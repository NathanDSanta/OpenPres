use crate::{
    error::AppError,
    layers::LayerToggles,
    theme::{style::is_valid_color, style::MediaFit, DesignRef},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenKind {
    Audience,
    Stage,
}

/// What a screen shows when no layer covers it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScreenBackground {
    Color {
        color: String,
    },
    /// An imported picture.
    Media {
        media_id: Uuid,
        #[serde(default)]
        fit: MediaFit,
    },
}

impl Default for ScreenBackground {
    fn default() -> Self {
        ScreenBackground::Color {
            color: "#000000".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualScreen {
    pub id: Uuid,
    pub name: String,
    pub kind: ScreenKind,
    pub width: u32,
    pub height: u32,
    /// Overrides the presentation's theme on the slides layer (stage vs audience designs).
    #[serde(default)]
    pub theme_id: Option<Uuid>,
    /// Same, for the announcements layer.
    #[serde(default)]
    pub announcements_theme_id: Option<Uuid>,
    #[serde(default)]
    pub background: ScreenBackground,
    #[serde(default, rename = "enabled_layers")]
    pub layers: LayerToggles,
    /// A props design always drawn on top of every layer of this screen.
    #[serde(default)]
    pub mask: Option<DesignRef>,
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
    #[serde(default)]
    pub announcements_theme_id: Option<Uuid>,
    #[serde(default)]
    pub background: ScreenBackground,
    #[serde(default, rename = "enabled_layers")]
    pub layers: LayerToggles,
    #[serde(default)]
    pub mask: Option<DesignRef>,
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
        if let ScreenBackground::Color { color } = &self.background {
            if !is_valid_color(color) {
                return Err(AppError::BadRequest(format!("invalid background colour `{color}`")));
            }
        }
        Ok(())
    }
}
