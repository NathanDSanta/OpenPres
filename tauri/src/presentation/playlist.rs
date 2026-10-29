use crate::{error::AppError, storage};
use axum::extract::Path;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// Just an ordered list of presentation identifiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: Uuid,
    pub name: String,
    pub presentation_ids: Vec<Uuid>,
}

pub struct PlaylistManager {
    pub playlists: Vec<Playlist>,
    pub dir: PathBuf,
}

fn validate_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest(
            "playlist name must be 1-100 characters".into(),
        ));
    }
    Ok(name.to_string())
}

impl PlaylistManager {
    pub fn load(dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&dir)?;
        let mut playlists = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("plist") {
                continue;
            }
            match storage::read_json::<Playlist>(&path) {
                Ok(p) => playlists.push(p),
                Err(e) => tracing::warn!("Skipping {}: {e}", path.display()),
            }
        }
        playlists.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(Self { playlists, dir })
    }
    pub fn list(&self) -> &[Playlist] {
        &self.playlists
    }

    fn file(&self, id: Uuid) -> PathBuf {
        self.dir.join(format!("{}.plist", id))
    }

    pub fn get(&self, id: Uuid) -> Result<&Playlist, AppError> {
        self.playlists
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("playlist {id}")))
    }
    pub fn create(
        &mut self,
        name: &str,
        presentation_ids: Vec<Uuid>,
    ) -> Result<Playlist, AppError> {
        let playlist = Playlist {
            id: Uuid::new_v4(),
            name: validate_name(name)?,
            presentation_ids,
        };
        storage::write_json(&self.file(playlist.id), &playlist)?;
        self.playlists.push(playlist.clone());
        Ok(playlist)
    }
    pub fn update(
        &mut self,
        id: Uuid,
        name: &str,
        presentation_ids: Vec<Uuid>,
    ) -> Result<Playlist, AppError> {
        let name = validate_name(name)?;
        let pos = self
            .playlists
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("playlist {id}")))?;
        let updated = Playlist {
            id,
            name,
            presentation_ids,
        };
        storage::write_json(&self.file(id), &updated)?;
        self.playlists[pos] = updated.clone();
        Ok(updated)
    }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> {
        let pos = self
            .playlists
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("playlist {id}")))?;
        std::fs::remove_file(self.file(id))?;
        self.playlists.remove(pos);
        Ok(())
    }
}
