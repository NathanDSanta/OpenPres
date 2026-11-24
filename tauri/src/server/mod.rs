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
    /// The oldest manager that can manage this server (compatibility.json).
    pub oldest_manager: &'static str,
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
        oldest_manager: &crate::compatibility::COMPATIBILITY.oldest_manager,
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

// ---------- set up by the Windows installer ----------

/// The installer's "Use this computer as an OpenPres server" page leaves its answers here
/// (windows/hooks.nsh). The server takes them on its first start and deletes the file.
pub const INSTALLER_SETUP_FILE: &str = "installer-setup.txt";

/// What the installer asked.
#[derive(Debug, Default, PartialEq)]
pub struct InstallerSetup {
    pub name: String,
    pub admin_password: String,
    pub operator_password: String,
    pub remote_access: bool,
    pub standby: bool,
}

/// `key=value` lines, UTF-16 (what NSIS writes, with a BOM) or UTF-8.
pub fn parse_installer_setup(bytes: &[u8]) -> InstallerSetup {
    let text = if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let units: Vec<u16> = rest.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)).into_owned()
    };
    let mut setup = InstallerSetup::default();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        match key.trim() {
            "name" => setup.name = value.trim().to_string(),
            // Passwords exactly as typed (spaces included).
            "admin_password" => setup.admin_password = value.to_string(),
            "operator_password" => setup.operator_password = value.to_string(),
            "remote_access" => setup.remote_access = value.trim() == "1",
            "power" => setup.standby = value.trim() == "standby",
            _ => {}
        }
    }
    setup
}

/// Sets the server up with what the installer asked (if it isn't set up yet) and deletes the
/// file, which holds the passwords as typed. True if the settings changed.
pub fn take_installer_setup(config: &mut AppConfig, file: &std::path::Path) -> bool {
    let Ok(bytes) = std::fs::read(file) else { return false };
    if let Err(e) = std::fs::remove_file(file) {
        tracing::error!("could not delete {}: {e}", file.display());
    }
    if config.set_up() {
        tracing::info!("the installer's server setup is ignored: this server is already set up");
        return false;
    }
    let setup = parse_installer_setup(&bytes);
    match set_up(config, &setup.name, &setup.admin_password, &setup.operator_password, setup.remote_access) {
        Ok(()) => {
            if setup.standby {
                config.power = Power::Standby;
            }
            tracing::info!(
                "set up by the installer: name {:?}, other devices {}, {:?}",
                config.display_name(),
                if setup.remote_access { "allowed" } else { "not allowed" },
                config.power
            );
            true
        }
        Err(e) => {
            // The setup window asks again.
            tracing::error!("the installer's server setup was not used: {e}");
            false
        }
    }
}

// ---------- start with the computer ----------

/// The program that starts with the computer: the server, in the background.
fn autostart() -> Option<auto_launch::AutoLaunch> {
    // An AppImage runs from a temporary mount; the file itself is in $APPIMAGE.
    let exe = std::env::var("APPIMAGE")
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok())?;
    // Windows runs the start-up entry as a command line: quoted, a path with spaces (a user
    // name like "Ana María") still names the program. The installer writes it the same way.
    #[cfg(windows)]
    let path = format!("\"{}\"", exe.to_str()?);
    #[cfg(not(windows))]
    let path = exe.to_str()?.to_string();
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name("OpenPres Server")
        .set_app_path(&path)
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

/// Whether this computer is used as a server, as chosen when OpenPres first opened (or in
/// its server list later, or by the Windows installer). None: not chosen yet. Kept in
/// `OpenPres/this-computer.json`, shared by the manager and the server.
pub fn this_computer_is_server() -> Option<bool> {
    this_computer_in(&crate::paths::root())
}

pub fn set_this_computer_is_server(on: bool) -> Result<(), AppError> {
    set_this_computer_in(&crate::paths::root(), on)
}

const THIS_COMPUTER_FILE: &str = "this-computer.json";

