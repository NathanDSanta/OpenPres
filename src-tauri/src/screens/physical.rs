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
