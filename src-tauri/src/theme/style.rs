use serde::{Deserialize, Serialize};

/// "#RRGGBB" or "#RRGGBBAA"
pub type Color = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform { pub x: f32, pub y: f32, pub width: f32, pub height: f32, pub rotation: f32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edges { pub top: f32, pub right: f32, pub bottom: f32, pub left: f32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Background {
    None,
    Color { color: Color },
    // TODO(later): Gradient, Image
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Border { pub width: f32, pub color: Color, pub radius: f32 }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HAlign { Left, Center, Right, Justify }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VAlign { Top, Middle, Bottom }

#[derive(Debug, Clone, Serialize, Deserialize)]
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
