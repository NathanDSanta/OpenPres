//! The themes a server starts with: lyrics and Bible passages full screen (black, white
//! bold Calibri, room at the bottom for a clock) and as lower thirds for the stream, plus a
//! clock and an "Amin" prop for the Stage. Added once (also to servers from before they existed);
//! deleting or changing them afterwards is fine: they don't come back.

use super::{Theme, ThemeManager};
use crate::{error::AppError, storage};
use serde_json::{json, Value};
use uuid::Uuid;

/// Present once the defaults were added.
const MARKER: &str = ".defaults-1";

const W: f32 = 1920.0;
const FONT: &str = "Calibri";
/// The full screen designs keep the text above this, leaving the bottom for a clock.
const TEXT_BOTTOM: f32 = 830.0;

/// Stable ids, so a design picked on a screen keeps pointing at the same default.
fn id(name: &str) -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, format!("openpres:default-theme:{name}").as_bytes())
}

fn element(name: &str, [x, y, w, h]: [f32; 4], fill: Value, text: Value) -> Value {
    json!({
        "id": id(&format!("element:{name}:{x}:{y}")),
        "name": name,
        "visible": true,
        "locked": false,
        "transform": { "x": x, "y": y, "width": w, "height": h, "rotation": 0 },
        "opacity": 1,
        "shape": { "type": "rectangle" },
        "corner_radius": 0,
        "fill": fill,
        "border": { "enabled": false, "width": 4, "color": "#FFFFFF" },
        "shadow": { "enabled": false, "color": "#000000AA", "blur": 12, "x": 0, "y": 4 },
        "padding": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
        "text": text,
    })
}

/// White bold Calibri, shrunk or grown to fill its box.
fn text(source: Value, size: f32, [min, max]: [f32; 2], extra: Value) -> Value {
    let mut style = json!({
        "font_family": FONT,
        "font_size": size,
        "color": "#FFFFFF",
        "bold": true,
        "h_align": "center",
        "v_align": "middle",
        "line_height": 1.15,
        "scaling": "fit",
        "min_font_size": min,
        "max_font_size": max,
        "join_lines": 1,
    });
    if let (Some(style), Some(extra)) = (style.as_object_mut(), extra.as_object()) {
        style.extend(extra.clone());
    }
    json!({ "source": source, "style": style })
}

fn shadowed(mut element: Value) -> Value {
    element["shadow"] = json!({ "enabled": true, "color": "#000000CC", "blur": 14, "x": 0, "y": 3 });
    element
}

fn none() -> Value {
    json!({ "type": "none" })
}
fn black() -> Value {
    json!({ "type": "color", "color": "#000000" })
}
/// The band behind a lower third.
fn band(y: f32, h: f32) -> Value {
    element("Band", [0.0, y, W, h], json!({ "type": "color", "color": "#000000B3" }), Value::Null)
}
fn slide() -> Value {
    json!({ "type": "slide", "scope": "current", "field": "text" })
}
fn bible(slot: u8, field: &str) -> Value {
    json!({ "type": "bible", "slot": slot, "field": field })
}
fn design(name: &str, background: Value, elements: Vec<Value>) -> Value {
    json!({ "id": id(&format!("design:{name}")), "name": name, "background": background, "elements": elements })
}
fn theme(name: &str, kind: &str, designs: Vec<Value>) -> Value {
    json!({ "id": id(&format!("theme:{name}")), "name": name, "kind": kind, "width": 1920, "height": 1080, "designs": designs })
}

