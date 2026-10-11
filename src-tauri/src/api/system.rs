use crate::{api, error::AppError, state::SharedState};
use axum::{extract::State, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/health", get(health))
        .route("/config", get(get_config).put(put_config))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

async fn get_config(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    let c = s.config.read().await;
    Ok(Json(json!({
        "api_port": c.api_port,
        "data_dir": c.data_dir,
    })))
}

#[derive(Deserialize)]
struct ConfigUpdate {
    api_port: u16,
}

/// Body: {"api_port": 9000}. Moves the server to the new port and saves the config.
/// This response is still sent from the old port; later requests go to the new one.
async fn put_config(
    State(s): State<SharedState>,
    Json(body): Json<ConfigUpdate>,
) -> Result<Json<Value>, AppError> {
    if body.api_port < 1024 {
        return Err(AppError::BadRequest(
            "api_port must be between 1024 and 65535".into(),
        ));
    }

    let current = s.config.read().await.api_port;
    if body.api_port != current {
        api::restart_on_port(s.clone(), body.api_port).await?;
    }

    let mut config = s.config.write().await;
    config.api_port = body.api_port;
    config.save()?;
    Ok(Json(json!({ "api_port": config.api_port })))
}
