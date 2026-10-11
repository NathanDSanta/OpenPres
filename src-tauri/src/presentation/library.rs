use super::Presentation;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// A library is just a folder on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library { pub id: Uuid, pub name: String, pub path: PathBuf }

pub struct LibraryManager {
    pub libraries: Vec<Library>,
    pub root: PathBuf,
}

impl LibraryManager {
    pub fn load(root: PathBuf) -> Result<Self, AppError> { todo!() }
    pub fn list(&self) -> &[Library] { todo!() }
    pub fn create(&mut self, name: &str) -> Result<Library, AppError> { todo!() }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> { todo!() }
    pub fn list_presentations(&self, library_id: Uuid) -> Result<Vec<Presentation>, AppError> { todo!() }
    pub fn create_presentation(&self, library_id: Uuid, p: Presentation) -> Result<Presentation, AppError> { todo!() }
    pub fn get_presentation(&self, id: Uuid) -> Result<Presentation, AppError> { todo!() }
    pub fn save_presentation(&self, p: &Presentation) -> Result<(), AppError> { todo!() }
    pub fn delete_presentation(&self, id: Uuid) -> Result<(), AppError> { todo!() }
}
