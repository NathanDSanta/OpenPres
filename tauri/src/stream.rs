//! Live streaming (YouTube RTMP) and local MP4 recording through ffmpeg.
//!
//! Like OBS: one clock for everything. The native compositor (compositor.rs) draws the
//! stream at a steady frame rate — the screen's background, camera and media layer
//! decoded natively, the slides and graphics from the main window on top — and the chosen
//! audio bus is captured in 10 ms blocks; both are timestamped on the clock that started
//! with the stream and handed to ffmpeg in one Matroska feed (mkv.rs), which encodes them
//! (x264 or the graphics card's encoder, encoders.rs) and sends them out.

use crate::{
    audio::{Graph, Node, ENGINE_RATE},
    compositor::{CameraSource, Compositor, Overlay, OverlayCell, Stats},
    encoders::{self, Encoder},
    error::AppError,
    events::EventHub,
    mkv::{self, Feed, PixelFormat, TrackInfo, Writer},
    storage::{now_ms, JsonDoc},
    stream_scene::BaseCell,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StreamSettings {
    pub screen_id: Option<Uuid>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub video_kbps: u32,
    pub audio_kbps: u32,
    /// Bus 1-16 sent as the stream's audio.
    pub bus: u8,
    pub mono: bool,
    pub send_rtmp: bool,
    pub rtmp_url: String,
    pub stream_key: String,
    pub record: bool,
    /// Folder for recordings; empty = [`default_record_dir`].
    pub record_dir: String,
    pub x264_preset: String,
    /// x264 on the processor or the graphics card's encoder (Automatic: the card's if it
    /// has one that works).
    pub encoder: Encoder,
    /// The broadcast on YouTube (a video, live or channel /live link), for the preview of
    /// what viewers get. Only played in the preview; nothing is sent to YouTube with it.
    pub youtube_url: String,
}

impl Default for StreamSettings {
    fn default() -> Self {
        Self {
            screen_id: None,
            width: 1280,
            height: 720,
            fps: 30,
            video_kbps: 4500,
            audio_kbps: 160,
            bus: 1,
            mono: false,
            send_rtmp: true,
            rtmp_url: "rtmp://a.rtmp.youtube.com/live2".into(),
            stream_key: String::new(),
            record: false,
            record_dir: String::new(),
            x264_preset: "veryfast".into(),
            encoder: Encoder::Auto,
            youtube_url: String::new(),
        }
    }
}

impl StreamSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(320..=3840).contains(&self.width) || !(180..=2160).contains(&self.height) {
            return Err(AppError::BadRequest("stream size must be between 320x180 and 3840x2160".into()));
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err(AppError::BadRequest("stream width and height must be even".into()));
        }
        if !(10..=60).contains(&self.fps) {
            return Err(AppError::BadRequest("fps must be between 10 and 60".into()));
        }
        if !(500..=20_000).contains(&self.video_kbps) || !(64..=320).contains(&self.audio_kbps) {
            return Err(AppError::BadRequest("bitrates are out of range".into()));
        }
        if !(1..=crate::audio::BUSES).contains(&self.bus) {
            return Err(AppError::BadRequest("bus must be between 1 and 16".into()));
        }
        let presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"];
        if !presets.contains(&self.x264_preset.as_str()) {
            return Err(AppError::BadRequest("unknown x264 preset".into()));
        }
        Ok(())
    }
}

