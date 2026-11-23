//! Screen presets: named sets of layers the admin defines once ("Audience", "Stream",
//! "Stage"…) so any screen can be switched to one with a click.

use crate::{error::AppError, layers::LayerToggles, storage::JsonDoc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenPreset {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    pub layers: LayerToggles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenPresetsFile {
    pub presets: Vec<ScreenPreset>,
}

fn layers(on: &[&str]) -> LayerToggles {
    let has = |l: &str| on.contains(&l);
    LayerToggles {
        video_input: has("video_input"),
        media: has("media"),
        slides: has("slides"),
        bible: has("bible"),
        announcements: has("announcements"),
        complements: has("complements"),
        props: has("props"),
    }
}

impl Default for ScreenPresetsFile {
    fn default() -> Self {
        let p = |name: &str, on: &[&str]| ScreenPreset {
            id: Uuid::new_v5(&Uuid::NAMESPACE_OID, format!("screen-preset:{name}").as_bytes()),
            name: name.into(),
            layers: layers(on),
        };
        Self {
            presets: vec![
                p("Everything", &["video_input", "media", "slides", "bible", "announcements", "complements", "props"]),
                p("Text only", &["slides", "bible", "announcements", "complements", "props"]),
                p("Stage", &["slides", "bible", "complements"]),
            ],
        }
    }
}

pub fn validate(file: &ScreenPresetsFile) -> Result<(), AppError> {
    if file.presets.len() > 24 {
        return Err(AppError::BadRequest("up to 24 screen presets".into()));
    }
    for p in &file.presets {
        let name = p.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err(AppError::BadRequest("screen preset names need 1-40 characters".into()));
        }
    }
    Ok(())
}

pub fn load(path: PathBuf) -> Result<JsonDoc<ScreenPresetsFile>, AppError> {
    let existed = path.exists();
    let doc = JsonDoc::<ScreenPresetsFile>::load(path)?;
    if !existed {
        doc.save()?;
    }
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        let file = ScreenPresetsFile::default();
        validate(&file).unwrap();
        assert!(file.presets[0].layers.media);
        assert!(!file.presets[2].layers.media);
    }
}
