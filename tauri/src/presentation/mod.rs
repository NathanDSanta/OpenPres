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

pub const DEFAULT_ARRANGEMENT: &str = "default";
pub const NEW_ARRANGEMENT_NAME: &str = "main";

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
    pub nameid: String,
    pub metadata: BTreeMap<String, String>,
    pub groups: Vec<Group>,
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

    pub fn summary(&self) -> PresentationSummary {
        PresentationSummary {
            id: self.id,
            title: self.title().unwrap_or("Untitled").to_string(),
            layer: self.layer().unwrap_or(PresentationLayer::Slides),
            groups: self.groups.len(),
            slides: self.groups.iter().map(|g| g.slides.len()).sum(),
        }
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

    // --------------Arrangements--------------------

    /// Default arrangement = groups in file order.
    pub fn default_arrangement(&self) -> Arrangement {
        Arrangement {
            name: DEFAULT_ARRANGEMENT.to_string(),
            order: self.groups.iter().map(|g| g.name.clone()).collect(),
        }
    }

    /// None or "default" -> the implicit arrangement; otherwise a stored one.
    pub fn find_arrangement(&self, name: Option<&str>) -> Result<Arrangement, AppError> {
        match name {
            None | Some(DEFAULT_ARRANGEMENT) => Ok(self.default_arrangement()),
            Some(n) => self
                .arrangements
                .iter()
                .find(|a| a.name == n)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("arrangement `{n}`"))),
        }
    }
    /// Creates or replaces a stored arrangement.
    pub fn set_arrangement(&mut self, name: &str, order: Vec<String>) -> Result<(), AppError> {
        let name = name.trim();
        if name.is_empty() || name == DEFAULT_ARRANGEMENT {
            return Err(AppError::BadRequest(format!(
                "arrangement name cannot be empty or `{DEFAULT_ARRANGEMENT}`"
            )));
        }
        if order.is_empty() {
            return Err(AppError::BadRequest("`order` cannot be empty".into()));
        }
        for group in &order {
            if !self.groups.iter().any(|g| &g.name == group) {
                return Err(AppError::BadRequest(format!("unknown group `{group}`")));
            }
        }
        match self.arrangements.iter_mut().find(|a| a.name == name) {
            Some(existing) => existing.order = order,
            None => self.arrangements.push(Arrangement {
                name: name.to_string(),
                order,
            }),
        }
        Ok(())
    }
    pub fn remove_arrangement(&mut self, name: &str) -> Result<(), AppError> {
        let before = self.arrangements.len();
        self.arrangements.retain(|a| a.name != name);
        if self.arrangements.len() == before {
            return Err(AppError::NotFound(format!("arrangement `{name}`")));
        }
        Ok(())
    }
    /// Removes references to groups that no longer exist; drops emptied arrangements.
    pub fn prune_arrangements(&mut self) {
        let names: Vec<String> = self.groups.iter().map(|g| g.name.clone()).collect();
        for arrangement in &mut self.arrangements {
            arrangement.order.retain(|g| names.contains(g));
        }
        self.arrangements.retain(|a| !a.order.is_empty());
    }
    /// "Custom", then "Custom 2", "Custom 3"... first one not already used.
    pub fn next_arrangement_name(&self) -> String {
        let taken = |n: &str| self.arrangements.iter().any(|a| a.name == n);
        if !taken(NEW_ARRANGEMENT_NAME) {
            return NEW_ARRANGEMENT_NAME.to_string();
        }
        (2..)
            .map(|i| format!("{NEW_ARRANGEMENT_NAME} {i}"))
            .find(|n| !taken(n))
            .unwrap()
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
