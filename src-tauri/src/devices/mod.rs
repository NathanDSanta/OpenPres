pub mod audio;
pub mod mock;
pub mod video;

use crate::error::AppError;
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
    pub async fn refresh(&self) -> Result<(), AppError> {
        todo!()
    }
    pub async fn video_devices(&self) -> Vec<VideoDevice> {
        todo!()
    }
    pub async fn audio_devices(&self) -> Vec<AudioDevice> {
        todo!()
    }
}
