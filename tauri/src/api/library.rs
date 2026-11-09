use std::collections::BTreeMap;

use crate::{
    error::AppError,
    presentation::{
        library::Library, parser, Arrangement, Group, Presentation, PresentationSummary,
    },
    state::SharedState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::utils::mime_type::MimeType::Js;
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/libraries", get(list_libraries).post(create_library))
        .route("/libraries/:id", delete(delete_library))
        .route(
            "/libraries/:id/presentations",
            get(list_presentations).post(create_presentation),
        )
        .route(
            "/libraries/:id/presentations/raw",
            post(create_presentation_raw),
        )
        .route(
            "/presentations/:id",
            get(get_presentation)
                .put(replace_presentation)
                .delete(delete_presentation),
        )
        .route("/presentations/:id/raw", get(get_raw).put(put_raw))
        .route("/presentations/:id/slides", get(get_slides))
        .route(
            "/presentations/:id/slides/:index/group",
            put(set_slide_group),
        )
        .route(
            "/presentations/:id/arrangements",
            get(list_arrangements).post(create_arrangement),
        )
        .route(
            "/presentations/:id/arrangements/:name",
            put(set_arrangement).delete(delete_arrangement),
        )
}
#[derive(Deserialize)]
struct NewLibrary {
    name: String,
}

#[derive(Deserialize)]
struct PresentationBody {
    #[serde(default)]
    nameid: String,
    #[serde(default)]
    metadata: BTreeMap<String, String>,
    #[serde(default)]
    groups: Vec<Group>,
}

#[derive(Deserialize)]
struct ChangeSlideGroupBody {
    arrangement: String,
    group: Option<String>,
}

impl PresentationBody {
    fn into_presentation(self, id: Uuid) -> Presentation {
        Presentation {
            id,
            nameid: self.nameid,
            metadata: self.metadata,
            groups: self.groups,
            arrangements: vec![],
        }
    }
}

// ------------ libraries -----------------

async fn list_libraries(State(s): State<SharedState>) -> Json<Vec<Library>> {
    let libs = s.libraries.read().await;
    Json(libs.list().to_vec())
}
async fn create_library(
    State(s): State<SharedState>,
    Json(body): Json<NewLibrary>,
) -> Result<(StatusCode, Json<Library>), AppError> {
    let library = s.libraries.write().await.create(&body.name)?;
    Ok((StatusCode::CREATED, Json(library)))
}
async fn delete_library(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    s.libraries.write().await.delete(id)?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------ presentations -----------------

async fn list_presentations(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<PresentationSummary>>, AppError> {
    let libs = s.libraries.read().await;
    let list = libs.list_presentations(id)?;
    Ok(Json(list.iter().map(|p| p.summary()).collect()))
}
async fn create_presentation(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PresentationBody>,
) -> Result<(StatusCode, Json<Presentation>), AppError> {
    let libs = s.libraries.write().await;
    let created = libs.create_presentation(id, body.into_presentation(Uuid::nil()))?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn create_presentation_raw(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    body: String,
) -> Result<(StatusCode, Json<Presentation>), AppError> {
    let parsed = parser::parse(Uuid::nil(), &body)?;
    let libs = s.libraries.write().await;
    let created = libs.create_presentation(id, parsed)?;
    Ok((StatusCode::CREATED, Json(created)))
}
async fn get_presentation(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Presentation>, AppError> {
    Ok(Json(s.libraries.read().await.get_presentation(id)?))
}

async fn replace_presentation(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PresentationBody>,
) -> Result<Json<Presentation>, AppError> {
    let libs = s.libraries.write().await;
    let existing = libs.get_presentation(id)?;
    let mut updated = body.into_presentation(id);
    updated.arrangements = existing.arrangements;
    libs.save_presentation(&mut updated)?;
    Ok(Json(updated))
}

async fn delete_presentation(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    s.libraries.write().await.delete_presentation(id)?;
    Ok(StatusCode::NO_CONTENT)
}
/// Raw .txt content (handy for curl testing of the file format).
async fn get_raw(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<String, AppError> {
    s.libraries.read().await.get_raw(id)
}
async fn put_raw(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    body: String,
) -> Result<Json<Presentation>, AppError> {
    let libs = s.libraries.write().await;
    let mut updated = parser::parse(id, &body)?;
    libs.save_presentation(&mut updated)?;
    Ok(Json(updated))
}

async fn set_slide_group(
    State(s): State<SharedState>,
    Path((id, index)): Path<(Uuid, usize)>,
    Json(body): Json<ChangeSlideGroupBody>,
) -> Result<Json<Presentation>, AppError> {
    let libs = s.libraries.write().await;
    let mut presentation = libs.get_presentation(id)?;

    presentation.change_slide_group(&body.arrangement, index, body.group.as_deref())?;

    libs.save_presentation(&mut presentation)?;

    Ok(Json(presentation))
}
// ---------- arrangements ----------

#[derive(Deserialize)]
struct ArrangementBody {
    order: Vec<String>,
}

#[derive(Deserialize)]
struct SlidesQuery {
    arrangement: Option<String>,
}

/// The implicit `default` first, then the stored ones.
async fn list_arrangements(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Arrangement>>, AppError> {
    let p = s.libraries.read().await.get_presentation(id)?;
    let mut all = vec![p.default_arrangement()];
    all.extend(p.arrangements.iter().cloned());
    Ok(Json(all))
}

/// POST /presentations/:id/arrangements
/// Body: {"order": ["Verse 1", "Chorus", "Verse 1", "Chorus"]}
/// The server picks the next free name ("Custom", "Custom 2", ...) and returns it.
async fn create_arrangement(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<ArrangementBody>,
) -> Result<(StatusCode, Json<Arrangement>), AppError> {
    let libs = s.libraries.write().await;
    let mut p = libs.get_presentation(id)?;
    let name = p.next_arrangement_name();
    p.set_arrangement(&name, body.order)?;
    libs.save_presentation(&mut p)?;
    Ok((StatusCode::CREATED, Json(p.find_arrangement(Some(&name))?)))
}

/// PUT /presentations/:id/arrangements/:name
/// Body: {"order": [...]}. Creates the arrangement or replaces it.
async fn set_arrangement(
    State(s): State<SharedState>,
    Path((id, name)): Path<(Uuid, String)>,
    Json(body): Json<ArrangementBody>,
) -> Result<Json<Arrangement>, AppError> {
    let libs = s.libraries.write().await;
    let mut p = libs.get_presentation(id)?;
    p.set_arrangement(&name, body.order)?;
    libs.save_presentation(&mut p)?;
    Ok(Json(p.find_arrangement(Some(name.trim()))?))
}

async fn delete_arrangement(
    State(s): State<SharedState>,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<StatusCode, AppError> {
    let libs = s.libraries.write().await;
    let mut p = libs.get_presentation(id)?;
    p.remove_arrangement(&name)?;
    libs.save_presentation(&mut p)?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /presentations/:id/slides?arrangement=Sunday
/// The final flat list of slides, exactly as the presenter will step through it.
async fn get_slides(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Query(q): Query<SlidesQuery>,
) -> Result<Json<Value>, AppError> {
    let p = s.libraries.read().await.get_presentation(id)?;
    let arrangement = p.find_arrangement(q.arrangement.as_deref())?;
    let slides = p.expand(&arrangement)?;
    let items: Vec<Value> = slides
        .iter()
        .enumerate()
        .map(|(i, sl)| json!({ "index": i, "group": sl.group, "text": sl.text }))
        .collect();
    Ok(Json(json!({
        "arrangement": arrangement.name,
        "total": items.len(),
        "slides": items
    })))
}
