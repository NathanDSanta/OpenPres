//! Native fullscreen windows that show a virtual screen on a physical monitor.
//!
//! The screen ↔ display binding itself is persisted by `ScreenManager`; this module only
//! tracks the live native windows (one per physical display).
//!
//! Platform notes, which explain why this file looks the way it does:
//! - **Windows**: building a webview window inside a *synchronous* Tauri command deadlocks
//!   WebView2 (white window, frozen app). Every command that may create a window is therefore
//!   `async`, so it runs on Tauri's async runtime instead of the main thread.
//! - **Linux**: on Wayland a client cannot position its own windows, so `set_position` is
//!   ignored and plain fullscreen lands on whatever output the compositor picks. We ask GTK
//!   to fullscreen on a specific monitor instead, which works on both Wayland and X11.
//! - **Mixed DPI**: monitor geometry is reported in physical pixels. We position windows with
//!   physical units so nothing is converted with the wrong monitor's scale factor.

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager, Monitor, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use uuid::Uuid;

const LABEL_PREFIX: &str = "presentation-display-";

/// Stable id for a monitor. Also used by the display provider in `main.rs`, so the ids
/// stored in bindings always match the ones looked up here.
pub fn monitor_id(monitor: &Monitor) -> String {
    let name = monitor.name().map(String::as_str).unwrap_or("Unknown display");
    let pos = monitor.position();
    format!("{name}@{},{}", pos.x, pos.y)
}

#[derive(Debug, Clone, Deserialize)]
pub struct WindowAssignment {
    pub screen_id: String,
    pub display_id: String,
}

#[derive(Serialize)]
pub struct PresentationWindowVisibility {
    pub display_id: String,
    pub visible: bool,
}

#[derive(Clone)]
struct WindowInfo {
    screen_id: String,
    visible: bool,
}

/// Live presentation windows, keyed by physical display id.
#[derive(Default)]
pub struct PresentationWindowRegistry {
    windows: Mutex<HashMap<String, WindowInfo>>,
}

impl PresentationWindowRegistry {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, WindowInfo>> {
        // The map stays consistent even if a holder panicked, so recover instead of failing.
        self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn display_for_label(&self, label: &str) -> Option<String> {
        self.lock().keys().find(|display| window_label(display) == label).cloned()
    }

    fn set_visible(&self, display_id: &str, visible: bool) {
        if let Some(info) = self.lock().get_mut(display_id) {
            info.visible = visible;
        }
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Window labels only allow `a-zA-Z0-9-/:_`, so the display id is hex-encoded.
fn window_label(display_id: &str) -> String {
    let encoded: String = display_id.bytes().map(|byte| format!("{byte:02x}")).collect();
    format!("{LABEL_PREFIX}{encoded}")
}

/// Returns the monitor and its index in `available_monitors()`. On Linux that index is
/// the GDK monitor number, which GTK needs for `fullscreen_on_monitor`.
fn find_monitor(app: &AppHandle, display_id: &str) -> Result<(usize, Monitor), String> {
    app.available_monitors()
        .map_err(err)?
        .into_iter()
        .enumerate()
        .find(|(_, monitor)| monitor_id(monitor) == display_id)
        .ok_or_else(|| format!("Display is no longer connected: {display_id}"))
}

fn presentation_path(screen_id: &str) -> Result<String, String> {
    // Validating keeps arbitrary strings out of the window URL.
    let id = Uuid::parse_str(screen_id).map_err(|_| format!("Invalid screen id: {screen_id}"))?;
    Ok(format!("presentation/{id}"))
}

/// Makes `window` fullscreen on `monitor`.
#[cfg(target_os = "linux")]
fn place_on_monitor(window: &WebviewWindow, index: usize, _monitor: &Monitor) -> Result<(), String> {
    let target = window.clone();
    let index = i32::try_from(index).map_err(err)?;
    // GTK objects may only be touched on the main thread.
    window
        .run_on_main_thread(move || {
            use gtk::prelude::*;
            match target.gtk_window() {
                Ok(gtk_window) => {
                    let screen = GtkWindowExt::screen(&gtk_window).or_else(gtk::gdk::Screen::default);
                    match screen {
                        Some(screen) => gtk_window.fullscreen_on_monitor(&screen, index),
                        None => tracing::warn!("no GDK screen; cannot fullscreen presentation window"),
                    }
                }
                Err(e) => tracing::warn!("could not access GTK window: {e}"),
            }
        })
        .map_err(err)
}

/// Makes `window` fullscreen on `monitor`.
#[cfg(not(target_os = "linux"))]
fn place_on_monitor(window: &WebviewWindow, _index: usize, monitor: &Monitor) -> Result<(), String> {
    // Borderless fullscreen uses the monitor the window is on, and the window can't be moved
    // while fullscreen, so: leave fullscreen, move (physical units), then fullscreen again.
    window.set_fullscreen(false).map_err(err)?;
    window.set_position(*monitor.position()).map_err(err)?;
    window.set_size(*monitor.size()).map_err(err)?;
    window.set_fullscreen(true).map_err(err)
}

fn is_already_placed(window: &WebviewWindow, display_id: &str) -> bool {
    window.is_visible().unwrap_or(false)
        && window.is_fullscreen().unwrap_or(false)
        && window
            .current_monitor()
            .ok()
            .flatten()
            .is_some_and(|monitor| monitor_id(&monitor) == display_id)
}

fn build_window(app: &AppHandle, label: &str, screen_id: &str) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(presentation_path(screen_id)?.into()))
        .title("OpenPres Presentation")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        // Like ProPresenter's output windows: not listed in the taskbar/dock.
        .skip_taskbar(true)
        // Created hidden and shown once it is on the right monitor, so it never flashes elsewhere.
        .visible(false)
        .build()
        .map_err(err)?;

