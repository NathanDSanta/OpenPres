use crate::{
    audio::{AudioConfig, InputStrip, OutputStrip},
    error::AppError,
    state::SharedState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/audio", get(get_audio).put(replace))
        .route("/audio/inputs", post(add_input))
        .route("/audio/inputs/:id", put(update_input).delete(delete_strip))
        .route("/audio/outputs", post(add_output))
        .route("/audio/outputs/:id", put(update_output).delete(delete_strip))
        .route("/audio/strips/:id/levels", put(set_levels))
        .route("/audio/buses", put(set_bus_names))
        .route("/audio/meters", get(meters))
        .route("/audio/restart", post(restart))
}

async fn view(s: &SharedState) -> Value {
    let config = s.audio_config.read().await.clone();
    let status = s.audio.status();
    json!({
        "config": config,
        "status": status,
        "buses": crate::audio::BUSES,
    })
}

/// Validates, saves and applies a new configuration.
async fn commit(s: &SharedState, mut config: AudioConfig) -> Result<(), AppError> {
    config.validate()?;
    config.save(&s.audio_config_path)?;
    s.audio.apply(&config, false);
    *s.audio_config.write().await = config;
    Ok(())
}

async fn get_audio(State(s): State<SharedState>) -> Json<Value> {
    Json(view(&s).await)
}

async fn replace(State(s): State<SharedState>, Json(config): Json<AudioConfig>) -> Result<Json<Value>, AppError> {
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

async fn add_input(State(s): State<SharedState>, Json(mut input): Json<InputStrip>) -> Result<(StatusCode, Json<Value>), AppError> {
    input.id = Uuid::new_v4();
    let mut config = s.audio_config.read().await.clone();
    config.inputs.push(input);
    commit(&s, config).await?;
    Ok((StatusCode::CREATED, Json(view(&s).await)))
}

async fn update_input(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(mut input): Json<InputStrip>) -> Result<Json<Value>, AppError> {
    input.id = id;
    let mut config = s.audio_config.read().await.clone();
    let slot = config
        .inputs
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or_else(|| AppError::NotFound(format!("input {id}")))?;
    *slot = input;
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

async fn add_output(State(s): State<SharedState>, Json(mut output): Json<OutputStrip>) -> Result<(StatusCode, Json<Value>), AppError> {
    output.id = Uuid::new_v4();
    let mut config = s.audio_config.read().await.clone();
    config.outputs.push(output);
    commit(&s, config).await?;
    Ok((StatusCode::CREATED, Json(view(&s).await)))
}

async fn update_output(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(mut output): Json<OutputStrip>) -> Result<Json<Value>, AppError> {
    output.id = id;
    let mut config = s.audio_config.read().await.clone();
    let slot = config
        .outputs
        .iter_mut()
        .find(|o| o.id == id)
        .ok_or_else(|| AppError::NotFound(format!("output {id}")))?;
    *slot = output;
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

async fn delete_strip(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    let mut config = s.audio_config.read().await.clone();
    let before = config.inputs.len() + config.outputs.len();
    config.inputs.retain(|i| i.id != id);
    config.outputs.retain(|o| o.id != id);
    if before == config.inputs.len() + config.outputs.len() {
        return Err(AppError::NotFound(format!("strip {id}")));
    }
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

/// Quick level changes from faders/knobs/mute buttons (no device reopen).
#[derive(Deserialize)]
struct Levels {
    fader_db: Option<f32>,
    gain_db: Option<f32>,
    volume_db: Option<f32>,
    muted: Option<bool>,
    bus: Option<u8>,
}

async fn set_levels(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(body): Json<Levels>) -> Result<Json<Value>, AppError> {
    let mut config = s.audio_config.read().await.clone();
    if let Some(input) = config.inputs.iter_mut().find(|i| i.id == id) {
        if let Some(v) = body.fader_db.or(body.volume_db) {
            input.fader_db = v;
        }
        if let Some(v) = body.gain_db {
            input.gain_db = v;
        }
        if let Some(v) = body.muted {
            input.muted = v;
        }
        if let Some(v) = body.bus {
            input.bus = v;
        }
    } else if let Some(output) = config.outputs.iter_mut().find(|o| o.id == id) {
        if let Some(v) = body.volume_db.or(body.fader_db) {
            output.volume_db = v;
        }
        if let Some(v) = body.muted {
            output.muted = v;
        }
        if let Some(v) = body.bus {
            output.bus = v;
        }
    } else {
        return Err(AppError::NotFound(format!("strip {id}")));
    }
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

#[derive(Deserialize)]
struct BusNames {
    bus_names: Vec<String>,
}

async fn set_bus_names(State(s): State<SharedState>, Json(body): Json<BusNames>) -> Result<Json<Value>, AppError> {
    let mut config = s.audio_config.read().await.clone();
    config.bus_names = body.bus_names;
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

/// Peak levels (0..1) per strip since the last call, for meters.
async fn meters(State(s): State<SharedState>) -> Json<Value> {
    let peaks = s.audio.graph.take_peaks();
    let map: serde_json::Map<String, Value> = peaks
        .into_iter()
        .map(|(id, (l, r))| (id.to_string(), json!([l, r])))
        .collect();
    Json(Value::Object(map))
}

/// Reopens every device (after plugging in an interface).
async fn restart(State(s): State<SharedState>) -> Json<Value> {
    s.devices.refresh().await;
    let config = s.audio_config.read().await.clone();
    s.audio.apply(&config, true);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    Json(view(&s).await)
}
