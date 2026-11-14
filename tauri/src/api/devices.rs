use crate::{
    devices::{audio::AudioDevice, video::VideoDevice},
    error::AppError,
    state::SharedState,
};
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/devices/video", get(list_video))
        .route("/devices/audio", get(list_audio))
        .route("/devices/refresh", post(refresh))
        .route("/devices/video/frame", get(frame))
        .route("/devices/video/mjpeg", get(mjpeg))
        .route("/video-inputs", get(list_inputs).post(create_input))
        .route("/video-inputs/:id", axum::routing::put(update_input).delete(delete_input))
}

// ---------- named video inputs ----------

use crate::devices::inputs::{self, VideoInput};
use uuid::Uuid;

async fn save_inputs(s: &SharedState, list: Vec<VideoInput>) -> Result<Vec<VideoInput>, AppError> {
    for i in &list {
        inputs::validate(i)?;
    }
    s.capture.set_formats(list.iter().map(|i| (i.device_id.clone(), (i.width, i.height, i.fps))).collect());
    let mut doc = s.video_inputs.write().await;
    doc.value.inputs = list.clone();
    doc.save()?;
    Ok(list)
}

async fn list_inputs(State(s): State<SharedState>) -> Json<Vec<VideoInput>> {
    Json(s.video_inputs.read().await.value.inputs.clone())
}

async fn create_input(State(s): State<SharedState>, Json(mut input): Json<VideoInput>) -> Result<(StatusCode, Json<VideoInput>), AppError> {
    input.id = Uuid::new_v4();
    input.name = input.name.trim().to_string();
    let mut list = s.video_inputs.read().await.value.inputs.clone();
    list.push(input.clone());
    save_inputs(&s, list).await?;
    Ok((StatusCode::CREATED, Json(input)))
}

async fn update_input(State(s): State<SharedState>, axum::extract::Path(id): axum::extract::Path<Uuid>, Json(mut input): Json<VideoInput>) -> Result<Json<VideoInput>, AppError> {
    input.id = id;
    input.name = input.name.trim().to_string();
    let mut list = s.video_inputs.read().await.value.inputs.clone();
    let slot = list.iter_mut().find(|i| i.id == id).ok_or_else(|| AppError::NotFound(format!("video input {id}")))?;
    *slot = input.clone();
    save_inputs(&s, list).await?;
    Ok(Json(input))
}

async fn delete_input(State(s): State<SharedState>, axum::extract::Path(id): axum::extract::Path<Uuid>) -> Result<StatusCode, AppError> {
    let mut list = s.video_inputs.read().await.value.inputs.clone();
    let before = list.len();
    list.retain(|i| i.id != id);
    if before == list.len() {
        return Err(AppError::NotFound(format!("video input {id}")));
    }
    save_inputs(&s, list).await?;
    Ok(StatusCode::NO_CONTENT)
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

#[derive(Deserialize)]
struct DeviceQuery {
    device: String,
}

async fn known(s: &SharedState, device: &str) -> Result<(), AppError> {
    if s.devices.video_devices().await.iter().any(|d| d.id == device) {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("video device `{device}`")))
    }
}

/// GET /devices/video/frame?device=nokhwa:0 -> latest JPEG (204 while the camera starts).
async fn frame(State(s): State<SharedState>, Query(q): Query<DeviceQuery>) -> Result<Response, AppError> {
    known(&s, &q.device).await?;
    let session = s.capture.session(&q.device);
    match session.frame() {
        Some((seq, jpeg)) => Ok((
            [
                (header::CONTENT_TYPE, "image/jpeg".to_string()),
                (header::CACHE_CONTROL, "no-store".to_string()),
                (header::HeaderName::from_static("x-frame"), seq.to_string()),
            ],
            jpeg.as_ref().clone(),
        )
            .into_response()),
        None => match session.error() {
            Some(e) => Err(AppError::Device(e)),
            None => Ok(StatusCode::NO_CONTENT.into_response()),
        },
    }
}

/// GET /devices/video/mjpeg?device=... -> multipart MJPEG stream for <img> previews.
async fn mjpeg(State(s): State<SharedState>, Query(q): Query<DeviceQuery>) -> Result<Response, AppError> {
    known(&s, &q.device).await?;
    let session = s.capture.session(&q.device);
    let stream = futures_util::stream::unfold((session, 0u64), |(session, last)| async move {
        loop {
            tokio::time::sleep(Duration::from_millis(30)).await;
            if let Some((seq, jpeg)) = session.frame() {
                if seq != last {
                    let mut part = format!(
                        "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                        jpeg.len()
                    )
                    .into_bytes();
                    part.extend_from_slice(&jpeg);
                    part.extend_from_slice(b"\r\n");
                    return Some((Ok::<_, std::io::Error>(part), (session, seq)));
                }
            } else if session.error().is_some() {
                return None;
            }
        }
    });
    Ok((
        [
            (header::CONTENT_TYPE, "multipart/x-mixed-replace; boundary=frame"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}
