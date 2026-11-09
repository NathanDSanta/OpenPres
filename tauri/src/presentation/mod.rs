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
    pub fn change_slide_group(
        &mut self,
        arrangement_name: &str,
        slide_index: usize,
        target_group: Option<&str>,
    ) -> Result<(), AppError> {
        // Get the arrangement and expand it into individual slides.
        let arrangement = self.find_arrangement(Some(arrangement_name))?;
        let slides = self.expand(&arrangement)?;

        let current = slides.get(slide_index).ok_or_else(|| {
            AppError::BadRequest(format!("slide index {slide_index} is out of range"))
        })?;

        let source_name = current.group.clone();

        let previous_name = if slide_index > 0 {
            Some(slides[slide_index - 1].group.clone())
        } else {
            None
        };

        // Resolve the destination group.
        let target_name = match target_group {
            Some(name) => name.trim().to_string(),
            None => previous_name.clone().ok_or_else(|| {
                AppError::BadRequest("the first slide cannot inherit a previous group".into())
            })?,
        };

        if target_name.is_empty() || target_name.contains(['\n', '\r', ',']) {
            return Err(AppError::BadRequest("invalid group name".into()));
        }

        if source_name == target_name {
            return Ok(());
        }

        // Find the selected slide's position inside its original group.
        // slide_index is an index in the expanded arrangement, not in Group.slides.
        let mut offset = 0;
        let mut local_slide_index = None;

        for group_name in &arrangement.order {
            let group = self
                .groups
                .iter()
                .find(|g| &g.name == group_name)
                .ok_or_else(|| AppError::NotFound(format!("group `{group_name}`")))?;

            if slide_index < offset + group.slides.len() {
                local_slide_index = Some(slide_index - offset);
                break;
            }

            offset += group.slides.len();
        }

        let local_slide_index = local_slide_index
            .ok_or_else(|| AppError::BadRequest("slide index is out of range".into()))?;

        let source_index = self
            .groups
            .iter()
            .position(|g| g.name == source_name)
            .ok_or_else(|| AppError::NotFound(format!("group `{source_name}`")))?;

        let target_index = self.groups.iter().position(|g| g.name == target_name);

        // CASE 1:
        // The previous slide already belongs to the requested group.
        // Merge the entire source group into that group.
        if previous_name.as_deref() == Some(target_name.as_str()) {
            let target_index =
                target_index.ok_or_else(|| AppError::NotFound(format!("group `{target_name}`")))?;

            // This should be the first slide of the source group.
            if local_slide_index != 0 {
                return Err(AppError::BadRequest(
                    "cannot merge a group from the middle of its slides".into(),
                ));
            }

            let source = self.groups.remove(source_index);
            let source_slides = source.slides;

            // Find the destination again because removing the source
            // group may have changed its vector index.
            let target_index = self
                .groups
                .iter()
                .position(|g| g.name == target_name)
                .unwrap_or(target_index.min(self.groups.len()));

            self.groups[target_index].slides.extend(source_slides);

            // Update all arrangements.
            // If the destination already exists, remove the source reference.
            // Otherwise, replace the source reference with the destination.
            for arrangement in &mut self.arrangements {
                let has_target = arrangement.order.iter().any(|name| name == &target_name);

                if has_target {
                    arrangement.order.retain(|name| name != &source_name);
                } else {
                    for name in &mut arrangement.order {
                        if name == &source_name {
                            *name = target_name.clone();
                        }
                    }
                }
            }

            return Ok(());
        }

        // CASE 2:
        // The destination group exists, but it is not the previous slide's group.
        // This would create two separate sections with the same name.
        if target_index.is_some() {
            return Err(AppError::Conflict(format!(
                "Cannot use group `{target_name}` here because it already exists \
             in a separate section. The previous slide belongs to a different group."
            )));
        }

        // CASE 3:
        // The destination group does not exist.
        //
        // If the selected slide is the first slide of its group,
        // rename the entire group.
        if local_slide_index == 0 {
            self.groups[source_index].name = target_name.clone();

            for arrangement in &mut self.arrangements {
                for name in &mut arrangement.order {
                    if name == &source_name {
                        *name = target_name.clone();
                    }
                }
            }

            return Ok(());
        }

        // CASE 4:
        // The selected slide is in the middle of its group.
        // Split the group so slides before it retain their original name.
        let new_slides = self.groups[source_index]
            .slides
            .split_off(local_slide_index);

        self.groups.insert(
            source_index + 1,
            Group {
                name: target_name.clone(),
                slides: new_slides,
            },
        );

        // Update every arrangement:
        // each occurrence of the original group becomes:
        // [original group, new group]
        for arrangement in &mut self.arrangements {
            let mut new_order = Vec::new();

            for name in &arrangement.order {
                new_order.push(name.clone());

                if name == &source_name {
                    new_order.push(target_name.clone());
                }
            }

            arrangement.order = new_order;
        }

        Ok(())
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
