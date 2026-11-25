//! The server's own updates (from GitHub Releases). The library keeps what is known and
//! takes requests (from the API and the tray); the program (main.rs) does the checking and
//! installing with Tauri's updater, which the library doesn't have (tests run without it).

use serde::Serialize;
use std::sync::{Mutex, RwLock};
use tokio::sync::mpsc;

/// Where servers in the beta program look for updates: every release, beta or stable, also
/// puts its latest.json on the "beta-feed" release, so it always offers the newest one.
/// Stable servers keep the address in tauri.conf.json (the newest stable release).
pub const BETA_FEED: &str = "https://github.com/NathanDSanta/OpenPres/releases/download/beta-feed/latest.json";

/// A version as people see it. Betas are named after the stable they build on ("0.7.0.3 beta":
/// the 3rd since 0.7.0), but the desktop apps carry them as 0.7.1-3, which sorts after 0.7.0
/// and before the hotfix 0.7.1 (docs/RELEASING.md).
pub fn display_version(version: &str) -> String {
    if let Some((base, beta)) = version.split_once('-') {
        let parts: Vec<u64> = base.split('.').filter_map(|p| p.parse().ok()).collect();
        if let (Ok(beta), [x, y, z]) = (beta.parse::<u64>(), parts.as_slice()) {
            if *z >= 1 {
                return format!("{x}.{y}.{}.{beta} beta", z - 1);
            }
        }
    }
    version.to_string()
}

/// A newer version.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Available {
    pub version: String,
    /// As people see it ("0.7.0.3 beta").
    pub name: String,
    /// The release notes (Markdown).
    pub notes: String,
    pub date: Option<String>,
}

/// What the server is doing about updates.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Activity {
    #[default]
    Idle,
    Checking,
    Downloading {
        done: u64,
        total: Option<u64>,
    },
    /// Installed (or the installer is running): the server is about to restart.
    Installing,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateStatus {
    /// The running version.
    pub current: &'static str,
    /// As people see it ("0.7.0", "0.7.0.3 beta").
    pub current_name: String,
    /// Betas are offered too (the beta program).
    pub beta: bool,
    /// This server can update itself (an installed release, not a test build).
    pub supported: bool,
    pub available: Option<Available>,
    #[serde(flatten)]
    pub activity: Activity,
    /// The last check or install failed (no internet, GitHub down…).
    pub error: Option<String>,
    /// When it last asked GitHub (ms since 1970).
    pub checked_at_ms: Option<u64>,
    /// Updates install by themselves (Settings → System).
    pub automatic: bool,
    /// An automatic update is waiting for the server to be free (why).
    pub waiting: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    Check,
    Install,
}

pub struct Updates {
    status: RwLock<UpdateStatus>,
    requests: mpsc::UnboundedSender<Request>,
    receiver: Mutex<Option<mpsc::UnboundedReceiver<Request>>>,
}

impl Default for Updates {
    fn default() -> Self {
        let (requests, receiver) = mpsc::unbounded_channel();
        Self {
            status: RwLock::new(UpdateStatus {
                current: env!("CARGO_PKG_VERSION"),
                current_name: display_version(env!("CARGO_PKG_VERSION")),
                beta: false,
                supported: false,
                available: None,
                activity: Activity::Idle,
                error: None,
                checked_at_ms: None,
                automatic: false,
                waiting: None,
            }),
            requests,
            receiver: Mutex::new(Some(receiver)),
        }
    }
}

impl Updates {
    pub fn status(&self) -> UpdateStatus {
        self.status.read().unwrap().clone()
    }

    /// For the program that does the updating: the requests, once. Marks updates as supported.
    pub fn take_requests(&self) -> Option<mpsc::UnboundedReceiver<Request>> {
        let taken = self.receiver.lock().unwrap().take();
        if taken.is_some() {
            self.status.write().unwrap().supported = true;
        }
        taken
    }

    /// Asks for a check or an install. False if nothing handles them (not supported).
    pub fn request(&self, request: Request) -> bool {
        self.status().supported && self.requests.send(request).is_ok()
    }

    pub fn update(&self, change: impl FnOnce(&mut UpdateStatus)) {
        change(&mut self.status.write().unwrap());
    }
}

/// Why an update shouldn't install itself now (something is live), or None when it can.
/// Asleep and Standby show nothing, so they're always free.
pub async fn busy(state: &crate::state::SharedState) -> Option<String> {
    use crate::{config::Power, presentation::PresentationLayer};
    let stream = state.stream.status();
    if stream.streaming {
        return Some("the stream is live".into());
    }
    if stream.recording_file.is_some() {
        return Some("it's recording".into());
    }
    if state.config.read().await.power != Power::Active {
        return None;
    }
    let presenter = state.presenter.read().await;
    if presenter.get(PresentationLayer::Slides).is_some() || presenter.get(PresentationLayer::Announcements).is_some() {
        return Some("slides are on the screens".into());
    }
    drop(presenter);
    if state.bible_live.read().await.is_some() {
        return Some("a Bible passage is on the screens".into());
    }
    let player = state.player.view();
    if player.visual.is_some() {
        return Some("media is on the screens".into());
    }
    if player.audio.is_some() {
        return Some("audio is playing".into());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_need_someone_to_handle_them() {
        let updates = Updates::default();
        assert!(!updates.status().supported);
        assert!(!updates.request(Request::Check), "a test build has no updater");
        let mut rx = updates.take_requests().unwrap();
        assert!(updates.status().supported);
        assert!(updates.request(Request::Install));
        assert_eq!(rx.try_recv().unwrap(), Request::Install);
        assert!(updates.take_requests().is_none(), "only once");
    }

    #[test]
    fn status_json_is_flat() {
        let updates = Updates::default();
        updates.update(|s| s.activity = Activity::Downloading { done: 5, total: Some(10) });
        let json = serde_json::to_value(updates.status()).unwrap();
        assert_eq!(json["state"], "downloading");
        assert_eq!(json["done"], 5);
        assert_eq!(json["total"], 10);
        assert_eq!(json["current"], env!("CARGO_PKG_VERSION"));
    }
}
