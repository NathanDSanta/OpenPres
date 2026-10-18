use crate::{error::AppError, state::SharedState};
use axum::{extract::{Path, State}, routing::{get, put}, Json, Router};
use serde_json::Value;
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/screens", get(list).post(create))
        .route("/screens/:id", put(update).delete(delete))
        .route("/screens/:id/binding", put(set_binding).delete(clear_binding))
        .route("/displays", get(list_displays))
}

async fn list(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
async fn create(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn update(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn delete(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
/// Body: {"display_id": "..."}
async fn set_binding(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn clear_binding(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
async fn list_displays(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
