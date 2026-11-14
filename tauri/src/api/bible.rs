use crate::{
    bible::{import, BibleLive, BibleSettings, Reference, MAX_VERSIONS},
    error::AppError,
    state::{Focus, SharedState},
};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

const CATALOG_URL: &str = "https://bible.helloao.org/api/available_translations.json";

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/bibles", get(list))
        .route("/bibles/settings", put(put_settings))
        .route("/bibles/import", post(import_file).layer(DefaultBodyLimit::max(200 * 1024 * 1024)))
        .route("/bibles/catalog", get(catalog))
        .route("/bibles/download", post(download))
        .route("/bibles/bundled/:id", post(restore_bundled))
        .route("/bibles/parse", get(parse))
        .route("/bibles/search", get(search))
        .route("/bibles/:id", get(get_one).delete(delete_one))
        .route("/bibles/:id/:book/:chapter", get(chapter))
        .route("/bible/live", get(live))
        .route("/bible/show", post(show))
        .route("/bible/next", post(next))
        .route("/bible/previous", post(previous))
        .route("/bible/clear", post(clear))
}

async fn list(State(s): State<SharedState>) -> Json<Value> {
    let store = s.bibles.read().await;
    Json(json!({
        "installed": store.list(),
        "settings": store.settings.value,
        "available_bundled": store.available_bundled(),
        "max_versions": MAX_VERSIONS,
    }))
}

async fn get_one(State(s): State<SharedState>, Path(id): Path<String>) -> Result<Json<Value>, AppError> {
    let bible = s.bibles.read().await.get(&id)?;
    Ok(Json(json!({ "bible": bible.summary(), "books": bible.outline() })))
}

