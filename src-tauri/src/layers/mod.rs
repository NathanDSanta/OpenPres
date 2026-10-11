pub mod content;

use crate::error::AppError;
use content::LayerContent;
use serde::{Deserialize, Serialize};

/// Bottom -> top draw order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    VideoInput,
    Media,
    Slides,
    Announcements,
    Complements,
    Props,
    Audio,
}

impl LayerKind {
    pub const ORDER: [LayerKind; 7] = [
        LayerKind::VideoInput, LayerKind::Media, LayerKind::Slides,
        LayerKind::Announcements, LayerKind::Complements, LayerKind::Props, LayerKind::Audio,
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub kind: LayerKind,
    pub visible: bool,
    pub content: LayerContent,
}

/// Always exactly 7 layers, in LayerKind::ORDER.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerStack { pub layers: Vec<Layer> }

impl LayerStack {
    pub fn new() -> Self { todo!() }
    pub fn get(&self, kind: LayerKind) -> &Layer { todo!() }
    /// Errors if the content type does not belong to that layer.
    pub fn set_content(&mut self, kind: LayerKind, content: LayerContent) -> Result<(), AppError> { todo!() }
    pub fn set_visible(&mut self, kind: LayerKind, visible: bool) { todo!() }
    pub fn clear(&mut self, kind: LayerKind) { todo!() }
}
