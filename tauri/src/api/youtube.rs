//! The stream's preview as viewers see it on YouTube: a link to the broadcast (a video,
//! a live link or a channel's /live page), played in YouTube's own embedded player. No
//! YouTube account or API: the page is read like any viewer's browser would.
use crate::{error::AppError, state::SharedState};
use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new().route("/youtube/video", get(video)).route("/youtube/embed", get(embed))
}

#[derive(Deserialize)]
struct VideoQuery {
    url: String,
}

/// The video a YouTube link points to (for a channel's /live page: what it's broadcasting now).
async fn video(Query(q): Query<VideoQuery>) -> Result<Json<Value>, AppError> {
    let link = q.url.trim();
    if let Some(id) = video_id_in_link(link) {
        return Ok(Json(json!({ "video_id": id })));
    }
    let url = youtube_page(link).ok_or_else(|| AppError::BadRequest("that isn't a YouTube link".into()))?;
    let page = fetch(&url).await?;
    match video_id_in_page(&page) {
        Some(id) => Ok(Json(json!({ "video_id": id }))),
        None => Err(AppError::BadRequest("YouTube shows nothing live on that page right now".into())),
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The id in a video link: watch?v=, youtu.be/, /live/, /embed/, /shorts/ or the bare id.
fn video_id_in_link(link: &str) -> Option<String> {
    if valid_id(link) {
        return Some(link.to_string());
    }
    let rest = link.split_once("://").map(|(_, r)| r).unwrap_or(link);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    let take = |s: &str| {
        let id: String = s.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        valid_id(&id).then_some(id)
    };
    if host == "youtu.be" || host.ends_with(".youtu.be") {
        return take(path);
    }
    if !is_youtube_host(&host) {
        return None;
    }
    if let Some(query) = path.split_once('?').map(|(_, q)| q) {
        if let Some(v) = query.split('&').find_map(|p| p.strip_prefix("v=")) {
            return take(v);
        }
    }
    let path = path.split(['?', '#']).next().unwrap_or("");
    for prefix in ["live/", "embed/", "shorts/"] {
        if let Some(id) = path.strip_prefix(prefix) {
            return take(id);
        }
    }
    None
}

fn is_youtube_host(host: &str) -> bool {
    host == "youtube.com" || host.ends_with(".youtube.com")
}

/// A youtube.com page to read (channel, @handle, /live…); nothing else is fetched.
fn youtube_page(link: &str) -> Option<String> {
    let rest = link.split_once("://").map(|(_, r)| r).unwrap_or(link);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    if !is_youtube_host(&host) || host.contains(['@', ':']) {
        return None;
    }
    Some(format!("https://www.youtube.com/{path}"))
}

async fn fetch(url: &str) -> Result<String, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let response = client
        .get(url)
        // Without it, YouTube answers from the EU with its cookie consent page.
        .header(header::COOKIE, "SOCS=CAI; CONSENT=YES+1")
        .header(header::ACCEPT_LANGUAGE, "en")
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("YouTube can't be reached: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest(format!("YouTube answered {}", response.status())));
    }
    response.text().await.map_err(|e| AppError::BadRequest(e.to_string()))
}

/// The page's own video: its canonical address (a channel's /live page has the broadcast's).
fn video_id_in_page(page: &str) -> Option<String> {
    let canonical = page.split("<link rel=\"canonical\" href=\"").nth(1)?;
    let canonical = canonical.split('"').next()?;
    video_id_in_link(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        for link in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=3",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://www.youtube.com/live/dQw4w9WgXcQ?si=abc",
            "youtube.com/embed/dQw4w9WgXcQ",
            "https://m.youtube.com/shorts/dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
        ] {
            assert_eq!(video_id_in_link(link).as_deref(), Some("dQw4w9WgXcQ"), "{link}");
        }
        assert_eq!(video_id_in_link("https://www.youtube.com/@church/live"), None);
        assert_eq!(video_id_in_link("https://evil.com/watch?v=dQw4w9WgXcQ"), None);
        assert_eq!(youtube_page("https://www.youtube.com/@church/live").as_deref(), Some("https://www.youtube.com/@church/live"));
        assert_eq!(youtube_page("https://evil.com/@church/live"), None);
        assert_eq!(youtube_page("https://youtube.com@evil.com/x"), None);
    }

    #[test]
    fn page() {
        let live = r#"<html><link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><body>"#;
        assert_eq!(video_id_in_page(live).as_deref(), Some("dQw4w9WgXcQ"));
        let offline = r#"<link rel="canonical" href="https://www.youtube.com/channel/UCabc">"#;
        assert_eq!(video_id_in_page(offline), None);
    }
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
