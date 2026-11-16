//! The stream's picture, put together natively at a steady frame rate, like OBS's video
//! thread.
//!
//! Each tick (the stream's frame rate, on a precise clock) the compositor draws, inside the
//! streamed screen's area: the screen's background, the camera (video input layer) and the
//! media layer, decoded natively (video_source.rs), then the slides and graphics drawn by
//! the app's main window on top (an overlay it uploads only when it changes). Videos are
//! never copied out of a window, so they move at the full frame rate. Everything is put
//! together in YUV 4:2:0 (yuv.rs), the format the encoder takes, so video frames are never
//! converted to RGB and back.
//!
//! Every frame carries its time. When the computer falls behind (a tick missed) the
//! previous picture is repeated for the missed ticks, as OBS does ("frames missed due to
//! rendering lag"), so the video keeps its pace; when the encoder falls behind, frames are
//! skipped ("skipped due to encoding lag") without shifting the rest.

use crate::{
    mkv::{ticks_of_ms, Feed},
    storage::now_ms,
    stream_scene::{Background, BaseCell, MediaFile, Rect, StreamBase},
    theme::style::MediaFit,
    video_source::{Clock, Image, Source, SourceSpec},
    yuv::{black_frame, rgb_to_yuv, Frame},
};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use fast_image_resize as fr;

/// Where the camera goes in the stream picture (stream pixels).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CameraSlot {
    pub device_id: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// A design's background video, decoded natively under the overlay: the main window
/// leaves it out of the overlay and says where it goes.
#[derive(Debug, Clone, PartialEq)]
pub struct LookVideo {
    pub path: PathBuf,
    pub rect: Rect,
    pub fit: MediaFit,
    pub looped: bool,
}

/// The slides and graphics, drawn by the main window (straight RGBA, the stream's size),
/// kept in YUV with their transparency.
pub struct Overlay {
    pub width: u32,
    pub height: u32,
    image: Image,
    /// Per row, the first and last pixel that isn't transparent (blending skips the rest).
    spans: Vec<Option<(u32, u32)>>,
    /// Every pixel is opaque: the overlay is the whole picture.
    pub opaque: bool,
    pub look_video: Option<LookVideo>,
}

impl Overlay {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>, look_video: Option<LookVideo>) -> Result<Self, String> {
        if rgba.len() != (width as usize) * (height as usize) * 4 {
            return Err(format!("expected {}x{} RGBA ({} bytes), got {} bytes", width, height, width as usize * height as usize * 4, rgba.len()));
        }
        if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err("the stream's width and height are even".into());
        }
        let spans = rgba
            .chunks_exact(width as usize * 4)
            .map(|row| {
                let alpha = |x: &usize| row[x * 4 + 3] != 0;
                let first = (0..width as usize).find(alpha)?;
                let last = (0..width as usize).rev().find(alpha)?;
                Some((first as u32, last as u32))
            })
            .collect();
        let image = Image::from_rgb(width, height, &rgba, 4);
        let opaque = image.opaque();
        let look_video = look_video.and_then(|mut v| {
            v.rect = clamp_rect(v.rect, width, height)?;
            Some(v)
        });
        Ok(Self { width, height, image, spans, opaque, look_video })
    }
}

/// Inside the frame, on even pixels (chroma comes in 2x2 blocks).
fn clamp_rect(mut r: Rect, width: u32, height: u32) -> Option<Rect> {
    r.x = r.x.min(width) & !1;
    r.y = r.y.min(height) & !1;
    r.w = r.w.min(width - r.x) & !1;
    r.h = r.h.min(height - r.y) & !1;
    (r.w >= 2 && r.h >= 2).then_some(r)
}

/// The latest overlay, shared between the upload endpoint and the compositor.
#[derive(Default)]
pub struct OverlayCell {
    latest: Mutex<Option<Arc<Overlay>>>,
    seq: AtomicU64,
}

impl OverlayCell {
    pub fn set(&self, overlay: Overlay) {
        *self.latest.lock().unwrap() = Some(Arc::new(overlay));
        self.seq.fetch_add(1, Ordering::Release);
    }
    pub fn clear(&self) {
        *self.latest.lock().unwrap() = None;
        self.seq.fetch_add(1, Ordering::Release);
    }
    pub fn seq(&self) -> u64 {
        self.seq.load(Ordering::Acquire)
    }
    pub fn get(&self) -> Option<Arc<Overlay>> {
        self.latest.lock().unwrap().clone()
    }
}

