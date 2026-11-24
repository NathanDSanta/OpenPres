//! The audio mixer is 16 stereo buses. Each bus can take one input device (a channel or a
//! channel pair) and play on any number of output devices (a channel or a channel pair each).
//! Media players and the stream encoder attach to buses too.
//!
//! * `gain_db`   - input gain of the bus' input device (-20 .. +40 dB)
//! * `volume_db` - the bus fader; applies to everything that leaves the bus (output
//!   devices and stream), -100 (= -inf) .. +10 dB

use crate::{error::AppError, storage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const BUSES: u8 = 16;
/// Output devices per bus.
pub const MAX_OUTPUTS: usize = 8;

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

/// A device channel (mono) or channel pair (stereo).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceTap {
    /// Device id as returned by `/devices/audio`.
    pub device_id: String,
    #[serde(default)]
    pub mode: ChannelMode,
    /// 0-based device channels: one for mono, two for stereo.
    pub channels: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub volume_db: f32,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub input: Option<DeviceTap>,
    /// Where the bus plays: several devices can get the same mix (the PA and a recorder…).
    #[serde(default)]
    pub outputs: Vec<DeviceTap>,
    /// Before several outputs: the one output, moved into `outputs` (validate).
    #[serde(default, rename = "output", skip_serializing)]
    legacy_output: Option<DeviceTap>,
}

impl BusConfig {
    fn new(number: u8) -> Self {
        Self {
            name: format!("Bus {number}"),
            volume_db: 0.0,
            gain_db: 0.0,
            muted: false,
            input: None,
            outputs: Vec::new(),
            legacy_output: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub buses: Vec<BusConfig>,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            buses: (1..=BUSES).map(BusConfig::new).collect(),
        }
    }
}

/// Fixed ids of the graph nodes that belong to a bus' devices.
pub fn input_node_id(bus: u8) -> Uuid {
    Uuid::from_u128(0x0a0d_10_00 + bus as u128)
}
/// The `index`th output of a bus (the first has the id the only output used to have).
pub fn output_node_id(bus: u8, index: usize) -> Uuid {
    Uuid::from_u128(0x0a0d_20_00 + bus as u128 + ((index as u128) << 16))
}

fn check_tap(bus: usize, what: &str, tap: &DeviceTap) -> Result<(), AppError> {
    if tap.device_id.trim().is_empty() {
        return Err(AppError::BadRequest(format!("bus {bus}: choose an {what} device")));
    }
    if tap.channels.len() != tap.mode.channel_count() {
        return Err(AppError::BadRequest(format!(
            "bus {bus}: a {} {what} needs {} channel(s)",
            if tap.mode == ChannelMode::Mono { "mono" } else { "stereo" },
            tap.mode.channel_count()
        )));
    }
    if tap.channels.iter().any(|c| *c >= 256) {
        return Err(AppError::BadRequest(format!("bus {bus}: channel out of range")));
    }
    Ok(())
}

fn check_db(bus: usize, label: &str, value: f32, min: f32, max: f32) -> Result<(), AppError> {
    if !value.is_finite() || value < min || value > max {
        return Err(AppError::BadRequest(format!(
            "bus {bus}: {label} must be between {min} and {max} dB"
        )));
    }
    Ok(())
}

impl AudioConfig {
    pub fn validate(&mut self) -> Result<(), AppError> {
        self.buses.truncate(BUSES as usize);
        while self.buses.len() < BUSES as usize {
            let n = self.buses.len() as u8 + 1;
            self.buses.push(BusConfig::new(n));
        }
        for (i, bus) in self.buses.iter_mut().enumerate() {
            let n = i + 1;
            let trimmed = bus.name.trim();
            bus.name = if trimmed.is_empty() {
                format!("Bus {n}")
            } else {
                trimmed.chars().take(40).collect()
            };
            check_db(n, "volume", bus.volume_db, -100.0, 10.0)?;
            check_db(n, "gain", bus.gain_db, -20.0, 40.0)?;
            if let Some(tap) = bus.legacy_output.take() {
                if bus.outputs.is_empty() {
                    bus.outputs.push(tap);
                }
            }
            if let Some(tap) = &bus.input {
                check_tap(n, "input", tap)?;
            }
            if bus.outputs.len() > MAX_OUTPUTS {
                return Err(AppError::BadRequest(format!("bus {n}: up to {MAX_OUTPUTS} outputs")));
            }
            for tap in &bus.outputs {
                check_tap(n, "output", tap)?;
            }
        }
        Ok(())
    }

    pub fn bus(&self, number: u8) -> Option<&BusConfig> {
        self.buses.get(number.checked_sub(1)? as usize)
    }

    /// audio.json in the bus format, or one of the older formats (input/output strips,
    /// then audio_routing.json) converted the first time.
    pub fn load(path: &Path, legacy: &Path) -> Result<Self, AppError> {
        let mut config = if path.exists() {
            let raw: Value = storage::read_json(path)?;
            if raw.get("buses").is_some() {
                serde_json::from_value(raw).unwrap_or_default()
            } else {
                Self::from_strips(&raw)
            }
        } else if legacy.exists() {
            Self::from_routing(&storage::read_json(legacy).unwrap_or(Value::Null))
        } else {
            AudioConfig::default()
        };
        if let Err(e) = config.validate() {
            tracing::warn!("audio.json has invalid entries ({e}); resetting them");
            for bus in config.buses.iter_mut() {
                bus.volume_db = bus.volume_db.clamp(-100.0, 10.0);
                bus.gain_db = bus.gain_db.clamp(-20.0, 40.0);
                if bus.input.as_ref().is_some_and(|t| t.channels.len() != t.mode.channel_count()) {
                    bus.input = None;
                }
                bus.outputs.retain(|t| t.channels.len() == t.mode.channel_count());
                bus.outputs.truncate(MAX_OUTPUTS);
            }
            let _ = config.validate();
        }
        Ok(config)
    }

