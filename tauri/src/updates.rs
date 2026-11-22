//! The server's own updates (from GitHub Releases). The library keeps what is known and
//! takes requests (from the API and the tray); the program (main.rs) does the checking and
//! installing with Tauri's updater, which the library doesn't have (tests run without it).

use serde::Serialize;
use std::sync::{Mutex, RwLock};
use tokio::sync::mpsc;

/// A newer version.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Available {
    pub version: String,
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
    /// This server can update itself (an installed release, not a test build).
    pub supported: bool,
    pub available: Option<Available>,
    #[serde(flatten)]
    pub activity: Activity,
    /// The last check or install failed (no internet, GitHub down…).
    pub error: Option<String>,
    /// When it last asked GitHub (ms since 1970).
    pub checked_at_ms: Option<u64>,
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
                supported: false,
                available: None,
                activity: Activity::Idle,
                error: None,
                checked_at_ms: None,
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
