use crate::{
    error::AppError,
    layers::{content::LayerContent, Layer, LayerKind, LayerStack},
    state::SharedState,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;
pub fn routes() -> Router<SharedState> {
    Router::new().route("/screens/:id/layers", get(list)).route(
        "/screens/:id/layers/:kind",
        get(get_layer).put(set_layer).delete(clear_layer),
    )
}
#[derive(Deserialize)]
struct LayerUpdate {
    visible: Option<bool>,
    content: Option<LayerContent>,
}
/// Rules that need other subsystems: the thing the layer points at must exist.
async fn validate_content(s: &SharedState, content: &LayerContent) -> Result<(), AppError> {
    match content {
        LayerContent::Presentation {
            presentation_id, ..
        } => {
            s.libraries
                .read()
                .await
                .get_presentation(*presentation_id)?;
        }
        LayerContent::VideoInput { device_id } => {
            let devices = s.devices.video_devices().await;
            if !devices.iter().any(|d| &d.id == device_id) {
                return Err(AppError::BadRequest(format!(
                    "unknown video device `{device_id}` (see GET /devices/video, or POST
 /devices/refresh)"
                )));
            }
        }
        LayerContent::Media { path } => {
            if !path.is_file() {
                return Err(AppError::BadRequest(format!(
                    "media file not found: {}",
                    path.display()
                )));
            }
        }
        LayerContent::Component { component, .. } => {
            if component.trim().is_empty() {
                return Err(AppError::BadRequest(
                    "component name cannot be empty".into(),
                ));
            }
        }
        LayerContent::Empty | LayerContent::AudioRouting => {}
    }
    Ok(())
}
async fn list(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<LayerStack>, AppError> {
    Ok(Json(s.screens.read().await.get(id)?.layers.clone()))
}
async fn get_layer(
    State(s): State<SharedState>,
    Path((id, kind)): Path<(Uuid, LayerKind)>,
) -> Result<Json<Layer>, AppError> {
    Ok(Json(
        s.screens.read().await.get(id)?.layers.get(kind).clone(),
    ))
}
/// Body: {"visible": true, "content": {...}} (both optional)
async fn set_layer(
    State(s): State<SharedState>,
    Path((id, kind)): Path<(Uuid, LayerKind)>,
    Json(body): Json<LayerUpdate>,
) -> Result<Json<Layer>, AppError> {
    if let Some(content) = &body.content {
        validate_content(&s, content).await?;
    }
    let layer = s
        .screens
        .write()
        .await
        .update_layer(id, kind, body.visible, body.content)?;
    Ok(Json(layer))
}
async fn clear_layer(
    State(s): State<SharedState>,
    Path((id, kind)): Path<(Uuid, LayerKind)>,
) -> Result<Json<Layer>, AppError> {
    Ok(Json(s.screens.write().await.clear_layer(id, kind)?))
}
