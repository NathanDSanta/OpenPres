//! The stream's picture, put together natively.
//!
//! The video input layer (camera / capture card) comes straight from the capture thread and
//! everything drawn above it (media, slides, Bible, announcements, props, mask) is drawn by
//! the app's main window as an overlay, uploaded only when it changes. Each tick (the
//! stream's frame rate) the latest camera frame and the latest overlay are combined and
//! written to ffmpeg as raw RGB, so the camera moves at its own frame rate whatever the
//! webview manages, and no extra window is needed.

use std::{
    collections::VecDeque,
    io::Write,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
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

/// Everything above the camera, drawn by the main window: straight (not premultiplied)
/// RGBA, the stream's size.
pub struct Overlay {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Set while the video input layer is on.
    pub camera: Option<CameraSlot>,
    /// Every pixel is opaque: the overlay is the whole picture.
    pub opaque: bool,
}

impl Overlay {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>, camera: Option<CameraSlot>) -> Result<Self, String> {
        if rgba.len() != (width as usize) * (height as usize) * 4 {
            return Err(format!("expected {}x{} RGBA ({} bytes), got {} bytes", width, height, width as usize * height as usize * 4, rgba.len()));
        }
        let camera = camera.and_then(|c| clamp_slot(c, width, height));
        let opaque = rgba.chunks_exact(4).all(|p| p[3] == 255);
        Ok(Self { width, height, rgba, camera, opaque })
    }
}

fn clamp_slot(mut c: CameraSlot, width: u32, height: u32) -> Option<CameraSlot> {
    c.x = c.x.min(width);
    c.y = c.y.min(height);
    c.w = c.w.min(width - c.x);
    c.h = c.h.min(height - c.y);
    (c.w >= 2 && c.h >= 2 && !c.device_id.is_empty()).then_some(c)
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
    rgb: Vec<u8>,
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
        let mut queue = self.queue.lock().unwrap();
        if !queue.is_empty() {
            queue.clear();
        }
        self.cleared.fetch_add(1, Ordering::Release);
    }
}

pub struct Compositor {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// Counters shown in the stream status.
#[derive(Default)]
pub struct Stats {
    /// Frames written to ffmpeg.
    pub frames: AtomicU64,
    /// Camera frames decoded (the camera's real frame rate).
    pub camera_frames: AtomicU64,
    /// Overlays received from the main window.
    pub overlays: AtomicU64,
}

impl Compositor {
    /// Starts the compositor and camera threads; frames go to `out` until `stop` is set or
    /// writing fails (ffmpeg ended).
    pub fn start(
        self,
        overlay: Arc<OverlayCell>,
        camera: CameraSource,
        out: Box<dyn Write + Send>,
        stop: Arc<AtomicBool>,
        stats: Arc<Stats>,
    ) {
        let cam = Arc::new(CameraCell::default());
        {
            let (overlay, cam, stop, stats) = (overlay.clone(), cam.clone(), stop.clone(), stats.clone());
            thread::Builder::new()
                .name("stream-camera".into())
                .spawn(move || camera_loop(overlay, camera, cam, stop, stats))
                .ok();
        }
        // Frames -> ffmpeg. A small queue: if ffmpeg falls behind, frames are skipped
        // (ffmpeg repeats the previous one) instead of the picture falling behind.
        let (tx, rx) = mpsc::sync_channel::<Arc<Vec<u8>>>(2);
        {
            let (stop, stats) = (stop.clone(), stats.clone());
            thread::Builder::new()
                .name("stream-video".into())
                .spawn(move || {
                    let mut out = out;
                    for frame in rx {
                        if out.write_all(&frame).is_err() {
                            stop.store(true, Ordering::Relaxed);
                            break;
                        }
                        stats.frames.fetch_add(1, Ordering::Relaxed);
                    }
                    // Dropping the pipe lets ffmpeg finish the files cleanly.
                })
                .ok();
        }
        thread::Builder::new()
            .name("stream-compose".into())
            .spawn(move || self.compose_loop(overlay, cam, tx, stop))
            .ok();
    }

