//! The routing graph: producers (inputs, media players) and consumers (outputs, the stream
//! encoder). Every producer/consumer pair on the same bus is connected by a ring buffer.
//! Producers push on their own clock (device callback or paced thread); consumers pull on
//! theirs. Rings are kept short so clock drift between devices only costs an occasional
//! dropped or repeated block instead of growing latency.

use super::ENGINE_RATE;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
};
use uuid::Uuid;

const MAX_FRAMES: usize = ENGINE_RATE as usize / 4; // 250 ms: beyond this, latency is trimmed
const TRIM_FRAMES: usize = ENGINE_RATE as usize / 25; // back to 40 ms
const PREFILL_FRAMES: usize = ENGINE_RATE as usize / 50; // wait for 20 ms before playing

pub struct AtomicF32(AtomicU32);

impl AtomicF32 {
    pub fn new(v: f32) -> Self {
        Self(AtomicU32::new(v.to_bits()))
    }
    pub fn get(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }
    pub fn set(&self, v: f32) {
        self.0.store(v.to_bits(), Ordering::Relaxed)
    }
    pub fn take(&self) -> f32 {
        f32::from_bits(self.0.swap(0, Ordering::Relaxed))
    }
    pub fn raise(&self, v: f32) {
        if v > self.get() {
            self.set(v)
        }
    }
}

pub struct Ring {
    buf: Mutex<VecDeque<f32>>,
    primed: AtomicBool,
}

impl Ring {
    fn new() -> Self {
        Self {
            buf: Mutex::new(VecDeque::with_capacity(MAX_FRAMES * 2)),
            primed: AtomicBool::new(false),
        }
    }

    fn push(&self, samples: &[f32]) {
        let Ok(mut buf) = self.buf.lock() else { return };
        buf.extend(samples.iter().copied());
        if buf.len() > MAX_FRAMES * 2 {
            let excess = buf.len() - TRIM_FRAMES * 2;
            buf.drain(..excess);
        }
    }

    /// Adds up to `out.len()` samples into `out`.
    fn mix_into(&self, out: &mut [f32]) {
        let Ok(mut buf) = self.buf.lock() else { return };
        if !self.primed.load(Ordering::Relaxed) {
            if buf.len() < PREFILL_FRAMES * 2 {
                return;
            }
            self.primed.store(true, Ordering::Relaxed);
        }
        let n = out.len().min(buf.len());
        for (o, s) in out[..n].iter_mut().zip(buf.drain(..n)) {
            *o += s;
        }
        if n < out.len() {
            // Ran dry: wait for a fresh prefill instead of crackling sample by sample.
            self.primed.store(false, Ordering::Relaxed);
        }
    }
}

/// Per-bus fader, mute and post-fader meters (index 1-16; 0 is unused).
pub struct BusMix {
    gain: [AtomicF32; 17],
    muted: [AtomicBool; 17],
    peak_l: [AtomicF32; 17],
    peak_r: [AtomicF32; 17],
}

impl Default for BusMix {
    fn default() -> Self {
        Self {
            gain: std::array::from_fn(|_| AtomicF32::new(1.0)),
            muted: std::array::from_fn(|_| AtomicBool::new(false)),
            peak_l: std::array::from_fn(|_| AtomicF32::new(0.0)),
            peak_r: std::array::from_fn(|_| AtomicF32::new(0.0)),
        }
    }
}

impl BusMix {
    pub fn set(&self, bus: u8, gain: f32, muted: bool) {
        if let Some(g) = self.gain.get(bus as usize) {
            g.set(gain);
            self.muted[bus as usize].store(muted, Ordering::Relaxed);
        }
    }
    /// The bus fader as a linear gain (0 when muted).
    pub fn gain(&self, bus: u8) -> f32 {
        let i = bus as usize;
        if i >= 17 || self.muted[i].load(Ordering::Relaxed) {
            0.0
        } else {
            self.gain[i].get()
        }
    }
    fn raise(&self, bus: u8, l: f32, r: f32) {
        let i = bus as usize;
        if i < 17 {
            let g = self.gain(bus);
            self.peak_l[i].raise(l * g);
            self.peak_r[i].raise(r * g);
        }
    }
    /// Post-fader peaks of buses 1-16 since the last call.
    pub fn take_peaks(&self) -> Vec<(f32, f32)> {
        (1..17).map(|i| (self.peak_l[i].take(), self.peak_r[i].take())).collect()
    }
}

