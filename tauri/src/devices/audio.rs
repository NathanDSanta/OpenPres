use crate::error::AppError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub input_channels: u16,
    #[serde(default)]
    pub output_channels: u16,
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
            use crate::audio::engine::{device_id, device_name, host};
            let host = host();
            let mut out: Vec<AudioDevice> = Vec::new();
            let mut add = |id: String, name: String, input: u16, output: u16, rates: Vec<u32>| {
                match out.iter_mut().find(|d| d.id == id) {
                    Some(existing) => {
                        existing.input_channels = existing.input_channels.max(input);
                        existing.output_channels = existing.output_channels.max(output);
                        for r in rates {
                            if !existing.sample_rates.contains(&r) {
                                existing.sample_rates.push(r);
                            }
                        }
                        existing.sample_rates.sort();
                    }
                    None => out.push(AudioDevice {
                        id,
                        name,
                        input_channels: input,
                        output_channels: output,
                        sample_rates: rates,
                    }),
                }
            };
            let rates_of = |ranges: &mut dyn Iterator<Item = cpal::SupportedStreamConfigRange>| {
                let mut channels = 0u16;
                let mut rates: Vec<u32> = Vec::new();
                for cfg in ranges {
                    channels = channels.max(cfg.channels());
                    for rate in [44_100u32, 48_000, 88_200, 96_000] {
                        if cfg.min_sample_rate() <= rate && rate <= cfg.max_sample_rate() && !rates.contains(&rate) {
                            rates.push(rate);
                        }
                    }
                }
                rates.sort();
                (channels, rates)
            };
            if let Ok(devices) = host.input_devices() {
                for device in devices {
                    let (Some(id), Some(name)) = (device_id(&device), device_name(&device)) else { continue };
                    let Ok(mut configs) = device.supported_input_configs() else { continue };
                    let (channels, rates) = rates_of(&mut configs);
                    if channels > 0 {
                        add(id, name, channels, 0, rates);
                    }
                }
            }
            if let Ok(devices) = host.output_devices() {
                for device in devices {
                    let (Some(id), Some(name)) = (device_id(&device), device_name(&device)) else { continue };
                    let Ok(mut configs) = device.supported_output_configs() else { continue };
                    let (channels, rates) = rates_of(&mut configs);
                    if channels > 0 {
                        add(id, name, 0, channels, rates);
                    }
                }
            }
            Ok(out)
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
    }
}
