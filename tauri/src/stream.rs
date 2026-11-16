//! Live streaming (YouTube RTMP) and local MP4 recording through ffmpeg.
//!
//! Video: the native compositor (compositor.rs) combines the camera of the video input layer
//! with the layers above it, which the app's main window draws and posts to
//! `/stream/overlay`, and pipes raw frames into ffmpeg at the stream's frame rate. Audio: a
//! consumer on the chosen bus feeds 48 kHz PCM to ffmpeg over a local TCP socket.

use crate::{
    audio::{Graph, Node, ENGINE_RATE},
    compositor::{CameraSource, Compositor, Overlay, OverlayCell, Stats},
    error::AppError,
    events::EventHub,
    storage::{now_ms, JsonDoc},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StreamSettings {
    pub screen_id: Option<Uuid>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub video_kbps: u32,
    pub audio_kbps: u32,
    /// Bus 1-16 sent as the stream's audio.
    pub bus: u8,
    pub mono: bool,
    pub send_rtmp: bool,
    pub rtmp_url: String,
    pub stream_key: String,
    pub record: bool,
    /// Folder for recordings; empty = <data>/recordings.
    pub record_dir: String,
    pub x264_preset: String,
}

/// Video rate control. Slides are mostly still, so a plain average/maximum bitrate lets x264
/// send far less than asked (tens of kbps for a still slide), and YouTube then warns that the
/// stream's bitrate is lower than recommended. When sending to a server the stream is padded
/// to a constant bitrate (like OBS's CBR mode); a recording on its own stays variable, so the
/// file is not filled with padding.
fn video_rate_args(kbps: u32, constant: bool) -> Vec<String> {
    let rate = format!("{kbps}k");
    let mut args = vec!["-b:v".into(), rate.clone(), "-maxrate".into(), rate.clone()];
    if constant {
        args.extend(["-minrate".into(), rate.clone(), "-bufsize".into(), rate]);
        args.extend(["-x264-params".into(), "nal-hrd=cbr:force-cfr=1".into()]);
    } else {
        args.extend(["-bufsize".into(), format!("{}k", kbps * 2)]);
    }
    args
}

impl Default for StreamSettings {
    fn default() -> Self {
        Self {
            screen_id: None,
            width: 1280,
            height: 720,
            fps: 30,
            video_kbps: 4500,
            audio_kbps: 160,
            bus: 1,
            mono: false,
            send_rtmp: true,
            rtmp_url: "rtmp://a.rtmp.youtube.com/live2".into(),
            stream_key: String::new(),
            record: false,
            record_dir: String::new(),
            x264_preset: "veryfast".into(),
        }
    }
}

impl StreamSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(320..=3840).contains(&self.width) || !(180..=2160).contains(&self.height) {
            return Err(AppError::BadRequest("stream size must be between 320x180 and 3840x2160".into()));
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err(AppError::BadRequest("stream width and height must be even".into()));
        }
        if !(10..=60).contains(&self.fps) {
            return Err(AppError::BadRequest("fps must be between 10 and 60".into()));
        }
        if !(500..=20_000).contains(&self.video_kbps) || !(64..=320).contains(&self.audio_kbps) {
            return Err(AppError::BadRequest("bitrates are out of range".into()));
        }
        if !(1..=crate::audio::BUSES).contains(&self.bus) {
            return Err(AppError::BadRequest("bus must be between 1 and 16".into()));
        }
        let presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"];
        if !presets.contains(&self.x264_preset.as_str()) {
            return Err(AppError::BadRequest("unknown x264 preset".into()));
        }
        Ok(())
    }
}

