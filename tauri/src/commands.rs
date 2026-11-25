//! The bridge between the React frontend and the backend API.
//!
//! `api_request` hands a request to the same Axum router that serves the HTTP API, in-process:
//! no socket, no port, no CORS. Every endpoint of the backend is therefore available to
//! the frontend with zero duplicated logic, and the HTTP server stays free for other tools.

use axum::{
    body::Body,
    http::{header, Method, Request},
    Router,
};
use serde::{Deserialize, Serialize};
use tower::ServiceExt; // for `oneshot`

/// The API router plus the internal key that lets in-process requests skip the password.
pub struct ApiRouter(pub Router, pub String);

#[derive(Deserialize)]
pub struct ApiRequest {
    method: String,
    /// Path including the query string, e.g. `/presenter/next?layer=announcements`
    path: String,
    body: Option<String>,
    content_type: Option<String>,
}

#[derive(Serialize)]
pub struct ApiResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn api_request(
    router: tauri::State<'_, ApiRouter>,
    req: ApiRequest,
) -> Result<ApiResponse, String> {
    let method =
        Method::from_bytes(req.method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;

    let path = format!("/api{}", req.path.as_str());

    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(openpres_lib::auth::INTERNAL_HEADER, router.1.as_str());
    if let Some(ct) = &req.content_type {
        builder = builder.header(header::CONTENT_TYPE, ct.as_str());
    }
    let body = match req.body {
        Some(b) => Body::from(b),
        None => Body::empty(),
    };
    let request = builder.body(body).map_err(|e| e.to_string())?;

    let response = router
        .0
        .clone()
        .oneshot(request)
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 32 * 1024 * 1024)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ApiResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[derive(Serialize)]
pub struct LocalServer {
    port: u16,
    key: String,
}

/// Where windows load media and camera frames from (the local HTTP server), and the key
/// that authorizes those requests.
#[tauri::command]
pub async fn local_server(
    state: tauri::State<'_, openpres_lib::state::SharedState>,
) -> Result<LocalServer, String> {
    Ok(LocalServer {
        port: state.config.read().await.api_port,
        key: state.auth.internal_key.clone(),
    })
}

// ---------- server setup window ----------

/// The setup window closes itself once the server is set up.
#[tauri::command]
pub fn close_setup(window: tauri::WebviewWindow) {
    let _ = window.destroy();
}

// ---------- logs ----------

#[derive(Deserialize)]
pub struct PageLine {
    level: String,
    message: String,
}

static PAGE_LIMIT: openpres_lib::logging::PageLimiter = openpres_lib::logging::PageLimiter::new(200);

/// A page's console lines, for the log file (the Manager's `src/lib/pageLog.ts`).
#[tauri::command]
pub fn page_log(webview: tauri::Webview, lines: Vec<PageLine>) {
    // Where the lines come from, without the query (it can hold a key).
    let page = webview
        .url()
        .map(|u| {
            let web = u.scheme().starts_with("http") && u.host_str().is_some_and(|h| h != "tauri.localhost");
            match (web, u.host_str(), u.port()) {
                (true, Some(host), Some(port)) => format!("{host}:{port}{}", u.path()),
                (true, Some(host), None) => format!("{host}{}", u.path()),
                _ => u.path().to_string(),
            }
        })
        .unwrap_or_default();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    for line in lines {
        if PAGE_LIMIT.allow(now) {
            openpres_lib::logging::page_line(webview.label(), &page, &line.level, &line.message);
        }
    }
}
