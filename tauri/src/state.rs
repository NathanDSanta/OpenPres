use crate::{
    audio_router::AudioRouting,
    config::AppConfig,
    devices::DeviceRegistry,
    presentation::{library::LibraryManager, playlist::PlaylistManager},
    presenter::PresenterEngine,
    screens::ScreenManager,
    theme::ThemeManager,
};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex, RwLock};

pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub devices: DeviceRegistry,
    pub screens: RwLock<ScreenManager>,
    pub audio: RwLock<AudioRouting>,
    pub libraries: RwLock<LibraryManager>,
    pub playlists: RwLock<PlaylistManager>,
    pub themes: RwLock<ThemeManager>,
    pub presenter: RwLock<PresenterEngine>,
    pub server_shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

pub type SharedState = Arc<AppState>;
