//! Opens the audio devices used by the buses and connects them to the routing graph.
//! cpal streams are not `Send` on every platform, so they all live on one dedicated
//! thread; the rest of the app talks to it through a channel.
//!
//! Devices are only opened while a bus uses them and are released (stream dropped) as soon
//! as no bus does. On Linux the PulseAudio host is used (also served by PipeWire), so
//! devices stay shared with the rest of the system instead of being taken over through
//! raw ALSA.

use super::{
    config::{input_node_id, output_node_id, AudioConfig, ChannelMode, DeviceTap},
    db_to_gain,
    graph::{Graph, Node},
    resample::Resampler,
    ENGINE_RATE,
};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, SampleFormat, SizedSample, StreamConfig,
};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{mpsc, Arc, Mutex},
    thread,
};

#[derive(Debug, Clone, Default, Serialize)]
pub struct EngineStatus {
    /// Problems per bus number ("1".."16"): device missing, channel out of range...
    pub input_errors: HashMap<u8, String>,
    pub output_errors: HashMap<u8, String>,
    /// Device ids with an open stream.
    pub open_devices: Vec<String>,
    /// The cpal host in use (e.g. PulseAudio, ALSA, WASAPI, CoreAudio).
    pub host: String,
}

enum Command {
    Apply(AudioConfig),
    Shutdown,
}

/// Which side of a bus a stream serves.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Input,
    Output,
}

type Topology = Vec<(u8, Side, DeviceTap)>;

pub struct AudioEngine {
    pub graph: Arc<Graph>,
    tx: Mutex<mpsc::Sender<Command>>,
    status: Arc<Mutex<EngineStatus>>,
    /// The devices that streams were last built for.
    built: Mutex<Option<Topology>>,
}

/// The audio host used everywhere (device lists and streams).
pub fn host() -> cpal::Host {
    cpal::default_host()
}

/// Display name of a device.
pub fn device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|d| d.name().to_string())
}

