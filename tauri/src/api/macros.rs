use crate::{
    error::AppError,
    macros::{self, MacrosFile, MacrosStatus},
    state::SharedState,
};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/macros", get(get_macros).put(put_macros))
        .route("/macros/status", get(status))
        .route("/macros/:id/run", post(run))
        .route("/macros/:id/stop", post(stop))
}

async fn get_macros(State(s): State<SharedState>) -> Json<MacrosFile> {
    Json(s.macros.read().await.value.clone())
}

/// Admin only (auth.rs).
async fn put_macros(State(s): State<SharedState>, Json(body): Json<MacrosFile>) -> Result<Json<MacrosFile>, AppError> {
    macros::validate(&body)?;
    s.macros.write().await.replace(body.clone())?;
    Ok(Json(body))
}

/// Which macros are running, and the last runs (newest first).
async fn status(State(s): State<SharedState>) -> Json<MacrosStatus> {
    Json(s.macro_runs.status().await)
}

#[derive(Deserialize, Default)]
struct RunBody {
    /// Where it was started from: "button", "shortcut", "command", "stream_deck".
    from: Option<String>,
}

/// Anyone can run a macro (the admin sets them up).
async fn run(State(s): State<SharedState>, Path(id): Path<Uuid>, body: Option<Json<RunBody>>) -> Result<Json<Value>, AppError> {
    let from = body.and_then(|Json(b)| b.from);
    let why = match from.as_deref() {
        Some("shortcut") => "Keyboard shortcut",
        Some("command") => "Command bar",
        Some("stream_deck") => "Stream Deck",
        _ => "By hand",
    };
    macros::start(&s, id, why.into()).await?;
    Ok(Json(json!({ "running": true })))
}

async fn stop(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    macros::stop(&s, id)?;
    Ok(Json(json!({ "stopping": true })))
}
