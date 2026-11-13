//! Imported media (pictures, videos, audio), media playlists and playback.
//! Media is always copied into the data folder on import, so it keeps working when the
//! original file is moved or deleted. Everything else references media by id.

pub mod library;
pub mod player;
pub mod playlists;

pub use library::{MediaItem, MediaKind, MediaLibrary};
pub use player::{MediaPlayer, Slot};
pub use playlists::{EndAction, MediaPlaylist, PlaylistKind};
