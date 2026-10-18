pub mod library;
pub mod parser;
pub mod playlist;
pub mod serializer;

use crate::{error::AppError, layers::LayerKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// Metadata keys with special meaning (everything else is free-form).
pub const META_TITLE: &str = "title";
pub const META_THEME: &str = "theme"; // theme UUID
pub const META_LAYER: &str = "layer"; // "slides" | "announcements"

pub const DEFAULT_ARRANGEMENT: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationLayer {
    Slides,
    Announcements,
}

impl From<PresentationLayer> for LayerKind {
    fn from(layer: PresentationLayer) -> Self {
        match layer {
            PresentationLayer::Slides => LayerKind::Slides,
            PresentationLayer::Announcements => LayerKind::Announcements,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub id: Uuid,
    pub metadata: BTreeMap<String, String>,
    pub groups: Vec<Group>,
    // Stored in a sidecar file (step 3), not in the .pres.txt itself
    pub arrangements: Vec<Arrangement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    pub slides: Vec<Slide>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Slide {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arrangement {
    pub name: String,
    /// Group names, in order (a group may appear several times).
    pub order: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlatSlide {
    pub group: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PresentationSummary {
    pub id: Uuid,
    pub title: String,
    pub layer: PresentationLayer,
    pub groups: usize,
    pub slides: usize,
}

impl Presentation {
    pub fn title(&self) -> Option<&str> {
        self.metadata.get(META_TITLE).map(|s| s.as_str())
    }

    /// None if the key is missing or is not a valid UUID
    pub fn theme_id(&self) -> Option<Uuid> {
        self.metadata
            .get(META_THEME)
            .and_then(|s| Uuid::parse_str(s.trim()).ok())
    }
    /// Defaults to Slides when the key is missing.
    pub fn layer(&self) -> Result<PresentationLayer, AppError> {
        match self.metadata.get(META_LAYER) {
            None => Ok(PresentationLayer::Slides),
            Some(value) => match value.trim().to_lowercase().as_str() {
                "slides" => Ok(PresentationLayer::Slides),
                "announcements" => Ok(PresentationLayer::Announcements),
                other => Err(AppError::BadRequest(format!(
                    "metadata `layer` must be `slides` or `announcements`, got `{other}`"
                ))),
            },
        }
    }
    /// Default arrangement = groups in file order.
    pub fn default_arrangement(&self) -> Arrangement {
        Arrangement {
            name: DEFAULT_ARRANGEMENT.to_string(),
            order: self.groups.iter().map(|g| g.name.clone()).collect(),
        }
    }
    /// Expands an arrangement into the flat slide list (moving a group moves all its slides).
    pub fn expand(&self, arrangement: &Arrangement) -> Result<Vec<FlatSlide>, AppError> {
        let mut out = Vec::new();
        for group_name in &arrangement.order {
            let group = self
                .groups
                .iter()
                .find(|g| &g.name == group_name)
                .ok_or_else(|| {
                    AppError::BadRequest(format!(
                        "arrangement `{}` uses unknown group `{}`",
                        arrangement.name, group_name
                    ))
                })?;
            for slide in &group.slides {
                out.push(FlatSlide {
                    group: group.name.clone(),
                    text: slide.text.clone(),
                });
            }
        }
        Ok(out)
    }
}