fn this_computer_in(root: &std::path::Path) -> Option<bool> {
    let text = std::fs::read_to_string(root.join(THIS_COMPUTER_FILE)).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?.get("server")?.as_bool()
}

fn set_this_computer_in(root: &std::path::Path, on: bool) -> Result<(), AppError> {
    std::fs::create_dir_all(root)?;
    std::fs::write(root.join(THIS_COMPUTER_FILE), format!("{{\n  \"server\": {on}\n}}\n"))?;
    Ok(())
}

/// Should `openpres --server` run? Not when the computer was chosen not to be a server, nor
/// before anyone chose (a new computer: the manager asks first). Servers set up before the
/// choice existed keep running.
pub fn should_run(choice: Option<bool>, set_up: bool) -> bool {
    match choice {
        Some(on) => on,
        None => set_up,
    }
}

/// The event topic that tells the server program to quit (`POST /server/quit`, from this
/// computer only: the manager's "Stop using this computer as a server").
pub const QUIT_TOPIC: &str = "server-quit";

/// Dashboards (home pages) are per manager mode.
pub const MODES: [&str; 4] = ["livestream", "stage", "all", "admin"];

/// Displays currently hidden (kept while the server runs).
pub type HiddenOutputs = HashSet<String>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_computer_choice() {
        let dir = std::env::temp_dir().join(format!("openpres-choice-{}", uuid::Uuid::new_v4()));
        assert_eq!(this_computer_in(&dir), None, "not chosen yet");
        set_this_computer_in(&dir, false).unwrap();
        assert_eq!(this_computer_in(&dir), Some(false));
        set_this_computer_in(&dir, true).unwrap();
        assert_eq!(this_computer_in(&dir), Some(true));
        std::fs::remove_dir_all(&dir).ok();

        assert!(!should_run(None, false), "a new computer: the manager asks first");
        assert!(should_run(None, true), "a server set up before the choice existed");
        assert!(!should_run(Some(false), true));
        assert!(should_run(Some(true), false), "chosen: its setup window asks for the rest");
    }

    #[test]
    fn installer_setup_in_utf16_with_a_bom() {
        let text = "name=Iglesia Ñuñoa\r\nadmin_password= pass ñ1\r\noperator_password=op=2x\r\nremote_access=1\r\npower=standby\r\n";
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(text.encode_utf16().flat_map(|u| u.to_le_bytes()));
        let setup = parse_installer_setup(&bytes);
        assert_eq!(
            setup,
            InstallerSetup {
                name: "Iglesia Ñuñoa".into(),
                admin_password: " pass ñ1".into(),
                operator_password: "op=2x".into(),
                remote_access: true,
                standby: true,
            }
        );
    }

    #[test]
    fn installer_setup_sets_up_once_in_standby_and_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(INSTALLER_SETUP_FILE);
        let mut config = AppConfig::load_from(dir.path().to_path_buf()).unwrap();
        std::fs::write(&file, "name=Stage PC\nadmin_password=admin1\noperator_password=oper1\nremote_access=0\npower=standby\n").unwrap();

        assert!(take_installer_setup(&mut config, &file));
        assert!(config.set_up());
        assert_eq!(config.power, Power::Standby);
        assert_eq!(config.server_name, "Stage PC");
        assert!(!config.remote_access);
        assert!(!file.exists(), "the passwords don't stay on disk");

        // Already set up: a new file changes nothing (and is deleted too).
        std::fs::write(&file, "name=Other\nadmin_password=zzzz1\noperator_password=yyyy1\n").unwrap();
        assert!(!take_installer_setup(&mut config, &file));
        assert_eq!(config.server_name, "Stage PC");
        assert!(!file.exists());
    }

    #[test]
    fn installer_setup_with_bad_passwords_leaves_the_setup_window() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(INSTALLER_SETUP_FILE);
        let mut config = AppConfig::load_from(dir.path().to_path_buf()).unwrap();
        std::fs::write(&file, "admin_password=same1\noperator_password=same1\n").unwrap();
        assert!(!take_installer_setup(&mut config, &file));
        assert!(!config.set_up());
        assert!(!file.exists());
    }

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
