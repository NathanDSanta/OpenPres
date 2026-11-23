//! Updates from GitHub Releases (tauri-plugin-updater; endpoint and key in tauri.conf.json).
//!
//! - The manager asks when it opens (the server list shows a dialog: Update / Remind me
//!   later). Updating closes it and opens the new version. On Windows the installer also
//!   closes this computer's server (same program); the manager starts it again.
//! - The server asks a minute after starting and then every 6 hours. Its admin sees the
//!   update in the interface, and the tray offers it. Updating restarts the server.
//!
//! Test builds (debug) don't update unless `OPENPRES_UPDATES=1`.

use openpres_lib::{
    logging,
    state::SharedState,
    updates::{Activity, Available, Request},
};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Installed releases update themselves; test builds would "update" to the last release.
pub fn enabled() -> bool {
    !cfg!(debug_assertions) || std::env::var_os("OPENPRES_UPDATES").is_some()
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    #[allow(unused_mut)]
    let mut builder = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        // Windows: the installer is started and this program ends right away.
        .on_before_exit(|| {
            tracing::info!("closing for the installer");
            logging::flush();
        });
    // Test builds can try a local latest.json (still signed with the release key).
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("OPENPRES_UPDATE_ENDPOINT") {
        let url = url.parse().map_err(|e| format!("OPENPRES_UPDATE_ENDPOINT: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())
}

async fn check(app: &AppHandle) -> Result<Option<Update>, String> {
    let found = updater(app)?.check().await.map_err(|e| e.to_string());
    match &found {
        Ok(Some(u)) => tracing::info!("update available: {} -> {}", u.current_version, u.version),
        Ok(None) => tracing::info!("no update (running {})", env!("CARGO_PKG_VERSION")),
        Err(e) => tracing::warn!("update check failed: {e}"),
    }
    found
}

fn date(update: &Update) -> Option<String> {
    update.date.map(|d| d.date().to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------- manager ----------

/// The update found when the manager opened, kept for "Update".
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: String,
    date: Option<String>,
}

/// Is there a newer version? (The server list asks when the manager opens.)
#[tauri::command]
pub async fn check_update(app: AppHandle, pending: tauri::State<'_, Pending>) -> Result<Option<UpdateInfo>, String> {
    if !enabled() {
        return Ok(None);
    }
    let update = check(&app).await?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: date(u),
    });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Progress {
    Downloading { done: u64, total: Option<u64> },
    Installing,
}

/// Downloads and installs the update found by `check_update`, then opens the new version.
#[tauri::command]
pub async fn install_update(app: AppHandle, pending: tauri::State<'_, Pending>, on_progress: Channel<Progress>) -> Result<(), String> {
    // Kept (not taken): "Try again" after a failed download uses it again.
    let update = pending.0.lock().unwrap().clone().ok_or("check for updates first")?;
    tracing::info!("updating the manager to {}", update.version);
    let mut done = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                let _ = on_progress.send(Progress::Downloading { done, total });
            },
            || {},
        )
        .await
        .map_err(|e| {
            tracing::error!("update download failed: {e}");
            e.to_string()
        })?;
    let _ = on_progress.send(Progress::Installing);
    // Windows: the installer takes over and this program ends here.
    update.install(bytes).map_err(|e| {
        tracing::error!("update install failed: {e}");
        e.to_string()
    })?;
    tracing::info!("updated; opening the new version");
    logging::flush();
    app.restart();
}

// ---------- server ----------

/// The tray's update item (its text follows what's going on).
pub struct TrayItem(pub tauri::menu::MenuItem<tauri::Wry>);

/// Checks every few hours and does what the API and the tray ask.
pub fn spawn_server(app: AppHandle, state: SharedState) {
    if !enabled() {
        return;
    }
    let Some(mut requests) = state.updates.take_requests() else { return };
    tauri::async_runtime::spawn(async move {
        let mut found: Option<Update> = None;
        let mut next = tokio::time::Instant::now() + FIRST_CHECK;
        loop {
            let request = tokio::select! {
                r = requests.recv() => match r { Some(r) => r, None => break },
                _ = tokio::time::sleep_until(next) => Request::Check,
            };
            match request {
                Request::Check => {
                    next = tokio::time::Instant::now() + EVERY;
                    set(&app, &state, |s| {
                        s.activity = Activity::Checking;
                        s.error = None;
                    });
                    let result = check(&app).await;
                    set(&app, &state, |s| {
                        s.activity = Activity::Idle;
                        s.checked_at_ms = Some(now_ms());
                        match &result {
                            Ok(update) => {
                                s.available = update.as_ref().map(|u| Available {
                                    version: u.version.clone(),
                                    notes: u.body.clone().unwrap_or_default(),
                                    date: date(u),
                                })
                            }
                            Err(e) => s.error = Some(e.clone()),
                        }
                    });
                    if let Ok(update) = result {
                        found = update;
                    }
                }
                Request::Install => {
                    // Still there after a failed download: it can be tried again.
                    if let Some(update) = found.clone() {
                        install_server(&app, &state, update).await;
                    }
                }
            }
        }
    });
}

async fn install_server(app: &AppHandle, state: &SharedState, update: Update) {
    tracing::info!("updating the server to {}", update.version);
    set(app, state, |s| {
        s.activity = Activity::Downloading { done: 0, total: None };
        s.error = None;
    });
    let mut done = 0u64;
    let mut shown = 0u64;
    let downloaded = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                // A change event every 2% (or 1 MB), not every chunk.
                let step = total.map(|t| t / 50).unwrap_or(1 << 20).max(1);
                if done - shown >= step || total == Some(done) {
                    shown = done;
                    set(app, state, |s| s.activity = Activity::Downloading { done, total });
                }
            },
            || {},
        )
        .await;
    let bytes = match downloaded {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::error!("update download failed: {e}");
            set(app, state, |s| {
                s.activity = Activity::Idle;
                s.error = Some(e.to_string());
            });
            return;
        }
    };
    set(app, state, |s| s.activity = Activity::Installing);
    // Let the managers see "Installing", then stop cleanly (stream, devices, sound).
    tokio::time::sleep(Duration::from_millis(500)).await;
    openpres_lib::shutdown(state);
    // Windows: the installer takes over, then starts the server again (same arguments).
    match update.install(bytes) {
        Ok(()) => tracing::info!("updated; starting the new version"),
        Err(e) => tracing::error!("update install failed: {e}; starting again"),
    }
    logging::flush();
    app.restart();
}

/// Changes the status, tells the managers, and updates the tray.
fn set(app: &AppHandle, state: &SharedState, change: impl FnOnce(&mut openpres_lib::updates::UpdateStatus)) {
    state.updates.update(change);
    state.events.changed_topics(vec!["update".into()]);
    if let Some(item) = app.try_state::<TrayItem>() {
        let _ = item.0.set_text(tray_text(&state.updates.status()));
    }
}

/// What the tray's update item says.
pub fn tray_text(status: &openpres_lib::updates::UpdateStatus) -> String {
    match (&status.activity, &status.available) {
        (Activity::Checking, _) => "Checking for updates…".into(),
        (Activity::Downloading { done, total: Some(total) }, _) if *total > 0 => {
            format!("Downloading the update… {}%", done * 100 / total)
        }
        (Activity::Downloading { .. }, _) => "Downloading the update…".into(),
        (Activity::Installing, _) => "Installing the update…".into(),
        (Activity::Idle, Some(a)) => format!("Update to OpenPres {}", a.version),
        (Activity::Idle, None) => "Check for updates".into(),
    }
}
