//! Change notifications. Every state change bumps a revision number; windows and web
//! clients refetch what they show when it changes instead of polling constantly.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppEvent {
    /// Something changed; clients refetch.
    Changed { revision: u64 },
    /// The desktop shell should open (Some) or close (None) the offscreen stream compositor.
    StreamCompositor {
        screen_id: Option<Uuid>,
        width: u32,
        height: u32,
        fps: u32,
    },
}

pub struct EventHub {
    revision: AtomicU64,
    tx: broadcast::Sender<AppEvent>,
}

impl Default for EventHub {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            revision: AtomicU64::new(1),
            tx,
        }
    }
}

impl EventHub {
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }
    pub fn changed(&self) {
        let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.tx.send(AppEvent::Changed { revision });
    }
    pub fn send(&self, event: AppEvent) {
        let _ = self.tx.send(event);
    }
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.tx.subscribe()
    }
}
