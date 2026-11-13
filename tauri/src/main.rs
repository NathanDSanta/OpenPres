#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod presentation_windows;

use openpres_lib::{
    api, build_app,
    config::AppConfig,
    devices::{audio::CpalProvider, mock::demo_registry, video::NokhwaProvider, DeviceRegistry},
    error::AppError,
    events::AppEvent,
    screens::{
        detect_displays,
        physical::{DisplayProvider, PhysicalDisplay},
    },
    state::SharedState,
};
use presentation_windows::{PresentationWindowRegistry, WindowAssignment};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_WINDOW: &str = "main";
const COMPOSITOR_WINDOW: &str = "stream-compositor";

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

/// Opens or closes the small window that renders the streamed screen.
fn set_compositor(app: &tauri::AppHandle, event: &AppEvent) {
    let AppEvent::StreamCompositor { screen_id, width, height, fps } = event else { return };
    let existing = app.get_webview_window(COMPOSITOR_WINDOW);
    match screen_id {
        None => {
            if let Some(window) = existing {
                let _ = window.destroy();
            }
        }
        Some(id) => {
            if let Some(window) = existing {
                let _ = window.destroy();
            }
            let url = format!("compositor/{id}?w={width}&h={height}&fps={fps}");
            let built = WebviewWindowBuilder::new(app, COMPOSITOR_WINDOW, WebviewUrl::App(url.into()))
                .title("OpenPres — Stream output (keep this window open)")
                .inner_size(480.0, 300.0)
                .min_inner_size(320.0, 220.0)
                .focused(false)
                .build();
            match built {
                Ok(window) => {
                    // Closing it would stop the stream's video; stopping the stream closes it.
                    let w = window.clone();
                    window.on_window_event(move |e| {
                        if let WindowEvent::CloseRequested { api, .. } = e {
                            api.prevent_close();
                            let _ = w.minimize();
                        }
                    });
                }
                Err(e) => tracing::error!("cannot open the stream compositor: {e}"),
            }
        }
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
            app.manage(commands::ApiRouter(
                api::build_router(state.clone()),
                state.auth.internal_key.clone(),
            ));
            app.manage(state.clone());

            // Backend changes -> every webview (main, presentation, compositor windows).
            {
                let app_handle = app.handle().clone();
                let mut rx = state.events.subscribe();
                tauri::async_runtime::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(AppEvent::Changed { revision }) => {
                                let _ = app_handle.emit("openpres://changed", revision);
                            }
                            Ok(event @ AppEvent::StreamCompositor { .. }) => {
                                let handle = app_handle.clone();
                                let _ = app_handle.run_on_main_thread(move || set_compositor(&handle, &event));
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });
            }

            let app_handle = app.handle().clone();
            // Runs off the main thread: creating windows from it is safe on Windows.
            tauri::async_runtime::spawn(async move {
                openpres_lib::spawn_background(state.clone());
                state.devices.refresh().await; // first device scan
                restore_presentation_windows(&app_handle, &state).await;
                if let Err(e) = api::start(state, port).await {
                    tracing::error!("API failed to start: {e}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app, including every presentation window.
            if window.label() == MAIN_WINDOW && matches!(event, WindowEvent::CloseRequested { .. }) {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<SharedState>() {
                    openpres_lib::shutdown(&state);
                }
                app.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::local_server,
            presentation_windows::assign_presentation_window,
            presentation_windows::set_presentation_window_visible,
            presentation_windows::get_presentation_window_visibility,
            presentation_windows::hide_current_presentation_window,
            presentation_windows::refresh_presentation_windows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
