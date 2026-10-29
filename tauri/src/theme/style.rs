use serde::{Deserialize, Serialize};

/// "#RRGGBB" or "#RRGGBBAA"
pub type Color = String;

pub fn is_valid_color(c: &str) -> bool {
    let Some(hex) = c.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 6 | 8) && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 100.0,
            rotation: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Edges {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

impl Default for Edges {
    fn default() -> Self {
        Self {
            top: 0.0,
            right: 0.0,
            bottom: 0.0,
            left: 0.0,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Background {
    #[default]
    None,
    Color {
        color: Color,
    },
    // TODO(later): Gradient, Image
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Border {
    pub width: f32,
    pub color: Color,
    pub radius: f32,
}

impl Default for Border {
    fn default() -> Self {
        Self {
            width: 0.0,
            color: "#000000".into(),
            radius: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HAlign {
    Left,
    #[default]
    Center,
    Right,
    Justify,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VAlign {
    Top,
    #[default]
    Middle,
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TextStyle {
    /// System-installed font family name.
    pub font_family: String,
    pub font_size: f32,
    pub color: Color,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub h_align: HAlign,
    pub v_align: VAlign,
    pub line_height: f32,
    /// Text margins inside the element (distinct from element padding).
    pub margin: Edges,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "sans-serif".into(),
            font_size: 48.0,
            color: "#FFFFFF".into(),
            bold: false,
            italic: false,
            underline: false,
            h_align: HAlign::Center,
            v_align: VAlign::Middle,
            line_height: 1.2,
            margin: Edges::default(),
        }
    }
}
