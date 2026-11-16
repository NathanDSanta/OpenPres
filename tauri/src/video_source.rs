//! Pictures and videos decoded natively (ffmpeg) for the stream, already fitted to where
//! they go, like OBS's media source: a video's frames arrive at the stream's frame rate
//! and are shown by their time, instead of being captured from a window.

use crate::theme::style::MediaFit;
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        mpsc::{self, Receiver, TryRecvError},
        Arc, Mutex,
    },
    thread,
};

pub use crate::yuv::Image;

/// ffmpeg filters that fit the input into w x h like the screens do (CSS object-fit), in
/// YUV 4:2:0 BT.709 (what the stream is put together in).
fn fit_filter(fit: MediaFit, w: u32, h: u32) -> String {
    let scale = "flags=bilinear:force_divisible_by=2:out_color_matrix=bt709:out_range=tv";
    match fit {
        MediaFit::Cover => format!("scale={w}:{h}:force_original_aspect_ratio=increase:{scale},crop={w}:{h},setsar=1,format=yuv420p"),
        MediaFit::Contain => {
            format!("scale={w}:{h}:force_original_aspect_ratio=decrease:{scale},format=yuva420p,pad={w}:{h}:-1:-1:color=black@0,setsar=1")
        }
        MediaFit::Stretch => format!("scale={w}:{h}:{scale},setsar=1,format=yuv420p"),
    }
}

/// Contain leaves transparent bars; cover and stretch fill the box.
fn has_alpha(fit: MediaFit) -> bool {
    fit == MediaFit::Contain
}

/// Bytes of one yuv420p (or yuva420p) picture.
fn frame_size(w: u32, h: u32, alpha: bool) -> usize {
    let luma = w as usize * h as usize;
    luma * 3 / 2 + if alpha { luma } else { 0 }
}

fn image_of(w: u32, h: u32, data: &[u8], alpha: bool) -> Image {
    let n = frame_size(w, h, false);
    Image::from_i420(w, h, &data[..n], alpha.then(|| &data[n..]))
}

fn command(ffmpeg: &str) -> Command {
    let mut cmd = Command::new(ffmpeg);
    crate::tools::no_window(&mut cmd);
    cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error"]);
    cmd
}

