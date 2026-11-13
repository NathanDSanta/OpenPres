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
