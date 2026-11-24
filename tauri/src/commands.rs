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

// ---------- manager ----------

/// Servers found on the network (mDNS).
pub struct Discovery(pub openpres_lib::server::discovery::Browser);

#[tauri::command]
pub fn discovered_servers(discovery: tauri::State<'_, Discovery>) -> Vec<openpres_lib::server::discovery::FoundServer> {
    discovery.0.list()
}

#[derive(Serialize)]
pub struct LocalStatus {
    /// A server runs on this computer.
    running: bool,
    port: u16,
    /// What it says about itself (`/api/server`), when it runs.
    info: Option<serde_json::Value>,
    /// This computer's name.
    host: String,
    /// This computer has been a server before (or used an OpenPres from before servers):
    /// the manager starts it by itself.
    has_data: bool,
    /// Used as a server (chosen when OpenPres first opened); None: not chosen yet.
    choice: Option<bool>,
    /// Its server has passwords (set up).
    set_up: bool,
}

/// Is a server running on this computer? (Asked straight, so it's found even when it
/// doesn't accept other devices and isn't announced.)
#[tauri::command]
pub async fn local_server_status() -> LocalStatus {
    let (port, has_data) = openpres_lib::config::AppConfig::peek_local();
    let info = async {
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(800))
            .build()
            .ok()?
            .get(format!("http://127.0.0.1:{port}/api/server"))
            .send()
            .await
            .ok()?;
        response.json::<serde_json::Value>().await.ok()
    }
    .await;
    LocalStatus {
        running: info.is_some(),
        port,
        info,
        host: openpres_lib::config::host_name(),
        has_data,
        choice: openpres_lib::server::this_computer_is_server(),
        set_up: openpres_lib::config::AppConfig::peek_set_up(),
    }
}

/// Uses this computer as a server, or not. Not: its server stops (if it runs) and no
/// longer starts with the computer; its songs and settings stay for later.
#[tauri::command]
pub async fn set_this_computer(server: bool) -> Result<(), String> {
    tracing::info!("this computer {} a server", if server { "is" } else { "isn't" });
    openpres_lib::server::set_this_computer_is_server(server).map_err(|e| e.to_string())?;
    if !server {
        if openpres_lib::server::starts_with_computer() {
            if let Err(e) = openpres_lib::server::set_starts_with_computer(false) {
                tracing::warn!("{e}");
            }
        }
        let (port, _) = openpres_lib::config::AppConfig::peek_local();
        let _ = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?
            .post(format!("http://127.0.0.1:{port}/api/server/quit"))
            .send()
            .await;
    }
    Ok(())
}

/// Starts the server on this computer, in the background.
#[tauri::command]
pub fn start_local_server() -> Result<(), String> {
    tracing::info!("starting the server on this computer");
    let exe = std::env::var("APPIMAGE")
        .map(std::path::PathBuf::from)
        .or_else(|_| std::env::current_exe())
        .map_err(|e| e.to_string())?;
    std::process::Command::new(exe).arg("--server").spawn().map(|_| ()).map_err(|e| {
        tracing::error!("could not start the server: {e}");
        e.to_string()
    })
}

// ---------- both ----------

#[derive(Deserialize)]
pub struct PageLine {
    level: String,
    message: String,
}

static PAGE_LIMIT: openpres_lib::logging::PageLimiter = openpres_lib::logging::PageLimiter::new(200);

/// A page's console lines, for the log file (see `src/lib/pageLog.ts`). Also allowed for the
/// server's interface opened in the manager window (capabilities/manager-pages.json).
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
