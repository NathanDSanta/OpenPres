pub mod element;
pub mod style;

use crate::{error::AppError, storage};
use element::{Element, TextSource};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use style::{is_valid_color, Fill, TextStyle};
use uuid::Uuid;

pub(crate) fn yes() -> bool {
    true
}

fn new_id() -> Uuid {
    Uuid::new_v4()
}

/// Slide themes are assigned to presentations; props collections hold props, complements
/// and screen masks. Both are edited with the same editor.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeKind {
    #[default]
    Slides,
    Props,
}

/// One look inside a theme (e.g. "Lyrics", "Title", "Stage"). Slides are drawn with a design.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Design {
    #[serde(default = "new_id")]
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub background: Fill,
    /// Draw order: first = bottom.
    #[serde(default)]
    pub elements: Vec<Element>,
}

/// Points at one design of one theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignRef {
    pub theme_id: Uuid,
    pub design_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(from = "ThemeRaw")]
pub struct Theme {
    pub id: Uuid,
    pub name: String,
    pub kind: ThemeKind,
    /// Canvas size in pixels; element geometry is in this space.
    pub width: u32,
    pub height: u32,
    pub designs: Vec<Design>,
}

#[derive(Deserialize)]
struct ThemeRaw {
    #[serde(default = "new_id")]
    id: Uuid,
    name: String,
    #[serde(default)]
    kind: ThemeKind,
    #[serde(default = "default_width")]
    width: u32,
    #[serde(default = "default_height")]
    height: u32,
    #[serde(default)]
    designs: Vec<Design>,
    // Version 1 themes had a single look at the top level.
    #[serde(default)]
    background: Option<Fill>,
    #[serde(default)]
    elements: Option<Vec<Element>>,
}

impl From<ThemeRaw> for Theme {
    fn from(raw: ThemeRaw) -> Self {
        let mut designs = raw.designs;
        if designs.is_empty() {
            designs.push(Design {
                // Stable id so presentations that reference "the first design" keep working.
                id: Uuid::new_v5(&raw.id, b"default-design"),
                name: "Default".into(),
                background: raw.background.unwrap_or_default(),
                elements: raw.elements.unwrap_or_default(),
            });
        }
        Theme {
            id: raw.id,
            name: raw.name,
            kind: raw.kind,
            width: raw.width,
            height: raw.height,
            designs,
        }
    }
}

fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
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

fn check_fill(label: &str, fill: &Fill) -> Result<(), AppError> {
    match fill {
        Fill::Color { color } => check_color(label, color),
        Fill::Gradient { from, to, angle } => {
            check_color(label, from)?;
            check_color(label, to)?;
            if !angle.is_finite() {
                return Err(bad(label, "gradient angle must be a number"));
            }
            Ok(())
        }
        Fill::None | Fill::Media { .. } => Ok(()),
    }
}

fn check_text_style(label: &str, style: &TextStyle) -> Result<(), AppError> {
    for (name, size) in [
        ("font_size", style.font_size),
        ("min_font_size", style.min_font_size),
        ("max_font_size", style.max_font_size),
    ] {
        if !(size.is_finite() && size > 0.0 && size <= 2000.0) {
            return Err(bad(label, &format!("{name} must be between 0 and 2000")));
        }
    }
    if !(style.line_height.is_finite() && style.line_height > 0.0) {
        return Err(bad(label, "line_height must be greater than 0"));
    }
    if style.font_family.trim().is_empty() {
        return Err(bad(label, "font_family cannot be empty"));
    }
    check_color(label, &style.color)?;
    check_color(label, &style.outline_color)
}

impl Theme {
    pub fn design(&self, id: Uuid) -> Option<&Design> {
        self.designs.iter().find(|d| d.id == id)
    }

    /// The design to use: by id, else by name (screen theme overrides), else the first.
    pub fn pick_design(&self, id: Option<Uuid>, name: Option<&str>) -> Option<&Design> {
        id.and_then(|id| self.design(id))
            .or_else(|| name.and_then(|n| self.designs.iter().find(|d| d.name.eq_ignore_ascii_case(n))))
            .or_else(|| self.designs.first())
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() {
            return Err(AppError::BadRequest("theme name cannot be empty".into()));
        }
        if !(1..=16384).contains(&self.width) || !(1..=16384).contains(&self.height) {
            return Err(AppError::BadRequest(
                "theme width and height must be between 1 and 16384 pixels".into(),
            ));
        }
        if self.designs.is_empty() {
            return Err(AppError::BadRequest("a theme needs at least one design".into()));
        }
        let mut ids = std::collections::HashSet::new();
        for design in &self.designs {
            if !ids.insert(design.id) {
                return Err(AppError::BadRequest(format!("duplicate design id {}", design.id)));
            }
            if design.name.trim().is_empty() {
                return Err(AppError::BadRequest("design names cannot be empty".into()));
            }
            check_fill(&format!("design `{}` background", design.name), &design.background)?;
            for el in &design.elements {
                Self::validate_element(el)?;
            }
        }
        Ok(())
    }

    fn validate_element(el: &Element) -> Result<(), AppError> {
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
            return Err(bad(&label, "x, y and rotation must be finite numbers"));
        }
        if !finite_non_negative(el.border.width) || !finite_non_negative(el.corner_radius) {
            return Err(bad(&label, "border width and corner radius must be 0 or more"));
        }
        if !finite_non_negative(el.shadow.blur) {
            return Err(bad(&label, "shadow blur must be 0 or more"));
        }
        check_color(&label, &el.border.color)?;
        check_color(&label, &el.shadow.color)?;
        check_fill(&label, &el.fill)?;
        if let Some(text) = &el.text {
            check_text_style(&label, &text.style)?;
            if let TextSource::Static { text } = &text.source {
                if text.len() > 20_000 {
                    return Err(bad(&label, "text is too long"));
                }
            }
        }
        Ok(())
    }

    /// Imported media referenced by this theme (used to warn before deleting media).
    pub fn media_ids(&self) -> Vec<Uuid> {
        let mut out = Vec::new();
        for design in &self.designs {
            if let Fill::Media { media_id, .. } = design.background {
                out.push(media_id);
            }
            for el in &design.elements {
                if let Fill::Media { media_id, .. } = el.fill {
                    out.push(media_id);
                }
            }
        }
        out
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
    /// Resolves a design reference to (theme, design).
    pub fn resolve(&self, r: &DesignRef) -> Option<(&Theme, &Design)> {
        let theme = self.get(r.theme_id).ok()?;
        Some((theme, theme.design(r.design_id)?))
    }
    pub fn create(&mut self, mut theme: Theme) -> Result<Theme, AppError> {
        theme.id = Uuid::new_v4();
        theme.validate()?;
        storage::write_json(&self.file(theme.id), &theme)?;
        self.themes.push(theme.clone());
        self.themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
