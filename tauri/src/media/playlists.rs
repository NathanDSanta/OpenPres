use super::{MediaItem, MediaKind};
use crate::{error::AppError, storage::JsonDoc, theme::style::MediaFit};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// What happens when an item finishes playing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndAction {
    /// Stop and clear (e.g. a backing track).
    #[default]
    Stop,
    /// Play the same item again.
    RepeatOne,
    /// Next item; clear after the last one.
    Next,
    /// Next item; after the last one start over (background music).
    LoopAll,
}

/// Media is organised in folders; a folder holds one kind of media and plays as a
/// playlist (with its end action, bus, fit...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaylistKind {
    /// Pictures, shown on the media layer.
    Image,
    /// Videos, shown on the media layer.
    Video,
    /// Audio files, played on the audio slot.
    Audio,
    /// Pictures and videos mixed (version 0.2 playlists; split into folders on load).
    Visual,
}

impl PlaylistKind {
    pub fn of(kind: MediaKind) -> Self {
        match kind {
            MediaKind::Image => PlaylistKind::Image,
            MediaKind::Video => PlaylistKind::Video,
            MediaKind::Audio => PlaylistKind::Audio,
        }
    }
    pub fn accepts(self, kind: MediaKind) -> bool {
        match self {
            PlaylistKind::Image => kind == MediaKind::Image,
            PlaylistKind::Video => kind == MediaKind::Video,
            PlaylistKind::Audio => kind == MediaKind::Audio,
            PlaylistKind::Visual => kind != MediaKind::Audio,
        }
    }
    pub fn is_audio(self) -> bool {
        self == PlaylistKind::Audio
    }
    fn default_name(self) -> &'static str {
        match self {
            PlaylistKind::Image => "Pictures",
            PlaylistKind::Video => "Videos",
            PlaylistKind::Audio => "Audio",
            PlaylistKind::Visual => "Media",
        }
    }
}

fn default_bus() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaPlaylist {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub name: String,
    pub kind: PlaylistKind,
    #[serde(default)]
    pub items: Vec<Uuid>,
    #[serde(default)]
    pub end_action: EndAction,
    /// Bus (1-16) the audio goes to.
    #[serde(default = "default_bus")]
    pub bus: u8,
    /// Sum the file's audio to mono on both bus sides.
    #[serde(default)]
    pub mono: bool,
    /// How pictures/videos fill the screen.
    #[serde(default)]
    pub fit: MediaFit,
    /// Seconds a picture stays before the end action runs (0 = until changed by hand).
    #[serde(default)]
    pub image_seconds: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlaylistsFile {
    pub playlists: Vec<MediaPlaylist>,
}

pub type MediaPlaylists = JsonDoc<PlaylistsFile>;

pub fn load(path: PathBuf) -> Result<MediaPlaylists, AppError> {
    JsonDoc::load(path)
}

pub fn new_folder(name: &str, kind: PlaylistKind) -> MediaPlaylist {
    MediaPlaylist {
        id: Uuid::new_v4(),
        name: name.to_string(),
        kind,
        items: vec![],
        end_action: match kind {
            PlaylistKind::Audio => EndAction::Next,
            _ => EndAction::LoopAll,
        },
        bus: 1,
        mono: false,
        fit: MediaFit::Cover,
        image_seconds: if kind == PlaylistKind::Image { 8 } else { 0 },
    }
}

/// Makes sure every media item is in exactly one folder of its own kind: splits mixed
/// picture/video playlists, removes duplicates and puts loose items in a default folder.
/// Returns true when something changed (and must be saved).
pub fn organise(doc: &mut PlaylistsFile, items: &[MediaItem]) -> bool {
    let mut changed = false;
    let kind_of = |id: &Uuid| items.iter().find(|m| m.id == *id).map(|m| m.kind);
    // 1. Split "visual" playlists into a picture folder and a video folder.
    let mut extra = Vec::new();
    for p in doc.playlists.iter_mut().filter(|p| p.kind == PlaylistKind::Visual) {
        let (videos, pictures): (Vec<Uuid>, Vec<Uuid>) =
            p.items.iter().partition(|id| kind_of(id) == Some(MediaKind::Video));
        if !videos.is_empty() && !pictures.is_empty() {
            let mut v = p.clone();
            v.id = Uuid::new_v4();
            v.name = format!("{} (videos)", p.name);
            v.kind = PlaylistKind::Video;
            v.items = videos;
            extra.push(v);
            p.items = pictures;
            p.kind = PlaylistKind::Image;
        } else {
            p.kind = if videos.is_empty() { PlaylistKind::Image } else { PlaylistKind::Video };
        }
        changed = true;
    }
    doc.playlists.extend(extra);
    // 2. Every item once, in a folder of the right kind.
    let mut seen = std::collections::HashSet::new();
    for p in doc.playlists.iter_mut() {
        let before = p.items.len();
        p.items.retain(|id| kind_of(id).is_some_and(|k| p.kind.accepts(k)) && seen.insert(*id));
        changed |= before != p.items.len();
    }
    // 3. Loose items go to a default folder per kind.
    for item in items {
        if seen.contains(&item.id) {
            continue;
        }
        let kind = PlaylistKind::of(item.kind);
        let folder = match doc.playlists.iter_mut().position(|p| p.kind == kind) {
            Some(i) => &mut doc.playlists[i],
            None => {
                doc.playlists.push(new_folder(kind.default_name(), kind));
                doc.playlists.last_mut().unwrap()
            }
        };
        folder.items.push(item.id);
        changed = true;
    }
    changed
}

pub fn validate(p: &MediaPlaylist) -> Result<(), AppError> {
    if p.name.trim().is_empty() || p.name.len() > 100 {
        return Err(AppError::BadRequest("folder name must be 1-100 characters".into()));
    }
    if !(1..=crate::audio::BUSES).contains(&p.bus) {
        return Err(AppError::BadRequest("bus must be between 1 and 16".into()));
    }
    Ok(())
}
