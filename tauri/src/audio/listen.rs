//! Listening to a bus over the network: the viewers (the Android app, /viewer in a browser) and,
//! later, translation tracks. There's one feed per bus and format, shared by everyone listening
//! to it: it takes the bus's sound from the graph once, converts it once, and hands the same
//! chunks to every listener. Thirty phones on one bus cost about what one does.
//!
//! The sound is raw 16-bit PCM (little-endian), stereo or mono, at 48, 24 or 16 kHz, in chunks
//! of 50 ms. The lower rates are for speech on busy Wi-Fi: 24 kHz mono is an eighth of 48 kHz
//! stereo.

use super::{graph::Node, Graph, BUSES, ENGINE_RATE};
use crate::error::AppError;
use axum::body::Bytes;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Sample rates a listener can ask for: 48 kHz divided by a whole number, so converting is just
/// averaging (which also filters out what the lower rate can't carry).
pub const RATES: [u32; 3] = [48_000, 24_000, 16_000];

const BLOCK: Duration = Duration::from_millis(10);
const BLOCK_FRAMES: usize = ENGINE_RATE as usize / 100;
/// Blocks per chunk sent: 50 ms.
const BLOCKS_PER_CHUNK: u64 = 5;
/// Chunks kept for a listener that falls behind (0.5 s); one that falls further skips ahead
/// instead of staying late.
const BACKLOG: usize = 10;

/// What a listener receives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Format {
    pub rate: u32,
    pub channels: u8,
}

impl Format {
    pub fn new(rate: u32, mono: bool) -> Result<Self, AppError> {
        if !RATES.contains(&rate) {
            return Err(AppError::BadRequest(format!("rate must be one of {RATES:?}")));
        }
        Ok(Self { rate, channels: if mono { 1 } else { 2 } })
    }

    /// The Content-Type of the sound.
    pub fn content_type(&self) -> String {
        format!("audio/L16; rate={}; channels={}", self.rate, self.channels)
    }

    fn chunk_bytes(&self) -> usize {
        BLOCK_FRAMES / (ENGINE_RATE / self.rate) as usize * self.channels as usize * 2 * BLOCKS_PER_CHUNK as usize
    }
}

/// The feeds running now, by bus and format.
pub struct Feeds {
    graph: Arc<Graph>,
    running: Mutex<HashMap<(u8, Format), broadcast::Sender<Bytes>>>,
}

impl Feeds {
    pub fn new(graph: Arc<Graph>) -> Arc<Self> {
        Arc::new(Self { graph, running: Mutex::new(HashMap::new()) })
    }

    /// Starts listening to bus `bus` (1-16): joins its feed in that format, starting the feed if
    /// nobody was listening. Dropping the receiver leaves; the last one to leave stops the feed.
    pub fn listen(self: &Arc<Self>, bus: u8, format: Format) -> Result<broadcast::Receiver<Bytes>, AppError> {
        if !(1..=BUSES).contains(&bus) {
            return Err(AppError::NotFound(format!("bus {bus}")));
        }
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(tx) = running.get(&(bus, format)) {
            return Ok(tx.subscribe());
        }
        let (tx, rx) = broadcast::channel(BACKLOG);
        let sink = Node::new(Uuid::new_v4(), bus, 1.0, false);
        self.graph.add_consumer(sink.clone());
        let feeds = self.clone();
        let feed_tx = tx.clone();
        let feed_sink = sink.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("bus-{bus}-feed"))
            .spawn(move || feeds.run(bus, format, feed_sink, feed_tx))
        {
            self.graph.remove(sink.id);
            return Err(AppError::Internal(format!("could not start listening: {e}")));
        }
        running.insert((bus, format), tx);
        Ok(rx)
    }

    /// How many are listening to bus `bus`, in any format.
    pub fn listeners(&self, bus: u8) -> usize {
        let running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        running.iter().filter(|((b, _), _)| *b == bus).map(|(_, tx)| tx.receiver_count()).sum()
    }

    /// The feed's thread: a block of the bus every 10 ms, a chunk to the listeners every 50 ms.
    fn run(&self, bus: u8, format: Format, sink: Arc<Node>, tx: broadcast::Sender<Bytes>) {
        let mut block = vec![0f32; BLOCK_FRAMES * 2];
        let mut chunk = Vec::with_capacity(format.chunk_bytes());
        let start = Instant::now();
        let mut index: u64 = 0;
        loop {
            if tx.receiver_count() == 0 {
                // Checked again under the lock, so nobody joins a feed that is stopping.
                let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
                if tx.receiver_count() == 0 {
                    running.remove(&(bus, format));
                    break;
                }
            }
            let due = start + Duration::from_millis(10 * (index + 1));
            let now = Instant::now();
            if due > now {
                std::thread::sleep(due - now);
            } else if now - due > BLOCK * 50 {
                // The computer stalled for half a second: carry on from now rather than catch up.
                index = (now - start).as_millis() as u64 / 10;
                chunk.clear();
            }
            sink.consume(&mut block);
            encode(&block, format, &mut chunk);
            index += 1;
            if index % BLOCKS_PER_CHUNK == 0 {
                let full = std::mem::replace(&mut chunk, Vec::with_capacity(format.chunk_bytes()));
                // Nobody listening between two checks is fine: the next turn stops the feed.
                let _ = tx.send(Bytes::from(full));
            }
        }
        self.graph.remove(sink.id);
    }
}

