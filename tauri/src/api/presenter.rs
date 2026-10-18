use crate::{error::AppError, state::SharedState};
use axum::{extract::State, routing::{get, post}, Json, Router};
use serde_json::Value;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/presenter/state", get(get_state))
        .route("/presenter/load", post(load))
        .route("/presenter/next", post(next))
        .route("/presenter/previous", post(previous))
        .route("/presenter/goto", post(goto))
        .route("/presenter/clear", post(clear))
}

async fn get_state(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
/// Body: {"presentation_id": "...", "arrangement": "name"?}
/// Routes the presentation to the Slides or Announcements layer on all screens,
/// based on the presentation's `layer` metadata.
async fn load(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn next(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
async fn previous(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
/// Body: {"index": 3}
async fn goto(State(s): State<SharedState>, Json(b): Json<Value>) -> Result<Json<Value>, AppError> { todo!() }
async fn clear(State(s): State<SharedState>) -> Result<Json<Value>, AppError> { todo!() }
