//! For viewers (the Android app, or /viewer in a browser): what they can watch and listen to,
//! and a bus's sound as it plays.

use crate::{
    audio::{graph::Node, BUSES, ENGINE_RATE},
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
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use uuid::Uuid;

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

#[derive(Deserialize, Default)]
struct ListenQuery {
    /// One channel (half the data): for weak Wi-Fi.
    #[serde(default)]
    mono: bool,
}

/// A bus's sound as it plays, after its fader: raw 16-bit PCM (little-endian, 48 kHz, stereo
/// or mono), sent every 50 ms for as long as the listener stays.
async fn listen(State(s): State<SharedState>, Path(n): Path<u8>, Query(q): Query<ListenQuery>) -> Result<Response, AppError> {
    if !(1..=BUSES).contains(&n) {
        return Err(AppError::NotFound(format!("bus {n}")));
    }
    let channels = if q.mono { 1 } else { 2 };
    let graph = s.audio.graph.clone();
    let sink = Node::new(Uuid::new_v4(), n, 1.0, false);
    graph.add_consumer(sink.clone());
    let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(40);
    std::thread::Builder::new()
        .name("bus-listener".into())
        .spawn(move || {
            let block_frames = (ENGINE_RATE / 100) as usize; // 10 ms
            let mut block = vec![0f32; block_frames * 2];
            let mut chunk: Vec<u8> = Vec::with_capacity(block_frames * 2 * channels * 5);
            let start = Instant::now();
            let mut index: u64 = 0;
            loop {
                let due = (start.elapsed().as_secs_f64() * 100.0) as u64;
                if index >= due {
                    if tx.is_closed() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(3));
                    continue;
                }
                // Fell behind (the listener didn't keep up): skip ahead rather than lag.
                if due - index > 50 {
                    index = due - 1;
                    chunk.clear();
                }
                sink.consume(&mut block);
                for frame in block.chunks_exact(2) {
                    let mut write = |v: f32| chunk.extend_from_slice(&((v.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
                    if channels == 1 {
                        write((frame[0] + frame[1]) * 0.5);
                    } else {
                        write(frame[0]);
                        write(frame[1]);
                    }
                }
                index += 1;
                // 50 ms per message.
                if index % 5 == 0 && tx.blocking_send(Bytes::from(std::mem::take(&mut chunk))).is_err() {
                    break;
                }
            }
            graph.remove(sink.id);
        })
        .map_err(|e| AppError::Internal(format!("could not start listening: {e}")))?;
    let stream = futures_util::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|b| (Ok::<_, std::io::Error>(b), rx)) });
    Ok((
        [
            (header::CONTENT_TYPE, format!("audio/L16; rate={ENGINE_RATE}; channels={channels}")),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}
