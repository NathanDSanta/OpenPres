//! The home page layout (widgets, positions, sizes, per-widget settings), saved as
//! workspace.json. The backend stores it as-is; the frontend owns its shape.

use crate::{error::AppError, storage::JsonDoc};
use serde_json::Value;
use std::path::PathBuf;

pub type Workspace = JsonDoc<Value>;

pub fn load(path: PathBuf) -> Result<Workspace, AppError> {
    JsonDoc::load(path)
}

pub fn validate(value: &Value) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(AppError::BadRequest("workspace must be a JSON object".into()));
    }
    if value.to_string().len() > 1_000_000 {
        return Err(AppError::BadRequest("workspace is too large".into()));
    }
    Ok(())
}
