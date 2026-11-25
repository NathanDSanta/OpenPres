//! The other OpenPres programs, from the server's side. Each has its own repository and
//! releases: the Manager (OpenPres-M), which operators use to run the server, and the Stream
//! Deck plugin (OpenPres-SD).
//!
//! - The tray's "Open Manager" (and the Start menu's "OpenPres") open the installed Manager;
//!   without one, the server's interface in the browser.
//! - The Windows installer installs them when asked (and the Manager by itself when a version
//!   from before the split, which had it built in, updates): it runs
//!   `openpres --install-extras manager streamdeck` once the server's files are in place.

use crate::{config::AppConfig, paths};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

/// The Manager's newest stable release, and the newest for the beta program.
const MANAGER_FEED: &str = "https://github.com/NathanDSanta/OpenPres-M/releases/latest/download/latest.json";
const MANAGER_BETA_FEED: &str = "https://github.com/NathanDSanta/OpenPres-M/releases/download/beta-feed/latest.json";
/// Where people download the Manager by hand (computers without an automatic install).
pub const MANAGER_DOWNLOADS: &str = "https://github.com/NathanDSanta/OpenPres-M/releases/latest";
/// The plugin's releases, newest first (betas are pre-releases).
const PLUGIN_RELEASES: &str = "https://api.github.com/repos/NathanDSanta/OpenPres-SD/releases?per_page=20";

/// What the installer can add.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Extra {
    Manager,
    StreamDeck,
}

impl Extra {
    pub fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "manager" => Some(Extra::Manager),
            "streamdeck" | "stream-deck" => Some(Extra::StreamDeck),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Extra::Manager => "the OpenPres Manager",
            Extra::StreamDeck => "the Stream Deck plugin",
        }
    }
}

// ---------- the Manager on this computer ----------

/// The Manager's program, if it's installed here.
pub fn manager_program() -> Option<PathBuf> {
    manager_candidates().into_iter().find(|p| p.is_file())
}

fn manager_candidates() -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = std::env::var_os("OPENPRES_MANAGER_PROGRAM").map(PathBuf::from).into_iter().collect();
    list.extend(installed_manager_places());
    list
}

#[cfg(windows)]
fn installed_manager_places() -> Vec<PathBuf> {
    let mut list = Vec::new();
    // Its installer records the folder (also one the person chose) for "Apps & features".
    for hive in ["HKCU", "HKLM"] {
        let mut cmd = std::process::Command::new("reg");
        cmd.args(["query", &format!(r"{hive}\Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPres Manager"), "/v", "InstallLocation"]);
        crate::tools::no_window(&mut cmd);
        if let Some(dir) = cmd.output().ok().and_then(|o| install_location(&String::from_utf8_lossy(&o.stdout))) {
            list.push(dir.join("openpres-manager.exe"));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        list.push(PathBuf::from(local).join("OpenPres Manager").join("openpres-manager.exe"));
    }
    list
}

#[cfg(target_os = "macos")]
fn installed_manager_places() -> Vec<PathBuf> {
    let app = PathBuf::from("OpenPres Manager.app/Contents/MacOS/openpres-manager");
    let mut list = vec![PathBuf::from("/Applications").join(&app)];
    if let Some(home) = std::env::var_os("HOME") {
        list.push(PathBuf::from(home).join("Applications").join(&app));
    }
    list
}

#[cfg(not(any(windows, target_os = "macos")))]
fn installed_manager_places() -> Vec<PathBuf> {
    // The .deb and .rpm put it on the PATH.
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).map(|dir| dir.join("openpres-manager")).collect())
        .unwrap_or_default()
}

/// The folder in `reg query`'s answer (`InstallLocation    REG_SZ    "C:\…\OpenPres Manager"`).
#[cfg_attr(not(windows), allow(dead_code))]
fn install_location(reg_output: &str) -> Option<PathBuf> {
    let line = reg_output.lines().find(|l| l.trim_start().starts_with("InstallLocation"))?;
    let value = line.split("REG_SZ").nth(1)?.trim().trim_matches('"');
    (!value.is_empty()).then(|| PathBuf::from(value))
}

