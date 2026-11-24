use crate::{
    error::AppError,
    layers::LayerKind,
    screens::{
        detect_displays,
        physical::PhysicalDisplay,
        presets::{self, ScreenPresetsFile},
        virtual_screen::{ScreenInput, VirtualScreen},
        ScreenManager,
    },
    state::SharedState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/screens", get(list).post(create))
        .route("/screens/order", put(reorder))
        .route("/screens/:id", put(update).delete(delete_one))
        .route(
            "/screens/:id/binding",
            put(set_binding).delete(clear_binding),
        )
        .route("/screens/:id/layers/:kind", put(set_layer))
        .route("/screens/:id/preset", put(apply_preset))
        .route("/screen-presets", get(get_presets).put(put_presets))
        .route("/displays", get(list_displays))
        .route("/displays/refresh", post(refresh_displays))
        .route("/displays/identify", get(identify_status).post(identify))
}
/// A screen plus the information about where it is shown
#[derive(Serialize)]
struct ScreenView {
    #[serde(flatten)]
    screen: VirtualScreen,
    display_id: Option<String>,
    display_connected: bool,
}
fn view(m: &ScreenManager, screen: &VirtualScreen) -> ScreenView {
    let binding = m.binding_of(screen.id);
    ScreenView {
        screen: screen.clone(),
        display_id: binding.map(|b| b.physical_display.clone()),
        display_connected: binding
            .map(|b| m.displays.iter().any(|d| d.id == b.physical_display))
            .unwrap_or(false),
    }
}
async fn list(State(s): State<SharedState>) -> Json<Vec<ScreenView>> {
    let m = s.screens.read().await;
    Json(m.list().iter().map(|sc| view(&m, sc)).collect())
}
#[derive(Deserialize)]
struct OrderBody {
    ids: Vec<Uuid>,
}

/// PUT /screens/order {ids}: the virtual screens in this order.
async fn reorder(State(s): State<SharedState>, Json(body): Json<OrderBody>) -> Result<Json<Vec<ScreenView>>, AppError> {
    let mut m = s.screens.write().await;
    m.reorder(&body.ids)?;
    Ok(Json(m.list().iter().map(|sc| view(&m, sc)).collect()))
}

async fn create(
    State(s): State<SharedState>,
    Json(input): Json<ScreenInput>,
) -> Result<(StatusCode, Json<ScreenView>), AppError> {
    let mut m = s.screens.write().await;
    let screen = m.create(input)?;
    Ok((StatusCode::CREATED, Json(view(&m, &screen))))
}
async fn update(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<ScreenInput>,
) -> Result<Json<ScreenView>, AppError> {
    let mut m = s.screens.write().await;
    let screen = m.update(id, input)?;
    Ok(Json(view(&m, &screen)))
}
async fn delete_one(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    s.screens.write().await.delete(id)?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct BindingBody {
    display_id: String,
}
/// Body: {"display_id": "<id from GET /displays>"}
async fn set_binding(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<BindingBody>,
) -> Result<Json<ScreenView>, AppError> {
    let mut m = s.screens.write().await;
    m.bind(id, &body.display_id)?;
    let screen = m.get(id)?.clone();
    Ok(Json(view(&m, &screen)))
}
async fn clear_binding(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    s.screens.write().await.unbind(id)?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct LayerBody {
    enabled: bool,
}

/// Body: {"enabled": false} to hide a layer on this screen.
async fn set_layer(
    State(s): State<SharedState>,
    Path((id, kind)): Path<(Uuid, LayerKind)>,
    Json(body): Json<LayerBody>,
) -> Result<Json<ScreenView>, AppError> {
    let mut m = s.screens.write().await;
    let screen = m.set_layer_enabled(id, kind, body.enabled)?;
    Ok(Json(view(&m, &screen)))
}

#[derive(Deserialize)]
struct PresetBody {
    preset_id: Uuid,
}

/// Switches a screen to a screen preset: its layers and the designs it sets.
async fn apply_preset(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PresetBody>,
) -> Result<Json<ScreenView>, AppError> {
    let preset = s
        .screen_presets
        .read()
        .await
        .value
        .presets
        .iter()
        .find(|p| p.id == body.preset_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("screen preset {}", body.preset_id)))?;
    let mut m = s.screens.write().await;
    let screen = m.apply_preset(id, &preset)?;
    Ok(Json(view(&m, &screen)))
}

async fn get_presets(State(s): State<SharedState>) -> Json<ScreenPresetsFile> {
    Json(s.screen_presets.read().await.value.clone())
}

/// Admin only (auth.rs).
async fn put_presets(
    State(s): State<SharedState>,
    Json(body): Json<ScreenPresetsFile>,
) -> Result<Json<ScreenPresetsFile>, AppError> {
    presets::validate(&body)?;
    s.screen_presets.write().await.replace(body.clone())?;
    // Screens show which preset they match: they listen to "screens".
    s.events.changed_topics(vec!["screens".to_string()]);
    Ok(Json(body))
}

async fn list_displays(State(s): State<SharedState>) -> Json<Vec<PhysicalDisplay>> {
    Json(s.screens.read().await.displays.clone())
}
/// Re-detects the monitors (call it after plugging in a projector).
async fn refresh_displays(
    State(s): State<SharedState>,
) -> Result<Json<Vec<PhysicalDisplay>>, AppError> {
    Ok(Json(detect_displays(&s).await?))
}

/// POST /displays/identify: for a few seconds every output shows its number, its screen and
/// its display, even in standby (its window opens just for that).
async fn identify(State(s): State<SharedState>) -> Json<Value> {
    let until = crate::storage::now_ms() + crate::server::IDENTIFY_MS;
    s.identify_until.store(until, std::sync::atomic::Ordering::Relaxed);
    // Afterwards the windows go back to what they were (closed again in standby).
    let state = s.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(crate::server::IDENTIFY_MS as u64 + 200)).await;
        state.events.changed_topics(vec!["displays".to_string()]);
    });
    identify_status(State(s)).await
}

/// GET /displays/identify: what each output shows while identifying (nothing after).
async fn identify_status(State(s): State<SharedState>) -> Json<Value> {
    let remaining = s.identify_until.load(std::sync::atomic::Ordering::Relaxed) - crate::storage::now_ms();
    if remaining <= 0 {
        return Json(json!({ "remaining_ms": 0, "outputs": [] }));
    }
    let standby = s.config.read().await.power != crate::config::Power::Active;
    let m = s.screens.read().await;
    let outputs: Vec<Value> = m
        .displays
        .iter()
        .enumerate()
        .filter_map(|(i, d)| {
            let binding = m.bindings.iter().find(|b| b.physical_display == d.id)?;
            let screen = m.screens.iter().find(|v| v.id == binding.virtual_screen)?;
            Some(json!({
                "number": i + 1,
                "display_id": d.id,
                "display_name": d.name,
                "width": d.width,
                "height": d.height,
                "screen_id": screen.id,
                "screen_name": screen.name,
            }))
        })
        .collect();
    Json(json!({ "remaining_ms": remaining, "standby": standby, "outputs": outputs }))
}
