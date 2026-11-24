//! Clear groups: buttons that clear a chosen set of layers at once (like "Clear all", or
//! "Text": slides, Bible and announcements). Set up by the admin; anyone runs them.

use crate::{error::AppError, storage::JsonDoc, theme::style::is_valid_color};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// What can be cleared, top layer first (the order they're stacked on a screen), then audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClearLayer {
    Audio,
    /// "complements" was a second props layer before.
    #[serde(alias = "complements")]
    Props,
    Announcements,
    Bible,
    Slides,
    Media,
    VideoInput,
}

impl ClearLayer {
    pub const ALL: [ClearLayer; 7] = [
        ClearLayer::Audio,
        ClearLayer::Props,
        ClearLayer::Announcements,
        ClearLayer::Bible,
        ClearLayer::Slides,
        ClearLayer::Media,
        ClearLayer::VideoInput,
    ];
    /// Every layer shown on screens (all but the audio).
    pub fn visual() -> Vec<ClearLayer> {
        Self::ALL
            .into_iter()
            .filter(|l| *l != ClearLayer::Audio)
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearGroup {
    #[serde(
        default = "Uuid::new_v4",
        deserialize_with = "crate::storage::ids::new_if_empty"
    )]
    pub id: Uuid,
    pub name: String,
    /// One of the app's clear icons (the interface draws it; unknown ones get a default).
    #[serde(default)]
    pub icon: String,
    /// #RRGGBB.
    #[serde(default = "default_color")]
    pub color: String,
    pub layers: Vec<ClearLayer>,
}

fn default_color() -> String {
    "#E5484D".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearGroupsFile {
    pub groups: Vec<ClearGroup>,
}

impl Default for ClearGroupsFile {
    fn default() -> Self {
        let g = |name: &str, icon: &str, color: &str, layers: Vec<ClearLayer>| ClearGroup {
            id: Uuid::new_v5(
                &Uuid::NAMESPACE_OID,
                format!("clear-group:{name}").as_bytes(),
            ),
            name: name.into(),
            icon: icon.into(),
            color: color.into(),
            layers,
        };
        Self {
            groups: vec![
                g("Clear all", "clear-all", "#E5484D", ClearLayer::visual()),
                g(
                    "Everything",
                    "everything",
                    "#C2384C",
                    ClearLayer::ALL.to_vec(),
                ),
                g(
                    "Text",
                    "text",
                    "#8B6FE0",
                    vec![
                        ClearLayer::Slides,
                        ClearLayer::Bible,
                        ClearLayer::Announcements,
                    ],
                ),
            ],
        }
    }
}

pub fn validate(file: &ClearGroupsFile) -> Result<(), AppError> {
    if file.groups.len() > 24 {
        return Err(AppError::BadRequest("up to 24 clear groups".into()));
    }
    for g in &file.groups {
        let name = g.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err(AppError::BadRequest(
                "clear group names need 1-40 characters".into(),
            ));
        }
        if g.layers.is_empty() {
            return Err(AppError::BadRequest(format!(
                "the clear group `{name}` clears nothing"
            )));
        }
        if !is_valid_color(&g.color) {
            return Err(AppError::BadRequest(format!(
                "invalid colour `{}`",
                g.color
            )));
        }
        if g.icon.len() > 40 {
            return Err(AppError::BadRequest("icon names are short".into()));
        }
    }
    Ok(())
}

pub fn load(path: PathBuf) -> Result<JsonDoc<ClearGroupsFile>, AppError> {
    let existed = path.exists();
    let mut doc = JsonDoc::<ClearGroupsFile>::load(path)?;
    // Groups from before the props were one layer may list "props" twice now.
    let mut merged = false;
    for g in doc.value.groups.iter_mut() {
        let before = g.layers.len();
        let mut seen = std::collections::HashSet::new();
        g.layers.retain(|l| seen.insert(*l));
        merged |= g.layers.len() != before;
    }
    if !existed || merged {
        doc.save()?;
    }
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        let file = ClearGroupsFile::default();
        validate(&file).unwrap();
        assert_eq!(file.groups[0].layers.len(), 6, "every layer shown on screens");
        assert!(file.groups[1].layers.contains(&ClearLayer::Audio));
    }

    #[test]
    fn complements_were_props_and_are_not_listed_twice() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clear_groups.json");
        std::fs::write(&path, r##"{"groups":[{"id":"","name":"Old","icon":"text","color":"#112233","layers":["props","complements","slides"]}]}"##).unwrap();
        let doc = load(path).unwrap();
        assert_eq!(doc.value.groups[0].layers, vec![ClearLayer::Props, ClearLayer::Slides]);
    }

    #[test]
    fn rejects_empty_groups() {
        let mut file = ClearGroupsFile::default();
        file.groups[0].layers.clear();
        assert!(validate(&file).is_err());
    }
}
