pub mod audio;
pub mod capture;
pub mod inputs;
pub mod mock;
pub mod video;

use audio::{AudioDevice, AudioInputProvider};
use tokio::sync::RwLock;
use video::{VideoDevice, VideoInputProvider};

pub struct DeviceRegistry {
    video_providers: Vec<Box<dyn VideoInputProvider>>,
    audio_providers: Vec<Box<dyn AudioInputProvider>>,
    video_cache: RwLock<Vec<VideoDevice>>,
    audio_cache: RwLock<Vec<AudioDevice>>,
}

impl DeviceRegistry {
    pub fn new(
        video: Vec<Box<dyn VideoInputProvider>>,
        audio: Vec<Box<dyn AudioInputProvider>>,
    ) -> Self {
        Self {
            video_providers: video,
            audio_providers: audio,
            video_cache: RwLock::new(vec![]),
            audio_cache: RwLock::new(vec![]),
        }
    }

    /// Re-scans every provider and replaces the caches (used by POST /devices/refresh).
    pub async fn refresh(&self) -> Vec<String> {
        let mut warnings = Vec::new();

        let mut video = Vec::new();
        for provider in &self.video_providers {
            match provider.list().await {
                Ok(list) => video.extend(list.into_iter().map(|mut d| {
                    d.id = format!("{}:{}", provider.name(), d.id);
                    d
                })),
                Err(e) => warnings.push(format!("video provider `{}`: {e}", provider.name())),
            }
        }

        let mut audio = Vec::new();
        for provider in &self.audio_providers {
            match provider.list().await {
                Ok(list) => audio.extend(list.into_iter().map(|mut d| {
                    d.id = format!("{}:{}", provider.name(), d.id);
                    d
                })),
                Err(e) => warnings.push(format!("audio provider `{}`: {e}", provider.name())),
            }
        }
        *self.video_cache.write().await = video;
        *self.audio_cache.write().await = audio;
        for w in &warnings {
            tracing::warn!("{w}");
        }
        warnings
    }
    pub async fn video_devices(&self) -> Vec<VideoDevice> {
        self.video_cache.read().await.clone()
    }

    pub async fn audio_devices(&self) -> Vec<AudioDevice> {
        self.audio_cache.read().await.clone()
    }
}