/// Stable id of a device, saved in audio.json.
pub fn device_id(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

/// Finds a device by its saved id; falls back to the name (ids saved by older versions
/// were `cpal:<name>`, and a device may get a new id after a host change).
pub fn find_device(host: &cpal::Host, saved: &str, input: bool) -> Option<cpal::Device> {
    let bare = saved.strip_prefix("cpal:").unwrap_or(saved);
    if let Ok(id) = bare.parse::<cpal::DeviceId>() {
        if let Some(d) = host.device_by_id(&id) {
            return Some(d);
        }
    }
    let matches = |d: &cpal::Device| {
        device_id(d).as_deref() == Some(bare) || device_name(d).as_deref() == Some(bare)
    };
    if input {
        host.input_devices().ok()?.find(matches)
    } else {
        host.output_devices().ok()?.find(matches)
    }
}

impl AudioEngine {
    pub fn start() -> Arc<Self> {
        let graph = Arc::new(Graph::default());
        let status = Arc::new(Mutex::new(EngineStatus::default()));
        let (tx, rx) = mpsc::channel::<Command>();
        {
            let graph = graph.clone();
            let status = status.clone();
            thread::Builder::new()
                .name("audio-engine".into())
                .spawn(move || engine_thread(rx, graph, status))
                .expect("cannot start audio thread");
        }
        Arc::new(Self {
            graph,
            tx: Mutex::new(tx),
            status,
            built: Mutex::new(None),
        })
    }

    pub fn status(&self) -> EngineStatus {
        self.status.lock().unwrap().clone()
    }

    fn topology(config: &AudioConfig) -> Topology {
        let mut t = Vec::new();
        for (i, bus) in config.buses.iter().enumerate() {
            let n = i as u8 + 1;
            if let Some(tap) = &bus.input {
                t.push((n, Side::Input, tap.clone()));
            }
            if let Some(tap) = &bus.output {
                t.push((n, Side::Output, tap.clone()));
            }
        }
        t
    }

    fn apply_levels(&self, config: &AudioConfig) {
        for (i, bus) in config.buses.iter().enumerate() {
            let n = i as u8 + 1;
            self.graph.buses.set(n, db_to_gain(bus.volume_db), bus.muted);
            if let Some(node) = self.graph.producer(input_node_id(n)) {
                node.set_gain(db_to_gain(bus.gain_db));
            }
        }
    }

    /// Applies a configuration. Level and mute changes are applied live; device or
    /// channel changes reopen only the streams (all of them, on the engine thread).
    pub fn apply(&self, config: &AudioConfig, force_rebuild: bool) {
        self.apply_levels(config);
        let topology = Self::topology(config);
        let mut built = self.built.lock().unwrap();
        if !force_rebuild && built.as_ref() == Some(&topology) {
            return;
        }
        *built = Some(topology);
        let _ = self.tx.lock().unwrap().send(Command::Apply(config.clone()));
    }

    pub fn shutdown(&self) {
        let _ = self.tx.lock().unwrap().send(Command::Shutdown);
    }
}

// ---------- the engine thread ----------

struct InputTap {
    node: Arc<Node>,
    channels: Vec<usize>,
    resampler: Resampler,
    raw: Vec<f32>,
    out: Vec<f32>,
}

struct OutputTap {
    node: Arc<Node>,
    channels: Vec<usize>,
    mono: bool,
    resampler: Resampler,
    chunk: Vec<f32>,
    resampled: Vec<f32>,
    fifo: VecDeque<f32>,
}

fn engine_thread(rx: mpsc::Receiver<Command>, graph: Arc<Graph>, status: Arc<Mutex<EngineStatus>>) {
    let mut streams: Vec<cpal::Stream> = Vec::new();
    let mut node_ids = Vec::new();
    while let Ok(command) = rx.recv() {
        match command {
            Command::Shutdown => break,
            Command::Apply(config) => {
                // Dropping a stream closes the device right away.
                streams.clear();
                for id in node_ids.drain(..) {
                    graph.remove(id);
                }
                let host = host();
                let mut new_status = EngineStatus {
                    host: host.id().name().to_string(),
                    ..Default::default()
                };
                build_all(&host, &config, &graph, &mut streams, &mut node_ids, &mut new_status, &status);
                *status.lock().unwrap() = new_status;
            }
        }
    }
    drop(streams);
}

fn build_all(
    host: &cpal::Host,
    config: &AudioConfig,
    graph: &Arc<Graph>,
    streams: &mut Vec<cpal::Stream>,
    node_ids: &mut Vec<uuid::Uuid>,
    status: &mut EngineStatus,
    shared_status: &Arc<Mutex<EngineStatus>>,
) {
    // Group the buses by device so every device is opened once.
    let mut inputs: HashMap<String, Vec<(u8, &DeviceTap)>> = HashMap::new();
    let mut outputs: HashMap<String, Vec<(u8, &DeviceTap)>> = HashMap::new();
    for (i, bus) in config.buses.iter().enumerate() {
        let n = i as u8 + 1;
        if let Some(tap) = &bus.input {
            let node = Node::new(input_node_id(n), n, db_to_gain(bus.gain_db), false);
            graph.add_producer(node);
            node_ids.push(input_node_id(n));
            inputs.entry(tap.device_id.clone()).or_default().push((n, tap));
        }
        if let Some(tap) = &bus.output {
            let node = Node::new(output_node_id(n), n, 1.0, false);
            graph.add_consumer(node);
            node_ids.push(output_node_id(n));
            outputs.entry(tap.device_id.clone()).or_default().push((n, tap));
        }
    }

    for (device_id, buses) in inputs {
        let fail = |status: &mut EngineStatus, message: String| {
            for (n, _) in &buses {
                status.input_errors.insert(*n, message.clone());
            }
        };
        let Some(device) = find_device(host, &device_id, true) else {
            fail(status, "input device not found (unplugged?)".into());
            continue;
        };
        let need = buses.iter().flat_map(|(_, t)| t.channels.iter()).copied().max().unwrap_or(0) + 1;
        let Some(config) = pick_config(device.supported_input_configs().ok().map(|c| c.collect()), device.default_input_config().ok(), need) else {
            fail(status, format!("the device has no input format with {need} channels"));
            continue;
        };
        let format = config.sample_format();
        let stream_config: StreamConfig = config.into();
        let dev_channels = stream_config.channels as usize;
        let mut taps = Vec::new();
        for (n, tap) in &buses {
            if tap.channels.iter().any(|c| *c as usize >= dev_channels) {
                status.input_errors.insert(*n, format!("the device has only {dev_channels} input channels"));
                continue;
            }
            if let Some(node) = graph.producer(input_node_id(*n)) {
                taps.push(InputTap {
                    node,
                    channels: tap.channels.iter().map(|c| *c as usize).collect(),
                    resampler: Resampler::new(stream_config.sample_rate, ENGINE_RATE),
                    raw: Vec::new(),
                    out: Vec::new(),
                });
            }
        }
        let numbers: Vec<u8> = buses.iter().map(|(n, _)| *n).collect();
        let s = shared_status.clone();
        let result = match format {
            SampleFormat::F32 => build_input::<f32>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::I16 => build_input::<i16>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::U16 => build_input::<u16>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::I32 => build_input::<i32>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::F64 => build_input::<f64>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::U8 => build_input::<u8>(&device, stream_config, taps, numbers.clone(), s),
            other => Err(format!("unsupported sample format {other:?}")),
        };
        match result {
            Ok(stream) => {
                status.open_devices.push(device_id);
                streams.push(stream);
            }
            Err(e) => fail(status, e),
        }
    }

    for (device_id, buses) in outputs {
        let fail = |status: &mut EngineStatus, message: String| {
            for (n, _) in &buses {
                status.output_errors.insert(*n, message.clone());
            }
        };
        let Some(device) = find_device(host, &device_id, false) else {
            fail(status, "output device not found (unplugged?)".into());
            continue;
        };
        let need = buses.iter().flat_map(|(_, t)| t.channels.iter()).copied().max().unwrap_or(0) + 1;
        let Some(config) = pick_config(device.supported_output_configs().ok().map(|c| c.collect()), device.default_output_config().ok(), need) else {
            fail(status, format!("the device has no output format with {need} channels"));
            continue;
        };
        let format = config.sample_format();
        let stream_config: StreamConfig = config.into();
        let dev_channels = stream_config.channels as usize;
        let mut taps = Vec::new();
        for (n, tap) in &buses {
            if tap.channels.iter().any(|c| *c as usize >= dev_channels) {
                status.output_errors.insert(*n, format!("the device has only {dev_channels} output channels"));
                continue;
            }
            if let Some(node) = graph.consumer(output_node_id(*n)) {
                taps.push(OutputTap {
                    node,
                    channels: tap.channels.iter().map(|c| *c as usize).collect(),
                    mono: tap.mode == ChannelMode::Mono,
                    resampler: Resampler::new(ENGINE_RATE, stream_config.sample_rate),
                    chunk: vec![0.0; 256 * 2],
                    resampled: Vec::new(),
                    fifo: VecDeque::new(),
                });
            }
        }
        let numbers: Vec<u8> = buses.iter().map(|(n, _)| *n).collect();
        let s = shared_status.clone();
        let result = match format {
            SampleFormat::F32 => build_output::<f32>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::I16 => build_output::<i16>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::U16 => build_output::<u16>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::I32 => build_output::<i32>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::F64 => build_output::<f64>(&device, stream_config, taps, numbers.clone(), s),
            SampleFormat::U8 => build_output::<u8>(&device, stream_config, taps, numbers.clone(), s),
            other => Err(format!("unsupported sample format {other:?}")),
        };
        match result {
            Ok(stream) => {
                status.open_devices.push(device_id);
                streams.push(stream);
            }
            Err(e) => fail(status, e),
        }
    }
}

/// Prefers 48 kHz and enough channels; falls back to the device default.
fn pick_config(
    supported: Option<Vec<cpal::SupportedStreamConfigRange>>,
    default: Option<cpal::SupportedStreamConfig>,
    need_channels: u16,
) -> Option<cpal::SupportedStreamConfig> {
    let ranges = supported.unwrap_or_default();
    let usable = |r: &&cpal::SupportedStreamConfigRange| {
        r.channels() >= need_channels
            && matches!(
                r.sample_format(),
                SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16 | SampleFormat::I32 | SampleFormat::F64 | SampleFormat::U8
            )
    };
    if let Some(default) = &default {
        if default.channels() >= need_channels && default.sample_rate() == ENGINE_RATE {
            return Some(default.clone());
        }
    }
    let mut candidates: Vec<&cpal::SupportedStreamConfigRange> = ranges.iter().filter(usable).collect();
    candidates.sort_by_key(|r| (r.sample_format() != SampleFormat::F32, r.channels()));
    for range in &candidates {
        if range.min_sample_rate() <= ENGINE_RATE && ENGINE_RATE <= range.max_sample_rate() {
            return Some((*range).clone().with_sample_rate(ENGINE_RATE));
        }
    }
    if let Some(default) = default {
        if default.channels() >= need_channels {
            return Some(default);
        }
    }
    candidates.first().map(|r| (*r).clone().with_max_sample_rate())
}

fn report(status: &Arc<Mutex<EngineStatus>>, buses: &[u8], input: bool, message: String) {
    if let Ok(mut s) = status.lock() {
        for n in buses {
            if input {
                s.input_errors.insert(*n, message.clone());
            } else {
                s.output_errors.insert(*n, message.clone());
            }
        }
    }
}

fn build_input<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut taps: Vec<InputTap>,
    buses: Vec<u8>,
    status: Arc<Mutex<EngineStatus>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let dev_channels = config.channels as usize;
    let stream = device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let frames = data.len() / dev_channels;
                for tap in taps.iter_mut() {
                    tap.raw.clear();
                    for f in 0..frames {
                        let base = f * dev_channels;
                        let l: f32 = data[base + tap.channels[0]].to_sample();
                        let r: f32 = match tap.channels.get(1) {
                            Some(c) => data[base + c].to_sample(),
                            None => l,
                        };
                        tap.raw.push(l);
                        tap.raw.push(r);
                    }
                    tap.out.clear();
                    let InputTap { resampler, raw, out, node, .. } = tap;
                    resampler.process(raw, out);
                    node.produce(out);
                }
            },
            move |e| report(&status, &buses, true, format!("input stream error: {e}")),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

