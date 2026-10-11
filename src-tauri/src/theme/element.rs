use super::style::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub id: Uuid,
    pub name: String,
    pub visible: bool,
    pub transform: Transform,
    pub background: Background,
    pub border: Border,
    pub padding: Edges,
    pub opacity: f32,
    pub kind: ElementKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ElementKind {
    Text { content: String, style: TextStyle },
    Shape { shape: ShapeKind },
    Media { path: PathBuf },
    /// Shows a value of the current/previous/next slide.
    Value { scope: ValueScope, field: ValueField, style: TextStyle },
    /// Invisible; actions are implemented later.
    Action { actions: Vec<serde_json::Value> },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind { Rectangle, Ellipse }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValueScope { Current, Previous, Next }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValueField {
    Text,
    SlideIndex,
    TotalSlides,
    GroupName,
    PresentationTitle,
}
