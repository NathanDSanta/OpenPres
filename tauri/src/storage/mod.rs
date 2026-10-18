use crate::error::AppError;
use serde::{de::DeserializeOwned, Serialize};
use std::{
    io::ErrorKind::NotFound,
    path::{Path, PathBuf},
};
use tracing_subscriber::field::display;

/// Layout under data_dir:
///   config.json
///   libraries/<library-name>/<presentation-id>.pres.txt
///   playlists/<id>.json
///   themes/<id>.json
///   screens.json
///   audio_routing.json
pub struct StoragePaths {
    pub root: PathBuf,
}

impl StoragePaths {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    pub fn libraries_dir(&self) -> PathBuf {
        self.root.join("libraries")
    }
    pub fn playlists_dir(&self) -> PathBuf {
        self.root.join("playlists")
    }
    pub fn themes_dir(&self) -> PathBuf {
        self.root.join("themes")
    }
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, AppError> {
    let text = read_text(path)?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("invalid JSON in {}: {e}", path.display())))
}
/// Should write atomically (temp file + rename).
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Internal(format!("cannot serialize: {e}")))?;
    write_text(path, &text)
}
pub fn read_text(path: &Path) -> Result<String, AppError> {
    std::fs::read_to_string(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AppError::NotFound(path.display().to_string()),
        _ => AppError::Io(e),
    })
}
pub fn write_text(path: &Path, text: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
