use crate::{
    compositor::{CameraSource, LookVideo, Overlay},
    encoders::{self, Encoder},
    error::AppError,
    state::SharedState,
    stream::{StreamSettings, StreamStatus},
    stream_scene::{self, Rect},
    theme::style::MediaFit,
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
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/stream/settings", get(get_settings).put(put_settings))
        .route("/stream/status", get(status))
        .route("/stream/encoders", get(list_encoders))
        .route("/stream/start", post(start))
        .route("/stream/stop", post(stop))
        // Up to 4K RGBA (33 MB).
        .route("/stream/overlay", post(overlay).layer(DefaultBodyLimit::max(40 * 1024 * 1024)))
}

/// The key is only shown masked unless asked for.
fn settings_json(settings: &StreamSettings) -> Value {
    let mut v = json!(settings);
    // What an empty folder means here (read-only; ignored when saved).
    v["default_record_dir"] = json!(crate::stream::default_record_dir().map(|d| d.display().to_string()).unwrap_or_default());
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
    if s.config.read().await.power != crate::config::Power::Active {
        return Err(AppError::Conflict("the server is on standby: switch it to active to stream".into()));
    }
    let ffmpeg = s.ffmpeg().await;
    let data_dir = s.data_dir().await;
    let settings = s.stream.settings_snapshot();
    // Which encoder works is found out once (it runs ffmpeg a few times).
    let encoder = {
        let (ffmpeg, wanted) = (ffmpeg.clone(), settings.encoder);
        tokio::task::spawn_blocking(move || {
            // And whether videos can be decoded on the graphics card.
            crate::video_source::probe_hw_decode(&ffmpeg);
            encoders::resolve(&ffmpeg, wanted)
        })
        .await
        .unwrap_or(Encoder::X264)
    };
    // What goes under the slides is known before the first frame.
    if let Some(screen_id) = settings.screen_id {
        s.stream.base.set(stream_scene::compute(&s, screen_id, settings.width, settings.height).await);
    }
    // The compositor takes camera frames straight from the capture threads.
    let state = s.clone();
    let camera: CameraSource = Arc::new(move |device: &str| state.capture.session(device).frame());
    let stop = s.stream.start(s.audio.graph.clone(), s.events.clone(), camera, &ffmpeg, encoder, &data_dir)?;
    if let Some(screen_id) = settings.screen_id {
        stream_scene::watch(s.clone(), s.stream.base.clone(), screen_id, settings.width, settings.height, stop);
    }
    Ok(Json(s.stream.status()))
}

/// The encoders, and whether each works on this computer.
async fn list_encoders(State(s): State<SharedState>) -> Json<Value> {
    let ffmpeg = s.ffmpeg().await;
    let found = tokio::task::spawn_blocking(move || encoders::available(&ffmpeg)).await.unwrap_or_default();
    let mut list = vec![json!({ "id": Encoder::Auto, "label": Encoder::Auto.label(), "available": true })];
    for e in std::iter::once(Encoder::X264).chain(Encoder::hardware().iter().copied()) {
        list.push(json!({ "id": e, "label": e.label(), "available": found.get(&e).copied().unwrap_or(false) }));
    }
    let ffmpeg = s.ffmpeg().await;
    let auto = tokio::task::spawn_blocking(move || encoders::resolve(&ffmpeg, Encoder::Auto)).await.unwrap_or(Encoder::X264);
    Json(json!({ "encoders": list, "automatic": auto, "automatic_label": auto.label() }))
}

async fn stop(State(s): State<SharedState>) -> Json<StreamStatus> {
    s.stream.stop(&s.audio.graph, &s.events);
    Json(s.stream.status())
}

#[derive(Deserialize)]
struct OverlayQuery {
    w: u32,
    h: u32,
    /// A design's background video left out of the picture, to go under it…
    lv: Option<Uuid>,
    /// …where (stream pixels), how it fits, and whether it loops.
    lx: Option<u32>,
    ly: Option<u32>,
    lw: Option<u32>,
    lh: Option<u32>,
    lfit: Option<MediaFit>,
    lloop: Option<bool>,
}

/// POST /stream/overlay?w=1920&h=1080[&lv=<media id>&lx=..&ly=..&lw=..&lh=..&lfit=cover&lloop=true]
/// Body: w*h straight RGBA pixels of the slides and graphics (everything above the media
/// layer; the background, camera and media layer are drawn natively).
async fn overlay(State(s): State<SharedState>, Query(q): Query<OverlayQuery>, body: Bytes) -> Result<StatusCode, AppError> {
    let look_video = match (q.lv, q.lx, q.ly, q.lw, q.lh) {
        (Some(id), Some(x), Some(y), Some(w), Some(h)) => s.media.read().await.path(id).ok().map(|path| LookVideo {
            path,
            rect: Rect { x, y, w, h },
            fit: q.lfit.unwrap_or_default(),
            looped: q.lloop.unwrap_or(true),
        }),
        _ => None,
    };
    let overlay = tokio::task::spawn_blocking(move || Overlay::new(q.w, q.h, body.to_vec(), look_video))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(AppError::BadRequest)?;
    s.stream.push_overlay(overlay)?;
    Ok(StatusCode::NO_CONTENT)
}
