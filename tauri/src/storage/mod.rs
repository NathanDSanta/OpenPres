use crate::error::AppError;
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

/// Layout under data_dir:
///   config.json            app settings (port, network, password hash, ffmpeg)
///   groups.json            group classes and colours
///   import_templates.json  group templates used when importing songs
///   workspace.json         home page widget layout
///   timers.json            timer definitions
///   stream.json            stream settings
///   audio.json             audio inputs, outputs and bus names
///   screens.json           virtual screens and display bindings
///   libraries/<name>/<presentation-id>.pres
///   playlists/<id>.plist
///   themes/<id>.theme
///   media/index.json, media/files/<id>.<ext>, media/playlists.json
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
    pub fn media_dir(&self) -> PathBuf {
        self.root.join("media")
    }
    pub fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, AppError> {
    let text = read_text(path)?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("invalid JSON in {}: {e}", path.display())))
}

/// Reads `path`, or returns the default when the file does not exist yet.
pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, AppError> {
    if path.exists() {
        read_json(path)
    } else {
        Ok(T::default())
    }
}

/// Writes atomically (temp file + rename).
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

/// A small JSON document kept in memory and saved to one file.
pub struct JsonDoc<T> {
    pub value: T,
    pub path: PathBuf,
}

impl<T: Serialize + DeserializeOwned + Default> JsonDoc<T> {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let value = read_json_or_default(&path)?;
        Ok(Self { value, path })
    }
    pub fn save(&self) -> Result<(), AppError> {
        write_json(&self.path, &self.value)
    }
    pub fn replace(&mut self, value: T) -> Result<(), AppError> {
        self.value = value;
        self.save()
    }
}

/// Milliseconds since the Unix epoch (used for live clocks shared with the frontend).
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
