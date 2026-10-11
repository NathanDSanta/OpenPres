use crate::error::AppError;
use serde::{Deserialize, Serialize};

pub const MAX_CHANNELS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMapping {
    /// Output slot, 0..MAX_CHANNELS-1.
    pub index: u8,
    pub source_device: String,
    /// Channel on the source device (e.g. a Wing AIO channel).
    pub source_channel: u16,
    pub label: String,
    pub gain_db: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AudioRouting { pub channels: Vec<ChannelMapping> }

impl AudioRouting {
    /// Errors if already at MAX_CHANNELS or if the index is already used.
    pub fn add_channel(&mut self, mapping: ChannelMapping) -> Result<(), AppError> { todo!() }
    pub fn remove_channel(&mut self, index: u8) -> Result<(), AppError> { todo!() }
    pub fn update_channel(&mut self, index: u8, mapping: ChannelMapping) -> Result<(), AppError> { todo!() }
    pub fn replace_all(&mut self, channels: Vec<ChannelMapping>) -> Result<(), AppError> { todo!() }
}