/// What the main window must draw while the stream runs.
#[derive(Debug, Clone, Serialize)]
pub struct StreamVideo {
    pub screen_id: Uuid,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// What ffmpeg reports about the encoding (its -progress output), every second.
#[derive(Debug, Clone, Default, Serialize)]
pub struct EncoderProgress {
    /// Frames encoded per second.
    pub fps: f64,
    /// Encoding speed; below 1.0 the encoder can't keep up with real time.
    pub speed: f64,
    /// Bitrate sent (kbit/s).
    pub kbps: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StreamStatus {
    pub running: bool,
    pub started_at_ms: Option<i64>,
    pub streaming: bool,
    pub recording_file: Option<String>,
    /// The encoder in use, e.g. "x264 (processor)".
    pub encoder: Option<String>,
    /// Frames sent to the encoder.
    pub frames: u64,
    /// Different pictures put together (how smoothly things move).
    pub pictures: u64,
    /// Frames repeated because the compositor was late (OBS: rendering lag).
    pub lagged: u64,
    /// Frames skipped because the encoder fell behind (OBS: encoding lag).
    pub skipped: u64,
    /// Camera frames that went into the stream (the camera's own frame rate).
    pub camera_frames: u64,
    /// Pictures of the slides and graphics received from the main window.
    pub overlays: u64,
    pub progress: Option<EncoderProgress>,
    pub video: Option<StreamVideo>,
    pub error: Option<String>,
    pub log: Vec<String>,
}

struct Running {
    child: Arc<Mutex<Child>>,
    stop: Arc<AtomicBool>,
    feed: Arc<Feed>,
    sink: Uuid,
    video: StreamVideo,
}

pub struct StreamManager {
    pub settings: Mutex<JsonDoc<StreamSettings>>,
    running: Mutex<Option<Running>>,
    status: Arc<Mutex<StreamStatus>>,
    stats: Mutex<Arc<Stats>>,
    overlay: Arc<OverlayCell>,
    /// Background, camera and media layer of the streamed screen (kept up to date by
    /// stream_scene::watch while the stream runs).
    pub base: Arc<BaseCell>,
}

impl StreamManager {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            settings: Mutex::new(JsonDoc::load(path)?),
            running: Mutex::new(None),
            status: Arc::new(Mutex::new(StreamStatus::default())),
            stats: Mutex::new(Arc::new(Stats::default())),
            overlay: Arc::new(OverlayCell::default()),
            base: Arc::new(BaseCell::default()),
        })
    }

    pub fn status(&self) -> StreamStatus {
        let mut s = self.status.lock().unwrap().clone();
        let stats = self.stats.lock().unwrap().clone();
        s.frames = stats.frames.load(Ordering::Relaxed);
        s.pictures = stats.pictures.load(Ordering::Relaxed);
        s.lagged = stats.lagged.load(Ordering::Relaxed);
        s.skipped = stats.skipped.load(Ordering::Relaxed);
        s.camera_frames = stats.camera_frames.load(Ordering::Relaxed);
        s.overlays = stats.overlays.load(Ordering::Relaxed);
        s.video = self.running.lock().unwrap().as_ref().map(|r| r.video.clone());
        // Without the main window's picture the slides and graphics are missing: say so
        // instead of looking fine.
        if s.running && s.overlays == 0 && s.error.is_none() && s.started_at_ms.is_some_and(|t| now_ms() - t > 8000) {
            s.error = Some("the slides and graphics are not reaching the stream: keep the OpenPres window open (it can be minimized or covered)".into());
        }
        s
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap().is_some()
    }

    /// The screen the stream shows, its size and fps (for the base layers' watcher).
    pub fn settings_snapshot(&self) -> StreamSettings {
        self.settings.lock().unwrap().value.clone()
    }

    /// Starts the stream with `encoder` (already resolved: see encoders::resolve). Returns
    /// the flag that is set when it stops.
    pub fn start(
        &self,
        graph: Arc<Graph>,
        hub: Arc<EventHub>,
        camera: CameraSource,
        ffmpeg: &str,
        encoder: Encoder,
        data_dir: &std::path::Path,
    ) -> Result<Arc<AtomicBool>, AppError> {
        let mut running = self.running.lock().unwrap();
        if running.is_some() {
            return Err(AppError::Conflict("the stream is already running".into()));
        }
        let settings = self.settings.lock().unwrap().value.clone();
        settings.validate()?;
        let screen_id = settings
            .screen_id
            .ok_or_else(|| AppError::BadRequest("choose the virtual screen to stream".into()))?;
        let rtmp = settings.send_rtmp && !settings.stream_key.trim().is_empty();
        if settings.send_rtmp && !rtmp {
            return Err(AppError::BadRequest("enter the stream key (or turn off streaming and only record)".into()));
        }
        if !rtmp && !settings.record {
            return Err(AppError::BadRequest("turn on streaming and/or recording".into()));
        }

        let recording = if settings.record {
            let dir = if settings.record_dir.trim().is_empty() {
                default_record_dir().unwrap_or_else(|| data_dir.join("recordings"))
            } else {
                PathBuf::from(settings.record_dir.trim())
            };
            std::fs::create_dir_all(&dir)?;
            let stamp = chrono_like_stamp();
            Some(dir.join(format!("OpenPres {stamp}.mp4")))
        } else {
            None
        };

        let channels: u8 = if settings.mono { 1 } else { 2 };
        let params = encoders::Params { fps: settings.fps, kbps: settings.video_kbps, constant: rtmp, preset: settings.x264_preset.clone() };
        let mut cmd = Command::new(ffmpeg);
        cmd.args(["-hide_banner", "-loglevel", "warning", "-nostats", "-stats_period", "1", "-progress", "pipe:2"])
            .args(encoders::input_args(encoder))
            // Picture and sound, timestamped on one clock, in one feed on stdin.
            .args(["-f", "matroska", "-i", "pipe:0", "-map", "0:v", "-map", "0:a"])
            .args(encoders::video_args(encoder, &params))
            // Keep the feed's times (frames skipped by a slow encoder leave a gap instead
            // of shifting everything after them).
            .args(["-fps_mode", "passthrough"])
            .args(["-c:a", "aac", "-b:a", &format!("{}k", settings.audio_kbps), "-ar", "44100"])
            .args(["-flags", "+global_header"]);
        let rtmp_target = format!(
            "{}/{}",
            settings.rtmp_url.trim().trim_end_matches('/'),
            settings.stream_key.trim()
        );
        match (rtmp, &recording) {
            (true, Some(file)) => {
                cmd.args(["-f", "tee"]).arg(format!(
                    "[f=flv:onfail=ignore]{rtmp_target}|[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof]{}",
                    file.display()
                ));
            }
            (true, None) => {
                cmd.args(["-f", "flv"]).arg(&rtmp_target);
            }
            (false, Some(file)) => {
                cmd.args(["-f", "mp4", "-movflags", "+frag_keyframe+empty_moov+default_base_moof"])
                    .arg(file);
            }
            (false, None) => unreachable!(),
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
        crate::tools::no_window(&mut cmd);
        // Never the stream key in the log.
        let key = settings.stream_key.trim().to_string();
        let hide_key = move |line: &str| if key.is_empty() { line.to_string() } else { line.replace(&key, "<stream key>") };
        let what = match (rtmp, recording.is_some()) {
            (true, true) => "streaming + recording",
            (true, false) => "streaming",
            _ => "recording",
        };
        tracing::info!(
            target: "ffmpeg",
            "start: {what}, {}x{} {} fps, {} kbps, {} · {}",
            settings.width,
            settings.height,
            settings.fps,
            settings.video_kbps,
            encoder.label(),
            hide_key(&format!("{cmd:?}")),
        );
        let mut child = cmd.spawn().map_err(|e| {
            AppError::BadRequest(format!(
                "cannot start ffmpeg (`{ffmpeg}`): {e}. Check the ffmpeg path in Settings (empty = the one bundled with OpenPres)."
            ))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| AppError::Internal("no ffmpeg stdin".into()))?;
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let stop = Arc::new(AtomicBool::new(false));
        let stats = Arc::new(Stats::default());
        *self.stats.lock().unwrap() = stats.clone();
        self.overlay.clear();
        {
            let mut status = self.status.lock().unwrap();
            *status = StreamStatus {
                running: true,
                started_at_ms: Some(now_ms()),
                streaming: rtmp,
                recording_file: recording.as_ref().map(|p| p.display().to_string()),
                encoder: Some(encoder.label().to_string()),
                ..Default::default()
            };
        }

        // The stream's clock starts now, for the picture and the sound alike.
        let start = Instant::now();
        let feed = Arc::new(Feed::default());
        let tracks = TrackInfo {
            width: settings.width,
            height: settings.height,
            fps: settings.fps,
            pixel_format: PixelFormat::I420,
            sample_rate: ENGINE_RATE,
            channels,
        };
        {
            // Feed -> ffmpeg's stdin. Ending (stop, or ffmpeg gone) closes the pipe, which
            // lets ffmpeg finish the files cleanly.
            let (feed, stop) = (feed.clone(), stop.clone());
            thread::Builder::new()
                .name("stream-feed".into())
                .spawn(move || {
                    let result = Writer::new(stdin, &tracks).and_then(|mut w| feed.run(&mut w, || {}));
                    if result.is_err() {
                        stop.store(true, Ordering::Relaxed);
                        feed.close();
                    }
                })
                .ok();
        }

        Compositor { width: settings.width, height: settings.height, fps: settings.fps, ffmpeg: ffmpeg.to_string() }.start(
            self.overlay.clone(),
            self.base.clone(),
            camera,
            feed.clone(),
            start,
            stop.clone(),
            stats,
        );

        // Bus audio, in 10 ms blocks on the same clock.
        let sink = Node::new(Uuid::new_v4(), settings.bus, 1.0, false);
        let sink_id = sink.id;
        graph.add_consumer(sink.clone());
        {
            let (feed, stop) = (feed.clone(), stop.clone());
            let mono = settings.mono;
            thread::Builder::new()
                .name("stream-audio".into())
                .spawn(move || feed_audio(feed, sink, mono, start, stop))
                .ok();
        }

        // ffmpeg's messages and progress, and cleanup if it exits by itself.
        {
            let status = self.status.clone();
            let child = child.clone();
            let stop = stop.clone();
            let feed = feed.clone();
            let hub = hub.clone();
            thread::Builder::new()
                .name("stream-log".into())
                .spawn(move || {
                    let hide_key = hide_key;
                    let mut lines: VecDeque<String> = VecDeque::new();
                    let mut progress = EncoderProgress::default();
                    if let Some(stderr) = stderr {
                        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                            let line = line.trim().to_string();
                            if let Some((key, value)) = progress_entry(&line) {
                                match key {
                                    "fps" => progress.fps = value.parse().unwrap_or(0.0),
                                    "speed" => progress.speed = value.trim_end_matches('x').trim().parse().unwrap_or(0.0),
                                    "bitrate" => progress.kbps = value.trim_end_matches("kbits/s").trim().parse().unwrap_or(0.0),
                                    "progress" => status.lock().unwrap().progress = Some(progress.clone()),
                                    _ => {}
                                }
                                continue;
                            }
                            if !line.is_empty() {
                                tracing::info!(target: "ffmpeg", "{}", hide_key(&line));
                            }
                            // Harmless notices.
                            if line.is_empty()
                                || line.contains("deprecated pixel format")
                                // The feed's sound has no layout tag; mono or stereo is right.
                                || line.contains("Guessed Channel Layout")
                                || line.starts_with("Last message repeated")
                            {
                                continue;
                            }
                            lines.push_back(line);
                            if lines.len() > 30 {
                                lines.pop_front();
                            }
                            status.lock().unwrap().log = lines.iter().cloned().collect();
                        }
                    }
                    let code = child.lock().unwrap().wait().ok();
                    tracing::info!(target: "ffmpeg", "ended ({})", code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()));
                    if !stop.load(Ordering::Relaxed) {
                        let mut s = status.lock().unwrap();
                        s.running = false;
                        // ffmpeg ends with generic summaries ("Error opening input files: …",
                        // "Conversion failed!"); the line before them says what went wrong.
                        let generic = |l: &str| {
                            l.starts_with("Error opening input file")
                                || l.starts_with("Error opening output file")
                                || l.starts_with("Error parsing options")
                                || l.starts_with("Conversion failed")
                        };
                        let reason = lines
                            .iter()
                            .rev()
                            .find(|l| !generic(l))
                            .or_else(|| lines.back())
                            .cloned()
                            .unwrap_or_default();
                        s.error = Some(format!(
                            "ffmpeg stopped ({}). {}",
                            code.map(|c| c.to_string()).unwrap_or_default(),
                            reason
                        ));
                        let error = s.error.as_deref().unwrap_or("");
                        tracing::error!(target: "ffmpeg", "the stream stopped by itself: {}", hide_key(error));
                        stop.store(true, Ordering::Relaxed);
                        feed.close();
                        hub.changed();
                    }
                })
                .ok();
        }

        *running = Some(Running {
            child,
            stop: stop.clone(),
            feed,
            sink: sink_id,
            video: StreamVideo { screen_id, width: settings.width, height: settings.height, fps: settings.fps },
        });
        drop(running);
        hub.changed();
        Ok(stop)
    }

    /// The picture of the slides and graphics, from the main window.
    pub fn push_overlay(&self, overlay: Overlay) -> Result<(), AppError> {
        let running = self.running.lock().unwrap();
        let Some(r) = running.as_ref().filter(|r| !r.stop.load(Ordering::Relaxed)) else {
            return Err(AppError::Gone("the stream is not running".into()));
        };
        if (overlay.width, overlay.height) != (r.video.width, r.video.height) {
            return Err(AppError::Conflict(format!("the stream is {}x{}", r.video.width, r.video.height)));
        }
        self.stats.lock().unwrap().overlays.fetch_add(1, Ordering::Relaxed);
        self.overlay.set(overlay);
        Ok(())
    }

    pub fn stop(&self, graph: &Graph, hub: &EventHub) {
        let taken = self.running.lock().unwrap().take();
        if let Some(r) = taken {
            tracing::info!(target: "ffmpeg", "stop requested");
            // The compositor and audio stop; the feed writes what is queued and closes
            // ffmpeg's input, so it finishes the files.
            r.stop.store(true, Ordering::Relaxed);
            let (child, feed) = (r.child.clone(), r.feed.clone());
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(100));
                feed.close();
                let deadline = Instant::now() + Duration::from_secs(8);
                loop {
                    if let Ok(Some(_)) = child.lock().unwrap().try_wait() {
                        break;
                    }
                    if Instant::now() > deadline {
                        let _ = child.lock().unwrap().kill();
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            });
            graph.remove(r.sink);
        }
        {
            let mut s = self.status.lock().unwrap();
            s.running = false;
        }
        self.overlay.clear();
        self.base.set(None);
        hub.changed();
    }

    /// Clears a finished stream's error/status after the stream ended by itself.
    pub fn reap(&self, graph: &Graph) {
        let mut running = self.running.lock().unwrap();
        if running.as_ref().is_some_and(|r| r.stop.load(Ordering::Relaxed)) {
            if let Some(r) = running.take() {
                graph.remove(r.sink);
            }
        }
    }
}

