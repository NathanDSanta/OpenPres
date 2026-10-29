use crate::{error::AppError, storage};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};
pub const MAX_CHANNELS: usize = 16;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMapping {
    /// Output slot, 0..MAX_CHANNELS-1.
    pub index: u8,
    /// Namespaced device id, e.g. `cpal:Behringer WING`.
    pub source_device: String,
    /// 0-based channel on the source device.
    pub source_channel: u16,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub muted: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AudioRouting {
    pub channels: Vec<ChannelMapping>,
    #[serde(skip)]
    pub path: PathBuf,
}
impl AudioRouting {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut routing = if path.exists() {
            storage::read_json::<AudioRouting>(&path)?
        } else {
            AudioRouting::default()
        };
        routing.path = path;
        Ok(routing)
    }
    fn save(&self) -> Result<(), AppError> {
        storage::write_json(&self.path, self)
    }
    /// Lowest unused output slot, or None when all 16 are taken.
    pub fn next_free_index(&self) -> Option<u8> {
        (0..MAX_CHANNELS as u8).find(|i| !self.channels.iter().any(|c| c.index == *i))
    }
    /// Rules that depend only on the mapping itself.
    fn check(m: &ChannelMapping) -> Result<(), AppError> {
        if m.index as usize >= MAX_CHANNELS {
            return Err(AppError::BadRequest(format!(
                "index must be between 0 and {}",
                MAX_CHANNELS - 1
            )));
        }
        if m.source_device.trim().is_empty() {
            return Err(AppError::BadRequest("source_device cannot be empty".into()));
        }
        if !m.gain_db.is_finite() || !(-120.0..=24.0).contains(&m.gain_db) {
            return Err(AppError::BadRequest(
                "gain_db must be between -120 and 24".into(),
            ));
        }
        if m.label.len() > 64 {
            return Err(AppError::BadRequest("label is too long (max 64)".into()));
        }
        Ok(())
    }
    /// Errors when the table is full (16) or the slot is already used.
    pub fn add_channel(&mut self, mapping: ChannelMapping) -> Result<(), AppError> {
        Self::check(&mapping)?;
        if self.channels.len() >= MAX_CHANNELS {
            return Err(AppError::Conflict(format!(
                "channel limit reached ({} channels)",
                MAX_CHANNELS
            )));
        }
        if self.channels.iter().any(|c| c.index == mapping.index) {
            return Err(AppError::Conflict(format!(
                "output slot {} is already in use",
                mapping.index
            )));
        }
        self.channels.push(mapping);
        self.channels.sort_by_key(|c| c.index);
        self.save()
    }
    pub fn remove_channel(&mut self, index: u8) -> Result<(), AppError> {
        let before = self.channels.len();
        self.channels.retain(|c| c.index != index);
        if self.channels.len() == before {
            return Err(AppError::NotFound(format!("no channel in slot {index}")));
        }
        self.save()
    }
    /// Replaces the mapping in slot `index` (the slot cannot be changed here).
    pub fn update_channel(
        &mut self,
        index: u8,
        mut mapping: ChannelMapping,
    ) -> Result<(), AppError> {
        mapping.index = index;
        Self::check(&mapping)?;
        let pos = self
            .channels
            .iter()
            .position(|c| c.index == index)
            .ok_or_else(|| AppError::NotFound(format!("no channel in slot {index}")))?;
        self.channels[pos] = mapping;
        self.save()
    }
    /// Replaces the whole table at once (all-or-nothing).
    pub fn replace_all(&mut self, mut channels: Vec<ChannelMapping>) -> Result<(), AppError> {
        if channels.len() > MAX_CHANNELS {
            return Err(AppError::BadRequest(format!(
                "at most {} channels are allowed, got {}",
                MAX_CHANNELS,
                channels.len()
            )));
        }
        let mut seen = HashSet::new();
        for m in &channels {
            Self::check(m)?;
            if !seen.insert(m.index) {
                return Err(AppError::BadRequest(format!(
                    "output slot {} appears twice",
                    m.index
                )));
            }
        }
        channels.sort_by_key(|c| c.index);
        self.channels = channels;
        self.save()
    }
}
