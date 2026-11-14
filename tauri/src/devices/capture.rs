//! Live camera / capture-card frames. A capture thread starts the first time a device's
//! frames are requested and stops by itself when nobody asked for a while. Frames are
//! kept as JPEG, which browsers, webviews and canvases can all draw.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    thread,
    time::Duration,
};

use crate::storage::now_ms;

const IDLE_STOP_MS: i64 = 8_000;

pub struct Session {
    latest: RwLock<Option<Arc<Vec<u8>>>>,
    seq: AtomicU64,
    last_access: AtomicI64,
    stop: AtomicBool,
    error: Mutex<Option<String>>,
}

impl Session {
    fn touch(&self) {
        self.last_access.store(now_ms(), Ordering::Relaxed);
    }
    pub fn frame(&self) -> Option<(u64, Arc<Vec<u8>>)> {
        self.touch();
        let frame = self.latest.read().unwrap().clone()?;
        Some((self.seq.load(Ordering::Relaxed), frame))
    }
    pub fn error(&self) -> Option<String> {
        self.error.lock().unwrap().clone()
    }
}

#[derive(Default)]
pub struct CaptureManager {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    /// Preferred (width, height, fps) per device, from the configured video inputs.
    formats: Mutex<HashMap<String, (u32, u32, u32)>>,
}

impl CaptureManager {
    /// The session for a namespaced device id (`nokhwa:0`), starting it if needed.
    pub fn session(&self, device_id: &str) -> Arc<Session> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(existing) = sessions.get(device_id) {
            if !existing.stop.load(Ordering::Relaxed) {
                existing.touch();
                return existing.clone();
            }
        }
        let session = Arc::new(Session {
            latest: RwLock::new(None),
            seq: AtomicU64::new(0),
            last_access: AtomicI64::new(now_ms()),
            stop: AtomicBool::new(false),
            error: Mutex::new(None),
        });
        sessions.insert(device_id.to_string(), session.clone());
        let id = device_id.to_string();
        let worker = session.clone();
        let format = self.formats.lock().unwrap().get(device_id).copied();
        thread::Builder::new()
            .name(format!("capture-{id}"))
            .spawn(move || {
                if let Err(e) = run(&id, &worker, format) {
                    tracing::warn!("capture `{id}` stopped: {e}");
                    *worker.error.lock().unwrap() = Some(e);
                }
                worker.stop.store(true, Ordering::Relaxed);
            })
            .expect("cannot start capture thread");
        session
    }

    /// Sets the formats to capture in; devices whose format changed restart.
    pub fn set_formats(&self, formats: HashMap<String, (u32, u32, u32)>) {
        let mut current = self.formats.lock().unwrap();
        let sessions = self.sessions.lock().unwrap();
        for (device, session) in sessions.iter() {
            if current.get(device) != formats.get(device) {
                session.stop.store(true, Ordering::Relaxed);
            }
        }
        *current = formats;
    }

    pub fn stop_all(&self) {
        for session in self.sessions.lock().unwrap().values() {
            session.stop.store(true, Ordering::Relaxed);
        }
    }
}

fn run(device_id: &str, session: &Session, format: Option<(u32, u32, u32)>) -> Result<(), String> {
    if let Some(name) = device_id.strip_prefix("mock-video:") {
        return run_mock(name, session);
    }
    let raw = device_id.strip_prefix("nokhwa:").ok_or("unsupported video device")?;
    run_nokhwa(raw, session, format.unwrap_or((1280, 720, 30)))
}

fn run_nokhwa(raw: &str, session: &Session, (width, height, fps): (u32, u32, u32)) -> Result<(), String> {
    use nokhwa::{
        pixel_format::RgbFormat,
        utils::{CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType, Resolution},
        Camera,
    };
    let index = match raw.parse::<u32>() {
        Ok(n) => CameraIndex::Index(n),
        Err(_) => CameraIndex::String(raw.to_string()),
    };
    let preferred = RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(CameraFormat::new(
        Resolution::new(width, height),
        FrameFormat::MJPEG,
        fps,
    )));
    let mut camera = Camera::new(index.clone(), preferred)
        .or_else(|_| {
            Camera::new(
                index,
                RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate),
            )
        })
        .map_err(|e| e.to_string())?;
    camera.open_stream().map_err(|e| e.to_string())?;
    while !session.stop.load(Ordering::Relaxed) {
        if now_ms() - session.last_access.load(Ordering::Relaxed) > IDLE_STOP_MS {
            break;
        }
        let buffer = match camera.frame() {
            Ok(b) => b,
            Err(e) => {
                *session.error.lock().unwrap() = Some(e.to_string());
                thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        let jpeg = if buffer.source_frame_format() == FrameFormat::MJPEG {
            buffer.buffer().to_vec()
        } else {
            let image = buffer.decode_image::<RgbFormat>().map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
                .encode_image(&image)
                .map_err(|e| e.to_string())?;
            out
        };
        *session.latest.write().unwrap() = Some(Arc::new(jpeg));
        session.seq.fetch_add(1, Ordering::Relaxed);
    }
    let _ = camera.stop_stream();
    Ok(())
}

/// A moving test pattern for the mock devices (OPENPRES_MOCK_DEVICES).
fn run_mock(name: &str, session: &Session) -> Result<(), String> {
    let (w, h) = (640u32, 360u32);
    let mut t = 0u32;
    let shift = name.bytes().fold(0u32, |a, b| a.wrapping_add(b as u32));
    while !session.stop.load(Ordering::Relaxed) {
        if now_ms() - session.last_access.load(Ordering::Relaxed) > IDLE_STOP_MS {
            break;
        }
        let img = image::RgbImage::from_fn(w, h, |x, y| {
            let bar = ((x + t * 4 + shift) / 80) % 6;
            let base: [u8; 3] = [[200, 60, 60], [60, 200, 60], [60, 60, 200], [200, 200, 60], [60, 200, 200], [200, 60, 200]][bar as usize];
            let shade = (y * 255 / h) as u8 / 3;
            image::Rgb([base[0].saturating_sub(shade), base[1].saturating_sub(shade), base[2].saturating_sub(shade)])
        });
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 70)
            .encode_image(&img)
            .map_err(|e| e.to_string())?;
        *session.latest.write().unwrap() = Some(Arc::new(out));
        session.seq.fetch_add(1, Ordering::Relaxed);
        t = t.wrapping_add(1);
        thread::sleep(Duration::from_millis(66));
    }
    Ok(())
}
