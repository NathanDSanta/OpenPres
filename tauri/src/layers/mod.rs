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
        LayerKind::VideoInput,
        LayerKind::Media,
        LayerKind::Slides,
        LayerKind::Announcements,
        LayerKind::Complements,
        LayerKind::Props,
        LayerKind::Audio,
    ];
    /// Which kinds of content may live on this layer.
    pub fn accepts(self, content: &LayerContent) -> bool {
        use LayerContent as C;
        matches!(
            (self, content),
            (_, C::Empty)
                | (LayerKind::VideoInput, C::VideoInput { .. })
                | (LayerKind::Media, C::Media { .. })
                | (
                    LayerKind::Slides | LayerKind::Announcements,
                    C::Presentation { .. }
                )
                | (
                    LayerKind::Complements | LayerKind::Props,
                    C::Component { .. }
                )
                | (LayerKind::Audio, C::AudioRouting)
        )
    }
    /// What a cleared layer holds.
    fn empty_content(self) -> LayerContent {
        if self == LayerKind::Audio {
            LayerContent::AudioRouting
        } else {
            LayerContent::Empty
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub kind: LayerKind,
    pub visible: bool,
    pub content: LayerContent,
}
/// Always exactly 7 layers, in LayerKind::ORDER.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerStack {
    pub layers: Vec<Layer>,
}
impl LayerStack {
    pub fn new() -> Self {
        let layers = LayerKind::ORDER
            .iter()
            .map(|&kind| Layer {
                kind,
                visible: true,
                content: kind.empty_content(),
            })
            .collect();
        Self { layers }
    }
    pub fn is_valid(&self) -> bool {
        self.layers.len() == LayerKind::ORDER.len()
            && self
                .layers
                .iter()
                .zip(LayerKind::ORDER.iter())
                .all(|(layer, kind)| layer.kind == *kind)
    }
    pub fn get(&self, kind: LayerKind) -> &Layer {
        &self.layers[kind as usize]
    }
    /// Errors if the content type does not belong to that layer.
    pub fn set_content(&mut self, kind: LayerKind, content: LayerContent) -> Result<(), AppError> {
        if !kind.accepts(&content) {
            return Err(AppError::BadRequest(format!(
                "layer `{:?}` cannot hold this kind of content",
                kind
            )));
        }
        self.layers[kind as usize].content = content;
        Ok(())
    }
    pub fn set_visible(&mut self, kind: LayerKind, visible: bool) {
        self.layers[kind as usize].visible = visible;
    }
    pub fn clear(&mut self, kind: LayerKind) {
        self.layers[kind as usize].content = kind.empty_content();
    }
}
impl Default for LayerStack {
    fn default() -> Self {
        Self::new()
    }
}
