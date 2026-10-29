use super::style::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

fn new_id() -> Uuid {
    Uuid::new_v4()
}

fn yes() -> bool {
    true
}

fn one() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    #[serde(default = "new_id")]
    pub id: Uuid,
    #[serde(default)]
    pub name: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub background: Background,
    #[serde(default)]
    pub border: Border,
    #[serde(default)]
    pub padding: Edges,
    #[serde(default = "one")]
    pub opacity: f32,
    pub kind: ElementKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ElementKind {
    Text {
        content: String,
        #[serde(default)]
        style: TextStyle,
    },
    Shape {
        shape: ShapeKind,
    },
    Media {
        path: PathBuf,
    },
    /// Shows a value of the current/previous/next slide.
    Value {
        scope: ValueScope,
        field: ValueField,
        #[serde(default)]
        style: TextStyle,
    },
    /// Invisible; actions are implemented later.
    Action {
        #[serde(default)]
        actions: Vec<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValueScope {
    Current,
    Previous,
    Next,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValueField {
    Text,
    SlideIndex,
    TotalSlides,
    GroupName,
    PresentationTitle,
}
