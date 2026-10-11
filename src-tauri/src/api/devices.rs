use crate::{error::AppError, state::SharedState};
use axum::{extract::State, routing::{get, post}, Json, Router};
use serde_json::Value;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/devices/video", get(list_video))
        .route("/devices/audio", get(list_audio))
        .route("/devices/refresh", post(refresh))
}

async fn list_video(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
async fn list_audio(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
/// Re-scans all providers, returns {video: [...], audio: [...]}.
async fn refresh(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
