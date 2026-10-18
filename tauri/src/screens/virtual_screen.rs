use crate::layers::LayerStack;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenKind { Audience, Stage }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualScreen {
    pub id: Uuid,
    pub name: String,
    pub kind: ScreenKind,
    pub width: u32,
    pub height: u32,
    pub layers: LayerStack,
    /// Overrides the presentation's theme for this screen (stage vs audience designs).
    pub theme_id: Option<Uuid>,
}
