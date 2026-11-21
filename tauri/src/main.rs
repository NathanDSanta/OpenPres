#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! One program, two roles:
//!
//! - `openpres --server`: the server. Runs in the background (a tray icon, no main window)
//!   and does everything: presentations, screens, stream, audio... It owns the windows on
//!   the displays (outputs), the hidden window that draws the stream's graphics, and, on
//!   the first run, the setup window.
//! - `openpres`: the manager. Finds servers on the network (or starts one on this
//!   computer) and opens the chosen server's interface; everything is done through it.
mod commands;
mod presentation_windows;

use openpres_lib::{
    api, build_app,
    config::AppConfig,
    devices::{audio::CpalProvider, mock::demo_registry, video::NokhwaProvider, DeviceRegistry},
    error::AppError,
    events::AppEvent,
    screens::physical::{DisplayProvider, PhysicalDisplay},
    server::{self, discovery, OutputHost, OutputPlan},
    state::SharedState,
};
use presentation_windows::PresentationWindowRegistry;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_WINDOW: &str = "main";
const SETUP_WINDOW: &str = "setup";
const RENDERER_WINDOW: &str = "stream-renderer";

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

/// The server's windows, as the backend wants them.
struct TauriOutputs {
    app: tauri::AppHandle,
}

impl OutputHost for TauriOutputs {
    fn apply(&self, plan: &OutputPlan) {
        let registry = self.app.state::<PresentationWindowRegistry>();
        if let Err(error) = presentation_windows::sync_windows(&self.app, &registry, &plan.windows) {
            tracing::warn!("output windows: {error}");
        }
        let renderer = self.app.get_webview_window(RENDERER_WINDOW);
        match (plan.stream_renderer, renderer) {
            (true, None) => {
                // Never shown: it only draws the stream's slides and graphics.
                let built = WebviewWindowBuilder::new(&self.app, RENDERER_WINDOW, WebviewUrl::App("renderer/stream".into()))
                    .title("OpenPres stream graphics")
                    .visible(false)
                    .skip_taskbar(true)
                    .focused(false)
                    .inner_size(320.0, 180.0)
                    .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                    .build();
                if let Err(e) = built {
                    tracing::warn!("could not open the stream graphics window: {e}");
                }
            }
            (false, Some(window)) => {
                let _ = window.destroy();
            }
            _ => {}
        }
    }
}

fn main() {
    tracing_subscriber::fmt::init();
    if std::env::args().any(|a| a == "--server") {
        run_server();
    } else {
        run_manager();
    }
}

// ---------- server ----------

/// Set when the server is asked to quit (tray); otherwise it keeps running with no windows.
static QUITTING: AtomicBool = AtomicBool::new(false);

fn run_server() {
    let config = AppConfig::load().expect("failed to load config");
    let port = config.api_port;
    let set_up = config.set_up();

    let app = tauri::Builder::default()
        .manage(PresentationWindowRegistry::default())
        .setup(move |app| {
            let devices = if std::env::var_os("OPENPRES_MOCK_DEVICES").is_some() {
                demo_registry()
            } else {
                DeviceRegistry::new(vec![Box::new(NokhwaProvider)], vec![Box::new(CpalProvider)])
            };
            let displays = TauriDisplays { handle: app.handle().clone() };
            let frontend_dir = app.path().resolve("frontend", tauri::path::BaseDirectory::Resource)?;
            tracing::info!("managers load the interface from {}", frontend_dir.display());
            let state = build_app(config, devices, Box::new(displays), frontend_dir)?;

            // The server's own windows talk to the backend through the `api_request`
            // command, which feeds the same router the HTTP API uses (see commands.rs).
            app.manage(commands::ApiRouter(api::build_router(state.clone()), state.auth.internal_key.clone()));
            app.manage(state.clone());

            // Backend changes -> the server's windows.
            {
                let app_handle = app.handle().clone();
                let mut rx = state.events.subscribe();
                tauri::async_runtime::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(AppEvent::Changed { revision, topics }) => {
                                let _ = app_handle.emit("openpres://changed", serde_json::json!({ "revision": revision, "topics": topics }));
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });
            }

            // A background program: no Dock icon on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            tray(app.handle());
            if !set_up {
                open_setup_window(app.handle());
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = api::start(state.clone(), port).await {
                    // Most likely another server already runs on this computer.
                    tracing::error!("the server could not start: {e}");
                    app_handle.exit(1);
                    return;
                }
                openpres_lib::spawn_background(state.clone());
                server::apply_power_at_start(&state).await;
                state.devices.refresh().await; // first device scan
                server::spawn_outputs(state.clone(), Arc::new(TauriOutputs { app: app_handle.clone() }));
                discovery::spawn_announcer(state);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::local_server,
            commands::close_setup,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the server");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            // Closing the last window doesn't stop the server; only "Quit" does.
            if code.is_none() && !QUITTING.load(Ordering::SeqCst) {
                api.prevent_exit();
            } else if let Some(state) = app.try_state::<SharedState>() {
                openpres_lib::shutdown(&state);
            }
        }
    });
}