/// Decodes a picture (any format ffmpeg knows) fitted to w x h (even). Pictures keep
/// their transparency; fully opaque ones come back without.
pub fn load_picture(ffmpeg: &str, path: &Path, fit: MediaFit, w: u32, h: u32) -> Result<Image, String> {
    let filter = match fit {
        MediaFit::Contain => fit_filter(fit, w, h),
        _ => fit_filter(fit, w, h).replace("format=yuv420p", "format=yuva420p"),
    };
    let output = command(ffmpeg)
        .arg("-i")
        .arg(path)
        .args(["-frames:v", "1", "-vf", &filter, "-f", "rawvideo", "-pix_fmt", "yuva420p", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("cannot run ffmpeg: {e}"))?;
    if output.stdout.len() < frame_size(w, h, true) {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cannot read the picture: {}", err.lines().last().unwrap_or("no picture")));
    }
    Ok(image_of(w, h, &output.stdout, true))
}

/// A decoded frame and its number since the decoder started.
struct Frame {
    index: u64,
    image: Arc<Image>,
}

/// Frames decoded ahead at most (each is a full picture).
const QUEUE: usize = 3;

/// One ffmpeg process decoding a video from `start_ms` at `fps` frames per second.
pub struct VideoDecoder {
    child: Child,
    frames: Receiver<Frame>,
    /// The next frame, decoded but not due yet.
    pending: Option<Frame>,
    current: Option<Frame>,
    pub start_ms: f64,
    fps: f64,
    ended: bool,
}

impl VideoDecoder {
    #[allow(clippy::too_many_arguments)]
    pub fn start(ffmpeg: &str, path: &Path, start_ms: f64, fit: MediaFit, w: u32, h: u32, fps: u32, looped: bool) -> Result<Self, String> {
        let alpha = has_alpha(fit);
        let mut cmd = command(ffmpeg);
        if looped {
            cmd.args(["-stream_loop", "-1"]);
        }
        if start_ms > 0.0 {
            cmd.args(["-ss", &format!("{:.3}", start_ms / 1000.0)]);
        }
        let filter = format!("fps={fps},{}", fit_filter(fit, w, h));
        cmd.arg("-i")
            .arg(path)
            .args(["-an", "-sn", "-dn", "-vf", &filter, "-f", "rawvideo", "-pix_fmt", if alpha { "yuva420p" } else { "yuv420p" }])
            .arg("pipe:1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("cannot run ffmpeg: {e}"))?;
        let mut stdout = child.stdout.take().ok_or("no ffmpeg output")?;
        let (tx, rx) = mpsc::sync_channel::<Frame>(QUEUE);
        let size = frame_size(w, h, alpha);
        thread::Builder::new()
            .name("stream-decode".into())
            .spawn(move || {
                for index in 0.. {
                    let mut data = vec![0u8; size];
                    if stdout.read_exact(&mut data).is_err() {
                        break; // the end, or the decoder was stopped
                    }
                    let image = Arc::new(image_of(w, h, &data, alpha));
                    if tx.send(Frame { index, image }).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { child, frames: rx, pending: None, current: None, start_ms, fps: fps as f64, ended: false })
    }

    /// The frame to show when the video is at `media_ms`; true when it is a new one.
    pub fn frame_at(&mut self, media_ms: f64) -> (Option<Arc<Image>>, bool) {
        // The nearest frame. The decoder's frames are on the stream's beat (its fps filter),
        // so asking at exactly a frame's time must not depend on rounding errors: with
        // floor() a time a hair before a frame shows the previous one, and frames get
        // skipped and repeated in turn.
        let due = ((media_ms - self.start_ms) * self.fps / 1000.0).round().max(0.0) as u64;
        let mut changed = false;
        loop {
            if self.pending.is_none() {
                match self.frames.try_recv() {
                    Ok(frame) => self.pending = Some(frame),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        self.ended = true;
                        break;
                    }
                }
            }
            match self.pending.take() {
                Some(frame) if frame.index <= due || self.current.is_none() => {
                    // Nothing shown yet: show the first frame as soon as it is there.
                    self.current = Some(frame);
                    changed = true;
                }
                other => {
                    self.pending = other;
                    break;
                }
            }
        }
        (self.current.as_ref().map(|f| f.image.clone()), changed)
    }

    /// How far behind the wanted time the shown frame is (ms); 0 when on time.
    pub fn behind_ms(&self, media_ms: f64) -> f64 {
        let shown = self.current.as_ref().map(|f| self.start_ms + f.index as f64 * 1000.0 / self.fps).unwrap_or(self.start_ms);
        (media_ms - shown).max(0.0)
    }

    /// Played to the end (not for looping videos).
    pub fn ended(&self) -> bool {
        self.ended && self.pending.is_none()
    }

    pub fn has_frame(&self) -> bool {
        self.current.is_some()
    }

    pub fn current(&self) -> Option<Arc<Image>> {
        self.current.as_ref().map(|f| f.image.clone())
    }
}

impl Drop for VideoDecoder {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// What a source shows and how its time runs.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceSpec {
    pub path: PathBuf,
    pub video: bool,
    pub fit: MediaFit,
    pub looped: bool,
    pub width: u32,
    pub height: u32,
}

/// Where a video is: its own clock from when it appeared, or the media player's.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Clock {
    Free,
    Player { position_ms: u64, anchor_ms: i64, playing: bool },
}

impl Clock {
    /// Where the video is at `now_ms` (epoch ms, fractional). `started_ms`: when a free
    /// running one started.
    fn media_ms(&self, started_ms: f64, now_ms: f64) -> f64 {
        match *self {
            Clock::Free => (now_ms - started_ms).max(0.0),
            Clock::Player { position_ms, anchor_ms, playing } => {
                if playing {
                    position_ms as f64 + (now_ms - anchor_ms as f64).max(0.0)
                } else {
                    position_ms as f64
                }
            }
        }
    }
}

/// A decoder that fell this far behind is restarted at the right time.
const RESYNC_MS: f64 = 1000.0;

/// One picture or video shown in the stream.
pub struct Source {
    pub spec: SourceSpec,
    clock: Clock,
    started_ms: f64,
    ffmpeg: String,
    fps: u32,
    picture: Arc<Mutex<Option<Arc<Image>>>>,
    picture_shown: bool,
    decoder: Option<VideoDecoder>,
    /// The frame shown before the decoder was restarted, until the new one has one.
    last: Option<Arc<Image>>,
    pub failed: bool,
}

impl Source {
    /// `now_ms`: the time of the stream frame being made (epoch ms; see `frame`).
    pub fn new(spec: SourceSpec, clock: Clock, ffmpeg: &str, fps: u32, now_ms: f64) -> Self {
        let picture = Arc::new(Mutex::new(None));
        let mut source = Self {
            spec,
            clock,
            started_ms: now_ms,
            ffmpeg: ffmpeg.to_string(),
            fps,
            picture: picture.clone(),
            picture_shown: false,
            decoder: None,
            last: None,
            failed: false,
        };
        if source.spec.video {
            source.restart(now_ms);
        } else {
            // Pictures load in the background; nothing shows until they are ready.
            let (ffmpeg, spec) = (source.ffmpeg.clone(), source.spec.clone());
            thread::Builder::new()
                .name("stream-picture".into())
                .spawn(move || match load_picture(&ffmpeg, &spec.path, spec.fit, spec.width, spec.height) {
                    Ok(img) => *picture.lock().unwrap() = Some(Arc::new(img)),
                    Err(e) => tracing::warn!("stream: {}: {e}", spec.path.display()),
                })
                .ok();
        }
        source
    }

    fn restart(&mut self, now_ms: f64) {
        if let Some(img) = self.decoder.as_ref().and_then(|d| d.current()) {
            self.last = Some(img);
        }
        self.decoder = None;
        let at = self.clock.media_ms(self.started_ms, now_ms);
        match VideoDecoder::start(&self.ffmpeg, &self.spec.path, at, self.spec.fit, self.spec.width, self.spec.height, self.fps, self.spec.looped) {
            Ok(d) => self.decoder = Some(d),
            Err(e) => {
                tracing::warn!("stream: {}: {e}", self.spec.path.display());
                self.failed = true;
            }
        }
    }

    /// Follows the media player: a jump (seek, pause, play) restarts the decoder there.
    pub fn set_clock(&mut self, clock: Clock, now_ms: f64) {
        if clock == self.clock {
            return;
        }
        let before = self.clock.media_ms(self.started_ms, now_ms);
        let paused_now = matches!(clock, Clock::Player { playing: false, .. });
        self.clock = clock;
        let after = self.clock.media_ms(self.started_ms, now_ms);
        if self.spec.video && ((after - before).abs() > 150.0 || paused_now) {
            self.restart(now_ms);
        }
    }

    /// The picture for the stream frame due at `now_ms`, and whether it changed since the
    /// last call. That is the frame's place on the stream's clock, not the moment this
    /// runs: frames are picked on an exact beat even when the compositor runs a little
    /// early or late, so none are skipped or shown twice because of it.
    pub fn frame(&mut self, now_ms: f64) -> (Option<Arc<Image>>, bool) {
        if !self.spec.video {
            let picture = self.picture.lock().unwrap().clone();
            let changed = picture.is_some() && !self.picture_shown;
            self.picture_shown |= picture.is_some();
            return (picture, changed);
        }
        let at = self.clock.media_ms(self.started_ms, now_ms);
        let Some(decoder) = self.decoder.as_mut() else { return (self.last.clone(), false) };
        let (img, changed) = decoder.frame_at(at);
        // A video on the player's clock that can't keep up jumps ahead to where it should
        // be, like a player does. Looping backgrounds just go on.
        let late = decoder.has_frame() && decoder.behind_ms(at) > RESYNC_MS && !decoder.ended();
        let resync = late && matches!(self.clock, Clock::Player { playing: true, .. });
        if img.is_some() {
            self.last = None;
        }
        let shown = img.or_else(|| self.last.clone());
        if resync {
            tracing::info!("stream: {} fell {:.0} ms behind; restarting it at the right time", self.spec.path.display(), decoder.behind_ms(at));
            self.restart(now_ms);
        }
        (shown, changed)
    }

    /// A video (not looping) played to its end.
    pub fn ended(&self) -> bool {
        self.failed || self.decoder.as_ref().is_some_and(|d| d.ended())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn ffmpeg() -> Option<String> {
        let path = std::env::var("OPENPRES_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into());
        Command::new(&path).arg("-version").output().ok().filter(|o| o.status.success()).map(|_| path)
    }

    fn make_video(ffmpeg: &str, path: &Path) {
        // 2 s of 160x90 at 25 fps; the left half white, the right black.
        let status = Command::new(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=25:d=2", "-vf", "drawbox=x=0:y=0:w=80:h=90:color=white:t=fill"])
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn fit_filters() {
        assert!(fit_filter(MediaFit::Cover, 1920, 1080).contains("crop=1920:1080"));
        assert!(fit_filter(MediaFit::Contain, 1920, 1080).contains("pad=1920:1080:-1:-1:color=black@0"));
        assert!(has_alpha(MediaFit::Contain) && !has_alpha(MediaFit::Stretch));
        assert_eq!(frame_size(4, 2, false), 12);
        assert_eq!(frame_size(4, 2, true), 20);
    }

    /// Needs ffmpeg with libx264 (OPENPRES_TEST_FFMPEG or on the PATH).
    #[test]
    #[ignore]
    fn decodes_videos_by_time_and_fits_them() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("openpres-video-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("v.mp4");
        make_video(&ffmpeg, &path);

        // Contain into a tall box: bars above and below are transparent.
        let mut d = VideoDecoder::start(&ffmpeg, &path, 0.0, MediaFit::Contain, 32, 36, 30, false).unwrap();
        let t = Instant::now();
        let mut first = None;
        while first.is_none() && t.elapsed().as_secs() < 5 {
            first = d.frame_at(0.0).0;
            thread::sleep(std::time::Duration::from_millis(10));
        }
        let img = first.expect("a first frame");
        assert_eq!((img.width, img.height), (32, 36));
        let alpha = img.alpha.as_ref().expect("bars are transparent");
        assert_eq!(alpha.luma[0], 0, "top bar transparent");
        let mid = 18 * 32 + 4;
        assert!(img.y[mid] > 200 && alpha.luma[mid] == 255, "white on the left: {}", img.y[mid]);
        // Frames are given out by time: 1 s in is frame 30.
        let t = Instant::now();
        while t.elapsed().as_secs() < 5 && d.behind_ms(1000.0) > 0.0 {
            d.frame_at(1000.0);
            thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_eq!(d.behind_ms(1000.0), 0.0);
        // And it ends.
        let t = Instant::now();
        while t.elapsed().as_secs() < 5 && !d.ended() {
            d.frame_at(10_000.0);
            thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(d.ended());

        let pic = load_picture(&ffmpeg, &path, MediaFit::Cover, 20, 20).unwrap();
        assert_eq!((pic.width, pic.height), (20, 20));
        assert!(pic.opaque(), "a video frame is opaque");
        std::fs::remove_dir_all(dir).ok();
    }

    /// The stream asks for frames on its beat, and its times can land a hair before a
    /// frame's (floating point): every frame must still be shown once, none twice.
    #[test]
    #[ignore]
    fn every_frame_is_shown_once_on_the_beat() {
        let Some(ffmpeg) = ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("openpres-beat-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("v.mp4");
        make_video(&ffmpeg, &path);
        let start = 267.175_312_5;
        let mut d = VideoDecoder::start(&ffmpeg, &path, start, MediaFit::Stretch, 16, 16, 30, false).unwrap();
        for k in 0..30u32 {
            let at = start + k as f64 * (1000.0 / 30.0) - 1e-9;
            let t = Instant::now();
            let mut changed = false;
            while !changed && t.elapsed().as_secs() < 5 {
                changed = d.frame_at(at).1;
                if !changed {
                    thread::sleep(std::time::Duration::from_millis(2));
                }
            }
            assert!(changed, "frame {k} was not shown");
            assert_eq!(d.current.as_ref().unwrap().index, k as u64, "frame {k}");
        }
        std::fs::remove_dir_all(dir).ok();
    }
}
