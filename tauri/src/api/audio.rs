use crate::{error::AppError, state::SharedState};
use axum::{extract::{Path, State}, routing::{delete, get, post}, Json, Router};
use serde_json::Value;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/audio/routing", get(get_routing).put(replace_routing))
        .route("/audio/routing/channels", post(add_channel))
        .route("/audio/routing/channels/:index", delete(remove_channel).put(update_channel))
}

async fn get_routing(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
async fn replace_routing(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
/// 409/400 when already at 16 channels.
async fn add_channel(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn remove_channel(State(s): State<SharedState>, Path(index): Path<u8>) -> Result<Json<Value>, AppError> { todo!() }
async fn update_channel(State(s): State<SharedState>, Path(index): Path<u8>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