/// Latest JPEG of a capture device: (frame number, bytes). Keeps the capture running.
pub type CameraSource = Arc<dyn Fn(&str) -> Option<(u64, Arc<Vec<u8>>)> + Send + Sync>;

/// A camera frame decoded and scaled to its slot.
struct CameraImage {
    slot: CameraSlot,
    image: Image,
}

/// Decoded camera frames waiting to be shown. Camera frames don't arrive on an exact beat:
/// with one queued, two arriving within one tick are shown on consecutive ticks instead of
/// one being lost.
#[derive(Default)]
struct CameraCell {
    queue: Mutex<VecDeque<Arc<CameraImage>>>,
    /// Bumped when the camera stops (the queue was emptied).
    cleared: AtomicU64,
}

/// Frames queued at most; older ones are dropped so the camera never lags behind.
const CAMERA_QUEUE: usize = 2;

impl CameraCell {
    fn push(&self, image: CameraImage) {
        let mut queue = self.queue.lock().unwrap();
        queue.push_back(Arc::new(image));
        while queue.len() > CAMERA_QUEUE {
            queue.pop_front();
        }
    }
    fn next(&self) -> Option<Arc<CameraImage>> {
        self.queue.lock().unwrap().pop_front()
    }
    fn clear(&self) {
        self.queue.lock().unwrap().clear();
        self.cleared.fetch_add(1, Ordering::Release);
    }
}

fn camera_slot(base: &StreamBase) -> Option<CameraSlot> {
    let device_id = base.camera.clone().filter(|d| !d.is_empty())?;
    let r = base.rect;
    Some(CameraSlot { device_id, x: r.x, y: r.y, w: r.w, h: r.h })
}

/// Counters shown in the stream status (OBS's statistics).
#[derive(Default)]
pub struct Stats {
    /// Frames written to the encoder.
    pub frames: AtomicU64,
    /// Different pictures put together (the frame rate of what moves).
    pub pictures: AtomicU64,
    /// Ticks the compositor was too late for: the previous picture was repeated.
    pub lagged: AtomicU64,
    /// Frames skipped because the encoder fell behind.
    pub skipped: AtomicU64,
    /// Camera frames decoded (the camera's real frame rate).
    pub camera_frames: AtomicU64,
    /// Overlays received from the main window.
    pub overlays: AtomicU64,
}

pub struct Compositor {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub ffmpeg: String,
}

/// Everything the compositor shows, and the decoders behind it.
struct Layers {
    ffmpeg: String,
    fps: u32,
    background: Option<(BackgroundKey, Source)>,
    /// A background folder: which item is on.
    folder: Option<(uuid::Uuid, usize)>,
    media: Option<Source>,
    look: Option<Source>,
}

/// What a background source shows (a change means a new source).
#[derive(Debug, Clone, PartialEq)]
enum BackgroundKey {
    Media(MediaFile, MediaFit, Rect),
    FolderItem(MediaFile, MediaFit, Rect, usize),
}

impl Layers {
    fn source(&self, file: &MediaFile, fit: MediaFit, rect: Rect, looped: bool, clock: Clock, now: f64) -> Source {
        let spec = SourceSpec { path: file.path.clone(), video: file.video, fit, looped, width: rect.w, height: rect.h };
        Source::new(spec, clock, &self.ffmpeg, self.fps, now)
    }

