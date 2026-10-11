pub mod physical;
pub mod virtual_screen;

use crate::error::AppError;
use physical::{Binding, PhysicalDisplay};
use uuid::Uuid;
use virtual_screen::VirtualScreen;

pub struct ScreenManager {
    pub screens: Vec<VirtualScreen>,
    pub bindings: Vec<Binding>,
    pub displays: Vec<PhysicalDisplay>,
}

impl ScreenManager {
    pub fn list(&self) -> &[VirtualScreen] { todo!() }
    pub fn get(&self, id: Uuid) -> Result<&VirtualScreen, AppError> { todo!() }
    pub fn get_mut(&mut self, id: Uuid) -> Result<&mut VirtualScreen, AppError> { todo!() }
    pub fn create(&mut self, screen: VirtualScreen) -> Result<(), AppError> { todo!() }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> { todo!() }
    /// Detects monitors (from Tauri) and replaces `displays`.
    pub fn refresh_displays(&mut self, detected: Vec<PhysicalDisplay>) { todo!() }
    /// Binds a virtual screen to a physical display (replaces any previous binding).
    pub fn bind(&mut self, screen_id: Uuid, display_id: &str) -> Result<(), AppError> { todo!() }
    pub fn unbind(&mut self, screen_id: Uuid) -> Result<(), AppError> { todo!() }
}