/// Appends `block` (interleaved stereo at 48 kHz) to `out` in `format`.
pub fn encode(block: &[f32], format: Format, out: &mut Vec<u8>) {
    let step = (ENGINE_RATE / format.rate) as usize;
    let scale = 1.0 / step as f32;
    let mut write = |v: f32| out.extend_from_slice(&((v.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
    for frames in block.chunks_exact(2 * step) {
        let (mut l, mut r) = (0f32, 0f32);
        for frame in frames.chunks_exact(2) {
            l += frame[0];
            r += frame[1];
        }
        if format.channels == 1 {
            write((l + r) * 0.5 * scale);
        } else {
            write(l * scale);
            write(r * scale);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn samples(bytes: &[u8]) -> Vec<i16> {
        bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
    }

    #[test]
    fn formats() {
        assert!(Format::new(44_100, false).is_err());
        let f = Format::new(24_000, true).unwrap();
        assert_eq!(f.content_type(), "audio/L16; rate=24000; channels=1");
        // 50 ms of 24 kHz mono: 1200 samples.
        assert_eq!(f.chunk_bytes(), 2400);
        assert_eq!(Format::new(48_000, false).unwrap().chunk_bytes(), 9600);
    }

    #[test]
    fn encodes_each_format() {
        // Left 0.5, right 0.25, for one block.
        let block: Vec<f32> = (0..BLOCK_FRAMES).flat_map(|_| [0.5f32, 0.25]).collect();
        for (rate, mono) in [(48_000, false), (24_000, true), (16_000, false), (16_000, true)] {
            let format = Format::new(rate, mono).unwrap();
            let mut out = vec![];
            encode(&block, format, &mut out);
            let s = samples(&out);
            assert_eq!(s.len(), BLOCK_FRAMES * format.channels as usize / (48_000 / rate) as usize, "{rate} {mono}");
            if mono {
                assert!(s.iter().all(|v| (*v - (0.375 * 32767.0) as i16).abs() <= 1));
            } else {
                assert!(s.chunks_exact(2).all(|p| (p[0] - 16383).abs() <= 1 && (p[1] - 8191).abs() <= 1));
            }
        }
    }

    #[test]
    fn averaging_removes_what_the_lower_rate_cannot_carry() {
        // A tone at 24 kHz (+1, -1, ...) can't exist at 24 kHz: averaging pairs cancels it.
        let block: Vec<f32> = (0..BLOCK_FRAMES).flat_map(|i| if i % 2 == 0 { [1.0f32, 1.0] } else { [-1.0, -1.0] }).collect();
        let mut out = vec![];
        encode(&block, Format::new(24_000, true).unwrap(), &mut out);
        assert!(samples(&out).iter().all(|v| *v == 0));
    }

    #[test]
    fn listeners_share_one_feed_that_stops_when_they_leave() {
        let graph = Arc::new(Graph::default());
        let producer = Node::new(Uuid::new_v4(), 3, 1.0, false);
        graph.add_producer(producer.clone());
        let feeds = Feeds::new(graph.clone());
        let format = Format::new(24_000, true).unwrap();
        let mut a = feeds.listen(3, format).unwrap();
        let mut b = feeds.listen(3, format).unwrap();
        let other = feeds.listen(3, Format::new(48_000, false).unwrap()).unwrap();
        assert_eq!(feeds.listeners(3), 3);
        assert_eq!(feeds.listeners(4), 0);
        assert_eq!(feeds.running.lock().unwrap().len(), 2, "one feed per format");
        // Two feeds, two consumers on the graph (not one per listener).
        assert_eq!(graph.take_peaks().len(), 3);
        drop(other);

        // Sound on the bus reaches both listeners, as the same chunk.
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        let (first, second) = rt.block_on(async {
            for _ in 0..40 {
                let mut tone = vec![0.5f32; BLOCK_FRAMES * 2];
                producer.produce(&mut tone);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            loop {
                let chunk = tokio::time::timeout(Duration::from_secs(2), a.recv()).await.expect("no sound").unwrap();
                if samples(&chunk).iter().any(|v| *v != 0) {
                    // b got the same chunks in the same order.
                    loop {
                        let other = b.recv().await.unwrap();
                        if other == chunk {
                            return (chunk, other);
                        }
                    }
                }
            }
        });
        assert_eq!(first.len(), 2400);
        assert_eq!(first.as_ptr(), second.as_ptr(), "the same bytes, not a copy");

        drop(a);
        drop(b);
        let gone = Instant::now();
        while feeds.listeners(3) > 0 || !feeds.running.lock().unwrap().is_empty() {
            assert!(gone.elapsed() < Duration::from_secs(2), "the feeds didn't stop");
            std::thread::sleep(Duration::from_millis(10));
        }
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(graph.take_peaks().len(), 1, "the feeds left the graph");
    }

    #[test]
    fn rejects_buses_that_do_not_exist() {
        let feeds = Feeds::new(Arc::new(Graph::default()));
        let format = Format::new(48_000, false).unwrap();
        assert!(feeds.listen(0, format).is_err());
        assert!(feeds.listen(17, format).is_err());
    }
}
