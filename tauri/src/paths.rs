//! Where OpenPres keeps its files. The server and the manager have a folder each:
//!
//! ```text
//! <data>/OpenPres/              Windows: %APPDATA%\OpenPres
//! ├── Server/                   the server: config.json, songs, media, Bibles…
//! │   ├── logs/                 server.YYYY-MM-DD.log
//! │   └── WebView/              browser data of its windows (outputs, setup)
//! └── Manager/
//!     ├── logs/                 manager.YYYY-MM-DD.log
//!     └── WebView/              browser data of the manager window (last server, mode…)
//! ```
//!
//! `OPENPRES_DATA_DIR` replaces `<data>/OpenPres` (tests, several copies on one computer).
//! Versions before 0.4 kept the server's files directly in `OpenPres/`; [`move_old_server_files`]
//! moves them into `Server/` the first time the new server starts.

use directories::BaseDirs;
use std::path::{Path, PathBuf};

/// Which of the two programs this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Server,
    Manager,
}

impl Role {
    /// From the command line: `--server` is the server.
    pub fn from_args() -> Self {
        if std::env::args().any(|a| a == "--server") {
            Role::Server
        } else {
            Role::Manager
        }
    }

    /// "server" / "manager" (log file names).
    pub fn name(self) -> &'static str {
        match self {
            Role::Server => "server",
            Role::Manager => "manager",
        }
    }

    /// The role's folder.
    pub fn dir(self) -> PathBuf {
        match self {
            Role::Server => server_dir(),
            Role::Manager => manager_dir(),
        }
    }

    pub fn logs_dir(self) -> PathBuf {
        self.dir().join("logs")
    }

    /// Browser data of the role's windows (Windows and Linux; macOS keeps its own).
    pub fn webview_dir(self) -> PathBuf {
        self.dir().join("WebView")
    }
}

/// `<data>/OpenPres`.
pub fn root() -> PathBuf {
    std::env::var_os("OPENPRES_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            BaseDirs::new()
                .map(|d| d.data_dir().join("OpenPres")) // e.g. AppData\Roaming\OpenPres
                .unwrap_or_else(|| PathBuf::from("./data"))
        })
}

pub fn server_dir() -> PathBuf {
    root().join("Server")
}

pub fn manager_dir() -> PathBuf {
    root().join("Manager")
}

/// The server's settings file, for managers that peek at this computer's server: the old
/// place until the new server has moved it.
pub fn server_config_file() -> PathBuf {
    let new = server_dir().join("config.json");
    let old = root().join("config.json");
    if !new.exists() && old.exists() {
        old
    } else {
        new
    }
}

/// What [`move_old_server_files`] did.
#[derive(Debug, PartialEq, Eq)]
pub enum Moved {
    /// Nothing to move (a new install, or already moved).
    Nothing,
    /// Everything moved into `Server/`.
    Done(usize),
    /// Some files couldn't be moved (in use?). The server keeps using the old folder this
    /// time and tries again at the next start.
    Failed(String),
}

/// Moves the server's files from `OpenPres/` (before 0.4) into `OpenPres/Server/`.
/// Returns the folder the server should use now.
pub fn move_old_server_files(root: &Path) -> (PathBuf, Moved) {
    let server = root.join("Server");
    let old_config = root.join("config.json");
    if !old_config.exists() || server.join("config.json").exists() {
        return (server, Moved::Nothing);
    }
    if let Err(e) = std::fs::create_dir_all(&server) {
        return (
            root.to_path_buf(),
            Moved::Failed(format!("cannot create {}: {e}", server.display())),
        );
    }
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) => {
            return (
                root.to_path_buf(),
                Moved::Failed(format!("cannot read {}: {e}", root.display())),
            )
        }
    };
    let mut names: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|e| e.file_name())
        .filter(|n| n != "Server" && n != "Manager")
        .collect();
    // config.json last: while it's still in the old place, the move isn't finished and is
    // tried again (from where it stopped) at the next start.
    names.sort_by_key(|n| n == "config.json");
    let mut moved = 0;
    for name in names {
        let (from, to) = (root.join(&name), server.join(&name));
        if to.exists() {
            // Left by an earlier, unfinished move? Keep both; nothing is lost.
            let kept = server.join(format!("{}.old", name.to_string_lossy()));
            if let Err(e) = std::fs::rename(&from, &kept) {
                return (
                    root.to_path_buf(),
                    Moved::Failed(format!("{}: {e}", from.display())),
                );
            }
            continue;
        }
        if let Err(e) = std::fs::rename(&from, &to) {
            return (
                root.to_path_buf(),
                Moved::Failed(format!("{}: {e}", from.display())),
            );
        }
        moved += 1;
    }
    (server, Moved::Done(moved))
}