/// A line of ffmpeg's -progress output ("fps=29.97", "speed=1.01x", "progress=continue").
fn progress_entry(line: &str) -> Option<(&str, &str)> {
    const KEYS: [&str; 12] = [
        "frame", "fps", "bitrate", "total_size", "out_time_us", "out_time_ms", "out_time", "dup_frames", "drop_frames", "speed", "progress", "stream_0_0_q",
    ];
    let (key, value) = line.split_once('=')?;
    (KEYS.contains(&key) || key.starts_with("stream_")).then_some((key, value))
}

/// The bus's sound in 10 ms blocks, each stamped with its time on the stream's clock. A
/// stall (the computer was busy) leaves a short gap rather than delaying the sound.
fn feed_audio(feed: Arc<Feed>, sink: Arc<Node>, mono: bool, start: Instant, stop: Arc<AtomicBool>) {
    let block_frames = (ENGINE_RATE / 100) as usize; // 10 ms
    let mut block = vec![0f32; block_frames * 2];
    let mut index: u64 = 0;
    while !stop.load(Ordering::Relaxed) {
        let due = (start.elapsed().as_secs_f64() * 100.0) as u64;
        if index >= due {
            thread::sleep(Duration::from_millis(3));
            continue;
        }
        if due - index > 50 {
            index = due - 1;
        }
        sink.consume(&mut block);
        let mut bytes: Vec<u8> = Vec::with_capacity(block_frames * if mono { 2 } else { 4 });
        for frame in block.chunks_exact(2) {
            let mut write = |v: f32| {
                let s = (v.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                bytes.extend_from_slice(&s.to_le_bytes());
            };
            if mono {
                write((frame[0] + frame[1]) * 0.5);
            } else {
                write(frame[0]);
                write(frame[1]);
            }
        }
        feed.audio(mkv::ticks_of_ms(index as f64 * 10.0), bytes);
        index += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::progress_entry;

    #[test]
    fn recordings_go_to_an_openpres_folder_in_videos() {
        if let Some(dir) = super::default_record_dir() {
            assert_eq!(dir.file_name().and_then(|n| n.to_str()), Some("OpenPres"));
        }
    }

    #[test]
    fn ffmpeg_progress_lines() {
        assert_eq!(progress_entry("speed=1.01x"), Some(("speed", "1.01x")));
        assert_eq!(progress_entry("progress=continue"), Some(("progress", "continue")));
        assert_eq!(progress_entry("[flv @ 0x55] Failed to update header with correct duration."), None);
        assert_eq!(progress_entry("Error opening output file rtmp://x"), None);
    }
}

/// Where recordings go when no folder is chosen: `OpenPres` in the user's Videos folder
/// (Windows `C:\Users\<name>\Videos\OpenPres`, macOS `~/Movies/OpenPres`, Linux
/// `~/Videos/OpenPres`). None if the system has no Videos folder (then `<data>/recordings`).
pub fn default_record_dir() -> Option<PathBuf> {
    directories::UserDirs::new().and_then(|u| u.video_dir().map(|v| v.join("OpenPres")))
}

/// "2026-11-13 20-05-09" in UTC, without pulling in a date crate.
fn chrono_like_stamp() -> String {
    let secs = now_ms() / 1000;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!("{y:04}-{mo:02}-{d:02} {h:02}-{m:02}-{s:02}")
}
