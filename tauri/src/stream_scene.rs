//! What the stream draws natively under the slides and graphics: the screen's background,
//! the camera (video input layer) and the media layer, worked out from the app's state
//! whenever it changes. The main window draws only what goes above them.

use crate::{
    media::{MediaKind, Slot},
    screens::virtual_screen::ScreenBackground,
    state::SharedState,
    theme::style::MediaFit,
    video_source::Clock,
};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use uuid::Uuid;

/// The screen's area in the stream picture (the screen is fitted, centred, with black bars
/// when the proportions differ), in stream pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Same as the main window's: scale = min(W/sw, H/sh), centred.
pub fn screen_rect(screen_w: u32, screen_h: u32, w: u32, h: u32) -> Rect {
    let scale = (w as f64 / screen_w.max(1) as f64).min(h as f64 / screen_h.max(1) as f64);
    // Even position and size: the stream is YUV 4:2:0 (chroma in 2x2 blocks).
    let rw = ((screen_w as f64 * scale).round() as u32).clamp(2, w) & !1;
    let rh = ((screen_h as f64 * scale).round() as u32).clamp(2, h) & !1;
    Rect { x: ((w - rw) / 2) & !1, y: ((h - rh) / 2) & !1, w: rw, h: rh }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MediaFile {
    pub path: PathBuf,
    /// Videos, and animated GIFs, are decoded as videos.
    pub video: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Background {
    Color([u8; 3]),
    /// A picture, or a video that loops.
    Media { file: MediaFile, fit: MediaFit },
    /// A folder: pictures change every `seconds`; videos play one after another.
    Folder { id: Uuid, items: Vec<MediaFile>, fit: MediaFit, seconds: u32 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct MediaLayer {
    pub media_id: Uuid,
    pub file: MediaFile,
    pub fit: MediaFit,
    /// The media player's position (videos).
    pub clock: Clock,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StreamBase {
    pub rect: Rect,
    pub background: Background,
    /// Video input device, shown over the whole screen (cover).
    pub camera: Option<String>,
    pub media: Option<MediaLayer>,
}

/// "#rgb", "#rrggbb" or "#rrggbbaa" (alpha ignored); anything else is black.
pub fn parse_color(s: &str) -> [u8; 3] {
    let hex = s.trim().trim_start_matches('#');
    let digits: Vec<u8> = hex.chars().filter_map(|c| c.to_digit(16).map(|d| d as u8)).collect();
    if digits.len() != hex.len() {
        return [0, 0, 0];
    }
    match digits.len() {
        3 | 4 => [digits[0] * 17, digits[1] * 17, digits[2] * 17],
        6 | 8 => [digits[0] * 16 + digits[1], digits[2] * 16 + digits[3], digits[4] * 16 + digits[5]],
        _ => [0, 0, 0],
    }
}

fn is_animated(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("gif"))
}

/// The base layers of `screen_id` for a w x h stream, from the current state.
pub async fn compute(s: &SharedState, screen_id: Uuid, w: u32, h: u32) -> Option<StreamBase> {
    // Each lock is taken on its own, never two at once.
    let screen = s.screens.read().await.get(screen_id).ok()?.clone();
    let folder_ids = match &screen.background {
        ScreenBackground::Folder { folder_id, .. } => s
            .media_playlists
            .read()
            .await
            .value
            .playlists
            .iter()
            .find(|p| p.id == *folder_id)
            .map(|p| p.items.clone())
            .unwrap_or_default(),
        _ => vec![],
    };
    let camera = if screen.layers.video_input { s.live.read().await.video_input.clone() } else { None };
    let player = if screen.layers.media { s.player.state(Slot::Visual) } else { None };

    let media = s.media.read().await;
    let file = |id: Uuid| -> Option<MediaFile> {
        let item = media.get(id).ok()?;
        let path = media.path_of(item);
        let video = match item.kind {
            MediaKind::Video => true,
            MediaKind::Image => is_animated(&path),
            MediaKind::Audio => return None,
        };
        Some(MediaFile { path, video })
    };
    let background = match &screen.background {
        ScreenBackground::Color { color } => Background::Color(parse_color(color)),
        ScreenBackground::Media { media_id, fit } => match file(*media_id) {
            Some(file) => Background::Media { file, fit: *fit },
            None => Background::Color([0, 0, 0]),
        },
        ScreenBackground::Folder { folder_id, fit, seconds } => {
            let items: Vec<MediaFile> = folder_ids.into_iter().filter_map(&file).collect();
            // Like the screens: a folder starting with a video plays its videos.
            let videos = items.first().is_some_and(|f| f.video);
            let items = items.into_iter().filter(|f| f.video == videos).collect();
            Background::Folder { id: *folder_id, items, fit: *fit, seconds: (*seconds).max(1) }
        }
    };
    let media_layer = player.and_then(|state| {
        let file = file(state.media_id)?;
        let clock = Clock::Player { position_ms: state.position_ms, anchor_ms: state.anchor_ms, playing: state.playing };
        Some(MediaLayer { media_id: state.media_id, file, fit: state.fit, clock })
    });
    let rect = screen_rect(screen.width, screen.height, w, h);
    Some(StreamBase { rect, background, camera, media: media_layer })
}

/// The latest base layers, shared with the compositor.
#[derive(Default)]
pub struct BaseCell {
    latest: Mutex<Option<Arc<StreamBase>>>,
    seq: AtomicU64,
}

impl BaseCell {
    pub fn set(&self, base: Option<StreamBase>) {
        let mut latest = self.latest.lock().unwrap();
        if latest.as_deref() != base.as_ref() {
            *latest = base.map(Arc::new);
            self.seq.fetch_add(1, Ordering::Release);
        }
    }
    pub fn get(&self) -> Option<Arc<StreamBase>> {
        self.latest.lock().unwrap().clone()
    }
    pub fn seq(&self) -> u64 {
        self.seq.load(Ordering::Acquire)
    }
}

/// Keeps `cell` up to date while the stream runs: after every change, and every second.
pub fn watch(s: SharedState, cell: Arc<BaseCell>, screen_id: Uuid, w: u32, h: u32, stop: Arc<AtomicBool>) {
    tokio::spawn(async move {
        let mut events = s.events.subscribe();
        while !stop.load(Ordering::Relaxed) {
            cell.set(compute(&s, screen_id, w, h).await);
            let _ = tokio::time::timeout(Duration::from_secs(1), events.recv()).await;
            // Changes come in bursts (e.g. a song's slides): let them settle a moment.
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screens_are_fitted_and_centred() {
        assert_eq!(screen_rect(1920, 1080, 1280, 720), Rect { x: 0, y: 0, w: 1280, h: 720 });
        // A 4:3 screen in a 16:9 stream: bars left and right.
        assert_eq!(screen_rect(1024, 768, 1920, 1080), Rect { x: 240, y: 0, w: 1440, h: 1080 });
        // Always on even pixels: 1000x1000 in 1280x720 would be 720x720 at x 280; 999 tall
        // would be 721 wide.
        let r = screen_rect(1001, 999, 1280, 720);
        assert!(r.x % 2 == 0 && r.y % 2 == 0 && r.w % 2 == 0 && r.h % 2 == 0, "{r:?}");
    }

    #[test]
    fn colors() {
        assert_eq!(parse_color("#101018"), [16, 16, 24]);
        assert_eq!(parse_color("#fff"), [255, 255, 255]);
        assert_eq!(parse_color("#FF000080"), [255, 0, 0]);
        assert_eq!(parse_color("red"), [0, 0, 0]);
    }
}
