use crate::error::AppError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Live state. Which layer receives the presentation comes from its `layer` metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PresenterEngine {
    pub presentation_id: Option<Uuid>,
    pub arrangement: Option<String>,
    pub slide_index: usize,
    pub total_slides: usize,
}

impl PresenterEngine {
    pub fn load(&mut self, presentation_id: Uuid, arrangement: Option<String>, total_slides: usize) -> Result<(), AppError> { todo!() }
    pub fn next(&mut self) -> Result<(), AppError> { todo!() }
    pub fn previous(&mut self) -> Result<(), AppError> { todo!() }
    pub fn goto(&mut self, index: usize) -> Result<(), AppError> { todo!() }
    pub fn clear(&mut self) { todo!() }
}