    /// Brings the sources in line with `base` and the overlay; true when a picture changed.
    fn update(&mut self, base: Option<&StreamBase>, overlay: Option<&Overlay>, now: f64) -> bool {
        let mut changed = false;
        // Background.
        let wanted: Option<(BackgroundKey, bool)> = base.and_then(|b| match &b.background {
            Background::Color(_) => None,
            Background::Media { file, fit } => Some((BackgroundKey::Media(file.clone(), *fit, b.rect), true)),
            Background::Folder { id, items, fit, seconds } => {
                if items.is_empty() {
                    return None;
                }
                let index = if items[0].video {
                    match self.folder {
                        Some((folder, i)) if folder == *id => i % items.len(),
                        _ => 0,
                    }
                } else {
                    ((now.max(0.0) as u64 / (*seconds as u64 * 1000)) % items.len() as u64) as usize
                };
                self.folder = Some((*id, index));
                let single = items.len() == 1;
                Some((BackgroundKey::FolderItem(items[index].clone(), *fit, b.rect, index), single))
            }
        });
        match wanted {
            None => {
                changed |= self.background.take().is_some();
                if base.is_some_and(|b| !matches!(b.background, Background::Folder { .. })) {
                    self.folder = None;
                }
            }
            Some((key, looped)) => {
                if self.background.as_ref().map(|(k, _)| k) != Some(&key) {
                    let source = match &key {
                        BackgroundKey::Media(file, fit, rect) | BackgroundKey::FolderItem(file, fit, rect, _) => self.source(file, *fit, *rect, looped, Clock::Free, now),
                    };
                    self.background = Some((key, source));
                    changed = true;
                }
            }
        }
        // A folder of videos goes to the next one at the end of each.
        if let (Some((_, source)), Some((id, index))) = (self.background.as_ref(), self.folder) {
            if source.spec.video && source.ended() {
                self.folder = Some((id, index + 1));
                self.background = None;
            }
        }
        // Media layer, on the media player's clock.
        match base.and_then(|b| b.media.as_ref().map(|m| (m, b.rect))) {
            None => changed |= self.media.take().is_some(),
            Some((m, rect)) => {
                let spec_matches = self.media.as_ref().is_some_and(|s| {
                    s.spec.path == m.file.path && s.spec.fit == m.fit && (s.spec.width, s.spec.height) == (rect.w, rect.h)
                });
                if spec_matches {
                    self.media.as_mut().unwrap().set_clock(m.clock, now);
                } else {
                    self.media = Some(self.source(&m.file, m.fit, rect, false, m.clock, now));
                    changed = true;
                }
            }
        }
        // A design's background video, under the overlay.
        match overlay.and_then(|o| o.look_video.as_ref()) {
            None => changed |= self.look.take().is_some(),
            Some(v) => {
                let same = self.look.as_ref().is_some_and(|s| s.spec.path == v.path && s.spec.fit == v.fit && (s.spec.width, s.spec.height) == (v.rect.w, v.rect.h));
                if !same {
                    let file = MediaFile { path: v.path.clone(), video: true };
                    self.look = Some(self.source(&file, v.fit, v.rect, v.looped, Clock::Free, now));
                    changed = true;
                }
            }
        }
        changed
    }
}

/// Sleeps until `deadline` precisely: the system sleep for most of it, then a short spin
/// (OBS does the same; plain sleeps can be a few milliseconds late, more on Windows).
fn sleep_until(deadline: Instant) {
    loop {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        let left = deadline - now;
        if left > Duration::from_micros(2000) {
            thread::sleep(left - Duration::from_micros(1500));
        } else {
            thread::yield_now();
        }
    }
}

/// Windows ticks its timers every 15.6 ms unless asked for 1 ms (OBS asks too).
#[cfg(windows)]
struct TimerResolution;
#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(period: u32) -> u32;
    fn timeEndPeriod(period: u32) -> u32;
}
#[cfg(windows)]
impl TimerResolution {
    fn fine() -> Self {
        unsafe { timeBeginPeriod(1) };
        TimerResolution
    }
}
#[cfg(windows)]
impl Drop for TimerResolution {
    fn drop(&mut self) {
        unsafe { timeEndPeriod(1) };
    }
}

