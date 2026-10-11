pub mod library;
pub mod parser;
pub mod playlist;
pub mod serializer;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// Metadata keys with special meaning (everything else is free-form).
pub const META_TITLE: &str = "title";
pub const META_THEME: &str = "theme";   // theme UUID
pub const META_LAYER: &str = "layer";   // "slides" | "announcements"

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationLayer { Slides, Announcements }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub id: Uuid,
    pub metadata: BTreeMap<String, String>,
    pub groups: Vec<Group>,
    /// Not stored in the txt file yet; see README open questions.
    pub arrangements: Vec<Arrangement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group { pub name: String, pub slides: Vec<Slide> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Slide { pub text: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arrangement {
    pub name: String,
    /// Group names, in order (a group may appear several times).
    pub order: Vec<String>,
}

impl Presentation {
    pub fn title(&self) -> Option<&str> { todo!() }
    pub fn theme_id(&self) -> Option<Uuid> { todo!() }
    /// Defaults to Slides when the key is missing.
    pub fn layer(&self) -> Result<PresentationLayer, AppError> { todo!() }
    /// Default arrangement = groups in file order.
    pub fn default_arrangement(&self) -> Arrangement { todo!() }
    /// Expands an arrangement into the flat slide list (moving a group moves all its slides).
    pub fn expand(&self, arrangement: &Arrangement) -> Result<Vec<&Slide>, AppError> { todo!() }
}
