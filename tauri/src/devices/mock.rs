use super::{audio::*, video::*};
use crate::error::AppError;
use async_trait::async_trait;
use std::sync::Mutex;

/// Returns a configurable list; lets tests simulate plug/unplug between refreshes.
pub struct MockVideoProvider { pub devices: Mutex<Vec<VideoDevice>> }
pub struct MockAudioProvider { pub devices: Mutex<Vec<AudioDevice>> }

impl MockVideoProvider {
    pub fn new(devices: Vec<VideoDevice>) -> Self { todo!() }
    pub fn set_devices(&self, devices: Vec<VideoDevice>) { todo!() }
}
impl MockAudioProvider {
    /// e.g. a fake 32-channel "Mock Wing AIO" device
    pub fn new(devices: Vec<AudioDevice>) -> Self { todo!() }
    pub fn set_devices(&self, devices: Vec<AudioDevice>) { todo!() }
}

#[async_trait]
impl VideoInputProvider for MockVideoProvider {
    fn name(&self) -> &'static str { "mock-video" }
    async fn list(&self) -> Result<Vec<VideoDevice>, AppError> { todo!() }
}
#[async_trait]
impl AudioInputProvider for MockAudioProvider {
    fn name(&self) -> &'static str { "mock-audio" }
    async fn list(&self) -> Result<Vec<AudioDevice>, AppError> { todo!() }
}
