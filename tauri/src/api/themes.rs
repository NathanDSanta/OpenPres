use crate::{error::AppError, state::SharedState, theme::{Theme, ThemeKind}};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;
pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/themes", get(list).post(create))
        .route("/themes/:id", get(get_one).put(update).delete(delete_one))
}
#[derive(Deserialize)]
struct KindQuery {
    kind: Option<ThemeKind>,
}

/// Short list entries (designs without their elements); fetch one theme for everything.
/// `?kind=slides` or `?kind=props` filters.
async fn list(State(s): State<SharedState>, Query(q): Query<KindQuery>) -> Json<Value> {
    let themes = s.themes.read().await;
    let items: Vec<Value> = themes
        .list()
        .iter()
        .filter(|t| q.kind.map_or(true, |k| t.kind == k))
        .map(|t| {
            json!({
                "id": t.id,
                "name": t.name,
                "kind": t.kind,
                "width": t.width,
                "height": t.height,
                "designs": t.designs.iter().map(|d| json!({ "id": d.id, "name": d.name })).collect::<Vec<_>>(),
            })
        })
        .collect();
    Json(json!(items))
}
async fn create(
    State(s): State<SharedState>,
    Json(theme): Json<Theme>,
) -> Result<(StatusCode, Json<Theme>), AppError> {
    let created = s.themes.write().await.create(theme)?;
    Ok((StatusCode::CREATED, Json(created)))
}
async fn get_one(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Theme>, AppError> {
    Ok(Json(s.themes.read().await.get(id)?.clone()))
}
async fn update(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(theme): Json<Theme>,
) -> Result<Json<Theme>, AppError> {
    Ok(Json(s.themes.write().await.update(id, theme)?))
}
async fn delete_one(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    s.themes.write().await.delete(id)?;
    Ok(StatusCode::NO_CONTENT)
}
