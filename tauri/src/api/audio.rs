use crate::{
    audio::{config::input_node_id, AudioConfig, BusConfig, BUSES},
    error::AppError,
    state::SharedState,
};
use axum::{
    extract::{Path, State},
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/audio", get(get_audio).put(replace))
        .route("/audio/buses/:n", put(update_bus))
        .route("/audio/buses/:n/levels", put(set_levels))
        .route("/audio/meters", get(meters))
        .route("/audio/restart", post(restart))
}

async fn view(s: &SharedState) -> Value {
    let config = s.audio_config.read().await.clone();
    let status = s.audio.status();
    json!({
        "config": config,
        "status": status,
        "buses": BUSES,
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

fn bus_index(n: u8) -> Result<usize, AppError> {
    if (1..=BUSES).contains(&n) {
        Ok(n as usize - 1)
    } else {
        Err(AppError::NotFound(format!("bus {n}")))
    }
}

async fn get_audio(State(s): State<SharedState>) -> Json<Value> {
    Json(view(&s).await)
}

async fn replace(State(s): State<SharedState>, Json(config): Json<AudioConfig>) -> Result<Json<Value>, AppError> {
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

/// Replaces one bus (name, levels, input and output device).
async fn update_bus(State(s): State<SharedState>, Path(n): Path<u8>, Json(bus): Json<BusConfig>) -> Result<Json<Value>, AppError> {
    let i = bus_index(n)?;
    let mut config = s.audio_config.read().await.clone();
    config.buses[i] = bus;
    commit(&s, config).await?;
    tokio::time::sleep(std::time::Duration::from_millis(150)).await; // let the devices open
    Ok(Json(view(&s).await))
}

/// Quick level changes from faders, knobs and mute buttons (no device reopen).
#[derive(Deserialize)]
struct Levels {
    volume_db: Option<f32>,
    gain_db: Option<f32>,
    muted: Option<bool>,
}

async fn set_levels(State(s): State<SharedState>, Path(n): Path<u8>, Json(body): Json<Levels>) -> Result<Json<Value>, AppError> {
    let i = bus_index(n)?;
    let mut config = s.audio_config.read().await.clone();
    let bus = &mut config.buses[i];
    if let Some(v) = body.volume_db {
        bus.volume_db = v;
    }
    if let Some(v) = body.gain_db {
        bus.gain_db = v;
    }
    if let Some(v) = body.muted {
        bus.muted = v;
    }
    commit(&s, config).await?;
    Ok(Json(view(&s).await))
}

/// Peak levels (0..1) since the last call: `buses` is post-fader (what leaves each bus),
/// `inputs` is each bus' input device after its gain.
async fn meters(State(s): State<SharedState>) -> Json<Value> {
    let buses: Vec<[f32; 2]> = s.audio.graph.buses.take_peaks().into_iter().map(|(l, r)| [l, r]).collect();
    let inputs: Vec<[f32; 2]> = (1..=BUSES)
        .map(|n| {
            s.audio
                .graph
                .producer(input_node_id(n))
                .map(|node| {
                    let (l, r) = node.take_peaks();
                    [l, r]
                })
                .unwrap_or([0.0, 0.0])
        })
        .collect();
    Json(json!({ "buses": buses, "inputs": inputs }))
}

/// Reopens every device (after plugging in an interface).
async fn restart(State(s): State<SharedState>) -> Json<Value> {
    s.devices.refresh().await;
    let config = s.audio_config.read().await.clone();
    s.audio.apply(&config, true);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    Json(view(&s).await)
}