/// What the main window must draw while the stream runs.
#[derive(Debug, Clone, Serialize)]
pub struct StreamVideo {
    pub screen_id: Uuid,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StreamStatus {
    pub running: bool,
    pub started_at_ms: Option<i64>,
    pub streaming: bool,
    pub recording_file: Option<String>,
    /// Frames sent to ffmpeg.
    pub frames: u64,
    /// Camera frames that went into the stream (the camera's own frame rate).
    pub camera_frames: u64,
    /// Pictures of the layers above the camera received from the main window.
    pub overlays: u64,
    pub video: Option<StreamVideo>,
    pub error: Option<String>,
    pub log: Vec<String>,
}

struct Running {
    child: Arc<Mutex<Child>>,
    stop: Arc<AtomicBool>,
    sink: Uuid,
    video: StreamVideo,
}

pub struct StreamManager {
    pub settings: Mutex<JsonDoc<StreamSettings>>,
    running: Mutex<Option<Running>>,
    status: Arc<Mutex<StreamStatus>>,
    stats: Mutex<Arc<Stats>>,
    overlay: Arc<OverlayCell>,
}

impl StreamManager {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            settings: Mutex::new(JsonDoc::load(path)?),
            running: Mutex::new(None),
            status: Arc::new(Mutex::new(StreamStatus::default())),
            stats: Mutex::new(Arc::new(Stats::default())),
            overlay: Arc::new(OverlayCell::default()),
        })
    }

    pub fn status(&self) -> StreamStatus {
        let mut s = self.status.lock().unwrap().clone();
        let stats = self.stats.lock().unwrap().clone();
        s.frames = stats.frames.load(Ordering::Relaxed);
        s.camera_frames = stats.camera_frames.load(Ordering::Relaxed);
        s.overlays = stats.overlays.load(Ordering::Relaxed);
        s.video = self.running.lock().unwrap().as_ref().map(|r| r.video.clone());
        // Without the main window's picture only black (and the camera) goes out: say so
        // instead of looking fine.
        if s.running && s.overlays == 0 && s.error.is_none() && s.started_at_ms.is_some_and(|t| now_ms() - t > 8000) {
            s.error = Some("the slides and graphics are not reaching the stream: keep the OpenPres window open (it can be minimized or covered)".into());
        }
        s
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap().is_some()
    }

    pub fn start(
        &self,
        graph: Arc<Graph>,
        hub: Arc<EventHub>,
        camera: CameraSource,
        ffmpeg: &str,
        data_dir: &std::path::Path,
    ) -> Result<(), AppError> {
        let mut running = self.running.lock().unwrap();
        if running.is_some() {
            return Err(AppError::Conflict("the stream is already running".into()));
        }
        let settings = self.settings.lock().unwrap().value.clone();
        settings.validate()?;
        let screen_id = settings
            .screen_id
            .ok_or_else(|| AppError::BadRequest("choose the virtual screen to stream".into()))?;
        let rtmp = settings.send_rtmp && !settings.stream_key.trim().is_empty();
        if settings.send_rtmp && !rtmp {
            return Err(AppError::BadRequest("enter the stream key (or turn off streaming and only record)".into()));
        }
        if !rtmp && !settings.record {
            return Err(AppError::BadRequest("turn on streaming and/or recording".into()));
        }

        let recording = if settings.record {
            let dir = if settings.record_dir.trim().is_empty() {
                data_dir.join("recordings")
            } else {
                PathBuf::from(settings.record_dir.trim())
            };
            std::fs::create_dir_all(&dir)?;
            let stamp = chrono_like_stamp();
            Some(dir.join(format!("OpenPres {stamp}.mp4")))
        } else {
            None
        };

        // Free local port for the audio feed.
        let audio_port = TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .map_err(|e| AppError::Internal(format!("no free port for audio: {e}")))?;

        let channels = if settings.mono { 1 } else { 2 };
        // Newer ffmpeg (the bundled master build, 8.x) only accepts -thread_queue_size as an
        // output option and refuses to open the inputs if it is given before -i.
        let input_queue: &[&str] = if input_thread_queue_supported(ffmpeg) {
            &["-thread_queue_size", "512"]
        } else {
            &[]
        };
        let mut cmd = Command::new(ffmpeg);
        cmd.args(["-hide_banner", "-loglevel", "warning", "-nostats"])
            // video: raw RGB frames from the compositor on stdin, timestamped as they arrive
            .args(input_queue)
            .args(["-use_wallclock_as_timestamps", "1"])
            .args(["-f", "rawvideo", "-pix_fmt", "rgb24"])
            .args(["-video_size", &format!("{}x{}", settings.width, settings.height)])
            .args(["-framerate", &settings.fps.to_string(), "-i", "pipe:0"])
            // audio: PCM over TCP. No wall-clock timestamps here: feed_audio already paces
            // it in real time, and newer ffmpeg turns wall-clock PCM timestamps into
            // out-of-range packets (the recording ends up with milliseconds of audio).
            .args(input_queue)
            .args(["-analyzeduration", "0"])
            .args(["-f", "s16le", "-ar", &ENGINE_RATE.to_string(), "-ac", &channels.to_string()])
            .arg("-i")
            .arg(format!("tcp://127.0.0.1:{audio_port}?listen=1"))
            .args(["-map", "0:v", "-map", "1:a"])
            .args(["-vf", &format!("scale={}:{},format=yuv420p", settings.width, settings.height)])
            .args(["-fps_mode", "cfr", "-r", &settings.fps.to_string()])
            .args(["-c:v", "libx264", "-preset", &settings.x264_preset, "-tune", "zerolatency"])
            .args(video_rate_args(settings.video_kbps, rtmp))
            .args(["-g", &(settings.fps * 2).to_string()])
            .args(["-c:a", "aac", "-b:a", &format!("{}k", settings.audio_kbps), "-ar", "44100"])
            .args(["-flags", "+global_header"]);
        let rtmp_target = format!(
            "{}/{}",
            settings.rtmp_url.trim().trim_end_matches('/'),
            settings.stream_key.trim()
        );
        match (rtmp, &recording) {
            (true, Some(file)) => {
                cmd.args(["-f", "tee"]).arg(format!(
                    "[f=flv:onfail=ignore]{rtmp_target}|[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof]{}",
                    file.display()
                ));
            }
            (true, None) => {
                cmd.args(["-f", "flv"]).arg(&rtmp_target);
            }
            (false, Some(file)) => {
                cmd.args(["-f", "mp4", "-movflags", "+frag_keyframe+empty_moov+default_base_moof"])
                    .arg(file);
            }
            (false, None) => unreachable!(),
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| {
            AppError::BadRequest(format!(
                "cannot start ffmpeg (`{ffmpeg}`): {e}. Check the ffmpeg path in Settings (empty = the one bundled with OpenPres)."
            ))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| AppError::Internal("no ffmpeg stdin".into()))?;
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let stop = Arc::new(AtomicBool::new(false));
        let stats = Arc::new(Stats::default());
        *self.stats.lock().unwrap() = stats.clone();
        self.overlay.clear();
        {
            let mut status = self.status.lock().unwrap();
            *status = StreamStatus {
                running: true,
                started_at_ms: Some(now_ms()),
                streaming: rtmp,
                recording_file: recording.as_ref().map(|p| p.display().to_string()),
                ..Default::default()
            };
        }

        // Camera + main window overlay -> raw frames on ffmpeg's stdin.
        Compositor { width: settings.width, height: settings.height, fps: settings.fps }.start(
            self.overlay.clone(),
            camera,
            Box::new(stdin),
            stop.clone(),
            stats,
        );

        // Bus audio -> ffmpeg over TCP, paced by the wall clock.
        let sink = Node::new(Uuid::new_v4(), settings.bus, 1.0, false);
        let sink_id = sink.id;
        graph.add_consumer(sink.clone());
        {
            let stop = stop.clone();
            let mono = settings.mono;
            thread::Builder::new()
                .name("stream-audio".into())
                .spawn(move || feed_audio(audio_port, sink, mono, stop))
                .ok();
        }

        // ffmpeg's messages, and cleanup if it exits by itself.
        {
            let status = self.status.clone();
            let child = child.clone();
            let stop = stop.clone();
            let hub = hub.clone();
            thread::Builder::new()
                .name("stream-log".into())
                .spawn(move || {
                    let mut lines: VecDeque<String> = VecDeque::new();
                    if let Some(stderr) = stderr {
                        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                            let line = line.trim().to_string();
                            // Harmless notices about JPEG colour range.
                            if line.is_empty()
                                || line.contains("deprecated pixel format")
                                || line.starts_with("Last message repeated")
                            {
                                continue;
                            }
                            lines.push_back(line);
                            if lines.len() > 30 {
                                lines.pop_front();
                            }
                            status.lock().unwrap().log = lines.iter().cloned().collect();
                        }
                    }
                    let code = child.lock().unwrap().wait().ok();
                    if !stop.load(Ordering::Relaxed) {
                        let mut s = status.lock().unwrap();
                        s.running = false;
                        // ffmpeg ends with generic summaries ("Error opening input files: …",
                        // "Conversion failed!"); the line before them says what went wrong.
                        let generic = |l: &str| {
                            l.starts_with("Error opening input file")
                                || l.starts_with("Error opening output file")
                                || l.starts_with("Error parsing options")
                                || l.starts_with("Conversion failed")
                        };
                        let reason = lines
                            .iter()
                            .rev()
                            .find(|l| !generic(l))
                            .or_else(|| lines.back())
                            .cloned()
                            .unwrap_or_default();
                        s.error = Some(format!(
                            "ffmpeg stopped ({}). {}",
                            code.map(|c| c.to_string()).unwrap_or_default(),
                            reason
                        ));
                        stop.store(true, Ordering::Relaxed);
                        hub.changed();
                    }
                })
                .ok();
        }

        *running = Some(Running {
            child,
            stop,
            sink: sink_id,
            video: StreamVideo { screen_id, width: settings.width, height: settings.height, fps: settings.fps },
        });
        drop(running);
        hub.changed();
        Ok(())
    }

    /// The picture of the layers above the camera, from the main window.
    pub fn push_overlay(&self, overlay: Overlay) -> Result<(), AppError> {
        let running = self.running.lock().unwrap();
        let Some(r) = running.as_ref().filter(|r| !r.stop.load(Ordering::Relaxed)) else {
            return Err(AppError::Gone("the stream is not running".into()));
        };
        if (overlay.width, overlay.height) != (r.video.width, r.video.height) {
            return Err(AppError::Conflict(format!("the stream is {}x{}", r.video.width, r.video.height)));
        }
        self.stats.lock().unwrap().overlays.fetch_add(1, Ordering::Relaxed);
        self.overlay.set(overlay);
        Ok(())
    }

    pub fn stop(&self, graph: &Graph, hub: &EventHub) {
        let taken = self.running.lock().unwrap().take();
        if let Some(r) = taken {
            // The compositor stops and closes ffmpeg's stdin after the queued frames.
            r.stop.store(true, Ordering::Relaxed);
            let child = r.child.clone();
            thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(6);
                loop {
                    if let Ok(Some(_)) = child.lock().unwrap().try_wait() {
                        break;
                    }
                    if Instant::now() > deadline {
                        let _ = child.lock().unwrap().kill();
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            });
            graph.remove(r.sink);
        }
        {
            let mut s = self.status.lock().unwrap();
            s.running = false;
        }
        self.overlay.clear();
        hub.changed();
    }

    /// Clears a finished stream's error/status after the stream ended by itself.
    pub fn reap(&self, graph: &Graph) {
        let mut running = self.running.lock().unwrap();
        if running.as_ref().is_some_and(|r| r.stop.load(Ordering::Relaxed)) {
            if let Some(r) = running.take() {
                graph.remove(r.sink);
            }
        }
    }
}

