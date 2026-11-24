//! Screen presets: named sets of layers, and the designs that go with them, that the admin
//! defines once ("Audience", "Stream", "Stage"…) so any screen can be switched to one with a click.

use crate::{
    error::AppError,
    layers::{LayerToggles, PropsShown},
    storage::JsonDoc,
    theme::DesignRef,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenPreset {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    pub layers: LayerToggles,
    /// The designs it sets on the screen. Missing: the screen keeps its own. `null`: back to
    /// the default (the presentation's design, the Bible settings' design, no mask).
    #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
    pub slides_design: Option<Option<DesignRef>>,
    #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
    pub bible_design: Option<Option<DesignRef>>,
    #[serde(default, deserialize_with = "present", skip_serializing_if = "Option::is_none")]
    pub mask: Option<Option<DesignRef>>,
}

/// A field that is there (even as `null`) is `Some`: "set it", unlike a missing one ("keep").
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<DesignRef>>, D::Error> {
    Option::<DesignRef>::deserialize(d).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenPresetsFile {
    pub presets: Vec<ScreenPreset>,
}

fn layers(on: &[&str], props_shown: PropsShown) -> LayerToggles {
    let has = |l: &str| on.contains(&l);
    LayerToggles {
        video_input: has("video_input"),
        media: has("media"),
        slides: has("slides"),
        bible: has("bible"),
        announcements: has("announcements"),
        props: has("props"),
        props_shown,
    }
}

impl Default for ScreenPresetsFile {
    fn default() -> Self {
        let p = |name: &str, on: &[&str], props_shown: PropsShown| ScreenPreset {
            id: Uuid::new_v5(&Uuid::NAMESPACE_OID, format!("screen-preset:{name}").as_bytes()),
            name: name.into(),
            layers: layers(on, props_shown),
            slides_design: None,
            bible_design: None,
            mask: None,
        };
        Self {
            presets: vec![
                p("Everything", &["video_input", "media", "slides", "bible", "announcements", "props"], PropsShown::Both),
                p("Text only", &["slides", "bible", "announcements", "props"], PropsShown::Stage),
                p("Livestream", &["video_input", "media", "slides", "bible", "announcements", "props"], PropsShown::Livestream),
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
    fn designs_are_kept_cleared_or_set() {
        let json = r#"{"presets":[{"id":"","name":"Stage","layers":{},"bible_design":null,
            "mask":{"theme_id":"00000000-0000-0000-0000-000000000001","design_id":"00000000-0000-0000-0000-000000000002"}}]}"#;
        let file: ScreenPresetsFile = serde_json::from_str(json).unwrap();
        let p = &file.presets[0];
        assert!(p.slides_design.is_none(), "missing: the screen keeps its own");
        assert_eq!(p.bible_design, Some(None), "null: back to the default");
        assert!(matches!(p.mask, Some(Some(_))), "a design: that one");
        let back = serde_json::to_value(p).unwrap();
        assert!(back.get("slides_design").is_none());
        assert!(back["bible_design"].is_null() && back.get("bible_design").is_some());
    }

    #[test]
    fn defaults_are_valid() {
        let file = ScreenPresetsFile::default();
        validate(&file).unwrap();
        assert!(file.presets[0].layers.media);
        assert!(!file.presets[1].layers.media);
        assert_eq!(file.presets[2].layers.props_shown, PropsShown::Livestream);
    }
}
