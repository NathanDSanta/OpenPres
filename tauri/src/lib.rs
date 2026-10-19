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
    screens::ScreenManager,
    state::{AppState, SharedState},
    storage::StoragePaths,
    theme::ThemeManager,
};

use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// Builds the full application state without Tauri, so tests can use it
/// with mock device providers and a temporary data dir.
pub fn build_app(config: AppConfig, devices: DeviceRegistry) -> Result<SharedState, AppError> {
    let paths = StoragePaths::new(config.data_dir.clone());
    let libraries = LibraryManager::load(paths.libraries_dir())?;
    Ok(Arc::new(AppState {
        config: RwLock::new(config),
        devices,
        screens: RwLock::new(ScreenManager {
            screens: vec![],
            bindings: vec![],
            displays: vec![],
        }),
        audio: RwLock::new(AudioRouting::default()),
        libraries: RwLock::new(libraries),
        playlists: RwLock::new(PlaylistManager { playlists: vec![] }),
        themes: RwLock::new(ThemeManager { themes: vec![] }),
        presenter: RwLock::new(PresenterEngine::default()),
        server_shutdown: Mutex::new(None),
    }))
}