pub fn themes() -> Vec<Theme> {
    let lyrics = theme(
        "Lyrics",
        "slides",
        vec![
            design(
                "Full screen",
                black(),
                vec![element("Lyrics", [100.0, 70.0, 1720.0, TEXT_BOTTOM - 70.0], none(), text(slide(), 100.0, [40.0, 120.0], json!({})))],
            ),
            // For the stream: the lines joined in pairs, so a slide fits in a wide band.
            design(
                "Lower third",
                none(),
                vec![
                    band(820.0, 200.0),
                    element("Lyrics", [120.0, 836.0, 1680.0, 168.0], none(), text(slide(), 60.0, [28.0, 64.0], json!({ "join_lines": 2 }))),
                ],
            ),
        ],
    );

    let reference_style = json!({ "bold": false, "color": "#FFFFFFCC", "scaling": "shrink" });
    let version_style = json!({ "bold": false, "color": "#FFFFFF99", "scaling": "shrink" });
    let bible = theme(
        "Bible",
        "slides",
        vec![
            design(
                "Full screen · 1 version",
                black(),
                vec![
                    element("Text", [100.0, 70.0, 1720.0, 640.0], none(), text(bible(0, "text"), 84.0, [32.0, 100.0], json!({}))),
                    element("Reference", [100.0, 730.0, 1720.0, 90.0], none(), text(bible(0, "reference"), 56.0, [28.0, 56.0], reference_style.clone())),
                ],
            ),
            design(
                "Full screen · 2 versions",
                black(),
                vec![
                    element("Text 1", [100.0, 70.0, 820.0, 600.0], none(), text(bible(0, "text"), 64.0, [24.0, 80.0], json!({}))),
                    element("Text 2", [1000.0, 70.0, 820.0, 600.0], none(), text(bible(1, "text"), 64.0, [24.0, 80.0], json!({}))),
                    element("Version 1", [100.0, 682.0, 820.0, 56.0], none(), text(bible(0, "version"), 36.0, [20.0, 36.0], version_style.clone())),
                    element("Version 2", [1000.0, 682.0, 820.0, 56.0], none(), text(bible(1, "version"), 36.0, [20.0, 36.0], version_style.clone())),
                    element("Reference", [100.0, 748.0, 1720.0, 72.0], none(), text(bible(0, "reference"), 50.0, [24.0, 50.0], reference_style.clone())),
                ],
            ),
            design(
                "Lower third · 1 version",
                none(),
                vec![
                    band(770.0, 250.0),
                    element(
                        "Reference",
                        [120.0, 782.0, 1680.0, 50.0],
                        none(),
                        text(bible(0, "reference"), 36.0, [20.0, 36.0], json!({ "bold": true, "color": "#FFE2A8", "h_align": "left", "scaling": "shrink" })),
                    ),
                    element("Text", [120.0, 834.0, 1680.0, 172.0], none(), text(bible(0, "text"), 50.0, [24.0, 56.0], json!({ "h_align": "left" }))),
                ],
            ),
            design(
                "Lower third · 2 versions",
                none(),
                vec![
                    band(720.0, 300.0),
                    element(
                        "Reference",
                        [120.0, 730.0, 1680.0, 50.0],
                        none(),
                        text(bible(0, "reference"), 36.0, [20.0, 36.0], json!({ "bold": true, "color": "#FFE2A8", "scaling": "shrink" })),
                    ),
                    element("Text 1", [120.0, 784.0, 810.0, 222.0], none(), text(bible(0, "text"), 42.0, [20.0, 48.0], json!({ "h_align": "left" }))),
                    element("Text 2", [990.0, 784.0, 810.0, 222.0], none(), text(bible(1, "text"), 42.0, [20.0, 48.0], json!({ "h_align": "left" }))),
                ],
            ),
        ],
    );

    // Its id keeps the old name ("Complements"), so screens that use its designs keep them.
    let mut props = theme(
        "Complements",
        "props",
        vec![
            // In the room left under the full screen designs.
            design(
                "Clock",
                none(),
                vec![shadowed(element(
                    "Clock",
                    [660.0, 856.0, 600.0, 170.0],
                    none(),
                    text(json!({ "type": "clock", "format": "HH:mm" }), 120.0, [40.0, 130.0], json!({ "scaling": "shrink" })),
                ))],
            ),
            design(
                "Amin",
                none(),
                vec![shadowed(element(
                    "Amin",
                    [1380.0, 900.0, 480.0, 130.0],
                    none(),
                    text(json!({ "type": "static", "text": "Amin" }), 96.0, [40.0, 96.0], json!({ "h_align": "right", "v_align": "bottom", "scaling": "shrink" })),
                ))],
            ),
        ],
    );

    props["name"] = json!("Props");

    [lyrics, bible, props]
        .into_iter()
        .map(|t| serde_json::from_value(t).expect("default themes are valid"))
        .collect()
}

impl ThemeManager {
    /// Adds the default themes the first time (once per server). The default props collection
    /// was called "Complements" before the props were one layer: renamed if still so.
    pub fn add_defaults(&mut self) -> Result<(), AppError> {
        let old_props = id("theme:Complements");
        let file = self.file(old_props);
        if let Some(t) = self.themes.iter_mut().find(|t| t.id == old_props && t.name == "Complements") {
            t.name = "Props".into();
            storage::write_json(&file, &*t)?;
        }
        let marker = self.dir.join(MARKER);
        if marker.exists() {
            return Ok(());
        }
        for theme in themes() {
            if self.themes.iter().any(|t| t.id == theme.id) {
                continue;
            }
            theme.validate()?;
            storage::write_json(&self.file(theme.id), &theme)?;
            self.themes.push(theme);
        }
        self.themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        std::fs::write(&marker, b"")?;
        tracing::info!("added the default themes");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_added_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut manager = ThemeManager::load(dir.path().to_path_buf()).unwrap();
        manager.add_defaults().unwrap();
        assert_eq!(manager.list().len(), 3);
        let designs: usize = manager.list().iter().map(|t| t.designs.len()).sum();
        assert_eq!(designs, 2 + 4 + 2);
        // Deleted: not added again.
        let lyrics = manager.list().iter().find(|t| t.name == "Lyrics").unwrap().id;
        manager.delete(lyrics).unwrap();
        let mut again = ThemeManager::load(dir.path().to_path_buf()).unwrap();
        again.add_defaults().unwrap();
        assert_eq!(again.list().len(), 2);
    }

    #[test]
    fn lower_third_joins_lines_in_pairs() {
        let lyrics = themes().into_iter().find(|t| t.name == "Lyrics").unwrap();
        let lower = lyrics.designs.iter().find(|d| d.name == "Lower third").unwrap();
        let text = lower.elements.iter().find_map(|e| e.text.as_ref()).unwrap();
        assert_eq!(text.style.join_lines, 2);
        assert_eq!(text.style.font_family, "Calibri");
    }
}
