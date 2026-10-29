use crate::{error::AppError, layers::LayerStack};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenKind {
    Audience,
    Stage,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualScreen {
    pub id: Uuid,
    pub name: String,
    pub kind: ScreenKind,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub layers: LayerStack,
    /// Overrides the presentation's theme on this screen (stage vs audience designs).
    pub theme_id: Option<Uuid>,
}
fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
}
/// The editable part of a screen (used by create and update).
#[derive(Debug, Clone, Deserialize)]
pub struct ScreenInput {
    pub name: String,
    pub kind: ScreenKind,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default)]
    pub theme_id: Option<Uuid>,
}
impl ScreenInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() || self.name.len() > 100 {
            return Err(AppError::BadRequest(
                "screen name must be 1-100 characters".into(),
            ));
        }
        if !(1..=16384).contains(&self.width) || !(1..=16384).contains(&self.height) {
            return Err(AppError::BadRequest(
                "screen width and height must be between 1 and 16384".into(),
            ));
        }
        Ok(())
    }
}