/// Before 0.4 the manager window kept its browser data (last server, last mode, dashboards…)
/// in the app's default place; copies it to `Manager/WebView` once, so nothing is lost.
/// Caches are left behind.
#[cfg(any(windows, target_os = "linux"))]
pub fn copy_old_manager_webview(old: &Path, new: &Path) -> std::io::Result<bool> {
    if new.exists() || !old.is_dir() {
        return Ok(false);
    }
    let partial = new.with_extension("copying");
    let _ = std::fs::remove_dir_all(&partial);
    copy_dir(old, &partial)?;
    std::fs::rename(&partial, new)?;
    Ok(true)
}

#[cfg(any(windows, target_os = "linux"))]
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    const CACHES: [&str; 8] = [
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "GrShaderCache",
        "ShaderCache",
    ];
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if CACHES.iter().any(|c| name == *c) {
                continue;
            }
            copy_dir(&entry.path(), &to.join(&name))?;
        } else if kind.is_file() {
            // A file in use (lock files) is skipped; the browser makes new ones.
            if let Err(e) = std::fs::copy(entry.path(), to.join(&name)) {
                tracing::debug!("not copied: {}: {e}", entry.path().display());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_server_files_move_into_server() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        std::fs::write(r.join("config.json"), "{}").unwrap();
        std::fs::write(r.join("screens.json"), "[]").unwrap();
        std::fs::create_dir_all(r.join("bibles")).unwrap();
        std::fs::write(r.join("bibles").join("kjv.json"), "{}").unwrap();
        std::fs::create_dir_all(r.join("Manager").join("logs")).unwrap();

        let (dir, moved) = move_old_server_files(r);
        assert_eq!(dir, r.join("Server"));
        assert_eq!(moved, Moved::Done(3));
        assert!(r.join("Server/config.json").exists());
        assert!(r.join("Server/bibles/kjv.json").exists());
        assert!(!r.join("config.json").exists());
        assert!(
            r.join("Manager/logs").exists(),
            "the manager's folder stays"
        );

        // Second start: nothing to do.
        assert_eq!(move_old_server_files(r).1, Moved::Nothing);
    }

    #[test]
    fn new_install_moves_nothing() {
        let root = tempfile::tempdir().unwrap();
        let (dir, moved) = move_old_server_files(root.path());
        assert_eq!(dir, root.path().join("Server"));
        assert_eq!(moved, Moved::Nothing);
    }

    #[test]
    fn unfinished_move_continues() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        // An earlier start moved screens.json, then stopped before config.json.
        std::fs::create_dir_all(r.join("Server")).unwrap();
        std::fs::write(r.join("Server/screens.json"), "[1]").unwrap();
        std::fs::write(r.join("config.json"), "{}").unwrap();
        std::fs::write(r.join("groups.json"), "{}").unwrap();

        let (dir, moved) = move_old_server_files(r);
        assert_eq!(dir, r.join("Server"));
        assert_eq!(moved, Moved::Done(2));
        assert_eq!(
            std::fs::read_to_string(r.join("Server/screens.json")).unwrap(),
            "[1]"
        );
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn manager_browser_data_is_copied_once_without_caches() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("old");
        std::fs::create_dir_all(old.join("EBWebView/Default/Local Storage/leveldb")).unwrap();
        std::fs::create_dir_all(old.join("EBWebView/Default/Cache")).unwrap();
        std::fs::write(
            old.join("EBWebView/Default/Local Storage/leveldb/000003.log"),
            "x",
        )
        .unwrap();
        std::fs::write(old.join("EBWebView/Default/Cache/data_0"), "big").unwrap();
        let new = tmp.path().join("Manager/WebView");

        assert!(copy_old_manager_webview(&old, &new).unwrap());
        assert!(new
            .join("EBWebView/Default/Local Storage/leveldb/000003.log")
            .exists());
        assert!(!new.join("EBWebView/Default/Cache").exists());
        assert!(!copy_old_manager_webview(&old, &new).unwrap(), "only once");
    }
}
