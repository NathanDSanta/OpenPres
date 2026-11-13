use crate::{error::AppError, state::SharedState, timers::{TimerDef, TimerView}};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/timers", get(list).post(create))
        .route("/timers/:id", put(update).delete(delete_one))
        .route("/timers/:id/:action", post(action))
}

async fn list(State(s): State<SharedState>) -> Json<Vec<TimerView>> {
    Json(s.timers.read().await.list())
}

async fn create(State(s): State<SharedState>, Json(def): Json<TimerDef>) -> Result<(StatusCode, Json<TimerDef>), AppError> {
    Ok((StatusCode::CREATED, Json(s.timers.write().await.create(def)?)))
}

async fn update(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(def): Json<TimerDef>) -> Result<Json<TimerDef>, AppError> {
    Ok(Json(s.timers.write().await.update(id, def)?))
}

async fn delete_one(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<StatusCode, AppError> {
    s.timers.write().await.delete(id)?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /timers/:id/start | pause | reset
async fn action(State(s): State<SharedState>, Path((id, action)): Path<(Uuid, String)>) -> Result<Json<Vec<TimerView>>, AppError> {
    {
        let mut timers = s.timers.write().await;
        match action.as_str() {
            "start" => timers.start(id)?,
            "pause" => timers.pause(id)?,
            "reset" => timers.reset(id)?,
            other => return Err(AppError::BadRequest(format!("unknown timer action `{other}`"))),
        }
    }
    Ok(Json(s.timers.read().await.list()))
}