/// A producer or consumer in the graph.
pub struct Node {
    pub id: Uuid,
    bus: AtomicU8,
    gain: AtomicF32,
    muted: AtomicBool,
    peak_l: AtomicF32,
    peak_r: AtomicF32,
    rings: RwLock<Vec<Arc<Ring>>>,
    mix: OnceLock<Arc<BusMix>>,
}

impl Node {
    pub fn new(id: Uuid, bus: u8, gain: f32, muted: bool) -> Arc<Self> {
        Arc::new(Self {
            id,
            bus: AtomicU8::new(bus),
            gain: AtomicF32::new(gain),
            muted: AtomicBool::new(muted),
            peak_l: AtomicF32::new(0.0),
            peak_r: AtomicF32::new(0.0),
            rings: RwLock::new(vec![]),
            mix: OnceLock::new(),
        })
    }
    pub fn bus(&self) -> u8 {
        self.bus.load(Ordering::Relaxed)
    }
    pub(super) fn set_bus_raw(&self, bus: u8) {
        self.bus.store(bus, Ordering::Relaxed)
    }
    pub fn set_gain(&self, gain: f32) {
        self.gain.set(gain)
    }
    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed)
    }
    fn effective_gain(&self) -> f32 {
        if self.muted.load(Ordering::Relaxed) {
            0.0
        } else {
            self.gain.get()
        }
    }
    fn meter(&self, stereo: &[f32]) -> (f32, f32) {
        let (mut l, mut r) = (0f32, 0f32);
        for frame in stereo.chunks_exact(2) {
            l = l.max(frame[0].abs());
            r = r.max(frame[1].abs());
        }
        self.peak_l.raise(l);
        self.peak_r.raise(r);
        (l, r)
    }
    /// Peak levels since the last call (linear, 1.0 = full scale).
    pub fn take_peaks(&self) -> (f32, f32) {
        (self.peak_l.take(), self.peak_r.take())
    }

    /// Producer side: applies gain, meters, and sends the block to every connected consumer.
    pub fn produce(&self, stereo: &mut [f32]) {
        let gain = self.effective_gain();
        if gain != 1.0 {
            for s in stereo.iter_mut() {
                *s *= gain;
            }
        }
        let (l, r) = self.meter(stereo);
        if let Some(mix) = self.mix.get() {
            mix.raise(self.bus(), l, r);
        }
        if let Ok(rings) = self.rings.try_read() {
            for ring in rings.iter() {
                ring.push(stereo);
            }
        }
    }

    /// Consumer side: fills `out` with the mix of every connected producer, times the gain.
    pub fn consume(&self, out: &mut [f32]) {
        out.fill(0.0);
        if let Ok(rings) = self.rings.try_read() {
            for ring in rings.iter() {
                ring.mix_into(out);
            }
        }
        // Everything that leaves a bus goes through the bus fader.
        let bus_gain = self.mix.get().map(|m| m.gain(self.bus())).unwrap_or(1.0);
        let gain = self.effective_gain() * bus_gain;
        if gain != 1.0 {
            for s in out.iter_mut() {
                *s *= gain;
            }
        }
        self.meter(out);
    }
}

#[derive(Default)]
pub struct Graph {
    pub buses: Arc<BusMix>,
    producers: RwLock<HashMap<Uuid, Arc<Node>>>,
    consumers: RwLock<HashMap<Uuid, Arc<Node>>>,
    links: Mutex<HashMap<(Uuid, Uuid), Arc<Ring>>>,
}