/// Opens the Manager; without one installed, this server's interface in the browser.
pub fn open_manager(port: u16) {
    if let Some(program) = manager_program() {
        tracing::info!("opening the Manager: {}", program.display());
        match std::process::Command::new(&program).spawn() {
            Ok(_) => return,
            Err(e) => tracing::warn!("could not open the Manager ({}): {e}", program.display()),
        }
    }
    let url = format!("http://127.0.0.1:{port}/");
    tracing::info!("no Manager installed: opening {url} in the browser");
    if let Err(e) = crate::tools::open_url(&url) {
        tracing::warn!("could not open {url}: {e}");
    }
}

/// Notes where this program is, for the Manager (it starts the server). The AppImage's own
/// file on Linux: the program inside it runs from a temporary mount.
pub fn note_server_program() {
    let exe = std::env::var("APPIMAGE").map(PathBuf::from).or_else(|_| std::env::current_exe());
    match exe {
        Ok(exe) => {
            let file = paths::root().join("server-program.txt");
            if std::fs::read_to_string(&file).ok().as_deref().map(str::trim) != exe.to_str() {
                if let Err(e) = std::fs::write(&file, format!("{}\n", exe.display())) {
                    tracing::warn!("could not write {}: {e}", file.display());
                }
            }
        }
        Err(e) => tracing::warn!("where is this program? {e}"),
    }
}

// ---------- installing ----------

/// This computer in latest.json's terms.
fn platform_key() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "windows-x86_64",
        ("windows", "aarch64") => "windows-aarch64",
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", "x86_64") => "darwin-x86_64",
        ("linux", "x86_64") => "linux-x86_64",
        ("linux", "aarch64") => "linux-aarch64",
        _ => return None,
    })
}

/// The Manager's installer for `platform` in its latest.json (on Windows the setup program).
fn manager_installer(latest: &Value, platform: &str) -> Option<String> {
    latest.get("platforms")?.get(platform)?.get("url")?.as_str().map(str::to_string)
}

/// The newest plugin among the releases (newest first): stable ones, and betas too for the
/// beta program.
fn plugin_download(releases: &Value, beta: bool) -> Option<(String, String)> {
    releases.as_array()?.iter().filter(|r| !r["draft"].as_bool().unwrap_or(false) && (beta || !r["prerelease"].as_bool().unwrap_or(false))).find_map(|r| {
        r["assets"].as_array()?.iter().find_map(|a| {
            let name = a["name"].as_str().filter(|n| n.ends_with(".streamDeckPlugin"))?;
            Some((name.to_string(), a["browser_download_url"].as_str()?.to_string()))
        })
    })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("OpenPres/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let res = client.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url}: {}", res.status()));
    }
    res.json().await.map_err(|e| format!("{url}: {e}"))
}

async fn download(client: &reqwest::Client, url: &str, to: &Path) -> Result<(), String> {
    let res = client.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url}: {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| format!("{url}: {e}"))?;
    std::fs::write(to, &bytes).map_err(|e| format!("{}: {e}", to.display()))?;
    tracing::info!("downloaded {url} ({} bytes)", bytes.len());
    Ok(())
}

/// Installs one extra. `beta`: the beta program's versions.
pub async fn install(extra: Extra, beta: bool) -> Result<String, String> {
    let client = client()?;
    let dir = std::env::temp_dir().join(format!("openpres-extras-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    match extra {
        Extra::Manager => {
            if !cfg!(windows) {
                // Elsewhere there's no installer to run quietly: the download page.
                crate::tools::open_url(MANAGER_DOWNLOADS)?;
                return Ok("opened the Manager's download page".into());
            }
            let feed = if beta { MANAGER_BETA_FEED } else { MANAGER_FEED };
            let latest = get_json(&client, feed).await?;
            let platform = platform_key().ok_or("no Manager for this computer")?;
            let url = manager_installer(&latest, platform).ok_or_else(|| format!("no Manager for {platform} in {feed}"))?;
            let setup = dir.join("OpenPres-Manager-Setup.exe");
            download(&client, &url, &setup).await?;
            // Its own installer, silently (installs for this user, like the server).
            let status = tokio::process::Command::new(&setup).arg("/S").status().await.map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&setup);
            if !status.success() {
                return Err(format!("the Manager's installer ended with {status}"));
            }
            Ok(format!("installed the Manager {}", latest["version"].as_str().unwrap_or("")))
        }
        Extra::StreamDeck => {
            let releases = get_json(&client, PLUGIN_RELEASES).await?;
            let (name, url) = plugin_download(&releases, beta).ok_or("no Stream Deck plugin released yet")?;
            let file = dir.join(&name);
            download(&client, &url, &file).await?;
            // The Stream Deck app installs it (and asks first).
            crate::tools::open_url(&file.to_string_lossy())?;
            Ok(format!("opened {name} for the Stream Deck app"))
        }
    }
}