fn open_setup_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(SETUP_WINDOW) {
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETUP_WINDOW, WebviewUrl::App("server-setup".into()))
        .title("OpenPres Server setup")
        .inner_size(560.0, 680.0)
        .resizable(true)
        .center()
        .build();
    if let Err(e) = built {
        tracing::warn!("could not open the setup window: {e}");
    }
}

/// Opens a manager (a new instance of this program without `--server`).
fn open_manager() {
    match std::env::var("APPIMAGE").map(std::path::PathBuf::from).or_else(|_| std::env::current_exe()) {
        Ok(exe) => {
            if let Err(e) = std::process::Command::new(exe).spawn() {
                tracing::warn!("could not open a manager: {e}");
            }
        }
        Err(e) => tracing::warn!("could not open a manager: {e}"),
    }
}

/// The tray icon: the server's only visible part.
fn tray(app: &tauri::AppHandle) {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let build = || -> tauri::Result<()> {
        let title = MenuItem::with_id(app, "title", "OpenPres Server", false, None::<&str>)?;
        let open = MenuItem::with_id(app, "open", "Open manager", true, None::<&str>)?;
        let autostart = CheckMenuItem::with_id(
            app,
            "autostart",
            "Start with the computer",
            true,
            server::starts_with_computer(),
            None::<&str>,
        )?;
        let quit = MenuItem::with_id(app, "quit", "Quit server", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let menu = Menu::with_items(app, &[&title, &separator, &open, &autostart, &separator, &quit])?;
        let mut builder = TrayIconBuilder::with_id("server")
            .tooltip("OpenPres Server")
            .menu(&menu)
            .on_menu_event(move |app, event| match event.id().as_ref() {
                "open" => open_manager(),
                "autostart" => {
                    let on = !server::starts_with_computer();
                    if let Err(e) = server::set_starts_with_computer(on) {
                        tracing::warn!("{e}");
                    }
                    let _ = autostart.set_checked(server::starts_with_computer());
                }
                "quit" => {
                    QUITTING.store(true, Ordering::SeqCst);
                    if let Some(state) = app.try_state::<SharedState>() {
                        openpres_lib::shutdown(&state);
                    }
                    app.exit(0);
                }
                _ => {}
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
        Ok(())
    };
    // Some Linux desktops have no tray (or no AppIndicator library): the server still runs,
    // and managers can do everything the tray does.
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(build));
    std::panic::set_hook(report);
    match built {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!("no tray icon: {e}"),
        Err(_) => tracing::warn!("no tray icon on this desktop"),
    }
}

// ---------- manager ----------

fn run_manager() {
    tauri::Builder::default()
        .manage(commands::Discovery(discovery::Browser::start()))
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN_WINDOW)
                .cloned()
                .ok_or("no main window in tauri.conf.json")?;
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                // Links that open a new window (help pages, the YouTube sign-in) go to the
                // computer's browser.
                .on_new_window(|url, _| {
                    if let Err(e) = openpres_lib::tools::open_url(url.as_str()) {
                        tracing::warn!("could not open {url}: {e}");
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW && matches!(event, WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::discovered_servers,
            commands::local_server_status,
            commands::start_local_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the manager");
}
