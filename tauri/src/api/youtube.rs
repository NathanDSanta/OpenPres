use crate::{error::AppError, state::SharedState};
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/youtube", get(status))
        .route("/youtube/client", put(set_client))
        .route("/youtube/connect", post(connect))
        .route("/youtube/oauth/callback", get(callback))
        .route("/youtube/disconnect", post(disconnect))
        .route("/youtube/broadcast/refresh", post(refresh_broadcast))
        .route("/youtube/use-stream-key", post(use_stream_key))
        .route("/youtube/chat", get(chat).post(send_chat))
        .route("/youtube/chat/ban", post(ban))
        .route("/youtube/chat/:id", delete(delete_chat))
        .route("/youtube/embed", get(embed))
}

async fn status(State(s): State<SharedState>) -> Json<Value> {
    Json(s.youtube.status().await)
}

#[derive(Deserialize)]
struct ClientBody {
    client_id: String,
    client_secret: Option<String>,
}

async fn set_client(State(s): State<SharedState>, Json(body): Json<ClientBody>) -> Result<Json<Value>, AppError> {
    s.youtube.set_client(body.client_id, body.client_secret).await?;
    Ok(Json(s.youtube.status().await))
}

/// Starts the Google sign-in and opens it in the browser of this computer.
async fn connect(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    let port = s.config.read().await.api_port;
    let redirect = format!("http://127.0.0.1:{port}/api/youtube/oauth/callback");
    let url = s.youtube.auth_url(redirect).await?;
    let opened = crate::tools::open_url(&url).is_ok();
    Ok(Json(json!({ "url": url, "opened": opened })))
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn page(title: &str, message: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><meta charset=utf-8><title>OpenPres</title>\
         <body style=\"font-family:system-ui;background:#111116;color:#e4e4ec;display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><h2>{title}</h2><p>{message}</p></div></body>"
    ))
}

/// Google sends the browser here after the sign-in (public route, checked by `state`).
async fn callback(State(s): State<SharedState>, Query(q): Query<CallbackQuery>) -> Html<String> {
    if let Some(e) = q.error {
        return page("YouTube was not connected", &format!("Google answered: {e}. You can close this tab."));
    }
    let (Some(code), Some(state)) = (q.code, q.state) else {
        return page("YouTube was not connected", "The answer from Google was incomplete.");
    };
    match s.youtube.finish_auth(&code, &state).await {
        Ok(()) => {
            s.events.changed();
            page("YouTube is connected", "You can close this tab and go back to OpenPres.")
        }
        Err(e) => page("YouTube was not connected", &e.to_string()),
    }
}

async fn disconnect(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    s.youtube.disconnect().await?;
    Ok(Json(s.youtube.status().await))
}

async fn refresh_broadcast(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    s.youtube.refresh_broadcast().await?;
    Ok(Json(s.youtube.status().await))
}

/// Copies the stream key (and server) of the found broadcast into the stream settings.
async fn use_stream_key(State(s): State<SharedState>) -> Result<StatusCode, AppError> {
    let broadcast = match s.youtube.broadcast.lock().await.clone() {
        Some(b) => Some(b),
        None => s.youtube.refresh_broadcast().await?,
    };
    let Some(b) = broadcast else {
        return Err(AppError::NotFound("no live or scheduled broadcast on this channel".into()));
    };
    let key = b.stream_key.ok_or_else(|| AppError::NotFound("the broadcast has no stream bound to it yet".into()))?;
    let mut doc = s.stream.settings.lock().unwrap();
    let mut settings = doc.value.clone();
    settings.stream_key = key;
    if let Some(url) = b.ingestion_url {
        settings.rtmp_url = url;
    }
    settings.send_rtmp = true;
    doc.replace(settings)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ChatQuery {
    #[serde(default)]
    since: u64,
}

async fn chat(State(s): State<SharedState>, Query(q): Query<ChatQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(s.youtube.chat_since(q.since).await?))
}

#[derive(Deserialize)]
struct SendBody {
    text: String,
}

async fn send_chat(State(s): State<SharedState>, Json(body): Json<SendBody>) -> Result<StatusCode, AppError> {
    s.youtube.send_message(&body.text).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_chat(State(s): State<SharedState>, Path(id): Path<String>) -> Result<StatusCode, AppError> {
    s.youtube.delete_message(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct BanBody {
    channel_id: String,
    /// Seconds for a timeout; absent = ban.
    seconds: Option<u32>,
}

async fn ban(State(s): State<SharedState>, Json(body): Json<BanBody>) -> Result<StatusCode, AppError> {
    s.youtube.ban(&body.channel_id, body.seconds).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct EmbedQuery {
    v: String,
}

/// A small page that embeds the YouTube player. It is served from this local server so
/// YouTube gets a normal http origin/referrer (the app's own scheme is not accepted by
/// the embedded player), and it relays player commands (mute, volume) from the app.
async fn embed(State(s): State<SharedState>, Query(q): Query<EmbedQuery>) -> Response {
    let valid = (6..=20).contains(&q.v.len()) && q.v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return (StatusCode::BAD_REQUEST, "invalid video id").into_response();
    }
    let port = s.config.read().await.api_port;
    let origin = format!("http://127.0.0.1:{port}");
    let html = format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{{margin:0;height:100%;background:#000;overflow:hidden}}iframe{{border:0;width:100%;height:100%}}</style></head>
<body><iframe id="p" src="https://www.youtube.com/embed/{v}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0&origin={origin}"
allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
<script>
  // Commands from the app: {{func: "mute" | "unMute" | "setVolume", args: [...]}}
  window.addEventListener("message", function (e) {{
    var d = e.data;
    if (!d || typeof d.func !== "string") return;
    document.getElementById("p").contentWindow.postMessage(JSON.stringify({{event: "command", func: d.func, args: d.args || []}}), "https://www.youtube.com");
  }});
</script></body></html>"#,
        v = q.v,
        origin = origin
    );
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}
