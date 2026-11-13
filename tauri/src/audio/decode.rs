//! Plays the audio of an imported file into the routing graph. Decoding uses symphonia
//! (mp3, wav, flac, ogg/vorbis, aac/m4a, the audio of mp4/mov/mkv); anything it cannot read
//! falls back to ffmpeg when available (e.g. opus/webm).

use super::{graph::Node, resample::Resampler, ENGINE_RATE};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{DecoderOptions, CODEC_TYPE_NULL},
    formats::{FormatOptions, SeekMode, SeekTo},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};

/// Keep this much audio buffered ahead of real time.
const LEAD: Duration = Duration::from_millis(120);

pub struct Playback {
    stop: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
}

impl Playback {
    /// Starts playing `path` from `start_ms` into `node`.
    pub fn start(path: PathBuf, start_ms: u64, node: Arc<Node>, mono: bool, ffmpeg: String) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        {
            let stop = stop.clone();
            let ended = ended.clone();
            thread::Builder::new()
                .name("media-audio".into())
                .spawn(move || {
                    let mut pacer = Pacer::new(&node, &stop, mono);
                    if let Err(e) = play_symphonia(&path, start_ms, &mut pacer) {
                        tracing::debug!("symphonia cannot play {}: {e}; trying ffmpeg", path.display());
                        if !pacer.produced_any {
                            if let Err(e) = play_ffmpeg(&ffmpeg, &path, start_ms, &mut pacer) {
                                tracing::debug!("ffmpeg cannot play {}: {e}", path.display());
                            }
                        }
                    }
                    pacer.drain();
                    ended.store(true, Ordering::Relaxed);
                })
                .expect("cannot start media thread");
        }
        Self { stop, ended }
    }

    /// True once the whole file was played (not set when stopped early).
    pub fn ended(&self) -> bool {
        self.ended.load(Ordering::Relaxed) && !self.stop.load(Ordering::Relaxed)
    }
}

impl Drop for Playback {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Sends audio to the graph at real-time speed (wall clock), so playback position, pause
/// and end detection behave the same whether or not any output listens to the bus.
struct Pacer<'a> {
    node: &'a Arc<Node>,
    stop: &'a AtomicBool,
    start: Instant,
    produced_frames: u64,
    produced_any: bool,
    mono: bool,
    block: Vec<f32>,
}

impl<'a> Pacer<'a> {
    fn new(node: &'a Arc<Node>, stop: &'a AtomicBool, mono: bool) -> Self {
        Self {
            node,
            stop,
            start: Instant::now(),
            produced_frames: 0,
            produced_any: false,
            mono,
            block: Vec::with_capacity(4096),
        }
    }
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
    /// Pushes 48 kHz stereo samples, sleeping whenever we are ahead of real time.
    fn push(&mut self, samples: &[f32]) -> bool {
        for chunk in samples.chunks(960 * 2) {
            loop {
                if self.stopped() {
                    return false;
                }
                let due = (self.start.elapsed() + LEAD).as_secs_f64() * ENGINE_RATE as f64;
                if (self.produced_frames as f64) < due {
                    break;
                }
                thread::sleep(Duration::from_millis(4));
            }
            self.block.clear();
            self.block.extend_from_slice(chunk);
            if self.mono {
                for frame in self.block.chunks_exact_mut(2) {
                    let m = (frame[0] + frame[1]) * 0.5;
                    frame[0] = m;
                    frame[1] = m;
                }
            }
            self.node.produce(&mut self.block);
            self.produced_frames += (chunk.len() / 2) as u64;
            self.produced_any = true;
        }
        true
    }
    /// Waits until the buffered lead has actually played, so "ended" fires on time.
    fn drain(&self) {
        let played = Duration::from_secs_f64(self.produced_frames as f64 / ENGINE_RATE as f64);
        while !self.stopped() && self.start.elapsed() < played {
            thread::sleep(Duration::from_millis(10));
        }
    }
}

