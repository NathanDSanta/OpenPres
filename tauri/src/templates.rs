//! Group templates for importing songs: how imported slides are assigned to groups.
//! A template is a list of names used once (`prefix`), then a list repeated until the end
//! (`repeat`). `{n}` is replaced by a counter that starts at `start` and grows once per
//! repetition.

use crate::{error::AppError, storage::JsonDoc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportTemplate {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub prefix: Vec<String>,
    #[serde(default)]
    pub repeat: Vec<String>,
    #[serde(default = "one")]
    pub start: u32,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplatesFile {
    pub templates: Vec<ImportTemplate>,
}

impl Default for TemplatesFile {
    fn default() -> Self {
        let t = |name: &str, prefix: &[&str], repeat: &[&str], start: u32| ImportTemplate {
            id: Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes()),
            name: name.into(),
            prefix: prefix.iter().map(|s| s.to_string()).collect(),
            repeat: repeat.iter().map(|s| s.to_string()).collect(),
            start,
        };
        Self {
            templates: vec![
                t("Verse 1, Chorus, then verses", &["Verse 1", "Chorus"], &["Verse {n}"], 2),
                t("Numbered verses", &[], &["Verse {n}"], 1),
                t("Verse / Chorus pairs", &[], &["Verse {n}", "Chorus {n}"], 1),
            ],
        }
    }
}

pub fn validate(file: &TemplatesFile) -> Result<(), AppError> {
    for t in &file.templates {
        if t.name.trim().is_empty() {
            return Err(AppError::BadRequest("template names cannot be empty".into()));
        }
        if t.prefix.is_empty() && t.repeat.is_empty() {
            return Err(AppError::BadRequest(format!(
                "template `{}` needs at least one group",
                t.name
            )));
        }
        if t.prefix.iter().chain(&t.repeat).any(|g| g.trim().is_empty() || g.contains([',', '\n'])) {
            return Err(AppError::BadRequest(format!(
                "template `{}` has an empty group name or a comma",
                t.name
            )));
        }
    }
    Ok(())
}

pub fn load(path: PathBuf) -> Result<JsonDoc<TemplatesFile>, AppError> {
    let existed = path.exists();
    let doc = JsonDoc::<TemplatesFile>::load(path)?;
    if !existed {
        doc.save()?;
    }
    Ok(doc)
}
