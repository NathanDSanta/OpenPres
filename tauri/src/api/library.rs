use crate::{error::AppError, state::SharedState};
use axum::{extract::{Path, State}, routing::{get, put}, Json, Router};
use serde_json::Value;
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/libraries", get(list_libraries).post(create_library))
        .route("/libraries/:id", axum::routing::delete(delete_library))
        .route("/libraries/:id/presentations", get(list_presentations).post(create_presentation))
        .route("/presentations/:id", get(get_presentation).put(save_presentation).delete(delete_presentation))
        .route("/presentations/:id/raw", get(get_raw).put(put_raw))
        .route("/presentations/:id/arrangements/:name", put(set_arrangement).delete(delete_arrangement))
}

async fn list_libraries(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
async fn create_library(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn delete_library(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
async fn list_presentations(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
async fn create_presentation(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn get_presentation(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
async fn save_presentation(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn delete_presentation(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> { todo!() }
/// Raw .txt content (handy for curl testing of the file format).
async fn get_raw(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<String, AppError> { todo!() }
async fn put_raw(State(s): State<SharedState>, Path(id): Path<Uuid>, body: String) -> Result<Json<Value>, AppError> { todo!() }
/// Body: {"order": ["group1", "group2", "group1"]}
async fn set_arrangement(State(s): State<SharedState>, Path((id, name)): Path<(Uuid, String)>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn delete_arrangement(State(s): State<SharedState>, Path((id, name)): Path<(Uuid, String)>) -> Result<Json<Value>, AppError> { todo!() }