/// Interleaved samples with `channels` channels -> stereo.
fn to_stereo(samples: &[f32], channels: usize, out: &mut Vec<f32>) {
    out.clear();
    match channels {
        0 => {}
        1 => {
            for s in samples {
                out.push(*s);
                out.push(*s);
            }
        }
        _ => {
            for frame in samples.chunks_exact(channels) {
                out.push(frame[0]);
                out.push(frame[1]);
            }
        }
    }
}

fn play_symphonia(path: &Path, start_ms: u64, pacer: &mut Pacer) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some())
        .ok_or("no audio track")?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let rate = track.codec_params.sample_rate.unwrap_or(ENGINE_RATE);

    // Seek, then drop the samples between the seek point and the exact start.
    let mut skip_frames: u64 = 0;
    if start_ms > 0 {
        let time = Time::new(start_ms / 1000, (start_ms % 1000) as f64 / 1000.0);
        match format.seek(SeekMode::Coarse, SeekTo::Time { time, track_id: Some(track.id) }) {
            Ok(seeked) => {
                if let Some(tb) = track.codec_params.time_base {
                    let wanted = tb.calc_timestamp(time);
                    skip_frames = wanted.saturating_sub(seeked.actual_ts);
                }
            }
            Err(_) => {
                // Unseekable: decode and discard from the start.
                skip_frames = start_ms * rate as u64 / 1000;
            }
        }
        decoder.reset();
    }

    let mut resampler = Resampler::new(rate, ENGINE_RATE);
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut stereo = Vec::new();
    let mut resampled = Vec::new();
    loop {
        if pacer.stopped() {
            return Ok(());
        }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                return Ok(());
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => {
                return if pacer.produced_any { Ok(()) } else { Err(e.to_string()) };
            }
        };
        if packet.track_id() != track.id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        let buf = sample_buf.get_or_insert_with(|| SampleBuffer::new(decoded.capacity() as u64, spec));
        if buf.capacity() < decoded.capacity() {
            *buf = SampleBuffer::new(decoded.capacity() as u64, spec);
        }
        buf.copy_interleaved_ref(decoded);
        let mut samples = buf.samples();
        if skip_frames > 0 {
            let frames = (samples.len() / channels.max(1)) as u64;
            let skip = skip_frames.min(frames);
            samples = &samples[(skip as usize * channels)..];
            skip_frames -= skip;
        }
        to_stereo(samples, channels, &mut stereo);
        resampled.clear();
        resampler.process(&stereo, &mut resampled);
        if !pacer.push(&resampled) {
            return Ok(());
        }
    }
}

fn play_ffmpeg(ffmpeg: &str, path: &Path, start_ms: u64, pacer: &mut Pacer) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing
    }
    let mut child = command
        .args(["-nostdin", "-loglevel", "error", "-ss"])
        .arg(format!("{:.3}", start_ms as f64 / 1000.0))
        .arg("-i")
        .arg(path)
        .args(["-vn", "-f", "f32le", "-ac", "2", "-ar"])
        .arg(ENGINE_RATE.to_string())
        .arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("cannot run ffmpeg: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("no ffmpeg output")?;
    let mut bytes = vec![0u8; 960 * 2 * 4];
    let mut samples = Vec::with_capacity(960 * 2);
    let mut carry: Vec<u8> = Vec::new();
    loop {
        let n = match stdout.read(&mut bytes) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        carry.extend_from_slice(&bytes[..n]);
        let usable = carry.len() / 8 * 8; // whole stereo frames
        samples.clear();
        for chunk in carry[..usable].chunks_exact(4) {
            samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        carry.drain(..usable);
        if !pacer.push(&samples) {
            break;
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}

/// Duration of the first audio track in milliseconds, when symphonia can tell.
pub fn probe_duration_ms(path: &Path) -> Option<u64> {
    let file = std::fs::File::open(path).ok()?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;
    let track = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some())?
        .clone();
    let frames = track.codec_params.n_frames?;
    let tb = track.codec_params.time_base?;
    let time = tb.calc_time(frames);
    Some(time.seconds * 1000 + (time.frac * 1000.0) as u64)
}