impl Compositor {
    /// Starts the compositor and camera threads; frames go to `feed` from `start` (the
    /// stream's time zero) until `stop` is set.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        self,
        overlay: Arc<OverlayCell>,
        base: Arc<BaseCell>,
        camera: CameraSource,
        feed: Arc<Feed>,
        start: Instant,
        stop: Arc<AtomicBool>,
        stats: Arc<Stats>,
    ) {
        let cam = Arc::new(CameraCell::default());
        {
            let (base, cam, stop, stats) = (base.clone(), cam.clone(), stop.clone(), stats.clone());
            thread::Builder::new()
                .name("stream-camera".into())
                .spawn(move || camera_loop(base, camera, cam, stop, stats))
                .ok();
        }
        thread::Builder::new()
            .name("stream-compose".into())
            .spawn(move || self.compose_loop(overlay, base, cam, feed, start, stop, stats))
            .ok();
    }

    #[allow(clippy::too_many_arguments)]
    fn compose_loop(self, overlay: Arc<OverlayCell>, base: Arc<BaseCell>, cam: Arc<CameraCell>, feed: Arc<Feed>, start: Instant, stop: Arc<AtomicBool>, stats: Arc<Stats>) {
        #[cfg(windows)]
        let _timer = TimerResolution::fine();
        let fps = self.fps.max(1) as u64;
        let frame_ms = 1000.0 / fps as f64;
        let mut layers = Layers { ffmpeg: self.ffmpeg.clone(), fps: self.fps, background: None, folder: None, media: None, look: None };
        let mut frame: Arc<Vec<u8>> = Arc::new(black_frame(self.width, self.height));
        let mut seen: Option<(u64, u64, u64)> = None;
        let mut camera: Option<Arc<CameraImage>> = None;
        let mut index: u64 = 0;
        let send = |index: u64, frame: &Arc<Vec<u8>>| {
            if feed.video(ticks_of_ms(index as f64 * frame_ms), frame.clone()) {
                stats.frames.fetch_add(1, Ordering::Relaxed);
            } else {
                stats.skipped.fetch_add(1, Ordering::Relaxed);
            }
        };
        // The stream's clock in epoch ms (the media player's clock is epoch ms too).
        let epoch_at_start = now_ms() as f64 - start.elapsed().as_secs_f64() * 1000.0;
        while !stop.load(Ordering::Relaxed) {
            // This frame's place on the clock: videos show the frame for that moment.
            let now = epoch_at_start + index as f64 * frame_ms;
            let current_base = base.get();
            let current_overlay = overlay.get().filter(|o| o.width == self.width && o.height == self.height);
            let mut dirty = layers.update(current_base.as_deref(), current_overlay.as_deref(), now);

            // One camera frame per tick, at most.
            let fresh = cam.next();
            let cleared = cam.cleared.load(Ordering::Acquire);
            if fresh.is_some() {
                camera = fresh.clone();
                dirty = true;
            } else if seen.is_some_and(|(_, _, c)| c != cleared) {
                camera = None;
            }
            let key = (overlay.seq(), base.seq(), cleared);
            dirty |= seen != Some(key);
            seen = Some(key);

            // Every source's picture for now (videos move on even if nothing else did).
            let mut pictures: Vec<(Option<Arc<Image>>, Rect)> = Vec::with_capacity(3);
            if let Some(b) = current_base.as_deref() {
                if let Some((_, source)) = layers.background.as_mut() {
                    let (img, changed) = source.frame(now);
                    dirty |= changed;
                    pictures.push((img, b.rect));
                }
            }
            let media_picture = match (layers.media.as_mut(), current_base.as_deref()) {
                (Some(source), Some(b)) => {
                    let (img, changed) = source.frame(now);
                    dirty |= changed;
                    Some((img, b.rect))
                }
                _ => None,
            };
            let look_picture = match (layers.look.as_mut(), current_overlay.as_deref().and_then(|o| o.look_video.as_ref())) {
                (Some(source), Some(v)) => {
                    let (img, changed) = source.frame(now);
                    dirty |= changed;
                    Some((img, v.rect))
                }
                _ => None,
            };

            if dirty {
                let mut buf = black_frame(self.width, self.height);
                compose(
                    &mut Frame::new(&mut buf, self.width, self.height),
                    current_base.as_deref(),
                    &pictures,
                    camera.as_deref(),
                    media_picture.as_ref(),
                    look_picture.as_ref(),
                    current_overlay.as_deref(),
                );
                frame = Arc::new(buf);
                stats.pictures.fetch_add(1, Ordering::Relaxed);
            }
            send(index, &frame);

            // The next tick, on the clock that started with the stream.
            index += 1;
            sleep_until(start + Duration::from_secs_f64(index as f64 / fps as f64));
            let due = (start.elapsed().as_secs_f64() * fps as f64) as u64;
            if due > index {
                let missed = due - index;
                // Too late for some ticks: repeat the picture for them, like OBS. After a
                // long stall (the computer slept) the time just jumps.
                if missed <= fps * 2 {
                    for i in 0..missed {
                        send(index + i, &frame);
                    }
                }
                stats.lagged.fetch_add(missed, Ordering::Relaxed);
                index = due;
            }
        }
    }
}

