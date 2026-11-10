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
use std::{collections::{HashMap, HashSet}, sync::Mutex};
use tauri::{LogicalPosition, LogicalSize, State};
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

    let path = format!("/api{}", req.path.as_str());

    let mut builder = Request::builder().method(method).uri(path);
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


/// Tracks one presentation webview per physical display. The screen binding itself
/// remains persisted by ScreenManager; this registry only tracks live native windows.
#[derive(Default)]
pub struct PresentationWindowRegistry {
    windows: Mutex<HashMap<String, PresentationWindowInfo>>,
}

#[derive(Clone)]
struct PresentationWindowInfo {
    screen_id: String,
    visible: bool,
}

#[derive(Serialize)]
pub struct PresentationWindowVisibility {
    pub display_id: String,
    pub visible: bool,
}

#[derive(Debug, Deserialize)]
pub struct WindowAssignment {
    pub screen_id: String,
    pub display_id: String,
}

fn window_label(display_id: &str) -> String {
    let encoded = display_id
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("presentation-display-{encoded}")
}

fn find_monitor(
    app: &AppHandle,
    display_id: &str,
) -> Result<tauri::Monitor, String> {
    app.available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|monitor| {
            let name = monitor
                .name()
                .cloned()
                .unwrap_or_else(|| "Unknown display".into());
            let pos = monitor.position();
            format!("{}@{},{}", name, pos.x, pos.y) == display_id
        })
        .ok_or_else(|| format!("Display is no longer connected: {display_id}"))
}

