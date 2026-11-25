//! Translation tracks (translation.rs): the settings, for the manager; and for phones (the
//! Translation app, no login) the tracks and their sound while they're on.

use crate::{
    api::viewer::{flag, sound_until},
    audio::listen::Format,
    error::AppError,
    state::SharedState,
    translation::{language, TranslationSettings, LANGUAGES},
};
use axum::{
    extract::{Path, Query, State},
    response::Response,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/translation", get(get_translation).put(put_translation))
        .route("/translation/tracks", get(tracks))
        .route("/translation/tracks/:language/listen", get(listen))
}

/// The settings, with what each track does now: whether phones hear it (and if not, why),
/// and how many are listening.
async fn status(s: &SharedState, settings: &TranslationSettings) -> Value {
    let reachable = s.config.read().await.remote_access;
    let tracks: Vec<Value> = settings
        .tracks
        .iter()
        .map(|t| {
            let sound = t.sound();
            let mut v = json!(t);
            v["live"] = json!(sound.is_ok());
            v["problem"] = json!(if t.on { sound.as_ref().err() } else { None });
            v["listeners"] = json!(sound.as_ref().map(|bus| s.audio.feeds.listeners(*bus)).unwrap_or(0));
            v["captions"] = json!(t.captions());
            v
        })
        .collect();
    // Phones reach the server only with remote access on (it listens on localhost otherwise).
    json!({ "languages": LANGUAGES, "tracks": tracks, "reachable": reachable })
}

async fn get_translation(State(s): State<SharedState>) -> Json<Value> {
    let settings = s.translation.settings().await;
    Json(status(&s, &settings).await)
}

async fn put_translation(State(s): State<SharedState>, Json(body): Json<TranslationSettings>) -> Result<Json<Value>, AppError> {
    let settings = s.translation.replace(body).await?;
    Ok(Json(status(&s, &settings).await))
}

/// For phones: every track, and whether it can be heard now.
async fn tracks(State(s): State<SharedState>) -> Json<Value> {
    let settings = s.translation.settings().await;
    let tracks: Vec<Value> = settings
        .tracks
        .iter()
        .filter_map(|t| {
            let lang = language(&t.language)?;
            Some(json!({ "language": lang.code, "name": lang.name, "live": t.sound().is_ok(), "captions": t.captions() }))
        })
        .collect();
    Json(json!({ "tracks": tracks }))
}

#[derive(Deserialize)]
struct ListenQuery {
    /// Speech: 24 kHz mono unless asked otherwise.
    #[serde(default = "speech_rate")]
    rate: u32,
    #[serde(default = "yes", deserialize_with = "flag")]
    mono: bool,
}

fn speech_rate() -> u32 {
    24_000
}
fn yes() -> bool {
    true
}

/// A track's sound while it's on (see viewer::listen for the format). A phone is cut off when
/// the track goes off or moves to another bus; it reconnects and finds out.
async fn listen(State(s): State<SharedState>, Path(code): Path<String>, Query(q): Query<ListenQuery>) -> Result<Response, AppError> {
    let lang = language(&code).ok_or_else(|| AppError::NotFound(format!("no {code} translation")))?;
    let settings = s.translation.settings().await;
    let bus = settings
        .track(lang.code)
        .ok_or_else(|| AppError::NotFound(format!("no {} translation", lang.english)))?
        .sound()
        .map_err(|why| AppError::Conflict(format!("{} translation: {why}", lang.english)))?;
    let format = Format::new(q.rate, q.mono)?;
    let rx = s.audio.feeds.listen(bus, format)?;
    let mut changes = s.translation.watch();
    let stop = async move {
        while changes.changed().await.is_ok() {
            let same = changes.borrow().track(lang.code).map(|t| t.sound() == Ok(bus)).unwrap_or(false);
            if !same {
                return;
            }
        }
    };
    Ok(sound_until(rx, format, stop))
}
