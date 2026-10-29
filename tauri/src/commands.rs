//! The ONE Tauri command the React frontend uses.
//!
//! It hands a request to the same Axum router that serves the HTTP API, in-process:
//! no socket, no port, no CORS. Every endpoint of the backend is therefore available to
//! the frontend with zero duplicated logic, and the HTTP server stays free for other tools.

use axum::{
    body::Body,
    http::{header, Method, Request},
    Router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tower::ServiceExt; // for `oneshot`

/// The API router, kept in Tauri's managed state.
pub struct ApiRouter(pub Router);

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

    let mut builder = Request::builder().method(method).uri(req.path.as_str());
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

#[tauri::command]
pub fn open_presentation_window(
    app: AppHandle,
    screen_id: String,
    display_id: String,
) -> Result<(), String> {
    let label = format!("presentation-{screen_id}");

    // Already open? Focus it.
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Find the monitor whose namespaced ID matches the backend's format.
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| {
            let name = m
                .name()
                .cloned()
                .unwrap_or_else(|| "Unknown display".into());
            let pos = m.position();
            format!("{}@{},{}", name, pos.x, pos.y) == display_id
        })
        .ok_or_else(|| format!("display not found: {display_id}"))?;

    let pos = monitor.position();
    let size = monitor.size();

    // Build WITHOUT fullscreen — position then size gives us an exact
    // borderless cover of the target monitor (the reliable approach on
    // multi-monitor). Fullscreen is applied in step 3 of the frontend below.
    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("presentation/{screen_id}").into()),
    )
    .title("OpenPres Presentation")
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .position(pos.x as f64, pos.y as f64)
    .inner_size(size.width as f64, size.height as f64)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Best-effort real fullscreen on the target monitor. If the WM
    // ignores it, the window is already positioned+size-matched, so the
    // user still sees a full-monitor surface.
    if let Err(e) = window.set_fullscreen(true) {
        tracing::warn!("set_fullscreen failed (window still positioned): {e}");
    }

    Ok(())
}

#[tauri::command]
pub fn close_presentation_window(app: AppHandle, screen_id: String) -> Result<(), String> {
    let label = format!("presentation-{screen_id}");
    if let Some(w) = app.get_webview_window(&label) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
