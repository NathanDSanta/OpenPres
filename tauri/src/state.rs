use crate::{
    audio::{AudioConfig, AudioEngine},
    auth::AuthState,
    config::AppConfig,
    devices::{capture::CaptureManager, DeviceRegistry},
    events::EventHub,
    groups::GroupsFile,
    live::LiveLayers,
    media::{playlists::MediaPlaylists, MediaLibrary, MediaPlayer},
    presentation::{library::LibraryManager, playlist::PlaylistManager},
    presenter::PresenterEngine,
    screens::{physical::DisplayProvider, ScreenManager},
    storage::JsonDoc,
    stream::StreamManager,
    templates::TemplatesFile,
    theme::ThemeManager,
    timers::TimerManager,
    workspace::Workspace,
};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{oneshot, Mutex, RwLock};

pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub devices: DeviceRegistry,
    pub display_provider: Box<dyn DisplayProvider>,
    pub screens: RwLock<ScreenManager>,
    pub libraries: RwLock<LibraryManager>,
    pub playlists: RwLock<PlaylistManager>,
    pub themes: RwLock<ThemeManager>,
    pub presenter: RwLock<PresenterEngine>,
    pub live: RwLock<LiveLayers>,
    pub timers: RwLock<TimerManager>,
    pub groups: RwLock<JsonDoc<GroupsFile>>,
    pub templates: RwLock<JsonDoc<TemplatesFile>>,
    pub workspace: RwLock<Workspace>,
    pub media: RwLock<MediaLibrary>,
    pub media_playlists: RwLock<MediaPlaylists>,
    pub player: MediaPlayer,
    pub audio_config: RwLock<AudioConfig>,
    pub audio_config_path: PathBuf,
    pub audio: Arc<AudioEngine>,
    pub capture: CaptureManager,
    pub stream: StreamManager,
    pub events: Arc<EventHub>,
    pub auth: AuthState,
    pub frontend_dir: PathBuf,
    pub server_shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

pub type SharedState = Arc<AppState>;

impl AppState {
    pub async fn ffmpeg(&self) -> String {
        self.config.read().await.ffmpeg_path.clone()
    }
    pub async fn data_dir(&self) -> PathBuf {
        self.config.read().await.data_dir.clone()
    }
}
