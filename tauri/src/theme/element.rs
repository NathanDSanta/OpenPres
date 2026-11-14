//! Design elements. Every element is a shape with an optional fill, border, shadow and
//! text. Text is either static or linked to something live (slide, clock, timer), so a
//! "clock" is a text element linked to the system clock and "media" is a shape filled
//! with an imported picture or video.

use super::style::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Shape {
    Rectangle,
    Ellipse,
    Triangle,
    Star {
        #[serde(default = "five")]
        points: u8,
        /// Inner radius relative to the outer one (0.1-0.95).
        #[serde(default = "half")]
        inner_ratio: f32,
    },
    Polygon {
        #[serde(default = "six")]
        sides: u8,
    },
}

fn five() -> u8 {
    5
}
fn six() -> u8 {
    6
}
fn half() -> f32 {
    0.5
}

impl Default for Shape {
    fn default() -> Self {
        Shape::Rectangle
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlideScope {
    Current,
    Previous,
    Next,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BibleField {
    #[default]
    Text,
    /// "Juan 3:16" in that version's book names.
    Reference,
    /// The version's abbreviation, e.g. "RVA".
    Version,
    /// Licence text some versions require.
    Attribution,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlideField {
    Text,
    /// 1-based slide number.
    Number,
    Total,
    Group,
    Title,
}

/// Where an element's text comes from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TextSource {
    Static {
        #[serde(default)]
        text: String,
    },
    Slide {
        scope: SlideScope,
        field: SlideField,
    },
    /// System clock, e.g. format `HH:mm:ss` or `h:mm a`.
    Clock {
        #[serde(default = "default_clock_format")]
        format: String,
    },
    /// A timer defined in the Timers list, e.g. format `mm:ss`.
    /// The passage on the Bible layer, in one of the shown versions (slot 0-3).
    Bible {
        #[serde(default)]
        slot: u8,
        #[serde(default)]
        field: BibleField,
    },
    Timer {
        #[serde(default, deserialize_with = "crate::storage::ids::opt")]
        timer_id: Option<Uuid>,
        #[serde(default = "default_timer_format")]
        format: String,
    },
}

fn default_clock_format() -> String {
    "HH:mm".into()
}
fn default_timer_format() -> String {
    "mm:ss".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextBlock {
    pub source: TextSource,
    #[serde(default)]
    pub style: TextStyle,
}

fn new_id() -> Uuid {
    Uuid::new_v4()
}
fn one() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(from = "ElementRaw")]
pub struct Element {
    pub id: Uuid,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub transform: Transform,
    pub opacity: f32,
    pub shape: Shape,
    /// Rounded corners for rectangles.
    pub corner_radius: f32,
    pub fill: Fill,
    pub border: Border,
    pub shadow: Shadow,
    pub padding: Edges,
    pub text: Option<TextBlock>,
}

// ---------- reading old and new files ----------

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum LegacyKind {
    Text {
        content: String,
        #[serde(default)]
        style: TextStyle,
    },
    Shape {
        shape: String,
    },
    Media {},
    Value {
        scope: SlideScope,
        field: String,
        #[serde(default)]
        style: TextStyle,
    },
    Action {},
}

#[derive(Deserialize, Default)]
struct LegacyBorder {
    #[serde(default)]
    width: f32,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    radius: f32,
    #[serde(default)]
    enabled: Option<bool>,
}

#[derive(Deserialize)]
struct ElementRaw {
    #[serde(default = "new_id", deserialize_with = "crate::storage::ids::new_if_empty")]
    id: Uuid,
    #[serde(default)]
    name: String,
    #[serde(default = "super::yes")]
    visible: bool,
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    transform: Transform,
    #[serde(default = "one")]
    opacity: f32,
    #[serde(default)]
    shape: Option<Shape>,
    #[serde(default)]
    corner_radius: f32,
    #[serde(default)]
    fill: Option<Fill>,
    #[serde(default)]
    border: Option<serde_json::Value>,
    #[serde(default)]
    shadow: Shadow,
    #[serde(default)]
    padding: Edges,
    #[serde(default)]
    text: Option<TextBlock>,
    // legacy fields
    #[serde(default)]
    background: Option<Fill>,
    #[serde(default)]
    kind: Option<LegacyKind>,
}

impl From<ElementRaw> for Element {
    fn from(raw: ElementRaw) -> Self {
        let legacy_border: LegacyBorder = raw
            .border
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let border = Border {
            enabled: legacy_border.enabled.unwrap_or(legacy_border.width > 0.0),
            width: if legacy_border.width > 0.0 { legacy_border.width } else { 4.0 },
            color: legacy_border.color.unwrap_or_else(|| "#FFFFFF".into()),
        };
        let mut element = Element {
            id: raw.id,
            name: raw.name,
            visible: raw.visible,
            locked: raw.locked,
            transform: raw.transform,
            opacity: raw.opacity,
            shape: raw.shape.unwrap_or_default(),
            corner_radius: if raw.corner_radius > 0.0 { raw.corner_radius } else { legacy_border.radius },
            fill: raw.fill.or(raw.background).unwrap_or_default(),
            border,
            shadow: raw.shadow,
            padding: raw.padding,
            text: raw.text,
        };
        match raw.kind {
            Some(LegacyKind::Text { content, style }) => {
                element.text = Some(TextBlock {
                    source: TextSource::Static { text: content },
                    style,
                });
            }
            Some(LegacyKind::Value { scope, field, style }) => {
                let field = match field.as_str() {
                    "slide_index" => SlideField::Number,
                    "total_slides" => SlideField::Total,
                    "group_name" => SlideField::Group,
                    "presentation_title" => SlideField::Title,
                    _ => SlideField::Text,
                };
                element.text = Some(TextBlock {
                    source: TextSource::Slide { scope, field },
                    style,
                });
            }
            Some(LegacyKind::Shape { shape }) if shape == "ellipse" => element.shape = Shape::Ellipse,
            _ => {}
        }
        element
    }
}
