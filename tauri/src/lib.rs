#![allow(dead_code, unused_variables, unused_imports)]

pub mod api;
pub mod audio_router;
pub mod config;
pub mod devices;
pub mod error;
pub mod layers;
pub mod presentation;
pub mod presenter;
pub mod screens;
pub mod state;
pub mod storage;
pub mod theme;

use crate::{
    audio_router::AudioRouting,
    config::AppConfig,
    devices::DeviceRegistry,
    error::AppError,
    presentation::{library::LibraryManager, playlist::PlaylistManager},
    presenter::PresenterEngine,
    screens::{physical::DisplayProvider, ScreenManager},
    state::{AppState, SharedState},
    storage::StoragePaths,
    theme::ThemeManager,
};

use std::{path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, RwLock};

/// Builds the full application state without Tauri, so tests can use it
/// with mock device providers and a temporary data dir.
pub fn build_app(
    config: AppConfig,
    devices: DeviceRegistry,
    displays: Box<dyn DisplayProvider>,
    frontend_dir: PathBuf,
) -> Result<SharedState, AppError> {
    let paths = StoragePaths::new(config.data_dir.clone());
    let screens = ScreenManager::load(paths.root.join("screens.json"))?;
    let audio = AudioRouting::load(paths.root.join("audio_routing.json"))?;
    let libraries = LibraryManager::load(paths.libraries_dir())?;
    let playlists = PlaylistManager::load(paths.playlists_dir())?;
    let themes = ThemeManager::load(paths.themes_dir())?;
    Ok(Arc::new(AppState {
        config: RwLock::new(config),
        devices,
        display_provider: displays,
        screens: RwLock::new(screens),
        audio: RwLock::new(audio),
        libraries: RwLock::new(libraries),
        playlists: RwLock::new(playlists),
        themes: RwLock::new(themes),
        presenter: RwLock::new(PresenterEngine::default()),
        frontend_dir,
        server_shutdown: Mutex::new(None),
    }))
}
