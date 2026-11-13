use super::{audio::*, video::*, DeviceRegistry};
use crate::error::AppError;
use async_trait::async_trait;
use std::sync::Mutex;
/// Returns a list you can swap at runtime (simulates plug/unplug).
pub struct MockVideoProvider {
    devices: Mutex<Vec<VideoDevice>>,
}
pub struct MockAudioProvider {
    devices: Mutex<Vec<AudioDevice>>,
}
impl MockVideoProvider {
    pub fn new(devices: Vec<VideoDevice>) -> Self {
        Self {
            devices: Mutex::new(devices),
        }
    }
    pub fn set_devices(&self, devices: Vec<VideoDevice>) {
        *self.devices.lock().unwrap() = devices;
    }
}
impl MockAudioProvider {
    pub fn new(devices: Vec<AudioDevice>) -> Self {
        Self {
            devices: Mutex::new(devices),
        }
    }
    pub fn set_devices(&self, devices: Vec<AudioDevice>) {
        *self.devices.lock().unwrap() = devices;
    }
}
#[async_trait]
impl VideoInputProvider for MockVideoProvider {
    fn name(&self) -> &'static str {
        "mock-video"
    }
    async fn list(&self) -> Result<Vec<VideoDevice>, AppError> {
        Ok(self.devices.lock().unwrap().clone())
    }
}
#[async_trait]
impl AudioInputProvider for MockAudioProvider {
    fn name(&self) -> &'static str {
        "mock-audio"
    }
    async fn list(&self) -> Result<Vec<AudioDevice>, AppError> {
        Ok(self.devices.lock().unwrap().clone())
    }
}
/// A ready-made registry with fake hardware, for demos and for working without devices.
/// Enable it by starting the app with the OPENPRES_MOCK_DEVICES environment variable set.
pub fn demo_registry() -> DeviceRegistry {
    let video = MockVideoProvider::new(vec![
        VideoDevice {
            id: "capture0".into(),
            name: "Mock Capture Card".into(),
            resolutions: vec![(1920, 1080), (1280, 720)],
        },
        VideoDevice {
            id: "webcam0".into(),
            name: "Mock Webcam".into(),
            resolutions: vec![(1280, 720)],
        },
    ]);
    let audio = MockAudioProvider::new(vec![AudioDevice {
        id: "wing".into(),
        name: "Mock Behringer Wing AIO".into(),
        input_channels: 32,
        output_channels: 32,
        sample_rates: vec![44_100, 48_000],
    }]);
    DeviceRegistry::new(vec![Box::new(video)], vec![Box::new(audio)])
}
