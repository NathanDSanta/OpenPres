use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Edges {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaFit {
    #[default]
    Cover,
    Contain,
    Stretch,
}

/// How an element (or a design) is filled. Old themes used `background`, which has the
/// same shape for `none` and `color`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Fill {
    #[default]
    None,
    Color {
        color: Color,
    },
    Gradient {
        from: Color,
        to: Color,
        #[serde(default)]
        angle: f32,
    },
    /// An imported picture or video.
    Media {
        #[serde(deserialize_with = "crate::storage::ids::nil_if_empty")]
        media_id: Uuid,
        #[serde(default)]
        fit: MediaFit,
        /// Videos loop by default.
        #[serde(default = "super::yes")]
        r#loop: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Border {
    pub enabled: bool,
    pub width: f32,
    pub color: Color,
}

impl Default for Border {
    fn default() -> Self {
        Self {
            enabled: false,
            width: 4.0,
            color: "#FFFFFF".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Shadow {
    pub enabled: bool,
    pub color: Color,
    pub blur: f32,
    pub x: f32,
    pub y: f32,
}

impl Default for Shadow {
    fn default() -> Self {
        Self {
            enabled: false,
            color: "#000000AA".into(),
            blur: 12.0,
            x: 0.0,
            y: 4.0,
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

/// Dynamic text scaling inside the element box.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextScaling {
    /// Always `font_size`.
    #[default]
    Fixed,
    /// Only scale down to fit.
    Shrink,
    /// Only scale up to fill the space.
    Grow,
    /// Scale up or down to fill the space.
    Fit,
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
    pub uppercase: bool,
    pub letter_spacing: f32,
    pub h_align: HAlign,
    pub v_align: VAlign,
    pub line_height: f32,
    /// Text margins inside the element (distinct from element padding).
    pub margin: Edges,
    pub scaling: TextScaling,
    /// Lower bound used when shrinking.
    pub min_font_size: f32,
    /// Upper bound used when growing.
    pub max_font_size: f32,
    pub outline_width: f32,
    pub outline_color: Color,
    /// Joins lines before drawing, e.g. to fit tall lyrics into a lower third:
    /// 1 = keep every line break, 2 = join lines in pairs (removes every other break),
    /// 3 = groups of three..., 0 = everything on one line.
    pub join_lines: u32,
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
            uppercase: false,
            letter_spacing: 0.0,
            h_align: HAlign::Center,
            v_align: VAlign::Middle,
            line_height: 1.2,
            margin: Edges::default(),
            scaling: TextScaling::Fixed,
            min_font_size: 12.0,
            max_font_size: 200.0,
            outline_width: 0.0,
            outline_color: "#000000".into(),
            join_lines: 1,
        }
    }
}
