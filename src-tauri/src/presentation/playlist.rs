use crate::error::AppError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Just an ordered list of presentation identifiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: Uuid,
    pub name: String,
    pub presentation_ids: Vec<Uuid>,
}

pub struct PlaylistManager { pub playlists: Vec<Playlist> }

impl PlaylistManager {
    pub fn list(&self) -> &[Playlist] { todo!() }
    pub fn get(&self, id: Uuid) -> Result<&Playlist, AppError> { todo!() }
    pub fn create(&mut self, name: &str) -> Result<Playlist, AppError> { todo!() }
    pub fn update(&mut self, playlist: Playlist) -> Result<(), AppError> { todo!() }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> { todo!() }
}