impl Graph {
    pub fn add_producer(&self, node: Arc<Node>) {
        let _ = node.mix.set(self.buses.clone());
        self.producers.write().unwrap().insert(node.id, node);
        self.rewire();
    }
    pub fn add_consumer(&self, node: Arc<Node>) {
        let _ = node.mix.set(self.buses.clone());
        self.consumers.write().unwrap().insert(node.id, node);
        self.rewire();
    }
    pub fn remove(&self, id: Uuid) {
        self.producers.write().unwrap().remove(&id);
        self.consumers.write().unwrap().remove(&id);
        self.rewire();
    }
    pub fn producer(&self, id: Uuid) -> Option<Arc<Node>> {
        self.producers.read().unwrap().get(&id).cloned()
    }
    pub fn consumer(&self, id: Uuid) -> Option<Arc<Node>> {
        self.consumers.read().unwrap().get(&id).cloned()
    }
    pub fn node(&self, id: Uuid) -> Option<Arc<Node>> {
        self.producer(id).or_else(|| self.consumer(id))
    }
    pub fn set_bus(&self, id: Uuid, bus: u8) {
        if let Some(node) = self.node(id) {
            if node.bus() != bus {
                node.set_bus_raw(bus);
                self.rewire();
            }
        }
    }
    /// Peaks of every node, keyed by id.
    pub fn take_peaks(&self) -> HashMap<Uuid, (f32, f32)> {
        let mut out = HashMap::new();
        for node in self.producers.read().unwrap().values() {
            out.insert(node.id, node.take_peaks());
        }
        for node in self.consumers.read().unwrap().values() {
            out.insert(node.id, node.take_peaks());
        }
        out
    }

    /// Connects every producer to every consumer on the same bus, reusing existing rings.
    pub fn rewire(&self) {
        let producers = self.producers.read().unwrap();
        let consumers = self.consumers.read().unwrap();
        let mut links = self.links.lock().unwrap();
        let mut next = HashMap::new();
        for p in producers.values() {
            for c in consumers.values() {
                if p.bus() == c.bus() {
                    let ring = links
                        .remove(&(p.id, c.id))
                        .unwrap_or_else(|| Arc::new(Ring::new()));
                    next.insert((p.id, c.id), ring);
                }
            }
        }
        for p in producers.values() {
            *p.rings.write().unwrap() = next
                .iter()
                .filter(|((pid, _), _)| *pid == p.id)
                .map(|(_, r)| r.clone())
                .collect();
        }
        for c in consumers.values() {
            *c.rings.write().unwrap() = next
                .iter()
                .filter(|((_, cid), _)| *cid == c.id)
                .map(|(_, r)| r.clone())
                .collect();
        }
        *links = next;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn producer_reaches_consumer_on_same_bus_only() {
        let graph = Graph::default();
        let p = Node::new(Uuid::new_v4(), 3, 1.0, false);
        let c_same = Node::new(Uuid::new_v4(), 3, 1.0, false);
        let c_other = Node::new(Uuid::new_v4(), 4, 1.0, false);
        graph.add_producer(p.clone());
        graph.add_consumer(c_same.clone());
        graph.add_consumer(c_other.clone());

        let mut block = vec![0.25f32; PREFILL_FRAMES * 2 + 64];
        p.produce(&mut block);
        let mut out = vec![0f32; 64];
        c_same.consume(&mut out);
        assert!(out.iter().all(|s| (*s - 0.25).abs() < 1e-6));
        c_other.consume(&mut out);
        assert!(out.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn bus_fader_applies_to_consumers() {
        let graph = Graph::default();
        let p = Node::new(Uuid::new_v4(), 2, 1.0, false);
        let c = Node::new(Uuid::new_v4(), 2, 1.0, false);
        graph.add_producer(p.clone());
        graph.add_consumer(c.clone());
        graph.buses.set(2, 0.5, false);
        let mut block = vec![1.0f32; PREFILL_FRAMES * 2 + 8];
        p.produce(&mut block);
        let mut out = vec![0f32; 8];
        c.consume(&mut out);
        assert!(out.iter().all(|s| (*s - 0.5).abs() < 1e-6));
        let peaks = graph.buses.take_peaks();
        assert!((peaks[1].0 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn mute_and_gain_apply() {
        let graph = Graph::default();
        let p = Node::new(Uuid::new_v4(), 1, 0.5, false);
        let c = Node::new(Uuid::new_v4(), 1, 1.0, true);
        graph.add_producer(p.clone());
        graph.add_consumer(c.clone());
        let mut block = vec![1.0f32; PREFILL_FRAMES * 2 + 8];
        p.produce(&mut block);
        assert!((block[0] - 0.5).abs() < 1e-6);
        let mut out = vec![0f32; 8];
        c.consume(&mut out);
        assert!(out.iter().all(|s| *s == 0.0));
    }
}
