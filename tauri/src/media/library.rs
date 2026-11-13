use crate::{error::AppError, storage};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Image,
    Video,
    Audio,
}

impl MediaKind {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" => Some(MediaKind::Image),
            "mp4" | "m4v" | "mov" | "webm" | "mkv" | "ogv" => Some(MediaKind::Video),
            "mp3" | "wav" | "ogg" | "oga" | "flac" | "m4a" | "aac" | "opus" | "aif" | "aiff" => {
                Some(MediaKind::Audio)
            }
            _ => None,
        }
    }
    pub fn has_audio(self) -> bool {
        matches!(self, MediaKind::Video | MediaKind::Audio)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: Uuid,
    pub name: String,
    pub kind: MediaKind,
    /// File name inside media/files.
    pub file: String,
    pub size: u64,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    pub imported_at: i64,
}

#[derive(Default, Serialize, Deserialize)]
struct IndexFile {
    items: Vec<MediaItem>,
}

pub struct MediaLibrary {
    pub items: Vec<MediaItem>,
    pub dir: PathBuf,
}

impl MediaLibrary {
    pub fn load(dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(dir.join("files"))?;
        let index: IndexFile = storage::read_json_or_default(&dir.join("index.json"))?;
        Ok(Self {
            items: index.items,
            dir,
        })
    }
    fn save(&self) -> Result<(), AppError> {
        storage::write_json(
            &self.dir.join("index.json"),
            &IndexFile {
                items: self.items.clone(),
            },
        )
    }
    pub fn get(&self, id: Uuid) -> Result<&MediaItem, AppError> {
        self.items
            .iter()
            .find(|m| m.id == id)
            .ok_or_else(|| AppError::NotFound(format!("media {id}")))
    }
    pub fn path_of(&self, item: &MediaItem) -> PathBuf {
        self.dir.join("files").join(&item.file)
    }
    pub fn path(&self, id: Uuid) -> Result<PathBuf, AppError> {
        Ok(self.path_of(self.get(id)?))
    }

    /// Checks the name and returns (id, kind, final file name, temporary path to write to).
    pub fn reserve(&self, name: &str) -> Result<(Uuid, MediaKind, String, PathBuf), AppError> {
        let name = name.trim();
        let ext = std::path::Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = MediaKind::from_extension(&ext).ok_or_else(|| {
            AppError::BadRequest(format!(
                "`{name}` is not a supported picture, video or audio file"
            ))
        })?;
        let id = Uuid::new_v4();
        let file = format!("{id}.{ext}");
        let tmp = self.dir.join("files").join(format!("{id}.part"));
        Ok((id, kind, file, tmp))
    }

    /// Moves a fully written temporary file into place and records it.
    pub fn finish_import(
        &mut self,
        id: Uuid,
        kind: MediaKind,
        name: &str,
        file: String,
        tmp: PathBuf,
    ) -> Result<MediaItem, AppError> {
        let path = self.dir.join("files").join(&file);
        std::fs::rename(&tmp, &path)?;
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let duration_ms = if kind.has_audio() {
            crate::audio::decode::probe_duration_ms(&path)
        } else {
            None
        };
        let stem = std::path::Path::new(name.trim())
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Media")
            .to_string();
        let item = MediaItem {
            id,
            name: stem,
            kind,
            file,
            size,
            duration_ms,
            width: None,
            height: None,
            imported_at: storage::now_ms() / 1000,
        };
        self.items.push(item.clone());
        self.save()?;
        Ok(item)
    }

    pub fn rename(&mut self, id: Uuid, name: &str) -> Result<MediaItem, AppError> {
        let name = name.trim();
        if name.is_empty() || name.len() > 200 {
            return Err(AppError::BadRequest("media name must be 1-200 characters".into()));
        }
        let item = self
            .items
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| AppError::NotFound(format!("media {id}")))?;
        item.name = name.to_string();
        let out = item.clone();
        self.save()?;
        Ok(out)
    }

    /// Fills in information the frontend learned while playing (video length, size).
    pub fn set_meta(
        &mut self,
        id: Uuid,
        duration_ms: Option<u64>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<(), AppError> {
        let item = self
            .items
            .iter_mut()
            .find(|m| m.id == id)
            .ok_or_else(|| AppError::NotFound(format!("media {id}")))?;
        let mut changed = false;
        if duration_ms.is_some() && item.duration_ms != duration_ms {
            item.duration_ms = duration_ms;
            changed = true;
        }
        if width.is_some() && item.width != width {
            item.width = width;
            item.height = height;
            changed = true;
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }

    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> {
        let pos = self
            .items
            .iter()
            .position(|m| m.id == id)
            .ok_or_else(|| AppError::NotFound(format!("media {id}")))?;
        let path = self.path_of(&self.items[pos]);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        self.items.remove(pos);
        self.save()
    }
}
