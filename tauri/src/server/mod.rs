//! OpenPres as a server: the part that runs in the background and does everything
//! (presentations, screens, stream, audio...), while managers on this or other computers
//! only operate it.
//!
//! - Power: active (everything works), standby (nothing shown or streamed, but everything
//!   can be managed) and asleep (nothing works except waking up).
//! - Outputs: which window shows which screen on which display is decided here, from the
//!   screens' display assignments, so any manager can change them; the app opens, moves
//!   and closes the windows to match (OutputHost).
//! - First-run setup and "start with the computer".

pub mod discovery;

use crate::{
    auth,
    config::{AppConfig, Power},
    error::AppError,
    media::player::Slot,
    screens::detect_displays,
    state::SharedState,
};
use serde::Serialize;
use std::{collections::HashSet, sync::Arc, time::Duration};
use uuid::Uuid;

/// One output window: a screen shown fullscreen on a display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OutputWindow {
    pub screen_id: Uuid,
    pub display_id: String,
    /// False: hidden for now (Escape on it, or from a manager), still assigned.
    pub visible: bool,
}

/// Every window the server should have open.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct OutputPlan {
    pub windows: Vec<OutputWindow>,
    /// The hidden window that draws the slides and graphics for the stream.
    pub stream_renderer: bool,
}

/// Opens, moves and closes the server's windows (the app does it with Tauri).
pub trait OutputHost: Send + Sync {
    fn apply(&self, plan: &OutputPlan);
}

/// What the windows should be now.
pub async fn plan(s: &SharedState) -> OutputPlan {
    if s.config.read().await.power != Power::Active {
        return OutputPlan::default();
    }
    let hidden = s.outputs_hidden.read().await.clone();
    let screens = s.screens.read().await;
    let windows = screens
        .bindings
        .iter()
        .filter(|b| screens.displays.iter().any(|d| d.id == b.physical_display))
        .filter(|b| screens.screens.iter().any(|v| v.id == b.virtual_screen))
        .map(|b| OutputWindow {
            screen_id: b.virtual_screen,
            display_id: b.physical_display.clone(),
            visible: !hidden.contains(&b.physical_display),
        })
        .collect();
    OutputPlan {
        windows,
        stream_renderer: s.stream.is_running(),
    }
}

/// Keeps the windows in line with the plan: after every change, and every few seconds
/// (displays plugged in or out are noticed then).
pub fn spawn_outputs(s: SharedState, host: Arc<dyn OutputHost>) {
    tokio::spawn(async move {
        let mut rx = s.events.subscribe();
        let mut applied: Option<OutputPlan> = None;
        let mut displays_checked = tokio::time::Instant::now() - Duration::from_secs(60);
        loop {
            if displays_checked.elapsed() >= Duration::from_secs(5) {
                displays_checked = tokio::time::Instant::now();
                if s.config.read().await.power != Power::Sleep {
                    if let Err(e) = refresh_displays(&s).await {
                        tracing::warn!("display detection failed: {e}");
                    }
                }
            }
            let wanted = plan(&s).await;
            if applied.as_ref() != Some(&wanted) {
                host.apply(&wanted);
                applied = Some(wanted);
            }
            tokio::select! {
                _ = rx.recv() => {
                    // A burst of changes is handled once.
                    tokio::time::sleep(Duration::from_millis(30)).await;
                    while rx.try_recv().is_ok() {}
                }
                _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            }
        }
    });
}

/// Detects the displays; tells everyone when they changed.
async fn refresh_displays(s: &SharedState) -> Result<(), AppError> {
    let before: Vec<String> = s.screens.read().await.displays.iter().map(|d| format!("{d:?}")).collect();
    let after: Vec<String> = detect_displays(s).await?.iter().map(|d| format!("{d:?}")).collect();
    if before != after {
        s.events.changed();
    }
    Ok(())
}

/// Shows or hides the window on a display (it stays assigned).
pub async fn set_output_visible(s: &SharedState, display_id: &str, visible: bool) {
    let mut hidden = s.outputs_hidden.write().await;
    if visible {
        hidden.remove(display_id);
    } else {
        hidden.insert(display_id.to_string());
    }
}

/// Every display's window: which screen, and whether it's showing.
pub async fn outputs(s: &SharedState) -> Vec<OutputWindow> {
    let hidden = s.outputs_hidden.read().await.clone();
    let screens = s.screens.read().await;
    screens
        .bindings
        .iter()
        .map(|b| OutputWindow {
            screen_id: b.virtual_screen,
            display_id: b.physical_display.clone(),
            visible: !hidden.contains(&b.physical_display),
        })
        .collect()
}