    fn compose_loop(self, overlay: Arc<OverlayCell>, cam: Arc<CameraCell>, tx: mpsc::SyncSender<Arc<Vec<u8>>>, stop: Arc<AtomicBool>) {
        let (w, h) = (self.width as usize, self.height as usize);
        let period = Duration::from_secs_f64(1.0 / self.fps.max(1) as f64);
        let mut frame = Arc::new(vec![0u8; w * h * 3]);
        let mut seen: Option<(u64, u64)> = None;
        let mut camera: Option<Arc<CameraImage>> = None;
        let mut next = Instant::now();
        while !stop.load(Ordering::Relaxed) {
            // One camera frame per tick, at most.
            let fresh = cam.next();
            let cleared = cam.cleared.load(Ordering::Acquire);
            if fresh.is_some() {
                camera = fresh.clone();
            } else if seen.is_some_and(|(_, c)| c != cleared) {
                camera = None;
            }
            let key = (overlay.seq(), cleared);
            if seen != Some(key) || fresh.is_some() {
                seen = Some(key);
                let ov = overlay.get().filter(|o| o.width == self.width && o.height == self.height);
                let mut buf = vec![0u8; w * h * 3];
                compose(&mut buf, self.width, ov.as_deref(), camera.as_deref());
                frame = Arc::new(buf);
            }
            match tx.try_send(frame.clone()) {
                Ok(()) | Err(mpsc::TrySendError::Full(_)) => {}
                Err(mpsc::TrySendError::Disconnected(_)) => break,
            }
            next += period;
            let now = Instant::now();
            if next > now {
                thread::sleep(next - now);
            } else if now - next > period * 4 {
                next = now; // far behind (e.g. the computer slept): don't try to catch up
            }
        }
    }
}

/// Black, then the camera in its slot, then the overlay.
fn compose(out: &mut [u8], width: u32, overlay: Option<&Overlay>, camera: Option<&CameraImage>) {
    if let Some(ov) = overlay.filter(|o| o.opaque) {
        for (o, p) in out.chunks_exact_mut(3).zip(ov.rgba.chunks_exact(4)) {
            o.copy_from_slice(&p[..3]);
        }
        return;
    }
    // `out` starts black.
    let wanted = overlay.and_then(|o| o.camera.as_ref());
    if let (Some(slot), Some(img)) = (wanted, camera) {
        if img.slot == *slot {
            let stride = width as usize * 3;
            let row = slot.w as usize * 3;
            for y in 0..slot.h as usize {
                let dst = (slot.y as usize + y) * stride + slot.x as usize * 3;
                out[dst..dst + row].copy_from_slice(&img.rgb[y * row..(y + 1) * row]);
            }
        }
    }
    if let Some(ov) = overlay {
        blend(out, &ov.rgba);
    }
}

/// Straight-alpha RGBA over RGB.
fn blend(out: &mut [u8], rgba: &[u8]) {
    for (o, p) in out.chunks_exact_mut(3).zip(rgba.chunks_exact(4)) {
        let a = p[3] as u32;
        if a == 0 {
            continue;
        }
        if a == 255 {
            o.copy_from_slice(&p[..3]);
            continue;
        }
        let ia = 255 - a;
        for c in 0..3 {
            o[c] = ((p[c] as u32 * a + o[c] as u32 * ia + 127) / 255) as u8;
        }
    }
}

/// Decodes and scales new camera frames as they arrive, for the slot the overlay asks for.
fn camera_loop(overlay: Arc<OverlayCell>, source: CameraSource, cam: Arc<CameraCell>, stop: Arc<AtomicBool>, stats: Arc<Stats>) {
    let mut resizer = fr::Resizer::new();
    // The slot and camera frame number last decoded.
    let mut last: Option<(CameraSlot, u64)> = None;
    while !stop.load(Ordering::Relaxed) {
        let slot = overlay.get().and_then(|o| o.camera.clone());
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
                cam.push(CameraImage { slot, rgb });
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

    fn overlay(w: u32, h: u32, px: [u8; 4], camera: Option<CameraSlot>) -> Overlay {
        Overlay::new(w, h, px.repeat((w * h) as usize), camera).unwrap()
    }

    #[test]
    fn opaque_overlay_is_the_picture() {
        let ov = overlay(4, 2, [10, 20, 30, 255], None);
        assert!(ov.opaque);
        let mut out = vec![0u8; 4 * 2 * 3];
        compose(&mut out, 4, Some(&ov), None);
        assert_eq!(&out[..3], &[10, 20, 30]);
    }

    #[test]
    fn camera_shows_through_a_transparent_overlay() {
        let slot = CameraSlot { device_id: "cam".into(), x: 1, y: 0, w: 2, h: 2 };
        let mut ov = overlay(4, 2, [0, 0, 0, 0], Some(slot.clone()));
        // Half-transparent white on the last pixel.
        let n = ov.rgba.len();
        ov.rgba[n - 4..].copy_from_slice(&[255, 255, 255, 128]);
        assert!(!ov.opaque);
        let cam = CameraImage { slot, rgb: vec![200; 2 * 2 * 3] };
        let mut out = vec![0u8; 4 * 2 * 3];
        compose(&mut out, 4, Some(&ov), Some(&cam));
        assert_eq!(&out[..3], &[0, 0, 0], "outside the slot stays black");
        assert_eq!(&out[3..6], &[200, 200, 200], "camera in its slot");
        let last = &out[out.len() - 3..];
        assert_eq!(last, &[128, 128, 128], "nothing under the last pixel: white at half over black");
        let mid = &out[(4 + 2) * 3..(4 + 2) * 3 + 3];
        assert_eq!(mid, &[200, 200, 200]);
    }

    #[test]
    fn camera_frames_arriving_together_are_shown_one_per_tick() {
        let cell = CameraCell::default();
        let slot = CameraSlot { device_id: "cam".into(), x: 0, y: 0, w: 2, h: 2 };
        for v in [1u8, 2, 3] {
            cell.push(CameraImage { slot: slot.clone(), rgb: vec![v; 12] });
        }
        // Only the newest two are kept (bounded delay), then one per tick.
        assert_eq!(cell.next().unwrap().rgb[0], 2);
        assert_eq!(cell.next().unwrap().rgb[0], 3);
        assert!(cell.next().is_none());
    }

    #[test]
    fn wrong_size_overlays_are_refused() {
        assert!(Overlay::new(4, 2, vec![0; 10], None).is_err());
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
        use std::time::Instant;
        let (w, h) = (1920usize, 1080usize);
        let cam = image::RgbImage::from_fn(1280, 720, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]));
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85).encode_image(&cam).unwrap();
        let mut resizer = fr::Resizer::new();
        let n = 60;
        let ms = |t: Instant| t.elapsed().as_secs_f64() * 1000.0 / n as f64;
        let t = Instant::now();
        for _ in 0..n {
            decode_cover(&jpeg, w as u32, h as u32, &mut resizer).unwrap();
        }
        println!("camera 1280x720 JPEG -> 1920x1080: {:.2} ms per frame", ms(t));
        // A lower third: opaque bar with a half-transparent edge, the rest transparent.
        let mut rgba = vec![0u8; w * h * 4];
        for y in 800..1000 {
            for x in 100..1820 {
                let i = (y * w + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[255, 255, 255, if y < 810 { 128 } else { 255 }]);
            }
        }
        let slot = CameraSlot { device_id: "cam".into(), x: 0, y: 0, w: w as u32, h: h as u32 };
        let t = Instant::now();
        let ov = Overlay::new(w as u32, h as u32, rgba, Some(slot.clone())).unwrap();
        println!("overlay received (alpha scan): {:.2} ms", t.elapsed().as_secs_f64() * 1000.0);
        let image = CameraImage { slot, rgb: vec![90; w * h * 3] };
        let t = Instant::now();
        for _ in 0..n {
            let mut out = vec![0u8; w * h * 3];
            compose(&mut out, w as u32, Some(&ov), Some(&image));
        }
        println!("compose 1080p camera + lower third: {:.2} ms per frame", ms(t));
        let opaque = Overlay::new(w as u32, h as u32, vec![255u8; w * h * 4], None).unwrap();
        let t = Instant::now();
        for _ in 0..n {
            let mut out = vec![0u8; w * h * 3];
            compose(&mut out, w as u32, Some(&opaque), None);
        }
        println!("compose 1080p slides only: {:.2} ms per frame", ms(t));
    }
}