/// Black, then in the screen's area: background, camera, media; then a design's video and
/// the overlay (slides and graphics) over everything.
#[allow(clippy::too_many_arguments)]
fn compose(
    out: &mut Frame,
    base: Option<&StreamBase>,
    backgrounds: &[(Option<Arc<Image>>, Rect)],
    camera: Option<&CameraImage>,
    media: Option<&(Option<Arc<Image>>, Rect)>,
    look: Option<&(Option<Arc<Image>>, Rect)>,
    overlay: Option<&Overlay>,
) {
    if let Some(ov) = overlay.filter(|o| o.opaque) {
        out.draw(&ov.image, 0, 0, None);
        return;
    }
    // `out` starts black.
    if let Some(b) = base {
        if let Background::Color([r, g, bl]) = b.background {
            out.fill(b.rect.x, b.rect.y, b.rect.w, b.rect.h, rgb_to_yuv(r, g, bl));
        }
        for (img, r) in backgrounds {
            if let Some(img) = img {
                out.draw(img, r.x, r.y, None);
            }
        }
        if let (Some(slot), Some(cam)) = (camera_slot(b), camera) {
            if cam.slot == slot {
                out.draw(&cam.image, slot.x, slot.y, None);
            }
        }
    }
    for (img, r) in media.into_iter().chain(look) {
        if let Some(img) = img {
            out.draw(img, r.x, r.y, None);
        }
    }
    if let Some(ov) = overlay {
        out.draw(&ov.image, 0, 0, Some(&ov.spans));
    }
}