// ---------- power ----------

/// Switches between active, standby and asleep.
pub async fn set_power(s: &SharedState, power: Power) -> Result<(), AppError> {
    let old = {
        let mut c = s.config.write().await;
        let old = c.power;
        if old == power {
            return Ok(());
        }
        c.power = power;
        c.save()?;
        old
    };
    tracing::info!("server: {old:?} -> {power:?}");
    if power != Power::Active {
        // Nothing is shown, played or streamed.
        s.stream.stop(&s.audio.graph, &s.events);
        let ffmpeg = s.ffmpeg().await;
        for slot in [Slot::Visual, Slot::Audio] {
            s.player.set_playing(slot, false, &ffmpeg);
        }
    }
    if power == Power::Sleep {
        // Devices are let go.
        s.capture.stop_all();
        s.audio.suspend();
    } else if old == Power::Sleep {
        s.audio.apply(&s.audio_config.read().await.clone(), true);
    }
    s.events.changed();
    Ok(())
}

/// Starts in the state it was left in; asleep means the devices stay closed.
pub async fn apply_power_at_start(s: &SharedState) {
    if s.config.read().await.power == Power::Sleep {
        s.capture.stop_all();
        s.audio.suspend();
    }
}

// ---------- identity and setup ----------

#[derive(Serialize)]
pub struct ServerInfo {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    pub version: &'static str,
    pub power: Power,
    pub port: u16,
    /// The admin and operator passwords are set.
    pub set_up: bool,
}

pub async fn info(s: &SharedState) -> ServerInfo {
    let c = s.config.read().await;
    ServerInfo {
        id: c.server_id,
        name: c.display_name(),
        host: crate::config::host_name(),
        version: env!("CARGO_PKG_VERSION"),
        power: c.power,
        port: c.api_port,
        set_up: c.set_up(),
    }
}

pub fn check_password(password: &str, what: &str) -> Result<(), AppError> {
    if password.chars().count() < 4 {
        return Err(AppError::BadRequest(format!("use an {what} password of at least 4 characters")));
    }
    Ok(())
}

/// First run: the server's name, the admin and operator passwords, and whether other
/// devices may connect.
pub fn set_up(c: &mut AppConfig, name: &str, admin_password: &str, operator_password: &str, remote_access: bool) -> Result<(), AppError> {
    check_password(admin_password, "admin")?;
    check_password(operator_password, "operator")?;
    if admin_password == operator_password {
        return Err(AppError::BadRequest("the admin and operator passwords must be different".into()));
    }
    let (hash, salt) = auth::new_password_hash(admin_password);
    c.admin_password_hash = Some(hash);
    c.admin_password_salt = Some(salt);
    let (hash, salt) = auth::new_password_hash(operator_password);
    c.password_hash = Some(hash);
    c.password_salt = Some(salt);
    c.server_name = name.trim().chars().take(60).collect();
    c.remote_access = remote_access;
    Ok(())
}

// ---------- start with the computer ----------

/// The program that starts with the computer: the server, in the background.
fn autostart() -> Option<auto_launch::AutoLaunch> {
    // An AppImage runs from a temporary mount; the file itself is in $APPIMAGE.
    let exe = std::env::var("APPIMAGE")
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok())?;
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name("OpenPres Server")
        .set_app_path(exe.to_str()?)
        .set_args(&["--server"])
        .set_use_launch_agent(true)
        .build()
        .ok()
}

pub fn starts_with_computer() -> bool {
    autostart().and_then(|a| a.is_enabled().ok()).unwrap_or(false)
}

pub fn set_starts_with_computer(on: bool) -> Result<(), AppError> {
    let a = autostart().ok_or_else(|| AppError::Internal("can't find the program to start".into()))?;
    let result = if on { a.enable() } else { a.disable() };
    result.map_err(|e| AppError::Internal(format!("could not change the start-up setting: {e}")))
}

/// Dashboards (home pages) are per manager mode.
pub const MODES: [&str; 4] = ["livestream", "stage", "all", "admin"];

/// Displays currently hidden (kept while the server runs).
pub type HiddenOutputs = HashSet<String>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_sets_both_passwords() {
        let mut c: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!c.set_up());
        assert!(set_up(&mut c, "Hall", "admin1", "admin1", true).is_err(), "must differ");
        assert!(set_up(&mut c, "Hall", "a", "operator", true).is_err(), "too short");
        set_up(&mut c, " Main hall ", "admin1", "operator", true).unwrap();
        assert!(c.set_up());
        assert_eq!(c.display_name(), "Main hall");
        assert!(c.remote_access);
    }
}
