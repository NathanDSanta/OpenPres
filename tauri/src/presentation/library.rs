use super::Presentation;
use crate::{
    error::AppError,
    presentation::{parser, serializer},
    storage,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

const PRES_EXT: &str = ".pres";

/// A library is just a folder on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: Uuid,
    pub name: String,
    pub path: PathBuf,
}

pub struct LibraryManager {
    pub libraries: Vec<Library>,
    pub root: PathBuf,
}

fn library_id(name: &str) -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes())
}

fn validate_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    let invalid = name.is_empty()
        || name.len() > 100
        || name.starts_with(".")
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name.chars().any(|c| c.is_control());
    if invalid {
        return Err(AppError::BadRequest(
                "library name must be 1-100 characters, not start with '.', and avoid / \\ : * ? \" < > |".into(),
                ));
    }
    Ok(name.to_string())
}

fn sort_libraries(libraries: &mut [Library]) {
    libraries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

impl LibraryManager {
    pub fn load(root: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&root)?;
        let mut libraries = Vec::new();
        for entry in std::fs::read_dir(&root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(".") {
                continue;
            }
            libraries.push(Library {
                id: library_id(&name),
                name,
                path: entry.path(),
            });
        }
        sort_libraries(&mut libraries);
        Ok(Self { libraries, root })
    }
    pub fn list(&self) -> &[Library] {
        &self.libraries
    }
    pub fn get(&self, id: Uuid) -> Result<&Library, AppError> {
        self.libraries
            .iter()
            .find(|l| l.id == id)
            .ok_or_else(|| AppError::NotFound(format!("library {id}")))
    }

    pub fn create(&mut self, name: &str) -> Result<Library, AppError> {
        let name = validate_name(name)?;
        if self
            .libraries
            .iter()
            .any(|l| l.name.eq_ignore_ascii_case(&name))
        {
            return Err(AppError::Conflict(format!(
                "Library `{name}` already exists"
            )));
        }
        let path = self.root.join(&name);
        std::fs::create_dir_all(&path)?;
        let library = Library {
            id: library_id(&name),
            name,
            path,
        };
        self.libraries.push(library.clone());
        sort_libraries(&mut self.libraries);
        Ok(library)
    }

    /// Deletes the folder and EVERYTHING in it. There is no undo
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> {
        let pos = self
            .libraries
            .iter()
            .position(|l| l.id == id)
            .ok_or_else(|| AppError::NotFound(format!("library {id}")))?;
        std::fs::remove_dir_all(&self.libraries[pos].path)?;
        self.libraries.remove(pos);
        Ok(())
    }

    // --------File Helpers--------
    fn pres_path(lib: &Library, id: Uuid) -> PathBuf {
        lib.path.join(format!("{}{}", id, PRES_EXT))
    }

    fn locate(&self, id: Uuid) -> Result<&Library, AppError> {
        self.libraries
            .iter()
            .find(|l| Self::pres_path(l, id).exists())
            .ok_or_else(|| AppError::NotFound(format!("presentation {id}")))
    }

    fn read_presentation(lib: &Library, id: Uuid) -> Result<Presentation, AppError> {
        let text = storage::read_text(&Self::pres_path(lib, id))?;
        parser::parse(id, &text)
    }

    fn write_presentation(lib: &Library, p: &Presentation) -> Result<(), AppError> {
        p.layer()?;
        if p.metadata.contains_key(super::META_THEME) && p.theme_id().is_none() {
            return Err(AppError::BadRequest(
                "metadata `theme` must be a valid Id".into(),
            ));
        }
        let text = serializer::serialize(p)?;
        storage::write_text(&Self::pres_path(lib, p.id), &text)
    }

    pub fn list_presentations(&self, library_id: Uuid) -> Result<Vec<Presentation>, AppError> {
        let lib = self.get(library_id)?;
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&lib.path)? {
            let file_name = entry?.file_name().to_string_lossy().to_string();
            let Some(stem) = file_name.strip_suffix(PRES_EXT) else {
                continue;
            };
            let Ok(id) = Uuid::parse_str(stem) else {
                continue;
            };
            match Self::read_presentation(lib, id) {
                Ok(p) => out.push(p),
                Err(e) => tracing::warn!("skipping {file_name}: {e}"),
            };
        }
        out.sort_by(|a, b| a.nameid.cmp(&b.nameid));
        Ok(out)
    }

    pub fn create_presentation(
        &self,
        library_id: Uuid,
        mut p: Presentation,
    ) -> Result<Presentation, AppError> {
        let lib = self.get(library_id)?;
        p.id = Uuid::new_v4();
        Self::write_presentation(lib, &p)?;
        Ok(p)
    }

    pub fn get_presentation(&self, id: Uuid) -> Result<Presentation, AppError> {
        let lib = self.locate(id)?;
        Self::read_presentation(lib, id)
    }

    pub fn get_raw(&self, id: Uuid) -> Result<String, AppError> {
        let lib = self.locate(id)?;
        storage::read_text(&Self::pres_path(lib, id))
    }

    pub fn save_presentation(&self, p: &mut Presentation) -> Result<(), AppError> {
        let lib = self.locate(p.id)?;
        p.prune_arrangements();
        Self::write_presentation(lib, p)
    }
    /// Moves a presentation file to another library.
    pub fn move_presentation(&self, id: Uuid, library_id: Uuid) -> Result<(), AppError> {
        let from = self.locate(id)?;
        let to = self.get(library_id)?;
        if from.id == to.id {
            return Ok(());
        }
        let (src, dst) = (Self::pres_path(from, id), Self::pres_path(to, id));
        if std::fs::rename(&src, &dst).is_err() {
            std::fs::copy(&src, &dst)?;
            std::fs::remove_file(&src)?;
        }
        Ok(())
    }

    /// Number of presentations in every library.
    pub fn count_presentations(&self) -> usize {
        self.libraries
            .iter()
            .filter_map(|l| std::fs::read_dir(&l.path).ok())
            .flat_map(|d| d.flatten())
            .filter(|e| e.file_name().to_string_lossy().ends_with(PRES_EXT))
            .count()
    }

    pub fn delete_presentation(&self, id: Uuid) -> Result<(), AppError> {
        let lib = self.locate(id)?;
        std::fs::remove_file(Self::pres_path(lib, id))?;
        Ok(())
    }
}
