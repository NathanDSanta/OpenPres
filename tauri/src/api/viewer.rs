//! For viewers (the Android app, or /viewer in a browser): what they can watch and listen to,
//! and a bus's sound as it plays.

use crate::{
    audio::{listen::Format, ENGINE_RATE},
    error::AppError,
    state::SharedState,
};
use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::future::Future;
use tokio::sync::broadcast::{self, error::RecvError};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/viewer", get(viewer))
        .route("/audio/buses/:n/listen", get(listen))
}

/// The buses a viewer can listen to, by name (the screens come from /screens).
async fn viewer(State(s): State<SharedState>) -> Json<Value> {
    let config = s.audio_config.read().await;
    let buses: Vec<Value> = config
        .buses
        .iter()
        .enumerate()
        .map(|(i, b)| json!({ "n": i + 1, "name": b.name }))
        .collect();
    Json(json!({ "buses": buses, "rate": ENGINE_RATE }))
}

/// How a listener wants the sound.
#[derive(Deserialize)]
pub struct ListenQuery {
    /// One channel (half the data): for weak Wi-Fi.
    #[serde(default, deserialize_with = "flag")]
    pub mono: bool,
    /// 48000, 24000 or 16000 (speech on busy Wi-Fi).
    #[serde(default = "full_rate")]
    pub rate: u32,
}

fn full_rate() -> u32 {
    ENGINE_RATE
}

/// `1`, `true`, `0` or `false`.
pub(crate) fn flag<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    match String::deserialize(d)?.as_str() {
        "1" | "true" => Ok(true),
        "0" | "false" | "" => Ok(false),
        other => Err(serde::de::Error::custom(format!("expected 1 or 0, not {other}"))),
    }
}

/// A bus's sound as it plays, after its fader: raw 16-bit PCM (little-endian), in chunks of
/// 50 ms for as long as the listener stays. Everyone on the same bus and format shares one feed
/// (audio::listen).
async fn listen(State(s): State<SharedState>, Path(n): Path<u8>, Query(q): Query<ListenQuery>) -> Result<Response, AppError> {
    let format = Format::new(q.rate, q.mono)?;
    let rx = s.audio.feeds.listen(n, format)?;
    Ok(sound(rx, format))
}

/// Sends a feed's chunks as they come. A listener whose network can't keep up misses chunks
/// rather than falling behind.
pub fn sound(rx: broadcast::Receiver<Bytes>, format: Format) -> Response {
    sound_until(rx, format, std::future::pending())
}

/// Like `sound`, but the listener is cut off when `stop` finishes.
pub fn sound_until<F>(rx: broadcast::Receiver<Bytes>, format: Format, stop: F) -> Response
where
    F: Future<Output = ()> + Send + 'static,
{
    let stream = futures_util::stream::unfold((rx, Box::pin(stop)), |(mut rx, mut stop)| async move {
        loop {
            tokio::select! {
                _ = &mut stop => return None,
                received = rx.recv() => match received {
                    Ok(chunk) => return Some((Ok::<_, std::io::Error>(chunk), (rx, stop))),
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => return None,
                },
            }
        }
    });
    (
        [(header::CONTENT_TYPE, format.content_type()), (header::CACHE_CONTROL, "no-store".to_string())],
        Body::from_stream(stream),
    )
        .into_response()
}
