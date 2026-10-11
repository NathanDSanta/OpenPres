use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LayerContent {
    Empty,
    VideoInput { device_id: String },
    Media { path: PathBuf },
    /// Used by both the Slides and Announcements layers.
    Presentation { presentation_id: Uuid, slide_index: usize },
    /// Complements and Props: toggleable components (clock, etc.).
    Component { component: String, enabled: bool },
    /// Audio layer: no visuals, routing is defined in audio_router.
    AudioRouting,
}
