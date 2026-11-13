use crate::{
    error::AppError,
    media::{
        player::SlotState,
        playlists::{self, MediaPlaylist},
        EndAction, MediaItem, MediaKind, PlaylistKind, Slot,
    },
    state::SharedState,
    theme::style::MediaFit,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::services::ServeFile;
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/media", get(list))
        .route(
            "/media/import",
            post(import).layer(DefaultBodyLimit::disable()),
        )
        .route("/media/:id", put(rename).delete(delete_one))
        .route("/media/:id/meta", put(set_meta))
        .route("/media/:id/file", get(file))
        .route("/media/playlists", get(list_playlists).post(create_playlist))
        .route("/media/playlists/:id", put(update_playlist).delete(delete_playlist))
        .route("/player", get(player_state))
        .route("/player/:slot/play", post(play))
        .route("/player/:slot/pause", post(pause))
        .route("/player/:slot/resume", post(resume))
        .route("/player/:slot/toggle", post(toggle))
        .route("/player/:slot/seek", post(seek))
        .route("/player/:slot/next", post(next))
        .route("/player/:slot/previous", post(previous))
        .route("/player/:slot/clear", post(clear))
        .route("/player/:slot/volume", put(volume))
}

// ---------- library ----------

async fn list(State(s): State<SharedState>) -> Json<Vec<MediaItem>> {
    Json(s.media.read().await.items.clone())
}

#[derive(Deserialize)]
struct ImportQuery {
    name: String,
    /// Optional playlist to append the new item to.
    playlist: Option<Uuid>,
}