    // Alt+F4 / window-manager close hides the window instead of destroying it, like Escape.
    // Our own teardown uses `destroy()`, which does not emit CloseRequested.
    let app = app.clone();
    let label = label.to_string();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.hide();
            }
            let registry = app.state::<PresentationWindowRegistry>();
            if let Some(display) = registry.display_for_label(&label) {
                registry.set_visible(&display, false);
            }
        }
    });
    Ok(window)
}

fn destroy_window(app: &AppHandle, registry: &PresentationWindowRegistry, display_id: &str) {
    if let Some(window) = app.get_webview_window(&window_label(display_id)) {
        let _ = window.destroy();
    }
    registry.lock().remove(display_id);
}

/// Creates or reuses the window for `assignment.display_id` and shows the requested screen.
/// With `keep_visibility`, a window the user hid stays hidden.
fn ensure_window(
    app: &AppHandle,
    registry: &PresentationWindowRegistry,
    assignment: &WindowAssignment,
    keep_visibility: bool,
) -> Result<(), String> {
    let (index, monitor) = find_monitor(app, &assignment.display_id)?;
    let label = window_label(&assignment.display_id);

    // A virtual screen is shown on one display at a time: drop its window anywhere else.
    let moved_from: Vec<String> = registry
        .lock()
        .iter()
        .filter(|(display, info)| info.screen_id == assignment.screen_id && **display != assignment.display_id)
        .map(|(display, _)| display.clone())
        .collect();
    for display in moved_from {
        destroy_window(app, registry, &display);
    }

    let previous = registry.lock().get(&assignment.display_id).cloned();
    let visible = !keep_visibility || previous.as_ref().map_or(true, |info| info.visible);

    let window = match app.get_webview_window(&label) {
        Some(window) => {
            let same_screen = previous.as_ref().is_some_and(|info| info.screen_id == assignment.screen_id);
            if !same_screen {
                let url = window.url().map_err(err)?.join(&format!("/{}", presentation_path(&assignment.screen_id)?)).map_err(err)?;
                window.navigate(url).map_err(err)?;
            }
            window
        }
        None => build_window(app, &label, &assignment.screen_id)?,
    };

    if visible {
        // Skip the fullscreen round-trip (and its flicker) when nothing needs to move.
        if !is_already_placed(&window, &assignment.display_id) {
            place_on_monitor(&window, index, &monitor)?;
        }
        window.show().map_err(err)?;
    } else {
        window.hide().map_err(err)?;
    }

    registry.lock().insert(
        assignment.display_id.clone(),
        WindowInfo { screen_id: assignment.screen_id.clone(), visible },
    );
    Ok(())
}

/// Closes windows whose display is no longer assigned, then (re)aligns all assigned ones.
/// Keeps going after a failure so one unplugged monitor doesn't block the others.
pub fn sync_windows(
    app: &AppHandle,
    registry: &PresentationWindowRegistry,
    assignments: &[WindowAssignment],
) -> Result<(), String> {
    let active: HashSet<&str> = assignments.iter().map(|a| a.display_id.as_str()).collect();
    let stale: Vec<String> = registry
        .lock()
        .keys()
        .filter(|display| !active.contains(display.as_str()))
        .cloned()
        .collect();
    for display in stale {
        destroy_window(app, registry, &display);
    }

    let errors: Vec<String> = assignments
        .iter()
        .filter_map(|assignment| ensure_window(app, registry, assignment, true).err())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

// ---------- commands ----------
// `assign` and `refresh` may create windows, so they MUST stay async (see the Windows note above).

#[tauri::command]
pub async fn assign_presentation_window(
    app: AppHandle,
    registry: State<'_, PresentationWindowRegistry>,
    screen_id: String,
    display_id: String,
) -> Result<(), String> {
    ensure_window(&app, &registry, &WindowAssignment { screen_id, display_id }, false)
}

#[tauri::command]
pub async fn refresh_presentation_windows(
    app: AppHandle,
    registry: State<'_, PresentationWindowRegistry>,
    assignments: Vec<WindowAssignment>,
) -> Result<(), String> {
    sync_windows(&app, &registry, &assignments)
}

#[tauri::command]
pub async fn set_presentation_window_visible(
    app: AppHandle,
    registry: State<'_, PresentationWindowRegistry>,
    display_id: String,
    visible: bool,
) -> Result<(), String> {
    let screen_id = registry.lock().get(&display_id).map(|info| info.screen_id.clone());
    match screen_id {
        // Showing goes through `ensure_window`, so the window is re-placed in case the
        // monitor layout changed (or GTK forgot the fullscreen monitor) while it was hidden.
        Some(screen_id) if visible => {
            ensure_window(&app, &registry, &WindowAssignment { screen_id, display_id }, false)
        }
        _ => {
            if let Some(window) = app.get_webview_window(&window_label(&display_id)) {
                window.hide().map_err(err)?;
            }
            registry.set_visible(&display_id, false);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn get_presentation_window_visibility(
    registry: State<'_, PresentationWindowRegistry>,
) -> Vec<PresentationWindowVisibility> {
    registry
        .lock()
        .iter()
        .map(|(display_id, info)| PresentationWindowVisibility {
            display_id: display_id.clone(),
            visible: info.visible,
        })
        .collect()
}

/// Called by the presentation page itself (Escape key).
#[tauri::command]
pub fn hide_current_presentation_window(
    window: WebviewWindow,
    registry: State<'_, PresentationWindowRegistry>,
) -> Result<(), String> {
    window.hide().map_err(err)?;
    if let Some(display) = registry.display_for_label(window.label()) {
        registry.set_visible(&display, false);
    }
    Ok(())
}
