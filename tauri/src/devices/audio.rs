use crate::error::AppError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub input_channels: u16,
    pub sample_rates: Vec<u32>,
}

#[async_trait]
pub trait AudioInputProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn list(&self) -> Result<Vec<AudioDevice>, AppError>;
}

/// Any OS audio input (including USB/AIO interfaces like the Behringer Wing) via cpal.
pub struct CpalProvider;

#[async_trait]
impl AudioInputProvider for CpalProvider {
    fn name(&self) -> &'static str { "cpal" }
    async fn list(&self) -> Result<Vec<AudioDevice>, AppError> { todo!() }
}
