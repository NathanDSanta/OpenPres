use crate::{error::AppError, storage};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const BUSES: u8 = 16;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelMode {
    #[default]
    Mono,
    Stereo,
}

impl ChannelMode {
    pub fn channel_count(self) -> usize {
        match self {
            ChannelMode::Mono => 1,
            ChannelMode::Stereo => 2,
        }
    }
}

fn default_bus() -> u8 {
    1
}

/// One input on the mixer: a channel (mono) or a pair (stereo) of an input device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputStrip {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub name: String,
    /// Namespaced device id, e.g. `cpal:Behringer WING`.
    pub device_id: String,
    #[serde(default)]
    pub mode: ChannelMode,
    /// 0-based device channels: one for mono, two for stereo.
    pub channels: Vec<u16>,
    /// Bus 1-16.
    #[serde(default = "default_bus")]
    pub bus: u8,
    /// Fader, -100 (= -inf) .. +10 dB.
    #[serde(default)]
    pub fader_db: f32,
    /// Input gain knob, -20 .. +40 dB (boosts without moving the fader).
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub muted: bool,
}

/// One output: plays a bus on a channel (mono) or a pair (stereo) of an output device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputStrip {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub name: String,
    pub device_id: String,
    #[serde(default)]
    pub mode: ChannelMode,
    pub channels: Vec<u16>,
    #[serde(default = "default_bus")]
    pub bus: u8,
    /// -100 (= -inf) .. +10 dB.
    #[serde(default)]
    pub volume_db: f32,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    #[serde(default)]
    pub inputs: Vec<InputStrip>,
    #[serde(default)]
    pub outputs: Vec<OutputStrip>,
    /// Names for buses 1-16.
    #[serde(default = "default_bus_names")]
    pub bus_names: Vec<String>,
}

fn default_bus_names() -> Vec<String> {
    (1..=BUSES).map(|i| format!("Bus {i}")).collect()
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            inputs: vec![],
            outputs: vec![],
            bus_names: default_bus_names(),
        }
    }
}

fn check_bus(bus: u8) -> Result<(), AppError> {
    if (1..=BUSES).contains(&bus) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("bus must be between 1 and {BUSES}")))
    }
}

fn check_channels(name: &str, mode: ChannelMode, channels: &[u16]) -> Result<(), AppError> {
    if channels.len() != mode.channel_count() {
        return Err(AppError::BadRequest(format!(
            "`{name}`: {} needs {} channel(s)",
            if mode == ChannelMode::Mono { "mono" } else { "stereo" },
            mode.channel_count()
        )));
    }
    if channels.iter().any(|c| *c >= 256) {
        return Err(AppError::BadRequest(format!("`{name}`: channel out of range")));
    }
    Ok(())
}

fn check_db(name: &str, label: &str, value: f32, min: f32, max: f32) -> Result<(), AppError> {
    if !value.is_finite() || value < min || value > max {
        return Err(AppError::BadRequest(format!(
            "`{name}`: {label} must be between {min} and {max} dB"
        )));
    }
    Ok(())
}

impl AudioConfig {
    pub fn validate(&mut self) -> Result<(), AppError> {
        let mut ids = std::collections::HashSet::new();
        for input in &self.inputs {
            if input.name.trim().is_empty() || input.device_id.trim().is_empty() {
                return Err(AppError::BadRequest("inputs need a name and a device".into()));
            }
            check_channels(&input.name, input.mode, &input.channels)?;
            check_bus(input.bus)?;
            check_db(&input.name, "fader", input.fader_db, -100.0, 10.0)?;
            check_db(&input.name, "gain", input.gain_db, -20.0, 40.0)?;
            if !ids.insert(input.id) {
                return Err(AppError::BadRequest("duplicate input id".into()));
            }
        }
        for output in &self.outputs {
            if output.name.trim().is_empty() || output.device_id.trim().is_empty() {
                return Err(AppError::BadRequest("outputs need a name and a device".into()));
            }
            check_channels(&output.name, output.mode, &output.channels)?;
            check_bus(output.bus)?;
            check_db(&output.name, "volume", output.volume_db, -100.0, 10.0)?;
            if !ids.insert(output.id) {
                return Err(AppError::BadRequest("duplicate output id".into()));
            }
        }
        self.bus_names.resize_with(BUSES as usize, String::new);
        for (i, name) in self.bus_names.iter_mut().enumerate() {
            let trimmed = name.trim();
            *name = if trimmed.is_empty() {
                format!("Bus {}", i + 1)
            } else {
                trimmed.chars().take(40).collect()
            };
        }
        Ok(())
    }

    /// audio.json, or the old audio_routing.json (one mono input per mapping) the first time.
    pub fn load(path: &Path, legacy: &Path) -> Result<Self, AppError> {
        if path.exists() {
            let mut config: AudioConfig = storage::read_json(path)?;
            if config.validate().is_err() {
                tracing::warn!("audio.json has invalid entries; they will be kept but may not work");
            }
            return Ok(config);
        }
        let mut config = AudioConfig::default();
        if legacy.exists() {
            #[derive(Deserialize)]
            struct Old {
                index: u8,
                source_device: String,
                source_channel: u16,
                #[serde(default)]
                label: String,
                #[serde(default)]
                gain_db: f32,
                #[serde(default)]
                muted: bool,
            }
            #[derive(Deserialize)]
            struct OldFile {
                #[serde(default)]
                channels: Vec<Old>,
            }
            if let Ok(old) = storage::read_json::<OldFile>(legacy) {
                for m in old.channels {
                    config.inputs.push(InputStrip {
                        id: Uuid::new_v4(),
                        name: if m.label.is_empty() {
                            format!("Input {}", m.index + 1)
                        } else {
                            m.label
                        },
                        device_id: m.source_device,
                        mode: ChannelMode::Mono,
                        channels: vec![m.source_channel],
                        bus: (m.index % BUSES) + 1,
                        fader_db: 0.0,
                        gain_db: m.gain_db.clamp(-20.0, 40.0),
                        muted: m.muted,
                    });
                }
            }
        }
        Ok(config)
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), AppError> {
        storage::write_json(path, self)
    }
}
