pub mod api;
pub mod audio;
pub mod auth;
pub mod bible;
pub mod config;
pub mod devices;
pub mod error;
pub mod events;
pub mod groups;
pub mod layers;
pub mod live;
pub mod media;
pub mod presentation;
pub mod presenter;
pub mod screens;
pub mod state;
pub mod storage;
pub mod stream;
pub mod templates;
pub mod theme;
pub mod timers;
pub mod tools;
pub mod workspace;
pub mod youtube;

use crate::{
    audio::{AudioConfig, AudioEngine},
    auth::AuthState,
    config::AppConfig,
    devices::{capture::CaptureManager, DeviceRegistry},
    error::AppError,
    events::EventHub,
    live::LiveLayers,
    media::{MediaLibrary, MediaPlayer},
    presentation::{library::LibraryManager, playlist::PlaylistManager},
    presenter::PresenterEngine,
    screens::{physical::DisplayProvider, ScreenManager},
    state::{AppState, SharedState},
    storage::StoragePaths,
    stream::StreamManager,
    theme::ThemeManager,
    timers::TimerManager,
};

use std::{sync::Arc, time::Duration};
use tokio::sync::{Mutex, RwLock};

/// Builds the full application state without Tauri, so tests can use it
/// with mock device providers and a temporary data dir.
pub fn build_app(
    config: AppConfig,
    devices: DeviceRegistry,
    displays: Box<dyn DisplayProvider>,
    frontend_dir: std::path::PathBuf,
) -> Result<SharedState, AppError> {
    let paths = StoragePaths::new(config.data_dir.clone());
    let screens = ScreenManager::load(paths.file("screens.json"))?;
    let libraries = LibraryManager::load(paths.libraries_dir())?;
    let playlists = PlaylistManager::load(paths.playlists_dir())?;
    let themes = ThemeManager::load(paths.themes_dir())?;
    let groups = groups::load(paths.file("groups.json"), &config.group_styles)?;
    let templates = templates::load(paths.file("import_templates.json"))?;
    let workspace = workspace::load(paths.file("workspace.json"))?;
    let ui_settings = workspace::load(paths.file("ui.json"))?;
    let timers = TimerManager::load(paths.file("timers.json"))?;
    let media = MediaLibrary::load(paths.media_dir())?;
    let mut media_playlists = media::playlists::load(paths.media_dir().join("playlists.json"))?;
    if media::playlists::organise(&mut media_playlists.value, &media.items) {
        media_playlists.save()?;
    }
    let stream = StreamManager::load(paths.file("stream.json"))?;
    let bibles = bible::BibleStore::load(paths.file("bibles"))?;

    let audio_config_path = paths.file("audio.json");
    let audio_config = AudioConfig::load(&audio_config_path, &paths.file("audio_routing.json"))?;
    let audio = AudioEngine::start();
    audio.apply(&audio_config, true);
    let player = MediaPlayer::new(audio.graph.clone());

    Ok(Arc::new(AppState {
        config: RwLock::new(config),
        devices,
        display_provider: displays,
        screens: RwLock::new(screens),
        libraries: RwLock::new(libraries),
        playlists: RwLock::new(playlists),
        themes: RwLock::new(themes),
        presenter: RwLock::new(PresenterEngine::default()),
        live: RwLock::new(LiveLayers::default()),
        bibles: RwLock::new(bibles),
        bible_live: RwLock::new(None),
        focus: RwLock::new(Default::default()),
        timers: RwLock::new(timers),
        groups: RwLock::new(groups),
        templates: RwLock::new(templates),
        workspace: RwLock::new(workspace),
        ui_settings: RwLock::new(ui_settings),
        started_at: std::time::Instant::now(),
        media: RwLock::new(media),
        media_playlists: RwLock::new(media_playlists),
        player,
        audio_config: RwLock::new(audio_config),
        audio_config_path,
        audio,
        capture: CaptureManager::default(),
        stream,
        youtube: youtube::Youtube::load(paths.file("youtube.json"))?,
        events: Arc::new(EventHub::default()),
        auth: AuthState::default(),
        frontend_dir,
        server_shutdown: Mutex::new(None),
    }))
}

/// Background work: media end-of-item handling and stream housekeeping.
/// Call once from inside the async runtime.
pub fn spawn_background(state: SharedState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_millis(200));
        loop {
            tick.tick().await;
            for due in state.player.due() {
                let media::player::Due::Ended(slot) = due;
                if let Err(e) = api::media::on_item_ended(&state, slot).await {
                    tracing::warn!("media end handling failed: {e}");
                }
                state.events.changed();
            }
            state.stream.reap(&state.audio.graph);
        }
    });
}

/// Stops background threads that hold devices (call when the app exits).
pub fn shutdown(state: &SharedState) {
    state.stream.stop(&state.audio.graph, &state.events);
    state.capture.stop_all();
    state.audio.shutdown();
}