/// Decodes and scales new camera frames as they arrive, for the slot of the base layers.
fn camera_loop(base: Arc<BaseCell>, source: CameraSource, cam: Arc<CameraCell>, stop: Arc<AtomicBool>, stats: Arc<Stats>) {
    let mut resizer = fr::Resizer::new();
    // The slot and camera frame number last decoded.
    let mut last: Option<(CameraSlot, u64)> = None;
    while !stop.load(Ordering::Relaxed) {
        let slot = base.get().and_then(|b| camera_slot(&b));
        let Some(slot) = slot else {
            if last.take().is_some() {
                cam.clear();
            }
            thread::sleep(Duration::from_millis(20));
            continue;
        };
        let Some((seq, jpeg)) = source(&slot.device_id) else {
            thread::sleep(Duration::from_millis(5));
            continue;
        };
        if last.as_ref() == Some(&(slot.clone(), seq)) {
            thread::sleep(Duration::from_millis(2));
            continue;
        }
        last = Some((slot.clone(), seq));
        match decode_cover(&jpeg, slot.w, slot.h, &mut resizer) {
            Ok(rgb) => {
                let image = Image::from_rgb(slot.w, slot.h, &rgb, 3);
                cam.push(CameraImage { slot, image });
                stats.camera_frames.fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => {
                tracing::debug!("camera frame skipped: {e}");
                thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

/// JPEG -> RGB scaled to cover w x h (cropping what doesn't fit), like the screens do.
fn decode_cover(jpeg: &[u8], w: u32, h: u32, resizer: &mut fr::Resizer) -> Result<Vec<u8>, String> {
    let decoded = match image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg) {
        Ok(img) => img,
        // Many webcams send MJPEG frames without Huffman tables; add the standard ones.
        Err(first) => match with_default_huffman_tables(jpeg) {
            Some(fixed) => image::load_from_memory_with_format(&fixed, image::ImageFormat::Jpeg).map_err(|_| first.to_string())?,
            None => return Err(first.to_string()),
        },
    };
    let rgb = decoded.into_rgb8();
    let (sw, sh) = rgb.dimensions();
    if sw == 0 || sh == 0 {
        return Err("empty camera frame".into());
    }
    if (sw, sh) == (w, h) {
        return Ok(rgb.into_raw());
    }
    let src = fr::images::Image::from_vec_u8(sw, sh, rgb.into_raw(), fr::PixelType::U8x3).map_err(|e| e.to_string())?;
    let mut dst = fr::images::Image::new(w, h, fr::PixelType::U8x3);
    // Crop the source to the slot's proportions (cover), centred.
    let (sw_f, sh_f) = (sw as f64, sh as f64);
    let scale = (w as f64 / sw_f).max(h as f64 / sh_f);
    let (cw, ch) = (w as f64 / scale, h as f64 / scale);
    let options = fr::ResizeOptions::new()
        .crop((sw_f - cw) / 2.0, (sh_f - ch) / 2.0, cw, ch)
        .resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Bilinear));
    resizer.resize(&src, &mut dst, &options).map_err(|e| e.to_string())?;
    Ok(dst.into_vec())
}

/// The standard Huffman tables (JPEG Annex K.3) that MJPEG cameras leave out.
const DEFAULT_DHT: [u8; 420] = [
    0xFF, 0xC4, 0x01, 0xA2, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x01, 0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x10,
    0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04,
    0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42,
    0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27,
    0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A,
    0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
    0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8,
    0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA,
    0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0x11, 0x00, 0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05,
    0x04, 0x04, 0x00, 0x01, 0x02, 0x77, 0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61,
    0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0, 0x15, 0x62, 0x72, 0xD1,
    0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66,
    0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A,
    0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4,
    0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7,
    0xD8, 0xD9, 0xDA, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
];

/// The JPEG with the standard Huffman tables inserted before the scan, when it has none.
fn with_default_huffman_tables(jpeg: &[u8]) -> Option<Vec<u8>> {
    let mut i = 2;
    while i + 4 <= jpeg.len() {
        if jpeg[i] != 0xFF {
            return None;
        }
        let marker = jpeg[i + 1];
        if marker == 0xC4 {
            return None; // has tables: the problem is something else
        }
        if marker == 0xDA {
            let mut fixed = Vec::with_capacity(jpeg.len() + DEFAULT_DHT.len());
            fixed.extend_from_slice(&jpeg[..i]);
            fixed.extend_from_slice(&DEFAULT_DHT);
            fixed.extend_from_slice(&jpeg[i..]);
            return Some(fixed);
        }
        let len = u16::from_be_bytes([jpeg[i + 2], jpeg[i + 3]]) as usize;
        i += 2 + len;
    }
    None
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream_scene::MediaLayer;

    fn overlay(w: u32, h: u32, px: [u8; 4]) -> Overlay {
        Overlay::new(w, h, px.repeat((w * h) as usize), None).unwrap()
    }

    fn base(rect: Rect, background: Background, camera: Option<&str>) -> StreamBase {
        StreamBase { rect, background, camera: camera.map(|c| c.to_string()), media: None }
    }

    /// Composes into a new black frame; returns its Y, U and V planes.
    fn composed(
        w: u32,
        h: u32,
        base: Option<&StreamBase>,
        camera: Option<&CameraImage>,
        media: Option<&(Option<Arc<Image>>, Rect)>,
        overlay: Option<&Overlay>,
    ) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut buf = black_frame(w, h);
        compose(&mut Frame::new(&mut buf, w, h), base, &[], camera, media, None, overlay);
        let n = (w * h) as usize;
        (buf[..n].to_vec(), buf[n..n + n / 4].to_vec(), buf[n + n / 4..].to_vec())
    }

    #[test]
    fn opaque_overlay_is_the_picture() {
        let ov = overlay(4, 2, [10, 20, 30, 255]);
        assert!(ov.opaque);
        let (y, u, v) = composed(4, 2, None, None, None, Some(&ov));
        let [cy, cu, cv] = rgb_to_yuv(10, 20, 30);
        assert_eq!((y[0], u[0], v[0]), (cy, cu, cv));
    }

    #[test]
    fn overlays_know_where_they_are_transparent() {
        let mut ov = overlay(4, 2, [0, 0, 0, 0]);
        assert!(!ov.opaque);
        assert_eq!(ov.spans, vec![None, None]);
        let mut rgba = vec![0u8; 4 * 2 * 4];
        rgba[(4 + 1) * 4..(4 + 3) * 4].copy_from_slice(&[255, 255, 255, 255, 255, 255, 255, 128]);
        ov = Overlay::new(4, 2, rgba, None).unwrap();
        assert_eq!(ov.spans, vec![None, Some((1, 2))]);
    }

    #[test]
    fn layers_stack_inside_the_screen_area() {
        // A 6x2 stream, the screen in the middle 2x2: background colour, then the camera
        // over it, then a half-transparent white overlay pixel.
        let rect = Rect { x: 2, y: 0, w: 2, h: 2 };
        let b = base(rect, Background::Color([10, 20, 30]), Some("cam"));
        let mut rgba = vec![0u8; 6 * 2 * 4];
        let n = rgba.len();
        rgba[n - 4..].copy_from_slice(&[255, 255, 255, 128]);
        let ov = Overlay::new(6, 2, rgba, None).unwrap();
        let (y, u, _) = composed(6, 2, Some(&b), None, None, Some(&ov));
        assert_eq!(y[0], crate::yuv::BLACK[0], "outside the screen stays black");
        assert_eq!((y[2], u[1]), (rgb_to_yuv(10, 20, 30)[0], rgb_to_yuv(10, 20, 30)[1]), "background colour");
        assert!((120..=131).contains(&y[11]), "outside: white at half over black: {}", y[11]);

        let slot = camera_slot(&b).unwrap();
        let cam = CameraImage { slot, image: Image::from_rgb(2, 2, &[200; 12], 3) };
        let (y, _, _) = composed(6, 2, Some(&b), Some(&cam), None, Some(&ov));
        assert_eq!(y[2], rgb_to_yuv(200, 200, 200)[0], "the camera covers the background");
    }

    #[test]
    fn media_with_transparent_bars_shows_what_is_under_it() {
        let rect = Rect { x: 0, y: 0, w: 2, h: 2 };
        let b = StreamBase {
            media: Some(MediaLayer {
                media_id: uuid::Uuid::nil(),
                file: MediaFile { path: "x".into(), video: true },
                fit: MediaFit::Contain,
                clock: Clock::Free,
            }),
            ..base(rect, Background::Color([50, 50, 50]), None)
        };
        // Top row: a transparent bar; bottom row: the video.
        let rgba = [0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255];
        let img = Arc::new(Image::from_rgb(2, 2, &rgba, 4));
        let (y, _, _) = composed(2, 2, Some(&b), None, Some(&(Some(img), rect)), None);
        assert_eq!(y[0], rgb_to_yuv(50, 50, 50)[0]);
        assert_eq!(y[2], rgb_to_yuv(255, 0, 0)[0]);
    }

    #[test]
    fn camera_frames_arriving_together_are_shown_one_per_tick() {
        let cell = CameraCell::default();
        let slot = CameraSlot { device_id: "cam".into(), x: 0, y: 0, w: 2, h: 2 };
        for v in [1u8, 2, 3] {
            cell.push(CameraImage { slot: slot.clone(), image: Image::from_i420(2, 2, &[v; 6], None) });
        }
        // Only the newest two are kept (bounded delay), then one per tick.
        assert_eq!(cell.next().unwrap().image.y[0], 2);
        assert_eq!(cell.next().unwrap().image.y[0], 3);
        assert!(cell.next().is_none());
    }

    #[test]
    fn wrong_size_overlays_are_refused() {
        assert!(Overlay::new(4, 2, vec![0; 10], None).is_err());
    }

    #[test]
    fn frames_keep_the_pace_and_carry_their_time() {
        // 1.0 s of a 30 fps stream: 30 frames, timed 0, 1/30 s, …
        let feed = Arc::new(Feed::default());
        let stop = Arc::new(AtomicBool::new(false));
        let stats = Arc::new(Stats::default());
        let base_cell = Arc::new(BaseCell::default());
        base_cell.set(Some(base(Rect { x: 0, y: 0, w: 16, h: 8 }, Background::Color([1, 2, 3]), None)));
        let start = Instant::now();
        Compositor { width: 16, height: 8, fps: 30, ffmpeg: "ffmpeg".into() }.start(
            Arc::new(OverlayCell::default()),
            base_cell,
            Arc::new(|_: &str| None),
            feed.clone(),
            start,
            stop.clone(),
            stats.clone(),
        );
        thread::sleep(Duration::from_millis(1000));
        stop.store(true, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(80));
        feed.close();
        struct Times(Vec<i64>);
        impl crate::mkv::Blocks for Times {
            fn block(&mut self, _: u8, ticks: i64, _: &[u8]) -> std::io::Result<()> {
                self.0.push(ticks);
                Ok(())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut times = Times(vec![]);
        feed.run(&mut times, || {}).unwrap();
        // The feed keeps the last 4 when nobody writes: what is left must be consecutive.
        let t = &times.0;
        assert!(t.windows(2).all(|w| w[1] - w[0] == 333 || w[1] - w[0] == 334), "{t:?}");
        let sent = stats.frames.load(Ordering::Relaxed) + stats.skipped.load(Ordering::Relaxed);
        assert!((29..=32).contains(&sent), "{sent} frames in a second");
        assert_eq!(stats.pictures.load(Ordering::Relaxed), 1, "nothing changed: one picture, repeated");
    }

    #[test]
    fn camera_frames_are_scaled_to_cover_their_slot() {
        // A 64x32 JPEG (wider than the 16x16 slot): cropped at the sides, scaled down.
        let img = image::RgbImage::from_fn(64, 32, |x, _| if (24..40).contains(&x) { image::Rgb([250, 10, 10]) } else { image::Rgb([10, 10, 250]) });
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95).encode_image(&img).unwrap();
        let mut resizer = fr::Resizer::new();
        let rgb = decode_cover(&jpeg, 16, 16, &mut resizer).unwrap();
        assert_eq!(rgb.len(), 16 * 16 * 3);
        let centre = &rgb[(8 * 16 + 8) * 3..(8 * 16 + 8) * 3 + 3];
        assert!(centre[0] > 200 && centre[2] < 60, "centre keeps the red band: {centre:?}");
    }

    #[test]
    fn mjpeg_without_tables_gets_the_standard_ones() {
        let img = image::RgbImage::from_pixel(16, 16, image::Rgb([90, 120, 150]));
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&img).unwrap();
        // Remove every DHT segment, like many webcams do.
        let mut stripped = jpeg[..2].to_vec();
        let mut i = 2;
        loop {
            let marker = jpeg[i + 1];
            if marker == 0xDA {
                stripped.extend_from_slice(&jpeg[i..]);
                break;
            }
            let len = u16::from_be_bytes([jpeg[i + 2], jpeg[i + 3]]) as usize;
            if marker != 0xC4 {
                stripped.extend_from_slice(&jpeg[i..i + 2 + len]);
            }
            i += 2 + len;
        }
        let fixed = with_default_huffman_tables(&stripped).expect("tables added");
        let decoded = image::load_from_memory_with_format(&fixed, image::ImageFormat::Jpeg).unwrap().into_rgb8();
        assert_eq!(decoded.dimensions(), (16, 16));
    }

    /// Timings in an optimized build: `cargo test --release --lib compositor::tests::speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn speed() {
        let (w, h) = (1920usize, 1080usize);
        let n = 60;
        let ms = |t: Instant| t.elapsed().as_secs_f64() * 1000.0 / n as f64;
        // A lower third: opaque bar with a half-transparent edge, the rest transparent.
        let mut rgba = vec![0u8; w * h * 4];
        for y in 800..1000 {
            for x in 100..1820 {
                let i = (y * w + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[255, 255, 255, if y < 810 { 128 } else { 255 }]);
            }
        }
        let t = Instant::now();
        let ov = Overlay::new(w as u32, h as u32, rgba, None).unwrap();
        println!("overlay received (alpha scan): {:.2} ms", t.elapsed().as_secs_f64() * 1000.0);
        let rect = Rect { x: 0, y: 0, w: w as u32, h: h as u32 };
        let b = base(rect, Background::Color([0, 0, 0]), None);
        let video = Arc::new(Image::from_i420(w as u32, h as u32, &vec![90; w * h * 3 / 2], None));
        let media = (Some(video), rect);
        let compose_n = |media: &(Option<Arc<Image>>, Rect)| {
            let t = Instant::now();
            for _ in 0..n {
                let mut buf = black_frame(w as u32, h as u32);
                compose(&mut Frame::new(&mut buf, w as u32, h as u32), Some(&b), &[], None, Some(media), None, Some(&ov));
            }
            ms(t)
        };
        println!("compose 1080p video + lower third: {:.2} ms per frame", compose_n(&media));
        // Letterboxed (contain): transparent bars at the top and bottom.
        let alpha: Vec<u8> = (0..h).flat_map(|y| std::iter::repeat(if (140..940).contains(&y) { 255 } else { 0 }).take(w)).collect();
        let contain = Arc::new(Image::from_i420(w as u32, h as u32, &vec![200; w * h * 3 / 2], Some(&alpha)));
        let media = (Some(contain), rect);
        let t = compose_n(&media);
        println!("compose 1080p video with transparency + lower third: {:.2} ms per frame", t);
    }
}
