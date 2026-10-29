pub mod element;
pub mod style;

use crate::{error::AppError, storage};
use element::{Element, ElementKind};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use style::{is_valid_color, Background, TextStyle};
use uuid::Uuid;

fn new_id() -> Uuid {
    Uuid::new_v4()
}

fn default_width() -> u32 {
    1920
}

fn default_height() -> u32 {
    1080
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    #[serde(default = "new_id")]
    pub id: Uuid,
    pub name: String,
    /// Slide size in pixels.
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default)]
    pub background: style::Background,
    /// Draw order: first = bottom.
    #[serde(default)]
    pub elements: Vec<Element>,
}

fn bad(label: &str, message: &str) -> AppError {
    AppError::BadRequest(format!("{label}: {message}"))
}

fn finite_non_negative(v: f32) -> bool {
    v.is_finite() && v >= 0.0
}

fn check_color(label: &str, color: &str) -> Result<(), AppError> {
    if is_valid_color(color) {
        Ok(())
    } else {
        Err(bad(
            label,
            &format!("invalid color `{color}` (use #RRGGBB or #RRGGBBAA)"),
        ))
    }
}

fn check_background(label: &str, bg: &Background) -> Result<(), AppError> {
    if let Background::Color { color } = bg {
        check_color(label, color)?;
    }
    Ok(())
}

fn check_text_style(label: &str, style: &TextStyle) -> Result<(), AppError> {
    if !(style.font_size.is_finite() && style.font_size > 0.0 && style.font_size <= 2000.0) {
        return Err(bad(label, "font_size must be between 0 and 2000"));
    }
    if !(style.line_height.is_finite() && style.line_height > 0.0) {
        return Err(bad(label, "line_height must be greater than 0"));
    }
    if style.font_family.trim().is_empty() {
        return Err(bad(label, "font_family cannot be empty"));
    }
    check_color(label, &style.color)
}

impl Theme {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() {
            return Err(AppError::BadRequest("theme name cannot be empty".into()));
        }
        if !(1..=16384).contains(&self.width) || !(1..=16384).contains(&self.height) {
            return Err(AppError::BadRequest(
                "theme width and height must be between 1 and 16384 pixels".into(),
            ));
        }
        check_background("theme background", &self.background)?;

        for el in &self.elements {
            let label = if el.name.is_empty() {
                format!("element {}", el.id)
            } else {
                format!("element `{}`", el.name)
            };
            if !(el.opacity.is_finite() && (0.0..=1.0).contains(&el.opacity)) {
                return Err(bad(&label, "opacity must be between 0 and 1"));
            }
            let t = &el.transform;
            if !finite_non_negative(t.width) || !finite_non_negative(t.height) {
                return Err(bad(&label, "width and height must be 0 or more"));
            }
            if !(t.x.is_finite() && t.y.is_finite() && t.rotation.is_finite()) {
                return Err(bad(&label, "x,y and rotations must be finite numbers"));
            }
            if !finite_non_negative(el.border.width) || !finite_non_negative(el.border.radius) {
                return Err(bad(&label, "border width and radius must be 0 or more"));
            }
            check_color(&label, &el.border.color)?;
            check_background(&label, &el.background)?;
            match &el.kind {
                ElementKind::Text { style, .. } | ElementKind::Value { style, .. } => {
                    check_text_style(&label, style)?
                }
                _ => {}
            }
        }
        Ok(())
    }
}

pub struct ThemeManager {
    pub themes: Vec<Theme>,
    pub dir: PathBuf,
}

impl ThemeManager {
    pub fn load(dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&dir)?;
        let mut themes = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("theme") {
                continue;
            }
            match storage::read_json::<Theme>(&path) {
                Ok(t) => themes.push(t),
                Err(e) => tracing::warn!("skipping {}: {e}", path.display()),
            }
        }
        themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(Self { themes, dir })
    }

    fn file(&self, id: Uuid) -> PathBuf {
        self.dir.join(format!("{}.theme", id))
    }

    pub fn list(&self) -> &[Theme] {
        &self.themes
    }
    pub fn get(&self, id: Uuid) -> Result<&Theme, AppError> {
        self.themes
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("theme {id}")))
    }
    pub fn create(&mut self, mut theme: Theme) -> Result<Theme, AppError> {
        theme.id = Uuid::new_v4();
        theme.validate()?;
        storage::write_json(&self.file(theme.id), &theme)?;
        self.themes.push(theme.clone());
        Ok(theme)
    }
    pub fn update(&mut self, id: Uuid, mut theme: Theme) -> Result<Theme, AppError> {
        let pos = self
            .themes
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("theme {id}")))?;
        theme.id = id;
        theme.validate()?;
        storage::write_json(&self.file(id), &theme)?;
        self.themes[pos] = theme.clone();
        Ok(theme)
    }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> {
        let pos = self
            .themes
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("theme {id}")))?;
        std::fs::remove_file(self.file(id))?;
        self.themes.remove(pos);
        Ok(())
    }
}
