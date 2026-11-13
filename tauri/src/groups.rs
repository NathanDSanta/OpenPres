//! Slide group definitions. A class such as "Verse" can be numbered: it then provides
//! "Verse 1" .. "Verse N", each a shade of the class colour. Saved in groups.json next to
//! the libraries so it travels with the rest of the data.

use crate::{config::GroupStyle, error::AppError, storage::JsonDoc, theme::style::is_valid_color};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shading {
    /// Each number is a bit darker.
    #[default]
    Darken,
    Lighten,
    /// Every number uses the same colour.
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupClass {
    pub name: String,
    pub color: String,
    /// Provides "<name> 1" .. "<name> <count>" in addition to "<name>".
    #[serde(default)]
    pub numbered: bool,
    #[serde(default = "default_count")]
    pub count: u8,
    #[serde(default)]
    pub shading: Shading,
}

fn default_count() -> u8 {
    4
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupsFile {
    pub classes: Vec<GroupClass>,
}

impl Default for GroupsFile {
    fn default() -> Self {
        let class = |name: &str, color: &str, numbered: bool, count: u8| GroupClass {
            name: name.into(),
            color: color.into(),
            numbered,
            count,
            shading: Shading::Darken,
        };
        Self {
            classes: vec![
                class("Verse", "#4ADE80", true, 8),
                class("Pre-Chorus", "#FACC15", true, 3),
                class("Chorus", "#F97316", true, 4),
                class("Bridge", "#A78BFA", true, 3),
                class("Intro", "#38BDF8", false, 1),
                class("Interlude", "#22D3EE", false, 1),
                class("Tag", "#F472B6", false, 1),
                class("Ending", "#F87171", false, 1),
            ],
        }
    }
}

pub fn validate(file: &GroupsFile) -> Result<(), AppError> {
    let mut names = std::collections::HashSet::new();
    for class in &file.classes {
        let name = class.name.trim();
        if name.is_empty() || name.len() > 40 || name.contains([',', '\n']) {
            return Err(AppError::BadRequest(
                "group names must be 1-40 characters without commas".into(),
            ));
        }
        if !names.insert(name.to_lowercase()) {
            return Err(AppError::BadRequest(format!("duplicate group `{name}`")));
        }
        if !is_valid_color(&class.color) {
            return Err(AppError::BadRequest(format!("invalid colour for `{name}`")));
        }
        if class.numbered && !(1..=30).contains(&class.count) {
            return Err(AppError::BadRequest(format!(
                "`{name}` must have between 1 and 30 numbered groups"
            )));
        }
    }
    Ok(())
}

/// Loads groups.json, migrating the old `group_styles` from config.json the first time.
pub fn load(path: PathBuf, legacy: &[GroupStyle]) -> Result<JsonDoc<GroupsFile>, AppError> {
    let existed = path.exists();
    let mut doc = JsonDoc::<GroupsFile>::load(path)?;
    if !existed {
        if !legacy.is_empty() {
            doc.value.classes = legacy
                .iter()
                .map(|style| GroupClass {
                    name: style.name.trim().to_string(),
                    color: style.color.clone(),
                    numbered: false,
                    count: 1,
                    shading: Shading::None,
                })
                .collect();
        }
        doc.save()?;
    }
    Ok(doc)
}
