pub mod element;
pub mod style;

use crate::error::AppError;
use element::Element;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub id: Uuid,
    pub name: String,
    /// Slide size in pixels.
    pub width: u32,
    pub height: u32,
    pub background: style::Background,
    /// Draw order: first = bottom.
    pub elements: Vec<Element>,
}

pub struct ThemeManager { pub themes: Vec<Theme> }

impl ThemeManager {
    pub fn list(&self) -> &[Theme] { todo!() }
    pub fn get(&self, id: Uuid) -> Result<&Theme, AppError> { todo!() }
    pub fn create(&mut self, theme: Theme) -> Result<Theme, AppError> { todo!() }
    pub fn update(&mut self, theme: Theme) -> Result<(), AppError> { todo!() }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> { todo!() }
}
