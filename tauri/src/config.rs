use crate::{error::AppError, paths, storage};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

pub const DEFAULT_API_PORT: u16 = 8787;

fn default_port() -> u16 {
    DEFAULT_API_PORT
}
fn default_ffmpeg() -> String {
    "ffmpeg".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_port")]
    pub api_port: u16,
    #[serde(skip)]
    pub data_dir: PathBuf,
    /// Old location of the group colours; read once and moved to groups.json.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub group_styles: Vec<GroupStyle>,
    /// Listen on every network interface (managers on other computers, iPads) instead of
    /// localhost only.
    #[serde(default)]
    pub remote_access: bool,
    /// Salted SHA-256 of the operator password (every manager mode except Admin);
    /// None = not set yet.
    #[serde(default)]
    pub password_hash: Option<String>,
    #[serde(default)]
    pub password_salt: Option<String>,
    /// Salted SHA-256 of the admin password (general settings); None = the server hasn't
    /// been set up yet.
    #[serde(default)]
    pub admin_password_hash: Option<String>,
    #[serde(default)]
    pub admin_password_salt: Option<String>,
    /// Viewers (the Android app, or /viewer in a browser) may watch the screens and listen to
    /// the buses.
    #[serde(default)]
    pub viewers: bool,
    /// Salted SHA-256 of the viewers' own password; None = they need none.
    #[serde(default)]
    pub viewer_password_hash: Option<String>,
    #[serde(default)]
    pub viewer_password_salt: Option<String>,
    /// This server, as managers know it.
    #[serde(default = "Uuid::new_v4")]
    pub server_id: Uuid,
    /// Name shown to managers; empty = the computer's name.
    #[serde(default)]
    pub server_name: String,
    /// Active, standby or asleep; kept across restarts.
    #[serde(default)]
    pub power: Power,
    /// Install new versions by themselves (when nothing is live), instead of waiting for the
    /// admin's "Update".
    #[serde(default)]
    pub auto_update: bool,
    /// ffmpeg executable used for streaming/recording and as fallback audio decoder.
    #[serde(default = "default_ffmpeg")]
    pub ffmpeg_path: String,
}

/// What the server is doing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Power {
    /// Everything works.
    #[default]
    Active,
    /// Nothing is shown or streamed, but everything can be managed (songs, groups,
    /// settings...).
    Standby,
    /// Nothing works, except waking it up.
    Sleep,
}

/// This computer's name (without a `.local` or domain part).
pub fn host_name() -> String {
    let name = gethostname::gethostname().to_string_lossy().into_owned();
    let name = name.split('.').next().unwrap_or("").trim().to_string();
    if name.is_empty() {
        "OpenPres".into()
    } else {
        name
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupStyle {
    pub name: String,
    pub color: String,
}

impl AppConfig {
    pub fn config_path(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }

    /// The server's folder (`OpenPres/Server`, see [`crate::paths`]).
    pub fn default_data_dir() -> PathBuf {
        paths::server_dir()
    }

    /// Loads the server's settings from its folder; first moves the files of versions
    /// before 0.4 there (see [`paths::move_old_server_files`]).
    pub fn load() -> Result<Self, AppError> {
        let (dir, moved) = paths::move_old_server_files(&paths::root());
        match &moved {
            paths::Moved::Nothing => {}
            paths::Moved::Done(n) => tracing::info!("moved {n} files and folders of the old version into {}", dir.display()),
            paths::Moved::Failed(e) => {
                tracing::error!("could not move the old files into the Server folder ({e}); using {} this time", dir.display())
            }
        }
        Self::load_from(dir)
    }

    /// For managers: this computer's server port, and whether a server has ever run here
    /// (its settings exist). Reads only; creates and changes nothing.
    pub fn peek_local() -> (u16, bool) {
        let file = paths::server_config_file();
        let port = storage::read_json::<AppConfig>(&file)
            .map(|c| c.api_port)
            .ok()
            .or_else(port_from_env)
            .unwrap_or(DEFAULT_API_PORT);
        (port, file.exists())
    }

    /// Is this computer's server set up (both passwords)? For the manager, before any server runs.
    pub fn peek_set_up() -> bool {
        storage::read_json::<AppConfig>(&paths::server_config_file()).is_ok_and(|c| c.set_up())
    }

    pub fn load_from(data_dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&data_dir)?;
        let file = data_dir.join("config.json");
        let mut config = if file.exists() {
            storage::read_json::<AppConfig>(&file)?
        } else {
            serde_json::from_str::<AppConfig>("{}").expect("defaults")
        };
        config.data_dir = data_dir;
        // Keep the id (and an upgraded config) from the first run on.
        if file.exists() && !storage::read_json::<serde_json::Value>(&file)?.get("server_id").is_some() {
            config.save()?;
        }

        if let Some(port) = port_from_cli().or_else(port_from_env) {
            config.api_port = port;
        }
        Ok(config)
    }

    pub fn save(&self) -> Result<(), AppError> {
        storage::write_json(&self.config_path(), self)
    }

    /// An operator password is set (managers must log in).
    pub fn password_required(&self) -> bool {
        self.password_hash.is_some()
    }

    /// Viewers need a password of their own.
    pub fn viewer_password_set(&self) -> bool {
        self.viewer_password_hash.is_some()
    }

    pub fn admin_password_set(&self) -> bool {
        self.admin_password_hash.is_some()
    }

    /// The first-run setup (name and passwords) is done.
    pub fn set_up(&self) -> bool {
        self.admin_password_set() && self.password_required()
    }

    /// The name managers show: the one set by the admin, or the computer's.
    pub fn display_name(&self) -> String {
        let name = self.server_name.trim();
        if name.is_empty() {
            host_name()
        } else {
            name.to_string()
        }
    }

    /// 0.0.0.0 when remote access is on, else localhost only.
    pub fn bind_addr(&self) -> [u8; 4] {
        if self.remote_access {
            [0, 0, 0, 0]
        } else {
            [127, 0, 0, 1]
        }
    }
}

fn port_from_env() -> Option<u16> {
    std::env::var("OPENPRES_PORT").ok()?.parse().ok()
}

/// Supports `--port 9000` and `--port=9000`.
fn port_from_cli() -> Option<u16> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--port=") {
            return value.parse().ok();
        }
        if arg == "--port" {
            return args.next()?.parse().ok();
        }
    }
    None
}
