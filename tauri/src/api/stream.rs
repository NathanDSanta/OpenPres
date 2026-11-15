use crate::{
    compositor::{CameraSlot, CameraSource, Overlay},
    error::AppError,
    state::SharedState,
    stream::{StreamSettings, StreamStatus},
};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/stream/settings", get(get_settings).put(put_settings))
        .route("/stream/status", get(status))
        .route("/stream/start", post(start))
        .route("/stream/stop", post(stop))
        // Up to 4K RGBA (33 MB).
        .route("/stream/overlay", post(overlay).layer(DefaultBodyLimit::max(40 * 1024 * 1024)))
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
    // The compositor takes camera frames straight from the capture threads.
    let state = s.clone();
    let camera: CameraSource = Arc::new(move |device: &str| state.capture.session(device).frame());
    s.stream.start(s.audio.graph.clone(), s.events.clone(), camera, &ffmpeg, &data_dir)?;
    Ok(Json(s.stream.status()))
}

async fn stop(State(s): State<SharedState>) -> Json<StreamStatus> {
    s.stream.stop(&s.audio.graph, &s.events);
    Json(s.stream.status())
}

#[derive(Deserialize)]
struct OverlayQuery {
    w: u32,
    h: u32,
    /// The video input device shown under the overlay, if the layer is on…
    camera: Option<String>,
    /// …and where it goes (stream pixels).
    cx: Option<u32>,
    cy: Option<u32>,
    cw: Option<u32>,
    ch: Option<u32>,
}

/// POST /stream/overlay?w=1920&h=1080[&camera=nokhwa:0&cx=..&cy=..&cw=..&ch=..]
/// Body: w*h straight RGBA pixels of everything above the video input layer.
async fn overlay(State(s): State<SharedState>, Query(q): Query<OverlayQuery>, body: Bytes) -> Result<StatusCode, AppError> {
    let camera = match (q.camera.filter(|c| !c.is_empty()), q.cx, q.cy, q.cw, q.ch) {
        (Some(device_id), Some(x), Some(y), Some(w), Some(h)) => Some(CameraSlot { device_id, x, y, w, h }),
        _ => None,
    };
    let overlay = Overlay::new(q.w, q.h, body.to_vec(), camera).map_err(AppError::BadRequest)?;
    s.stream.push_overlay(overlay)?;
    Ok(StatusCode::NO_CONTENT)
}
