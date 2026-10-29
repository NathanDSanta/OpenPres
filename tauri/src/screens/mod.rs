pub mod physical;
pub mod virtual_screen;
use crate::{
    error::AppError,
    layers::{content::LayerContent, Layer, LayerKind, LayerStack},
    state::SharedState,
    storage,
};
use physical::{Binding, PhysicalDisplay};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;
use virtual_screen::{ScreenInput, VirtualScreen};
/// What is written to screens.json.
#[derive(Default, Serialize, Deserialize)]
struct ScreensFile {
    screens: Vec<VirtualScreen>,
    bindings: Vec<Binding>,
}
pub struct ScreenManager {
    pub screens: Vec<VirtualScreen>,
    pub bindings: Vec<Binding>,
    /// Detected live, never saved.
    pub displays: Vec<PhysicalDisplay>,
    pub path: PathBuf,
}
impl ScreenManager {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let file: ScreensFile = if path.exists() {
            storage::read_json(&path)?
        } else {
            ScreensFile::default()
        };
        let mut screens = file.screens;
        for screen in &mut screens {
            screen.layers = LayerStack::new(); // layers are live state: start clean
        }
        Ok(Self {
            screens,
            bindings: file.bindings,
            displays: vec![],
            path,
        })
    }
    fn save(&self) -> Result<(), AppError> {
        let file = ScreensFile {
            screens: self.screens.clone(),
            bindings: self.bindings.clone(),
        };
        storage::write_json(&self.path, &file)
    }
    // ---------- screens ----------
    pub fn list(&self) -> &[VirtualScreen] {
        &self.screens
    }
    pub fn get(&self, id: Uuid) -> Result<&VirtualScreen, AppError> {
        self.screens
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::NotFound(format!("screen {id}")))
    }
    fn get_mut(&mut self, id: Uuid) -> Result<&mut VirtualScreen, AppError> {
        self.screens
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::NotFound(format!("screen {id}")))
    }
    pub fn create(&mut self, input: ScreenInput) -> Result<VirtualScreen, AppError> {
        input.validate()?;
        let screen = VirtualScreen {
            id: Uuid::new_v4(),
            name: input.name.trim().to_string(),
            kind: input.kind,
            width: input.width,
            height: input.height,
            layers: LayerStack::new(),
            theme_id: input.theme_id,
        };
        self.screens.push(screen.clone());
        self.save()?;
        Ok(screen)
    }
    /// Replaces the editable fields. Layers and bindings are untouched.
    pub fn update(&mut self, id: Uuid, input: ScreenInput) -> Result<VirtualScreen, AppError> {
        input.validate()?;
        let updated = {
            let screen = self.get_mut(id)?;
            screen.name = input.name.trim().to_string();
            screen.kind = input.kind;
            screen.width = input.width;
            screen.height = input.height;
            screen.theme_id = input.theme_id;
            screen.clone()
        };
        self.save()?;
        Ok(updated)
    }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> {
        let pos = self
            .screens
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| AppError::NotFound(format!("screen {id}")))?;
        self.screens.remove(pos);
        self.bindings.retain(|b| b.virtual_screen != id);
        self.save()
    }
    // ---------- displays and bindings ----------
    pub fn refresh_displays(&mut self, detected: Vec<PhysicalDisplay>) {
        self.displays = detected;
    }
    pub fn binding_of(&self, screen_id: Uuid) -> Option<&Binding> {
        self.bindings.iter().find(|b| b.virtual_screen == screen_id)
    }
    /// One display shows one virtual screen: any previous use of either side is replaced.
    pub fn bind(&mut self, screen_id: Uuid, display_id: &str) -> Result<(), AppError> {
        self.get(screen_id)?;
        if !self.displays.iter().any(|d| d.id == display_id) {
            return Err(AppError::NotFound(format!(
                "display `{display_id}` (try POST /displays/refresh)"
            )));
        }
        self.bindings
            .retain(|b| b.virtual_screen != screen_id && b.physical_display != display_id);
        self.bindings.push(Binding {
            virtual_screen: screen_id,
            physical_display: display_id.to_string(),
        });
        self.save()
    }
    pub fn unbind(&mut self, screen_id: Uuid) -> Result<(), AppError> {
        let before = self.bindings.len();
        self.bindings.retain(|b| b.virtual_screen != screen_id);
        if self.bindings.len() == before {
            return Err(AppError::NotFound("that screen has no binding".into()));
        }
        self.save()
    }
    // ---------- layers (live state, not saved) ----------
    pub fn update_layer(
        &mut self,
        id: Uuid,
        kind: LayerKind,
        visible: Option<bool>,
        content: Option<LayerContent>,
    ) -> Result<Layer, AppError> {
        let screen = self.get_mut(id)?;
        if let Some(content) = content {
            screen.layers.set_content(kind, content)?;
        }
        if let Some(visible) = visible {
            screen.layers.set_visible(kind, visible);
        }
        Ok(screen.layers.get(kind).clone())
    }
    pub fn clear_layer(&mut self, id: Uuid, kind: LayerKind) -> Result<Layer, AppError> {
        let screen = self.get_mut(id)?;
        screen.layers.clear(kind);
        Ok(screen.layers.get(kind).clone())
    }
    /// Puts the same content on one layer of every screen (used by the presenter).
    pub fn set_layer_all(
        &mut self,
        kind: LayerKind,
        content: LayerContent,
    ) -> Result<(), AppError> {
        for screen in &mut self.screens {
            screen.layers.set_content(kind, content.clone())?;
        }
        Ok(())
    }
    pub fn clear_layer_all(&mut self, kind: LayerKind) {
        for screen in &mut self.screens {
            screen.layers.clear(kind);
        }
    }
}
/// Asks the display provider for the monitors and stores them in the manager.
pub async fn detect_displays(state: &SharedState) -> Result<Vec<PhysicalDisplay>, AppError> {
    let detected = state.display_provider.list()?;
    state
        .screens
        .write()
        .await
        .refresh_displays(detected.clone());
    Ok(detected)
}