fn feed_audio(port: u16, sink: Arc<Node>, mono: bool, stop: Arc<AtomicBool>) {
    // ffmpeg opens the audio input after the video input.
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut socket = loop {
        if stop.load(Ordering::Relaxed) || Instant::now() > deadline {
            return;
        }
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(s) => break s,
            Err(_) => thread::sleep(Duration::from_millis(100)),
        }
    };
    let _ = socket.set_nodelay(true);
    let block_frames = (ENGINE_RATE / 100) as usize; // 10 ms
    let mut block = vec![0f32; block_frames * 2];
    let mut bytes: Vec<u8> = Vec::with_capacity(block_frames * 4);
    let start = Instant::now();
    let mut sent_frames: u64 = 0;
    while !stop.load(Ordering::Relaxed) {
        let due = (start.elapsed().as_secs_f64() * ENGINE_RATE as f64) as u64;
        if sent_frames + block_frames as u64 > due {
            thread::sleep(Duration::from_millis(3));
            continue;
        }
        sink.consume(&mut block);
        bytes.clear();
        for frame in block.chunks_exact(2) {
            let mut write = |v: f32| {
                let s = (v.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                bytes.extend_from_slice(&s.to_le_bytes());
            };
            if mono {
                write((frame[0] + frame[1]) * 0.5);
            } else {
                write(frame[0]);
                write(frame[1]);
            }
        }
        if socket.write_all(&bytes).is_err() {
            break;
        }
        sent_frames += block_frames as u64;
    }
}

