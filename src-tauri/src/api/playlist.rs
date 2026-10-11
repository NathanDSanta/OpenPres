use crate::{error::AppError, state::SharedState};
use axum::{extract::{Path, State}, routing::{get, put}, Json, Router};
use serde_json::Value;
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/playlists", get(list).post(create))
        .route("/playlists/:id", get(get_one).put(update).delete(delete))
}

async fn list(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
async fn create(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn get_one(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
async fn update(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn delete(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
