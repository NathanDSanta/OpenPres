//! Two playback slots: `visual` (pictures/videos on the media layer; a video's sound goes
//! to a bus) and `audio` (audio files). The frontend shows videos itself and keeps them in
//! sync with the position published here; the backend plays the sound.

use super::{EndAction, MediaKind};
use crate::{
    audio::{db_to_gain, decode::Playback, Graph, Node},
    storage::now_ms,
    theme::style::MediaFit,
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    Visual,
    Audio,
}

impl Slot {
    fn index(self) -> usize {
        match self {
            Slot::Visual => 0,
            Slot::Audio => 1,
        }
    }
    fn node_id(self) -> Uuid {
        Uuid::new_v5(&Uuid::NAMESPACE_OID, if self == Slot::Visual { b"slot-visual" } else { b"slot-audio" })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SlotState {
    pub playlist_id: Option<Uuid>,
    pub index: usize,
    pub media_id: Uuid,
    pub name: String,
    pub kind: MediaKind,
    pub playing: bool,
    /// Position at `anchor_ms`.
    pub position_ms: u64,
    /// Epoch ms of the last play/seek; current position = position_ms + (now - anchor_ms).
    pub anchor_ms: i64,
    pub duration_ms: Option<u64>,
    pub end_action: EndAction,
    pub bus: u8,
    pub mono: bool,
    pub fit: MediaFit,
    pub image_seconds: u32,
    pub volume_db: f32,
}

impl SlotState {
    pub fn position_now(&self) -> u64 {
        if self.playing {
            self.position_ms + (now_ms() - self.anchor_ms).max(0) as u64
        } else {
            self.position_ms
        }
    }
}

#[derive(Default)]
struct Runtime {
    state: Option<SlotState>,
    playback: Option<Playback>,
    path: Option<PathBuf>,
}

pub struct MediaPlayer {
    graph: Arc<Graph>,
    slots: Mutex<[Runtime; 2]>,
    /// Volume kept per slot across items.
    volumes: Mutex<[f32; 2]>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerView {
    pub visual: Option<SlotState>,
    pub audio: Option<SlotState>,
    pub volumes: [f32; 2],
    pub now_ms: i64,
}

/// Why a slot needs attention from the playlist logic.
pub enum Due {
    Ended(Slot),
}

impl MediaPlayer {
    pub fn new(graph: Arc<Graph>) -> Self {
        Self {
            graph,
            slots: Mutex::new([Runtime::default(), Runtime::default()]),
            volumes: Mutex::new([0.0, 0.0]),
        }
    }

    pub fn view(&self) -> PlayerView {
        let slots = self.slots.lock().unwrap();
        PlayerView {
            visual: slots[0].state.clone(),
            audio: slots[1].state.clone(),
            volumes: *self.volumes.lock().unwrap(),
            now_ms: now_ms(),
        }
    }

    pub fn state(&self, slot: Slot) -> Option<SlotState> {
        self.slots.lock().unwrap()[slot.index()].state.clone()
    }

    fn node(&self, slot: Slot, state: &SlotState) -> Arc<Node> {
        let id = slot.node_id();
        let node = match self.graph.producer(id) {
            Some(node) => node,
            None => {
                let node = Node::new(id, state.bus, 1.0, false);
                self.graph.add_producer(node.clone());
                node
            }
        };
        node.set_gain(db_to_gain(state.volume_db));
        self.graph.set_bus(id, state.bus);
        node
    }

    fn restart_audio(&self, slot: Slot, rt: &mut Runtime, ffmpeg: &str) {
        rt.playback = None;
        let (Some(state), Some(path)) = (&rt.state, &rt.path) else { return };
        if state.playing && state.kind.has_audio() {
            let node = self.node(slot, state);
            rt.playback = Some(Playback::start(
                path.clone(),
                state.position_ms,
                node,
                state.mono,
                ffmpeg.to_string(),
            ));
        }
    }

    /// Replaces what the slot plays.
    pub fn load(&self, slot: Slot, mut state: SlotState, path: PathBuf, ffmpeg: &str) {
        state.volume_db = self.volumes.lock().unwrap()[slot.index()];
        state.anchor_ms = now_ms();
        let mut slots = self.slots.lock().unwrap();
        let rt = &mut slots[slot.index()];
        rt.state = Some(state);
        rt.path = Some(path);
        self.restart_audio(slot, rt, ffmpeg);
    }

    pub fn set_playing(&self, slot: Slot, playing: bool, ffmpeg: &str) -> bool {
        let mut slots = self.slots.lock().unwrap();
        let rt = &mut slots[slot.index()];
        let Some(state) = rt.state.as_mut() else { return false };
        if state.playing == playing {
            return true;
        }
        state.position_ms = state.position_now();
        state.anchor_ms = now_ms();
        state.playing = playing;
        self.restart_audio(slot, rt, ffmpeg);
        true
    }

    pub fn seek(&self, slot: Slot, position_ms: u64, ffmpeg: &str) -> bool {
        let mut slots = self.slots.lock().unwrap();
        let rt = &mut slots[slot.index()];
        let Some(state) = rt.state.as_mut() else { return false };
        state.position_ms = match state.duration_ms {
            Some(d) => position_ms.min(d),
            None => position_ms,
        };
        state.anchor_ms = now_ms();
        self.restart_audio(slot, rt, ffmpeg);
        true
    }

    pub fn set_volume(&self, slot: Slot, volume_db: f32) {
        self.volumes.lock().unwrap()[slot.index()] = volume_db;
        let mut slots = self.slots.lock().unwrap();
        if let Some(state) = slots[slot.index()].state.as_mut() {
            state.volume_db = volume_db;
        }
        if let Some(node) = self.graph.producer(slot.node_id()) {
            node.set_gain(db_to_gain(volume_db));
        }
    }

    /// Learns a duration reported later (e.g. a video's length from the frontend).
    pub fn set_duration(&self, media_id: Uuid, duration_ms: u64) {
        let mut slots = self.slots.lock().unwrap();
        for rt in slots.iter_mut() {
            if let Some(state) = rt.state.as_mut() {
                if state.media_id == media_id && state.duration_ms.is_none() {
                    state.duration_ms = Some(duration_ms);
                }
            }
        }
    }

    pub fn clear(&self, slot: Slot) {
        let mut slots = self.slots.lock().unwrap();
        let rt = &mut slots[slot.index()];
        rt.playback = None;
        rt.state = None;
        rt.path = None;
    }

    /// Slots whose item has finished.
    pub fn due(&self) -> Vec<Due> {
        let slots = self.slots.lock().unwrap();
        let mut out = Vec::new();
        for (slot, rt) in [(Slot::Visual, &slots[0]), (Slot::Audio, &slots[1])] {
            let Some(state) = &rt.state else { continue };
            if !state.playing {
                continue;
            }
            let position = state.position_now();
            let finished = match state.kind {
                MediaKind::Audio => {
                    rt.playback.as_ref().is_some_and(|p| p.ended())
                        || state.duration_ms.is_some_and(|d| position >= d + 1500)
                }
                MediaKind::Video => state.duration_ms.is_some_and(|d| position >= d),
                MediaKind::Image => state.image_seconds > 0 && position >= state.image_seconds as u64 * 1000,
            };
            if finished {
                out.push(Due::Ended(slot));
            }
        }
        out
    }
}