fn position_window(
    window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
) -> Result<(), String> {
    // Leave fullscreen before changing geometry; some window managers otherwise
    // ignore the position and size updates.
    let _ = window.set_fullscreen(false);
    // Monitor geometry is reported in physical pixels. Tauri's logical
    // window geometry must be divided by the monitor scale factor (e.g. 2.0
    // for a 4K display configured at 200% scaling in niri).
    let scale_factor = monitor.scale_factor();
    let physical_pos = *monitor.position();
    let physical_size = *monitor.size();
    let logical_pos = physical_pos.to_logical::<f64>(scale_factor);
    let logical_size = physical_size.to_logical::<f64>(scale_factor);

    window
        .set_position(LogicalPosition::new(logical_pos.x, logical_pos.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(logical_size.width, logical_size.height))
        .map_err(|e| e.to_string())?;
    window
        .set_fullscreen(true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_presentation_window(
    app: &AppHandle,
    registry: &PresentationWindowRegistry,
    assignment: &WindowAssignment,
    preserve_visibility: bool,
) -> Result<(), String> {
    let monitor = find_monitor(app, &assignment.display_id)?;
    let label = window_label(&assignment.display_id);

    // A virtual screen can only be bound to one display. If it moved, close its
    // old native window before attaching it to the new display.
    let old_display = {
        let windows = registry.windows.lock().map_err(|e| e.to_string())?;
        windows
            .iter()
            .find(|(display, info)| {
                info.screen_id == assignment.screen_id && *display != &assignment.display_id
            })
            .map(|(display, _)| display.clone())
    };
    if let Some(old_display) = old_display {
        if let Some(old_window) = app.get_webview_window(&window_label(&old_display)) {
            let _ = old_window.close();
        }
        registry
            .windows
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&old_display);
    }

    let previous = registry
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .get(&assignment.display_id)
        .cloned();

    let visible = if preserve_visibility {
        previous.as_ref().map(|state| state.visible).unwrap_or(true)
    } else {
        true
    };

    if let Some(window) = app.get_webview_window(&label) {
        // Reuse the existing monitor window and attach the requested virtual screen.
        window
            .eval(&format!(
                "window.location.replace('/presentation/{}')",
                assignment.screen_id
            ))
            .map_err(|e| e.to_string())?;
        position_window(&window, &monitor)?;
        if visible {
            window.show().map_err(|e| e.to_string())?;
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
    } else {
        // Builder geometry is logical, while Monitor geometry is physical.
        let scale_factor = monitor.scale_factor();
        let logical_pos = monitor.position().to_logical::<f64>(scale_factor);
        let logical_size = monitor.size().to_logical::<f64>(scale_factor);
        let window = WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::App(format!("presentation/{}", assignment.screen_id).into()),
        )
        .title("OpenPres Presentation")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .position(logical_pos.x, logical_pos.y)
        .inner_size(logical_size.width, logical_size.height)
        .focused(false)
        .visible(visible)
        .build()
        .map_err(|e| e.to_string())?;

        if let Err(error) = window.set_fullscreen(true) {
            tracing::warn!("Could not fullscreen presentation window: {error}");
        }
    }

    registry
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            assignment.display_id.clone(),
            PresentationWindowInfo {
                screen_id: assignment.screen_id.clone(),
                visible,
            },
        );

    Ok(())
}

#[tauri::command]
pub fn assign_presentation_window(
    app: AppHandle,
    registry: State<'_, PresentationWindowRegistry>,
    screen_id: String,
    display_id: String,
) -> Result<(), String> {
    ensure_presentation_window(
        &app,
        registry.inner(),
        &WindowAssignment {
            screen_id,
            display_id,
        },
        false,
    )
}

#[tauri::command]
pub fn set_presentation_window_visible(
    app: AppHandle,
    registry: State<'_, PresentationWindowRegistry>,
    display_id: String,
    visible: bool,
) -> Result<(), String> {
    let label = window_label(&display_id);
    if let Some(window) = app.get_webview_window(&label) {
        if visible {
            window.show().map_err(|e| e.to_string())?;
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
    }

    if let Some(info) = registry
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .get_mut(&display_id)
    {
        info.visible = visible;
    }
    Ok(())
}

#[tauri::command]
pub fn get_presentation_window_visibility(
    registry: State<'_, PresentationWindowRegistry>,
) -> Result<Vec<PresentationWindowVisibility>, String> {
    Ok(registry
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|(display_id, info)| PresentationWindowVisibility {
            display_id: display_id.clone(),
            visible: info.visible,
        })
        .collect())
}

#[tauri::command]
pub fn hide_current_presentation_window(
    window: tauri::WebviewWindow,
    registry: State<'_, PresentationWindowRegistry>,
) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    let label = window.label().to_string();
    let mut windows = registry.windows.lock().map_err(|e| e.to_string())?;
    for (display_id, info) in windows.iter_mut() {
        if window_label(display_id) == label {
            info.visible = false;
            break;
        }
    }
    Ok(())
}

/// Re-detect/re-align every currently bound window. Hidden windows remain hidden.
/// Reopens the windows for persisted screen bindings after application startup.
pub fn restore_presentation_windows(
    app: &AppHandle,
    registry: &PresentationWindowRegistry,
    assignments: Vec<WindowAssignment>,
) -> Result<(), String> {
    for assignment in assignments {
        ensure_presentation_window(app, registry, &assignment, true)?;
    }
    Ok(())
}

#[tauri::command]
pub fn refresh_presentation_windows(
    app: AppHandle,
    registry: State<'_, PresentationWindowRegistry>,
    assignments: Vec<WindowAssignment>,
) -> Result<(), String> {
    let active: HashSet<String> = assignments
        .iter()
        .map(|assignment| assignment.display_id.clone())
        .collect();

    let stale: Vec<String> = registry
        .windows
        .lock()
        .map_err(|e| e.to_string())?
        .keys()
        .filter(|display| !active.contains(*display))
        .cloned()
        .collect();

    for display_id in stale {
        if let Some(window) = app.get_webview_window(&window_label(&display_id)) {
            let _ = window.close();
        }
        registry
            .windows
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&display_id);
    }

    for assignment in assignments {
        ensure_presentation_window(&app, registry.inner(), &assignment, true)?;
    }
    Ok(())
}