fn build_output<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut taps: Vec<OutputTap>,
    buses: Vec<u8>,
    status: Arc<Mutex<EngineStatus>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let dev_channels = config.channels as usize;
    let mut mix: Vec<f32> = Vec::new();
    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let frames = data.len() / dev_channels;
                mix.clear();
                mix.resize(data.len(), 0.0);
                for tap in taps.iter_mut() {
                    // Pull 48 kHz blocks through the resampler until we have enough frames.
                    while tap.fifo.len() < frames * 2 {
                        let OutputTap { node, chunk, resampled, resampler, fifo, .. } = tap;
                        node.consume(chunk);
                        resampled.clear();
                        resampler.process(chunk, resampled);
                        fifo.extend(resampled.iter().copied());
                    }
                    for f in 0..frames {
                        let l = tap.fifo.pop_front().unwrap_or(0.0);
                        let r = tap.fifo.pop_front().unwrap_or(0.0);
                        let base = f * dev_channels;
                        if tap.mono {
                            mix[base + tap.channels[0]] += (l + r) * 0.5;
                        } else {
                            mix[base + tap.channels[0]] += l;
                            mix[base + tap.channels[1]] += r;
                        }
                    }
                }
                for (out, value) in data.iter_mut().zip(mix.iter()) {
                    *out = T::from_sample(value.clamp(-1.0, 1.0));
                }
            },
            move |e| report(&status, &buses, false, format!("output stream error: {e}")),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}
