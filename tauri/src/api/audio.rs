use crate::{
    audio_router::{ChannelMapping, MAX_CHANNELS},
    devices::audio::AudioDevice,
    error::AppError,
    state::SharedState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/audio/routing", get(get_routing).put(replace_routing))
        .route("/audio/routing/channels", post(add_channel))
        .route(
            "/audio/routing/channels/:index",
            axum::routing::put(update_channel).delete(remove_channel),
        )
}
/// Body of POST: like ChannelMapping, but `index` is optional.
#[derive(Deserialize)]
struct NewChannel {
    index: Option<u8>,
    source_device: String,
    source_channel: u16,
    #[serde(default)]
    label: String,
    #[serde(default)]
    gain_db: f32,
    #[serde(default)]
    muted: bool,
}
#[derive(Deserialize)]
struct RoutingBody {
    channels: Vec<ChannelMapping>,
}
/// Hardware-dependent rule: if the device is known, the channel must exist on it.
fn check_against_devices(m: &ChannelMapping, devices: &[AudioDevice]) -> Result<(), AppError> {
    if let Some(device) = devices.iter().find(|d| d.id == m.source_device) {
        if m.source_channel >= device.input_channels {
            return Err(AppError::BadRequest(format!(
                "device `{}` has {} input channels (0-{}), channel {} does not exist",
                device.name,
                device.input_channels,
                device.input_channels.saturating_sub(1),
                m.source_channel
            )));
        }
    }
    Ok(())
}
/// The routing table plus an `available` flag per channel.
async fn view(s: &SharedState) -> Value {
    let devices = s.devices.audio_devices().await;
    let routing = s.audio.read().await;
    let channels: Vec<Value> = routing
        .channels
        .iter()
        .map(|c| {
            let available = devices
                .iter()
                .find(|d| d.id == c.source_device)
                .map(|d| c.source_channel < d.input_channels)
                .unwrap_or(false);
            json!({
            "index": c.index,
            "source_device": c.source_device,
            "source_channel": c.source_channel,
            "label": c.label,
            "gain_db": c.gain_db,
            "muted": c.muted,
            "available": available
            })
        })
        .collect();
    json!({ "max_channels": MAX_CHANNELS, "used": channels.len(), "channels": channels })
}
async fn get_routing(State(s): State<SharedState>) -> Json<Value> {
    Json(view(&s).await)
}
/// Body: {"channels": [ ...full mappings with index... ]} (replaces everything)
async fn replace_routing(
    State(s): State<SharedState>,
    Json(body): Json<RoutingBody>,
) -> Result<Json<Value>, AppError> {
    let devices = s.devices.audio_devices().await;
    for m in &body.channels {
        check_against_devices(m, &devices)?;
    }
    s.audio.write().await.replace_all(body.channels)?;
    Ok(Json(view(&s).await))
}
async fn add_channel(
    State(s): State<SharedState>,
    Json(body): Json<NewChannel>,
) -> Result<(StatusCode, Json<ChannelMapping>), AppError> {
    let devices = s.devices.audio_devices().await;
    let mut routing = s.audio.write().await;
    let index = match body.index {
        Some(i) => i,
        None => routing.next_free_index().ok_or_else(|| {
            AppError::Conflict(format!("channel limit reached ({} channels)", MAX_CHANNELS))
        })?,
    };
    let mapping = ChannelMapping {
        index,
        source_device: body.source_device,
        source_channel: body.source_channel,
        label: body.label,
        gain_db: body.gain_db,
        muted: body.muted,
    };
    check_against_devices(&mapping, &devices)?;
    routing.add_channel(mapping.clone())?;
    Ok((StatusCode::CREATED, Json(mapping)))
}
/// Body: a full mapping (the slot comes from the URL).
async fn update_channel(
    State(s): State<SharedState>,
    Path(index): Path<u8>,
    Json(mapping): Json<NewChannel>,
) -> Result<Json<Value>, AppError> {
    let devices = s.devices.audio_devices().await;
    let mapping = ChannelMapping {
        index,
        source_device: mapping.source_device,
        source_channel: mapping.source_channel,
        label: mapping.label,
        gain_db: mapping.gain_db,
        muted: mapping.muted,
    };
    check_against_devices(&mapping, &devices)?;
    s.audio.write().await.update_channel(index, mapping)?;
    Ok(Json(view(&s).await))
}
async fn remove_channel(
    State(s): State<SharedState>,
    Path(index): Path<u8>,
) -> Result<Json<Value>, AppError> {
    s.audio.write().await.remove_channel(index)?;
    Ok(Json(view(&s).await))
}
