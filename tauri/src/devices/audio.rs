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
    fn name(&self) -> &'static str {
        "cpal"
    }
    async fn list(&self) -> Result<Vec<AudioDevice>, AppError> {
        tokio::task::spawn_blocking(|| -> Result<Vec<AudioDevice>, AppError> {
            use cpal::traits::{DeviceTrait, HostTrait};
            let host = cpal::default_host();
            let devices = host
                .input_devices()
                .map_err(|e| AppError::Device(e.to_string()))?;
            let mut out = Vec::new();
            for device in devices {
                let Ok(name) = device.name() else { continue };
                let Ok(configs) = device.supported_input_configs() else {
                    continue;
                };
                let mut channels = 0u16;
                let mut rates: Vec<u32> = Vec::new();
                for cfg in configs {
                    channels = channels.max(cfg.channels());
                    for rate in [44_100u32, 48_000, 88_200, 96_000] {
                        if cfg.min_sample_rate().0 <= rate
                            && rate <= cfg.max_sample_rate().0
                            && !rates.contains(&rate)
                        {
                            rates.push(rate);
                        }
                    }
                }
                if channels == 0 {
                    continue;
                }
                rates.sort();
                out.push(AudioDevice {
                    id: name.clone(),
                    name,
                    input_channels: channels,
                    sample_rates: rates,
                });
            }
            Ok(out)
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
    }
}
