use crate::{
    devices::{audio::AudioDevice, video::VideoDevice},
    state::SharedState,
};
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/devices/video", get(list_video))
        .route("/devices/audio", get(list_audio))
        .route("/devices/refresh", post(refresh))
}
async fn list_video(State(s): State<SharedState>) -> Json<Vec<VideoDevice>> {
    Json(s.devices.video_devices().await)
}
async fn list_audio(State(s): State<SharedState>) -> Json<Vec<AudioDevice>> {
    Json(s.devices.audio_devices().await)
}
/// Re-scans all providers. Returns both lists plus warnings from failing providers.
async fn refresh(State(s): State<SharedState>) -> Json<Value> {
    let warnings = s.devices.refresh().await;
    let video = s.devices.video_devices().await;
    let audio = s.devices.audio_devices().await;
    Json(json!({ "video": video, "audio": audio, "warnings": warnings }))
}