/// POST /media/import?name=song.mp3&playlist=<id> with the file as the raw body.
/// The file is copied into the data folder.
async fn import(
    State(s): State<SharedState>,
    Query(q): Query<ImportQuery>,
    body: Body,
) -> Result<(StatusCode, Json<MediaItem>), AppError> {
    let (id, kind, file, tmp) = s.media.read().await.reserve(&q.name)?;
    let result: Result<(), AppError> = async {
        let mut out = tokio::fs::File::create(&tmp).await?;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| AppError::BadRequest(format!("upload interrupted: {e}")))?;
            out.write_all(&chunk).await?;
        }
        out.flush().await?;
        Ok(())
    }
    .await;
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    let name = q.name.clone();
    let item = {
        let state = s.clone();
        tokio::task::spawn_blocking(move || {
            let mut media = state.media.blocking_write();
            media.finish_import(id, kind, &name, file, tmp)
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??
    };
    if let Some(pid) = q.playlist {
        let mut docs = s.media_playlists.write().await;
        if let Some(p) = docs.value.playlists.iter_mut().find(|p| p.id == pid) {
            p.items.push(item.id);
            docs.save()?;
        }
    }
    Ok((StatusCode::CREATED, Json(item)))
}

#[derive(Deserialize)]
struct RenameBody {
    name: String,
}

async fn rename(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(body): Json<RenameBody>) -> Result<Json<MediaItem>, AppError> {
    Ok(Json(s.media.write().await.rename(id, &body.name)?))
}

#[derive(Deserialize)]
struct MetaBody {
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
}

/// Information learned by the frontend (e.g. a video's length).
async fn set_meta(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(body): Json<MetaBody>) -> Result<StatusCode, AppError> {
    s.media.write().await.set_meta(id, body.duration_ms, body.width, body.height)?;
    if let Some(d) = body.duration_ms {
        s.player.set_duration(id, d);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_one(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<StatusCode, AppError> {
    for slot in [Slot::Visual, Slot::Audio] {
        if s.player.state(slot).is_some_and(|st| st.media_id == id) {
            s.player.clear(slot);
        }
    }
    s.media.write().await.delete(id)?;
    let mut docs = s.media_playlists.write().await;
    for p in docs.value.playlists.iter_mut() {
        p.items.retain(|m| *m != id);
    }
    docs.save()?;
    Ok(StatusCode::NO_CONTENT)
}

/// The file itself, with HTTP range support (needed for video seeking).
async fn file(State(s): State<SharedState>, Path(id): Path<Uuid>, req: Request) -> Result<Response, AppError> {
    let path = s.media.read().await.path(id)?;
    let response = ServeFile::new(path)
        .oneshot(req)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let (mut parts, body) = response.into_parts();
    parts.headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, max-age=86400"),
    );
    Ok(Response::from_parts(parts, Body::new(body)).into_response())
}

// ---------- playlists ----------

async fn list_playlists(State(s): State<SharedState>) -> Json<Vec<MediaPlaylist>> {
    Json(s.media_playlists.read().await.value.playlists.clone())
}

async fn check_items(s: &SharedState, p: &MediaPlaylist) -> Result<(), AppError> {
    let media = s.media.read().await;
    for id in &p.items {
        let item = media.get(*id)?;
        let ok = match p.kind {
            PlaylistKind::Audio => item.kind == MediaKind::Audio,
            PlaylistKind::Visual => item.kind != MediaKind::Audio,
        };
        if !ok {
            return Err(AppError::BadRequest(format!(
                "`{}` cannot go in a {} playlist",
                item.name,
                if p.kind == PlaylistKind::Audio { "audio" } else { "picture/video" }
            )));
        }
    }
    Ok(())
}

async fn create_playlist(State(s): State<SharedState>, Json(mut p): Json<MediaPlaylist>) -> Result<(StatusCode, Json<MediaPlaylist>), AppError> {
    p.id = Uuid::new_v4();
    playlists::validate(&p)?;
    check_items(&s, &p).await?;
    let mut docs = s.media_playlists.write().await;
    docs.value.playlists.push(p.clone());
    docs.save()?;
    Ok((StatusCode::CREATED, Json(p)))
}

async fn update_playlist(State(s): State<SharedState>, Path(id): Path<Uuid>, Json(mut p): Json<MediaPlaylist>) -> Result<Json<MediaPlaylist>, AppError> {
    p.id = id;
    playlists::validate(&p)?;
    check_items(&s, &p).await?;
    let mut docs = s.media_playlists.write().await;
    let slot = docs
        .value
        .playlists
        .iter_mut()
        .find(|x| x.id == id)
        .ok_or_else(|| AppError::NotFound(format!("media playlist {id}")))?;
    *slot = p.clone();
    docs.save()?;
    drop(docs);
    // Settings of a playing playlist apply right away.
    for slot in [Slot::Visual, Slot::Audio] {
        if let Some(state) = s.player.state(slot) {
            if state.playlist_id == Some(id) {
                let ffmpeg = s.ffmpeg().await;
                let mut updated = state.clone();
                updated.end_action = p.end_action;
                updated.bus = p.bus;
                updated.mono = p.mono;
                updated.fit = p.fit;
                updated.image_seconds = p.image_seconds;
                updated.position_ms = state.position_now();
                let path = s.media.read().await.path(state.media_id)?;
                s.player.load(slot, updated, path, &ffmpeg);
            }
        }
    }
    Ok(Json(p))
}

async fn delete_playlist(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<StatusCode, AppError> {
    let mut docs = s.media_playlists.write().await;
    let before = docs.value.playlists.len();
    docs.value.playlists.retain(|p| p.id != id);
    if before == docs.value.playlists.len() {
        return Err(AppError::NotFound(format!("media playlist {id}")));
    }
    docs.save()?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- playback ----------

async fn player_state(State(s): State<SharedState>) -> Json<Value> {
    Json(json!(s.player.view()))
}

fn slot_of(name: &str) -> Result<Slot, AppError> {
    match name {
        "visual" => Ok(Slot::Visual),
        "audio" => Ok(Slot::Audio),
        other => Err(AppError::BadRequest(format!("unknown player slot `{other}` (visual or audio)"))),
    }
}

#[derive(Deserialize, Default)]
struct PlayBody {
    /// Play this playlist, starting at `index` (default 0).
    playlist_id: Option<Uuid>,
    #[serde(default)]
    index: usize,
    /// Or a single item without a playlist.
    media_id: Option<Uuid>,
    /// Start paused (e.g. to cue).
    #[serde(default)]
    paused: bool,
    #[serde(default)]
    position_ms: u64,
}

/// Starts item `index` of `playlist` (or a lone item) on `slot`.
async fn start_item(
    s: &SharedState,
    slot: Slot,
    playlist: Option<&MediaPlaylist>,
    index: usize,
    media_id: Uuid,
    playing: bool,
    position_ms: u64,
) -> Result<(), AppError> {
    let (item, path) = {
        let media = s.media.read().await;
        let item = media.get(media_id)?.clone();
        let path = media.path_of(&item);
        (item, path)
    };
    let expected_audio = slot == Slot::Audio;
    if (item.kind == MediaKind::Audio) != expected_audio {
        return Err(AppError::BadRequest(if expected_audio {
            "only audio files play on the audio slot".into()
        } else {
            "audio files play on the audio slot".into()
        }));
    }
    let state = SlotState {
        playlist_id: playlist.map(|p| p.id),
        index,
        media_id: item.id,
        name: item.name.clone(),
        kind: item.kind,
        playing,
        position_ms,
        anchor_ms: 0,
        duration_ms: item.duration_ms,
        end_action: playlist.map(|p| p.end_action).unwrap_or(EndAction::Stop),
        bus: playlist.map(|p| p.bus).unwrap_or(1),
        mono: playlist.map(|p| p.mono).unwrap_or(false),
        fit: playlist.map(|p| p.fit).unwrap_or(MediaFit::Cover),
        image_seconds: playlist.map(|p| p.image_seconds).unwrap_or(0),
        volume_db: 0.0,
    };
    let ffmpeg = s.ffmpeg().await;
    s.player.load(slot, state, path, &ffmpeg);
    Ok(())
}

async fn playlist(s: &SharedState, id: Uuid) -> Result<MediaPlaylist, AppError> {
    s.media_playlists
        .read()
        .await
        .value
        .playlists
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("media playlist {id}")))
}

async fn play(State(s): State<SharedState>, Path(slot): Path<String>, body: Option<Json<PlayBody>>) -> Result<Json<Value>, AppError> {
    let slot = slot_of(&slot)?;
    let body = body.map(|Json(b)| b).unwrap_or_default();
    match (body.playlist_id, body.media_id) {
        (Some(pid), media) => {
            let p = playlist(&s, pid).await?;
            let (index, media_id) = match media {
                Some(m) => (p.items.iter().position(|x| *x == m).unwrap_or(body.index), m),
                None => (body.index, *p.items.get(body.index).ok_or_else(|| AppError::BadRequest("that playlist position is empty".into()))?),
            };
            start_item(&s, slot, Some(&p), index, media_id, !body.paused, body.position_ms).await?;
        }
        (None, Some(media_id)) => {
            start_item(&s, slot, None, 0, media_id, !body.paused, body.position_ms).await?;
        }
        (None, None) => {
            // No target: resume what is loaded.
            let ffmpeg = s.ffmpeg().await;
            if !s.player.set_playing(slot, true, &ffmpeg) {
                return Err(AppError::Conflict("nothing is loaded on that slot".into()));
            }
        }
    }
    Ok(Json(json!(s.player.view())))
}

async fn set_playing(s: &SharedState, slot: &str, playing: Option<bool>) -> Result<Json<Value>, AppError> {
    let slot = slot_of(slot)?;
    let ffmpeg = s.ffmpeg().await;
    let want = match playing {
        Some(p) => p,
        None => !s.player.state(slot).map(|st| st.playing).unwrap_or(false),
    };
    if !s.player.set_playing(slot, want, &ffmpeg) {
        return Err(AppError::Conflict("nothing is loaded on that slot".into()));
    }
    Ok(Json(json!(s.player.view())))
}

async fn pause(State(s): State<SharedState>, Path(slot): Path<String>) -> Result<Json<Value>, AppError> {
    set_playing(&s, &slot, Some(false)).await
}
async fn resume(State(s): State<SharedState>, Path(slot): Path<String>) -> Result<Json<Value>, AppError> {
    set_playing(&s, &slot, Some(true)).await
}
async fn toggle(State(s): State<SharedState>, Path(slot): Path<String>) -> Result<Json<Value>, AppError> {
    set_playing(&s, &slot, None).await
}

#[derive(Deserialize)]
struct SeekBody {
    position_ms: u64,
}

async fn seek(State(s): State<SharedState>, Path(slot): Path<String>, Json(body): Json<SeekBody>) -> Result<Json<Value>, AppError> {
    let slot = slot_of(&slot)?;
    let ffmpeg = s.ffmpeg().await;
    if !s.player.seek(slot, body.position_ms, &ffmpeg) {
        return Err(AppError::Conflict("nothing is loaded on that slot".into()));
    }
    Ok(Json(json!(s.player.view())))
}

/// Moves to another item of the slot's playlist. `wrap` loops around the ends.
async fn advance(s: &SharedState, slot: Slot, forward: bool, wrap: bool) -> Result<bool, AppError> {
    let Some(state) = s.player.state(slot) else {
        return Err(AppError::Conflict("nothing is loaded on that slot".into()));
    };
    let Some(pid) = state.playlist_id else { return Ok(false) };
    let Ok(p) = playlist(s, pid).await else { return Ok(false) };
    if p.items.is_empty() {
        return Ok(false);
    }
    let len = p.items.len();
    let target = if forward {
        if state.index + 1 < len {
            Some(state.index + 1)
        } else if wrap {
            Some(0)
        } else {
            None
        }
    } else if state.index > 0 {
        Some(state.index - 1)
    } else if wrap {
        Some(len - 1)
    } else {
        Some(0)
    };
    match target {
        Some(index) => {
            start_item(s, slot, Some(&p), index, p.items[index], true, 0).await?;
            Ok(true)
        }
        None => Ok(false),
    }
}

async fn next(State(s): State<SharedState>, Path(slot): Path<String>) -> Result<Json<Value>, AppError> {
    let slot = slot_of(&slot)?;
    let wrap = s.player.state(slot).is_some_and(|st| st.end_action == EndAction::LoopAll);
    advance(&s, slot, true, wrap).await?;
    Ok(Json(json!(s.player.view())))
}

async fn previous(State(s): State<SharedState>, Path(slot): Path<String>) -> Result<Json<Value>, AppError> {
    let slot = slot_of(&slot)?;
    // Like most players: past the first seconds, "previous" restarts the item.
    if let Some(state) = s.player.state(slot) {
        if state.position_now() > 3000 || state.playlist_id.is_none() {
            let ffmpeg = s.ffmpeg().await;
            s.player.seek(slot, 0, &ffmpeg);
            return Ok(Json(json!(s.player.view())));
        }
    }
    let wrap = s.player.state(slot).is_some_and(|st| st.end_action == EndAction::LoopAll);
    advance(&s, slot, false, wrap).await?;
    Ok(Json(json!(s.player.view())))
}

async fn clear(State(s): State<SharedState>, Path(slot): Path<String>) -> Result<Json<Value>, AppError> {
    s.player.clear(slot_of(&slot)?);
    Ok(Json(json!(s.player.view())))
}

#[derive(Deserialize)]
struct VolumeBody {
    volume_db: f32,
}

async fn volume(State(s): State<SharedState>, Path(slot): Path<String>, Json(body): Json<VolumeBody>) -> Result<Json<Value>, AppError> {
    if !body.volume_db.is_finite() || !(-100.0..=10.0).contains(&body.volume_db) {
        return Err(AppError::BadRequest("volume must be between -100 and +10 dB".into()));
    }
    s.player.set_volume(slot_of(&slot)?, body.volume_db);
    Ok(Json(json!(s.player.view())))
}

/// Called by the background ticker when an item finished: applies the end action.
pub async fn on_item_ended(s: &SharedState, slot: Slot) -> Result<(), AppError> {
    let Some(state) = s.player.state(slot) else { return Ok(()) };
    let ffmpeg = s.ffmpeg().await;
    match state.end_action {
        EndAction::Stop => s.player.clear(slot),
        EndAction::RepeatOne => {
            s.player.seek(slot, 0, &ffmpeg);
        }
        EndAction::Next => {
            if !advance(s, slot, true, false).await.unwrap_or(false) {
                s.player.clear(slot);
            }
        }
        EndAction::LoopAll => {
            if !advance(s, slot, true, true).await.unwrap_or(false) {
                s.player.seek(slot, 0, &ffmpeg);
            }
        }
    }
    Ok(())
}