/// True for numbered ffmpeg releases before 8, which still take -thread_queue_size as an
/// input option. Git/master builds ("N-12345-g…") and unknown versions get false.
fn input_thread_queue_supported(ffmpeg: &str) -> bool {
    crate::tools::ffmpeg_version(ffmpeg)
        .ok()
        .and_then(|v| parse_major_version(&v))
        .is_some_and(|major| major < 8)
}

/// "ffmpeg version 6.1.1-3ubuntu5 Copyright…" -> Some(6); "ffmpeg version N-128909-g…" -> None.
fn parse_major_version(version_line: &str) -> Option<u32> {
    let rest = version_line.split("version").nth(1)?.trim_start();
    let rest = rest.strip_prefix('n').unwrap_or(rest); // tagged git builds: "n7.1"
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::{parse_major_version, video_rate_args};

    #[test]
    fn streams_use_constant_bitrate() {
        let cbr = video_rate_args(6800, true);
        assert!(cbr.windows(2).any(|w| w[0] == "-minrate" && w[1] == "6800k"));
        assert!(cbr.iter().any(|a| a.contains("nal-hrd=cbr")));
        let vbr = video_rate_args(6800, false);
        assert!(!vbr.iter().any(|a| a == "-minrate" || a.contains("nal-hrd")));
    }

    #[test]
    fn ffmpeg_major_versions() {
        assert_eq!(parse_major_version("ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023"), Some(6));
        assert_eq!(parse_major_version("ffmpeg version n7.1 Copyright"), Some(7));
        assert_eq!(parse_major_version("ffmpeg version 8.0 Copyright"), Some(8));
        assert_eq!(parse_major_version("ffmpeg version N-128909-g604ef3784d-20261114 Copyright"), None);
        assert_eq!(parse_major_version("ffmpeg"), None);
    }
}

/// "2026-11-13 20-05-09" in UTC, without pulling in a date crate.
fn chrono_like_stamp() -> String {
    let secs = now_ms() / 1000;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!("{y:04}-{mo:02}-{d:02} {h:02}-{m:02}-{s:02}")
}