    /// Version 0.2: lists of input and output strips that each picked a bus. The first
    /// input of each bus becomes the bus' input, its outputs the bus' outputs.
    fn from_strips(raw: &Value) -> Self {
        let mut config = AudioConfig::default();
        if let Some(names) = raw.get("bus_names").and_then(Value::as_array) {
            for (bus, name) in config.buses.iter_mut().zip(names) {
                if let Some(name) = name.as_str() {
                    bus.name = name.to_string();
                }
            }
        }
        fn tap(strip: &Value) -> Option<(usize, DeviceTap, &Value)> {
            let bus = strip.get("bus")?.as_u64()? as usize;
            let tap = DeviceTap {
                device_id: strip.get("device_id")?.as_str()?.to_string(),
                mode: serde_json::from_value(strip.get("mode")?.clone()).ok()?,
                channels: serde_json::from_value(strip.get("channels")?.clone()).ok()?,
            };
            (1..=BUSES as usize).contains(&bus).then_some((bus, tap, strip))
        }
        for strip in raw.get("inputs").and_then(Value::as_array).into_iter().flatten() {
            if let Some((bus, t, strip)) = tap(strip) {
                let b = &mut config.buses[bus - 1];
                if b.input.is_none() {
                    b.input = Some(t);
                    b.gain_db = strip.get("gain_db").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                }
            }
        }
        for strip in raw.get("outputs").and_then(Value::as_array).into_iter().flatten() {
            if let Some((bus, t, strip)) = tap(strip) {
                let b = &mut config.buses[bus - 1];
                if b.outputs.is_empty() {
                    b.volume_db = strip.get("volume_db").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                    b.muted = strip.get("muted").and_then(Value::as_bool).unwrap_or(false);
                }
                if b.outputs.len() < MAX_OUTPUTS {
                    b.outputs.push(t);
                }
            }
        }
        config
    }

    /// Version 0.1: audio_routing.json with one mono input per mapping.
    fn from_routing(raw: &Value) -> Self {
        let mut config = AudioConfig::default();
        for m in raw.get("channels").and_then(Value::as_array).into_iter().flatten() {
            let (Some(index), Some(device), Some(channel)) = (
                m.get("index").and_then(Value::as_u64),
                m.get("source_device").and_then(Value::as_str),
                m.get("source_channel").and_then(Value::as_u64),
            ) else {
                continue;
            };
            let bus = &mut config.buses[(index % BUSES as u64) as usize];
            if bus.input.is_none() {
                bus.input = Some(DeviceTap {
                    device_id: device.to_string(),
                    mode: ChannelMode::Mono,
                    channels: vec![channel as u16],
                });
                if let Some(label) = m.get("label").and_then(Value::as_str).filter(|l| !l.is_empty()) {
                    bus.name = label.to_string();
                }
            }
        }
        config
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), AppError> {
        storage::write_json(path, self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn migrates_strips_to_buses() {
        let raw = json!({
            "inputs": [{"name": "Mic", "device_id": "cpal:Wing", "mode": "mono", "channels": [3], "bus": 2, "gain_db": 6.0}],
            "outputs": [{"name": "PA", "device_id": "cpal:Out", "mode": "stereo", "channels": [0, 1], "bus": 2, "volume_db": -3.0}],
            "bus_names": ["Music", "Voice"]
        });
        let mut c = AudioConfig::from_strips(&raw);
        c.validate().unwrap();
        assert_eq!(c.buses.len(), 16);
        assert_eq!(c.buses[1].name, "Voice");
        assert_eq!(c.buses[1].input.as_ref().unwrap().channels, vec![3]);
        assert_eq!(c.buses[1].gain_db, 6.0);
        assert_eq!(c.buses[1].outputs[0].channels, vec![0, 1]);
        assert_eq!(c.buses[1].volume_db, -3.0);
        assert!(c.buses[0].input.is_none());
    }

    #[test]
    fn one_output_from_before_becomes_the_first_of_the_list() {
        let raw = json!({"buses": [{"name": "Main", "output": {"device_id": "cpal:Out", "mode": "stereo", "channels": [0, 1]}}]});
        let mut c: AudioConfig = serde_json::from_value(raw).unwrap();
        c.validate().unwrap();
        assert_eq!(c.buses[0].outputs.len(), 1);
        assert_eq!(c.buses[0].outputs[0].device_id, "cpal:Out");
        let saved = serde_json::to_value(&c).unwrap();
        assert!(saved["buses"][0].get("output").is_none(), "saved as outputs only");
        assert_eq!(saved["buses"][0]["outputs"][0]["channels"], json!([0, 1]));
    }

    #[test]
    fn several_outputs_each_get_a_node() {
        assert_eq!(output_node_id(3, 0), Uuid::from_u128(0x0a0d_20_03));
        assert_ne!(output_node_id(3, 1), output_node_id(3, 0));
        assert_ne!(output_node_id(3, 1), output_node_id(4, 0));
    }
}
