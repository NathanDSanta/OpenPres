use crate::{error::AppError, state::SharedState, stream::{StreamSettings, StreamStatus}};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/stream/settings", get(get_settings).put(put_settings))
        .route("/stream/status", get(status))
        .route("/stream/start", post(start))
        .route("/stream/stop", post(stop))
        .route(
            "/stream/frame",
            post(frame).layer(DefaultBodyLimit::max(32 * 1024 * 1024)),
        )
}

/// The key is only shown masked unless asked for.
fn settings_json(settings: &StreamSettings) -> Value {
    let mut v = json!(settings);
    let key = &settings.stream_key;
    v["stream_key_set"] = json!(!key.is_empty());
    v["stream_key"] = json!(if key.len() > 4 {
        format!("{}{}", "•".repeat(key.len() - 4), &key[key.len() - 4..])
    } else {
        "•".repeat(key.len())
    });
    v
}

async fn get_settings(State(s): State<SharedState>) -> Json<Value> {
    Json(settings_json(&s.stream.settings.lock().unwrap().value))
}

/// Body: StreamSettings. A `stream_key` that is still the masked value keeps the old key.
async fn put_settings(State(s): State<SharedState>, Json(mut body): Json<StreamSettings>) -> Result<Json<Value>, AppError> {
    body.validate()?;
    let mut doc = s.stream.settings.lock().unwrap();
    if body.stream_key.contains('•') {
        body.stream_key = doc.value.stream_key.clone();
    }
    doc.replace(body)?;
    Ok(Json(settings_json(&doc.value)))
}

async fn status(State(s): State<SharedState>) -> Json<StreamStatus> {
    Json(s.stream.status())
}

async fn start(State(s): State<SharedState>) -> Result<Json<StreamStatus>, AppError> {
    let ffmpeg = s.ffmpeg().await;
    let data_dir = s.data_dir().await;
    s.stream.start(s.audio.graph.clone(), s.events.clone(), &ffmpeg, &data_dir)?;
    Ok(Json(s.stream.status()))
}

async fn stop(State(s): State<SharedState>) -> Json<StreamStatus> {
    s.stream.stop(&s.audio.graph, &s.events);
    Json(s.stream.status())
}

/// One JPEG frame from the compositor.
async fn frame(State(s): State<SharedState>, body: Bytes) -> StatusCode {
    if s.stream.push_frame(body.to_vec()) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::GONE
    }
}
