use crate::error::AppError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalDisplay {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub position: (i32, i32),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Binding {
    pub virtual_screen: Uuid,
    pub physical_display: String,
}
/// Where the list of physical displays comes from (Tauri in the app).
pub trait DisplayProvider: Send + Sync {
    fn list(&self) -> Result<Vec<PhysicalDisplay>, AppError>;
}
/// Fixed list, handy for tests or headless runs.
pub struct StaticDisplays(pub Vec<PhysicalDisplay>);
impl DisplayProvider for StaticDisplays {
    fn list(&self) -> Result<Vec<PhysicalDisplay>, AppError> {
        Ok(self.0.clone())
    }
}