async fn delete_one(State(s): State<SharedState>, Path(id): Path<String>) -> Result<StatusCode, AppError> {
    s.bibles.write().await.remove(&id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn put_settings(State(s): State<SharedState>, Json(settings): Json<BibleSettings>) -> Result<Json<Value>, AppError> {
    s.bibles.write().await.save_settings(settings)?;
    Ok(list(State(s)).await)
}

async fn restore_bundled(State(s): State<SharedState>, Path(id): Path<String>) -> Result<Json<Value>, AppError> {
    let summary = s.bibles.write().await.restore_bundled(&id)?;
    Ok(Json(json!(summary)))
}

#[derive(Deserialize)]
struct ImportQuery {
    #[serde(default)]
    file_name: String,
    #[serde(flatten)]
    meta: import::ImportMeta,
}

/// POST /bibles/import?file_name=x.xml&name=&abbreviation=&language= with the file as body.
async fn import_file(State(s): State<SharedState>, Query(q): Query<ImportQuery>, body: Bytes) -> Result<Json<Value>, AppError> {
    let bible = tokio::task::spawn_blocking(move || import::read(&body, &q.file_name, &q.meta))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    let summary = s.bibles.write().await.install(bible)?;
    Ok(Json(json!(summary)))
}

fn http() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent(concat!("OpenPres/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// The online catalog of free Bibles (Free Use Bible API by AO Lab).
async fn catalog() -> Result<Json<Value>, AppError> {
    let value: Value = http()?
        .get(CATALOG_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::Device(format!("cannot reach the Bible catalog: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Device(format!("unexpected catalog answer: {e}")))?;
    let list: Vec<Value> = value
        .get("translations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|t| {
            json!({
                "id": t.get("id"),
                "name": t.get("name"),
                "english_name": t.get("englishName"),
                "abbreviation": t.get("shortName"),
                "language": t.get("language"),
                "language_name": t.get("languageEnglishName").or(t.get("languageName")),
                "license_url": t.get("licenseUrl"),
                "books": t.get("numberOfBooks"),
                "verses": t.get("totalNumberOfVerses"),
            })
        })
        .collect();
    Ok(Json(json!({ "translations": list })))
}

#[derive(Deserialize)]
struct DownloadBody {
    /// Catalog id, e.g. "BSB".
    id: String,
    #[serde(flatten)]
    meta: import::ImportMeta,
}

async fn download(State(s): State<SharedState>, Json(body): Json<DownloadBody>) -> Result<Json<Value>, AppError> {
    if body.id.is_empty() || !body.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::BadRequest("invalid catalog id".into()));
    }
    let url = format!("https://bible.helloao.org/api/{}/complete.json", body.id);
    let bytes = http()?
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::Device(format!("download failed: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::Device(format!("download failed: {e}")))?;
    let mut meta = body.meta;
    if meta.id.is_empty() {
        meta.id = body.id.to_lowercase();
    }
    let bible = tokio::task::spawn_blocking(move || import::read(&bytes, "complete.json", &meta))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    let summary = s.bibles.write().await.install(bible)?;
    Ok(Json(json!(summary)))
}

async fn chapter(State(s): State<SharedState>, Path((id, book, chapter)): Path<(String, String, usize)>) -> Result<Json<Value>, AppError> {
    let bible = s.bibles.read().await.get(&id)?;
    let b = bible.book(&book).ok_or_else(|| AppError::NotFound(format!("book {book}")))?;
    let verses = b
        .chapters
        .get(chapter.wrapping_sub(1))
        .ok_or_else(|| AppError::NotFound(format!("chapter {chapter}")))?;
    Ok(Json(json!({ "book": b.code, "name": b.name, "chapter": chapter, "verses": verses })))
}

#[derive(Deserialize)]
struct ParseQuery {
    q: String,
    bible: Option<String>,
}

/// Interprets a typed reference with the given (or primary) version, and previews it in
/// every selected version.
async fn parse(State(s): State<SharedState>, Query(q): Query<ParseQuery>) -> Result<Json<Value>, AppError> {
    let store = s.bibles.read().await;
    let primary = match &q.bible {
        Some(id) => store.get(id)?,
        None => store.primary()?,
    };
    let Some(reference) = primary.parse_reference(&q.q) else {
        return Ok(Json(json!({ "reference": null })));
    };
    let verse_numbers = store.settings.value.verse_numbers;
    let passages: Vec<_> = store.selected().iter().map(|b| b.passage(&reference, verse_numbers)).collect();
    Ok(Json(json!({ "reference": reference, "label": primary.format_reference(&reference), "passages": passages })))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    bible: Option<String>,
    book: Option<String>,
    limit: Option<usize>,
}

/// Keyword search: every word must appear, in any order; accents and punctuation do not
/// matter.
async fn search(State(s): State<SharedState>, Query(q): Query<SearchQuery>) -> Result<Json<Value>, AppError> {
    let bible = {
        let store = s.bibles.read().await;
        match &q.bible {
            Some(id) => store.get(id)?,
            None => store.primary()?,
        }
    };
    let limit = q.limit.unwrap_or(100).min(500);
    let (hits, total) = tokio::task::spawn_blocking(move || {
        let (hits, total) = bible.search(&q.q, q.book.as_deref(), limit);
        let hits: Vec<Value> = hits
            .into_iter()
            .map(|(r, text)| json!({ "label": bible.format_reference(&r), "reference": r, "text": text }))
            .collect();
        (hits, total)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "hits": hits, "total": total })))
}

/// What is live on the Bible layer, as passages in every selected version.
pub async fn live_json(s: &SharedState) -> Value {
    let Some(live) = s.bible_live.read().await.clone() else {
        return Value::Null;
    };
    let store = s.bibles.read().await;
    let verse_numbers = store.settings.value.verse_numbers;
    let passages: Vec<_> = store.selected().iter().map(|b| b.passage(&live.reference, verse_numbers)).collect();
    json!({
        "reference": live.reference,
        "label": store.primary().map(|b| b.format_reference(&live.reference)).unwrap_or_default(),
        "passages": passages,
    })
}

async fn live(State(s): State<SharedState>) -> Json<Value> {
    Json(live_json(&s).await)
}

#[derive(Deserialize)]
struct ShowBody {
    /// Either a reference...
    reference: Option<Reference>,
    /// ...or text to parse ("Juan 3:16").
    query: Option<String>,
}

async fn show(State(s): State<SharedState>, Json(body): Json<ShowBody>) -> Result<Json<Value>, AppError> {
    let reference = {
        let store = s.bibles.read().await;
        let primary = store.primary()?;
        match (body.reference, body.query) {
            (Some(r), _) => {
                if primary.verse_count(&r.book, r.chapter) == 0 {
                    return Err(AppError::NotFound("that chapter is not in this Bible".into()));
                }
                r
            }
            (None, Some(q)) => primary
                .parse_reference(&q)
                .ok_or_else(|| AppError::BadRequest(format!("`{q}` is not a Bible reference")))?,
            (None, None) => return Err(AppError::BadRequest("give a reference or a query".into())),
        }
    };
    *s.bible_live.write().await = Some(BibleLive { reference });
    *s.focus.write().await = Focus::Bible;
    Ok(Json(live_json(&s).await))
}

/// Moves the Bible layer one verse. Returns false when nothing is live.
pub async fn step(s: &SharedState, forward: bool) -> Result<bool, AppError> {
    let Some(live) = s.bible_live.read().await.clone() else {
        return Ok(false);
    };
    let primary = s.bibles.read().await.primary()?;
    if let Some(reference) = primary.step(&live.reference, forward) {
        *s.bible_live.write().await = Some(BibleLive { reference });
    }
    Ok(true)
}

async fn next(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    if !step(&s, true).await? {
        return Err(AppError::Conflict("nothing is live on the Bible layer".into()));
    }
    Ok(Json(live_json(&s).await))
}

async fn previous(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    if !step(&s, false).await? {
        return Err(AppError::Conflict("nothing is live on the Bible layer".into()));
    }
    Ok(Json(live_json(&s).await))
}

async fn clear(State(s): State<SharedState>) -> Json<Value> {
    *s.bible_live.write().await = None;
    Json(Value::Null)
}