/// `openpres --install-extras manager streamdeck`: what the Windows installer runs. Returns
/// the exit code (0: everything installed).
pub fn run_cli(args: &[String]) -> i32 {
    let extras: Vec<Extra> = args.iter().skip_while(|a| *a != "--install-extras").skip(1).filter_map(|a| Extra::parse(a)).collect();
    // A beta server installs the beta program's versions, like one whose admin chose it.
    let beta = env!("CARGO_PKG_VERSION").contains('-') || peek_beta_program();
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("extras: {e}");
            return 1;
        }
    };
    let mut code = 0;
    for extra in extras {
        tracing::info!("installing {}{}", extra.name(), if beta { " (beta program)" } else { "" });
        match runtime.block_on(install(extra, beta)) {
            Ok(done) => tracing::info!("{done}"),
            Err(e) => {
                tracing::error!("could not install {}: {e}", extra.name());
                code = 1;
            }
        }
    }
    code
}

/// The admin's beta program choice, read from the server's settings (the server may not run).
fn peek_beta_program() -> bool {
    crate::storage::read_json::<AppConfig>(&paths::server_config_file()).is_ok_and(|c| c.beta_program)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extras_by_name() {
        assert_eq!(Extra::parse("manager"), Some(Extra::Manager));
        assert_eq!(Extra::parse("StreamDeck"), Some(Extra::StreamDeck));
        assert_eq!(Extra::parse("viewer"), None);
    }

    #[test]
    fn the_managers_setup_comes_from_its_latest_json() {
        let latest = json!({
            "version": "0.7.0",
            "platforms": {
                "windows-x86_64": { "url": "https://example/OpenPres-Manager-0.7.0-Windows-x64-Setup.exe", "signature": "s" },
                "windows-x86_64-msi": { "url": "https://example/x.msi", "signature": "s" }
            }
        });
        assert_eq!(manager_installer(&latest, "windows-x86_64").as_deref(), Some("https://example/OpenPres-Manager-0.7.0-Windows-x64-Setup.exe"));
        assert_eq!(manager_installer(&latest, "darwin-aarch64"), None);
    }

    #[test]
    fn the_newest_plugin_and_betas_only_for_the_beta_program() {
        let asset = |name: &str| json!({ "name": name, "browser_download_url": format!("https://example/{name}") });
        let releases = json!([
            { "draft": false, "prerelease": true, "assets": [asset("OpenPres-StreamDeck-Plugin-0.7.0.2-beta.streamDeckPlugin")] },
            { "draft": true, "prerelease": false, "assets": [asset("OpenPres-StreamDeck-Plugin-0.8.0.streamDeckPlugin")] },
            { "draft": false, "prerelease": false, "assets": [asset("SHA256SUMS.txt"), asset("OpenPres-StreamDeck-Plugin-0.7.0.streamDeckPlugin")] },
        ]);
        assert_eq!(plugin_download(&releases, false).unwrap().0, "OpenPres-StreamDeck-Plugin-0.7.0.streamDeckPlugin");
        assert_eq!(plugin_download(&releases, true).unwrap().0, "OpenPres-StreamDeck-Plugin-0.7.0.2-beta.streamDeckPlugin");
        assert_eq!(plugin_download(&json!([]), true), None);
    }

    #[test]
    fn reads_the_install_folder_from_reg_query() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OpenPres Manager\r\n    InstallLocation    REG_SZ    \"C:\\Users\\Ana María\\AppData\\Local\\OpenPres Manager\"\r\n\r\n";
        assert_eq!(install_location(out), Some(PathBuf::from("C:\\Users\\Ana María\\AppData\\Local\\OpenPres Manager")));
        assert_eq!(install_location("ERROR: The system was unable to find the specified registry key or value."), None);
    }

    #[test]
    fn this_computer_has_a_platform_key() {
        assert!(platform_key().is_some());
    }
}
