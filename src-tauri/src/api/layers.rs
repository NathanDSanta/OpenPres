use crate::{error::AppError, layers::LayerKind, state::SharedState};
use axum::{extract::{Path, State}, routing::get, Json, Router};
use serde_json::Value;
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/screens/:id/layers", get(list))
        .route("/screens/:id/layers/:kind", get(get_layer).put(set_layer).delete(clear_layer))
}

async fn list(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
async fn get_layer(State(s): State<SharedState>, Path((id, kind)): Path<(Uuid, LayerKind)>) -> Result<Json<Value>, AppError> { todo!() }
/// Body: {"visible": bool?, "content": LayerContent?}
async fn set_layer(State(s): State<SharedState>, Path((id, kind)): Path<(Uuid, LayerKind)>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn clear_layer(State(s): State<SharedState>, Path((id, kind)): Path<(Uuid, LayerKind)>) -> Result<Json<Value>, AppError> { todo!() }
