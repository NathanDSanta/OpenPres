//! Named video inputs (cameras, capture cards) with the format to capture them in.
//! Saved as video_inputs.json; the video layer shows an input's device.

use crate::{error::AppError, storage::JsonDoc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

fn default_width() -> u32 {
    1280
}
fn default_height() -> u32 {
    720
}
fn default_fps() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInput {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    /// Device id from /devices/video, e.g. `nokhwa:0`.
    pub device_id: String,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VideoInputsFile {
    #[serde(default)]
    pub inputs: Vec<VideoInput>,
}

pub type VideoInputs = JsonDoc<VideoInputsFile>;

pub fn load(path: PathBuf) -> Result<VideoInputs, AppError> {
    JsonDoc::load(path)
}

pub fn validate(input: &VideoInput) -> Result<(), AppError> {
    if input.name.trim().is_empty() || input.name.len() > 60 {
        return Err(AppError::BadRequest("input names must be 1-60 characters".into()));
    }
    if input.device_id.trim().is_empty() {
        return Err(AppError::BadRequest("choose a device".into()));
    }
    if !(160..=7680).contains(&input.width) || !(120..=4320).contains(&input.height) || !(1..=120).contains(&input.fps) {
        return Err(AppError::BadRequest("resolution or frame rate out of range".into()));
    }
    Ok(())
}
