#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;

use openpres_lib::{
    api, build_app,
    config::AppConfig,
    devices::{audio::CpalProvider, mock::demo_registry, video::NokhwaProvider, DeviceRegistry},
    error::AppError,
    screens::{
        detect_displays,
        physical::{DisplayProvider, PhysicalDisplay},
    },
};

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
                let name = m
                    .name()
                    .cloned()
                    .unwrap_or_else(|| "Unknown display".to_string());
                let pos = m.position();
                let size = m.size();
                PhysicalDisplay {
                    id: format!("{}@{},{}", name, pos.x, pos.y),
                    name,
                    width: size.width,
                    height: size.height,
                    position: (pos.x, pos.y),
                }
            })
            .collect())
    }
}

fn main() {
    tracing_subscriber::fmt::init();

    let config = AppConfig::load().expect("failed to load config");
    let port = config.api_port;

    tauri::Builder::default()
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

            tauri::async_runtime::spawn(async move {
                state.devices.refresh().await; // first device scan
                if let Err(e) = detect_displays(&state).await {
                    tracing::warn!("display detection failed: {e}");
                }
                if let Err(e) = api::start(state, port).await {
                    tracing::error!("API failed to start: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::open_presentation_window,
            commands::close_presentation_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
