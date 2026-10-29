use crate::{error::AppError, state::SharedState, theme::Theme};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use uuid::Uuid;
pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/themes", get(list).post(create))
        .route("/themes/:id", get(get_one).put(update).delete(delete_one))
}
/// Short list entries; fetch one theme to get its elements.
async fn list(State(s): State<SharedState>) -> Json<Value> {
    let themes = s.themes.read().await;
    let items: Vec<Value> = themes
        .list()
        .iter()
        .map(|t| {
            json!({
            "id": t.id,
            "name": t.name,
            "width": t.width,
            "height": t.height,
            "elements": t.elements.len()
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
