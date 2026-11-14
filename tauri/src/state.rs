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

/// Which content the presentation controls (next / previous) move: the slides or the
/// Bible passage, whichever was put on screen last. Announcements always move too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Focus {
    #[default]
    Slides,
    Bible,
}

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
    pub bibles: RwLock<crate::bible::BibleStore>,
    pub bible_live: RwLock<Option<crate::bible::BibleLive>>,
    pub focus: RwLock<Focus>,
    pub timers: RwLock<TimerManager>,
    pub groups: RwLock<JsonDoc<GroupsFile>>,
    pub templates: RwLock<JsonDoc<TemplatesFile>>,
    pub workspace: RwLock<Workspace>,
    /// UI preferences owned by the frontend (keybindings, command prefixes...).
    pub ui_settings: RwLock<Workspace>,
    pub started_at: std::time::Instant,
    pub media: RwLock<MediaLibrary>,
    pub media_playlists: RwLock<MediaPlaylists>,
    pub player: MediaPlayer,
    pub audio_config: RwLock<AudioConfig>,
    pub audio_config_path: PathBuf,
    pub audio: Arc<AudioEngine>,
    pub capture: CaptureManager,
    pub stream: StreamManager,
    pub youtube: crate::youtube::Youtube,
    pub events: Arc<EventHub>,
    pub auth: AuthState,
    pub frontend_dir: PathBuf,
    pub server_shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

pub type SharedState = Arc<AppState>;

impl AppState {
    /// The ffmpeg to run: the Settings path, the bundled one, or the system one.
    pub async fn ffmpeg(&self) -> String {
        crate::tools::ffmpeg(&self.config.read().await.ffmpeg_path)
    }
    pub async fn data_dir(&self) -> PathBuf {
        self.config.read().await.data_dir.clone()
    }
}
