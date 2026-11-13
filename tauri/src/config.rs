use crate::{error::AppError, storage};
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    /// Listen on every network interface (iPad / other computers) instead of localhost.
    #[serde(default)]
    pub remote_access: bool,
    /// Salted SHA-256 of the web password; None = no password.
    #[serde(default)]
    pub password_hash: Option<String>,
    #[serde(default)]
    pub password_salt: Option<String>,
    /// ffmpeg executable used for streaming/recording and as fallback audio decoder.
    #[serde(default = "default_ffmpeg")]
    pub ffmpeg_path: String,
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

    pub fn default_data_dir() -> PathBuf {
        BaseDirs::new()
            .map(|d| d.data_dir().join("OpenPres")) // e.g. AppData\Roaming\OpenPres
            .unwrap_or_else(|| PathBuf::from("./data"))
    }

    pub fn load() -> Result<Self, AppError> {
        let data_dir = std::env::var_os("OPENPRES_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(Self::default_data_dir);
        Self::load_from(data_dir)
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

        if let Some(port) = port_from_cli().or_else(port_from_env) {
            config.api_port = port;
        }
        Ok(config)
    }

    pub fn save(&self) -> Result<(), AppError> {
        storage::write_json(&self.config_path(), self)
    }

    pub fn password_required(&self) -> bool {
        self.password_hash.is_some()
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
