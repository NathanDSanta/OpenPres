use crate::{error::AppError, storage};
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const DEFAULT_API_PORT: u16 = 8787;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub api_port: u16,
    #[serde(skip)]
    pub data_dir: PathBuf,
}

impl AppConfig {
    pub fn config_path(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }

    pub fn default_data_dir() -> PathBuf {
        BaseDirs::new()
            .map(|d| d.data_dir().join("OpenPres")) // Directly targets AppData\Roaming\OpenPres
            .unwrap_or_else(|| PathBuf::from("./data"))
    }
    
    pub fn load() -> Result<Self, AppError> {
        let data_dir = std::env::var_os("OPENPRES_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(Self::default_data_dir);
        std::fs::create_dir_all(&data_dir)?;

        let file = data_dir.join("config.json");
        let mut config = if file.exists() {
            storage::read_json::<AppConfig>(&file)?
        } else {
            AppConfig {
                api_port: DEFAULT_API_PORT,
                data_dir: PathBuf::new(),
            }
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
