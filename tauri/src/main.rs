#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod presentation_windows;

use openpres_lib::{
    api, build_app,
    config::AppConfig,
    devices::{audio::CpalProvider, mock::demo_registry, video::NokhwaProvider, DeviceRegistry},
    error::AppError,
    screens::{
        detect_displays,
        physical::{DisplayProvider, PhysicalDisplay},
    },
    state::SharedState,
};
use presentation_windows::{PresentationWindowRegistry, WindowAssignment};
use tauri::Manager;

/// Reads the connected monitors from Tauri.
struct TauriDisplays {
    handle: tauri::AppHandle,
}

impl DisplayProvider for TauriDisplays {
    fn list(&self) -> Result<Vec<PhysicalDisplay>, AppError> {
        let monitors = self
            .handle
            .available_monitors()
            .map_err(|e| AppError::Device(e.to_string()))?;
        Ok(monitors
            .iter()
            .map(|m| {
                let pos = m.position();
                let size = m.size();
                PhysicalDisplay {
                    id: presentation_windows::monitor_id(m),
                    name: m.name().cloned().unwrap_or_else(|| "Unknown display".to_string()),
                    width: size.width,
                    height: size.height,
                    position: (pos.x, pos.y),
                }
            })
            .collect())
    }
}

/// Reopens the windows for persisted screen bindings whose monitor is connected.
async fn restore_presentation_windows(app: &tauri::AppHandle, state: &SharedState) {
    if let Err(e) = detect_displays(state).await {
        tracing::warn!("display detection failed: {e}");
        return;
    }
    let assignments: Vec<WindowAssignment> = {
        let manager = state.screens.read().await;
        manager
            .bindings
            .iter()
            .filter(|binding| manager.displays.iter().any(|d| d.id == binding.physical_display))
            .map(|binding| WindowAssignment {
                screen_id: binding.virtual_screen.to_string(),
                display_id: binding.physical_display.clone(),
            })
            .collect()
    };
    let registry = app.state::<PresentationWindowRegistry>();
    if let Err(error) = presentation_windows::sync_windows(app, &registry, &assignments) {
        tracing::warn!("could not restore presentation windows: {error}");
    }
}

fn main() {
    tracing_subscriber::fmt::init();

    let config = AppConfig::load().expect("failed to load config");
    let port = config.api_port;

    tauri::Builder::default()
        .manage(PresentationWindowRegistry::default())
        .setup(move |app| {
            let devices = if std::env::var_os("OPENPRES_MOCK_DEVICES").is_some() {
                demo_registry()
            } else {
                DeviceRegistry::new(vec![Box::new(NokhwaProvider)], vec![Box::new(CpalProvider)])
            };
            let displays = TauriDisplays {
                handle: app.handle().clone(),
            };
            let frontend_dir = app
                .path()
                .resolve("frontend", tauri::path::BaseDirectory::Resource)?;
            let state = build_app(config, devices, Box::new(displays), frontend_dir)?;

            // The frontend talks to the backend through the `api_request` command, which feeds
            // the same router the HTTP API uses (see commands.rs).
            app.manage(commands::ApiRouter(api::build_router(state.clone())));

            let app_handle = app.handle().clone();
            // Runs off the main thread: creating windows from it is safe on Windows.
            tauri::async_runtime::spawn(async move {
                state.devices.refresh().await; // first device scan
                restore_presentation_windows(&app_handle, &state).await;
                if let Err(e) = api::start(state, port).await {
                    tracing::error!("API failed to start: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            presentation_windows::assign_presentation_window,
            presentation_windows::set_presentation_window_visible,
            presentation_windows::get_presentation_window_visibility,
            presentation_windows::hide_current_presentation_window,
            presentation_windows::refresh_presentation_windows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
