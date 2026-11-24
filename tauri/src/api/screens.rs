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
