use crate::{error::AppError, presentation::playlist::Playlist, state::SharedState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/playlists", get(list).post(create))
        .route(
            "/playlists/:id",
            get(get_one).put(update).delete(delete_one),
        )
        .route("/playlists/:id/presentations", get(resolve))
}

#[derive(Deserialize)]
struct PlaylistBody {
    name: String,
    #[serde(default)]
    presentation_ids: Vec<Uuid>,
}
async fn list(State(s): State<SharedState>) -> Json<Vec<Playlist>> {
    Json(s.playlists.read().await.list().to_vec())
}
async fn create(
    State(s): State<SharedState>,
    Json(body): Json<PlaylistBody>,
) -> Result<(StatusCode, Json<Playlist>), AppError> {
    let playlist = s
        .playlists
        .write()
        .await
        .create(&body.name, body.presentation_ids)?;
    Ok((StatusCode::CREATED, Json(playlist)))
}
async fn get_one(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Playlist>, AppError> {
    Ok(Json(s.playlists.read().await.get(id)?.clone()))
}
async fn update(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PlaylistBody>,
) -> Result<Json<Playlist>, AppError> {
    let updated = s
        .playlists
        .write()
        .await
        .update(id, &body.name, body.presentation_ids)?;
    Ok(Json(updated))
}
async fn delete_one(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    s.playlists.write().await.delete(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn resolve(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let playlist = s.playlists.read().await.get(id)?.clone();
    let libs = s.libraries.read().await;
    let items: Vec<Value> = playlist
        .presentation_ids
        .iter()
        .map(|pid| match libs.get_presentation(*pid) {
            Ok(p) => json!({"id": pid, "missing": false, "summary": p.summary()}),
            Err(_) => json!({"id": pid, "missing": true}),
        })
        .collect();
    Ok(Json(json!({"playlist": playlist, "items":items})))
}
