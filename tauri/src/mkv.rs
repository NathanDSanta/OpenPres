//! A minimal live Matroska writer: raw video frames and PCM audio with their timestamps,
//! piped into ffmpeg. One file carries both on one clock (like OBS, which timestamps every
//! frame and audio packet itself), so they stay in sync and frames can be skipped when
//! the encoder falls behind without the rest of the stream shifting.

use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Condvar, Mutex},
};

/// Timestamps are in units of 100 µs (Matroska's TimestampScale, in ns).
pub const TICKS_PER_SECOND: i64 = 10_000;
const TIMESTAMP_SCALE_NS: u64 = 1_000_000_000 / TICKS_PER_SECOND as u64;

pub const VIDEO_TRACK: u8 = 1;
pub const AUDIO_TRACK: u8 = 2;

/// Pixel layouts of the video track, as the four-character codes ffmpeg's demuxer knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Rgb24,
    I420,
}

impl PixelFormat {
    fn fourcc(self) -> [u8; 4] {
        match self {
            PixelFormat::Rgb24 => [b'R', b'G', b'B', 24],
            PixelFormat::I420 => *b"I420",
        }
    }
}

pub struct TrackInfo {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub pixel_format: PixelFormat,
    pub sample_rate: u32,
    pub channels: u8,
}

fn vint_size(n: u64) -> Vec<u8> {
    for len in 1..=8u32 {
        let max = (1u64 << (7 * len)) - 2; // all ones means "unknown"
        if n <= max {
            let mut out = vec![0u8; len as usize];
            for (i, b) in out.iter_mut().enumerate() {
                *b = (n >> (8 * (len as usize - 1 - i))) as u8;
            }
            out[0] |= 0x80 >> (len - 1);
            return out;
        }
    }
    panic!("element too large");
}

