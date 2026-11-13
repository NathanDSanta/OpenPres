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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaylistKind {
    /// Audio files, played on the audio slot.
    Audio,
    /// Pictures and videos, shown on the media layer.
    Visual,
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

pub fn validate(p: &MediaPlaylist) -> Result<(), AppError> {
    if p.name.trim().is_empty() || p.name.len() > 100 {
        return Err(AppError::BadRequest("playlist name must be 1-100 characters".into()));
    }
    if !(1..=crate::audio::BUSES).contains(&p.bus) {
        return Err(AppError::BadRequest("bus must be between 1 and 16".into()));
    }
    Ok(())
}