/// "Unknown size": for the segment and clusters of a live stream.
const UNKNOWN_SIZE: [u8; 8] = [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

fn id_bytes(id: u32) -> Vec<u8> {
    let bytes = id.to_be_bytes();
    let skip = bytes.iter().position(|&b| b != 0).unwrap_or(3);
    bytes[skip..].to_vec()
}

fn element(id: u32, data: &[u8]) -> Vec<u8> {
    let mut out = id_bytes(id);
    out.extend(vint_size(data.len() as u64));
    out.extend_from_slice(data);
    out
}

fn uint(id: u32, v: u64) -> Vec<u8> {
    let bytes = v.to_be_bytes();
    let skip = bytes.iter().position(|&b| b != 0).unwrap_or(7);
    element(id, &bytes[skip..])
}

fn float(id: u32, v: f64) -> Vec<u8> {
    element(id, &v.to_be_bytes())
}

fn string(id: u32, v: &str) -> Vec<u8> {
    element(id, v.as_bytes())
}

fn master(id: u32, children: &[Vec<u8>]) -> Vec<u8> {
    element(id, &children.concat())
}

/// The EBML header, segment start, info and the two tracks.
pub fn header(t: &TrackInfo) -> Vec<u8> {
    let ebml = master(
        0x1A45_DFA3,
        &[
            uint(0x4286, 1),
            uint(0x42F7, 1),
            uint(0x42F2, 4),
            uint(0x42F3, 8),
            string(0x4282, "matroska"),
            uint(0x4287, 4),
            uint(0x4285, 2),
        ],
    );
    let info = master(
        0x1549_A966,
        &[uint(0x2A_D7B1, TIMESTAMP_SCALE_NS), string(0x4D80, "OpenPres"), string(0x5741, "OpenPres")],
    );
    let video = master(
        0xAE,
        &[
            uint(0xD7, VIDEO_TRACK as u64),
            uint(0x73C5, 1),
            uint(0x83, 1),
            uint(0x9C, 0),
            string(0x86, "V_UNCOMPRESSED"),
            uint(0x23_E383, 1_000_000_000 / t.fps.max(1) as u64),
            master(
                0xE0,
                &[uint(0xB0, t.width as u64), uint(0xBA, t.height as u64), element(0x2E_B524, &t.pixel_format.fourcc())],
            ),
        ],
    );
    let audio = master(
        0xAE,
        &[
            uint(0xD7, AUDIO_TRACK as u64),
            uint(0x73C5, 2),
            uint(0x83, 2),
            uint(0x9C, 0),
            string(0x86, "A_PCM/INT/LIT"),
            master(0xE1, &[float(0xB5, t.sample_rate as f64), uint(0x9F, t.channels as u64), uint(0x6264, 16)]),
        ],
    );
    let mut out = ebml;
    out.extend(id_bytes(0x1853_8067)); // Segment
    out.extend(UNKNOWN_SIZE);
    out.extend(info);
    out.extend(master(0x1654_AE6B, &[video, audio])); // Tracks
    out
}

/// Writes blocks, starting clusters as needed. Blocks of both tracks must come roughly in
/// timestamp order (as they happen).
pub struct Writer<W: Write> {
    out: W,
    /// Timestamp of the open cluster.
    cluster: Option<i64>,
}

/// Blocks are placed relative to their cluster in 16 bits; start a new cluster well before.
const CLUSTER_SPAN: i64 = 2 * TICKS_PER_SECOND;

/// Where the feed's blocks go (a Writer; something else in tests).
pub trait Blocks {
    fn block(&mut self, track: u8, ticks: i64, data: &[u8]) -> io::Result<()>;
    fn flush(&mut self) -> io::Result<()>;
}

impl<W: Write> Blocks for Writer<W> {
    fn block(&mut self, track: u8, ticks: i64, data: &[u8]) -> io::Result<()> {
        Writer::block(self, track, ticks, data)
    }
    fn flush(&mut self) -> io::Result<()> {
        Writer::flush(self)
    }
}

impl<W: Write> Writer<W> {
    pub fn new(mut out: W, tracks: &TrackInfo) -> io::Result<Self> {
        out.write_all(&header(tracks))?;
        Ok(Self { out, cluster: None })
    }

    /// One frame or audio packet at `ticks` (see TICKS_PER_SECOND).
    pub fn block(&mut self, track: u8, ticks: i64, data: &[u8]) -> io::Result<()> {
        let relative = match self.cluster {
            Some(c) if ticks - c < CLUSTER_SPAN && ticks - c >= i16::MIN as i64 => ticks - c,
            _ => {
                let mut cluster = id_bytes(0x1F43_B675);
                cluster.extend(UNKNOWN_SIZE);
                cluster.extend(uint(0xE7, ticks.max(0) as u64));
                self.out.write_all(&cluster)?;
                self.cluster = Some(ticks.max(0));
                ticks - ticks.max(0)
            }
        };
        let mut head = id_bytes(0xA3);
        head.extend(vint_size(4 + data.len() as u64));
        head.push(0x80 | track); // track number as a one-byte vint
        head.extend_from_slice(&(relative as i16).to_be_bytes());
        head.push(0x80); // keyframe
        self.out.write_all(&head)?;
        self.out.write_all(data)
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.out.flush()
    }
}

/// Milliseconds to stream ticks.
pub fn ticks_of_ms(ms: f64) -> i64 {
    (ms * TICKS_PER_SECOND as f64 / 1000.0).round() as i64
}

/// Video frames waiting for the encoder at most. When it falls further behind, the oldest
/// waiting frame is skipped (OBS: "skipped frames due to encoding lag"); the others keep
/// their times, so the picture and sound stay together.
const MAX_WAITING_FRAMES: usize = 4;

#[derive(Default)]
struct Waiting {
    video: VecDeque<(i64, Arc<Vec<u8>>)>,
    audio: VecDeque<(i64, Vec<u8>)>,
    closed: bool,
}

/// Frames and sound on their way to ffmpeg, written by one thread in time order.
#[derive(Default)]
pub struct Feed {
    waiting: Mutex<Waiting>,
    ready: Condvar,
}

impl Feed {
    /// Queues a frame; false when an older one had to be skipped to make room.
    pub fn video(&self, ticks: i64, frame: Arc<Vec<u8>>) -> bool {
        let mut w = self.waiting.lock().unwrap();
        if w.closed {
            return true;
        }
        let skipped = w.video.len() >= MAX_WAITING_FRAMES;
        if skipped {
            w.video.pop_front();
        }
        w.video.push_back((ticks, frame));
        self.ready.notify_one();
        !skipped
    }

    pub fn audio(&self, ticks: i64, pcm: Vec<u8>) {
        let mut w = self.waiting.lock().unwrap();
        if !w.closed {
            w.audio.push_back((ticks, pcm));
            self.ready.notify_one();
        }
    }

    /// No more input: the writer finishes what is queued and returns.
    pub fn close(&self) {
        self.waiting.lock().unwrap().closed = true;
        self.ready.notify_all();
    }

    /// Writes everything queued, oldest first, until closed (or writing fails: ffmpeg
    /// ended). `written` is told about every video frame written.
    pub fn run(&self, out: &mut impl Blocks, mut written: impl FnMut()) -> io::Result<()> {
        loop {
            let next = {
                let mut w = self.waiting.lock().unwrap();
                while w.video.is_empty() && w.audio.is_empty() && !w.closed {
                    w = self.ready.wait(w).unwrap();
                }
                let v = w.video.front().map(|f| f.0);
                let a = w.audio.front().map(|f| f.0);
                match (v, a) {
                    (None, None) => return out.flush(),
                    (Some(v), Some(a)) if a <= v => Err(w.audio.pop_front().unwrap()),
                    (Some(_), _) => Ok(w.video.pop_front().unwrap()),
                    (None, Some(_)) => Err(w.audio.pop_front().unwrap()),
                }
            };
            match next {
                Ok((ticks, frame)) => {
                    out.block(VIDEO_TRACK, ticks, &frame)?;
                    written();
                }
                Err((ticks, pcm)) => out.block(AUDIO_TRACK, ticks, &pcm)?,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_ebml_vints() {
        assert_eq!(vint_size(0), vec![0x80]);
        assert_eq!(vint_size(126), vec![0xFE]);
        assert_eq!(vint_size(127), vec![0x40, 0x7F]);
        assert_eq!(vint_size(6_220_800), vec![0x10, 0x5E, 0xEC, 0x00]);
    }

    #[test]
    fn clusters_start_when_blocks_drift_away() {
        let tracks = TrackInfo { width: 4, height: 2, fps: 30, pixel_format: PixelFormat::Rgb24, sample_rate: 48_000, channels: 2 };
        let mut w = Writer::new(Vec::new(), &tracks).unwrap();
        w.block(VIDEO_TRACK, 0, &[0; 24]).unwrap();
        w.block(AUDIO_TRACK, 100, &[0; 8]).unwrap();
        assert_eq!(w.cluster, Some(0));
        w.block(VIDEO_TRACK, CLUSTER_SPAN + 5, &[0; 24]).unwrap();
        assert_eq!(w.cluster, Some(CLUSTER_SPAN + 5));
        // Audio a little earlier than the new cluster still fits (negative offset).
        w.block(AUDIO_TRACK, CLUSTER_SPAN, &[0; 8]).unwrap();
        assert_eq!(w.cluster, Some(CLUSTER_SPAN + 5));
    }

    #[test]
    fn the_feed_writes_in_time_order_and_skips_when_full() {
        let feed = Feed::default();
        let frame = Arc::new(vec![1u8; 24]);
        feed.audio(5, vec![0; 4]);
        for t in [10, 20, 30, 40] {
            assert!(feed.video(t, frame.clone()));
        }
        // The encoder is behind: the oldest waiting frame makes room.
        assert!(!feed.video(50, frame.clone()));
        feed.audio(25, vec![0; 4]);
        feed.close();
        struct Record(Vec<(u8, i64)>);
        impl Blocks for Record {
            fn block(&mut self, track: u8, ticks: i64, _: &[u8]) -> io::Result<()> {
                self.0.push((track, ticks));
                Ok(())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut out = Record(vec![]);
        let mut frames = 0;
        feed.run(&mut out, || frames += 1).unwrap();
        assert_eq!(frames, 4, "10 was skipped");
        assert_eq!(out.0, vec![(2, 5), (1, 20), (2, 25), (1, 30), (1, 40), (1, 50)]);
    }

    /// ffmpeg reads what we write: `cargo test --lib mkv -- --ignored` (needs ffprobe).
    #[test]
    #[ignore]
    fn ffprobe_reads_it() {
        use std::process::{Command, Stdio};
        let tracks = TrackInfo { width: 64, height: 36, fps: 30, pixel_format: PixelFormat::I420, sample_rate: 48_000, channels: 2 };
        let mut child = Command::new("ffprobe")
            .args(["-v", "error", "-f", "matroska", "-i", "pipe:0", "-show_entries", "stream=codec_name,pix_fmt,width,height,sample_rate,channels:packet=stream_index,pts_time", "-of", "compact"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("ffprobe");
        {
            let mut w = Writer::new(child.stdin.take().unwrap(), &tracks).unwrap();
            let frame = vec![128u8; 64 * 36 * 3 / 2];
            let pcm = vec![0u8; 480 * 4];
            for i in 0..90i64 {
                w.block(VIDEO_TRACK, ticks_of_ms(i as f64 * 1000.0 / 30.0), &frame).unwrap();
                w.block(AUDIO_TRACK, ticks_of_ms(i as f64 * 1000.0 / 30.0), &pcm).unwrap();
            }
        }
        let out = String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap();
        println!("{out}");
        assert!(out.contains("codec_name=rawvideo|width=64|height=36|pix_fmt=yuv420p"), "{out}");
        assert!(out.contains("codec_name=pcm_s16le|sample_rate=48000|channels=2"), "{out}");
        assert!(out.contains("pts_time=2.966700"), "the last frame keeps its time: {out}");
    }
}
