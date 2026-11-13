//! Opens the audio devices used by the input and output strips and connects them to the
//! routing graph. cpal streams are not `Send` on every platform, so they all live on one
//! dedicated thread; the rest of the app talks to it through a channel.

use super::{
    config::{AudioConfig, ChannelMode},
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
use uuid::Uuid;

#[derive(Debug, Clone, Default, Serialize)]
pub struct EngineStatus {
    /// Strip id -> problem (device missing, channel out of range, stream error...).
    pub errors: HashMap<Uuid, String>,
    /// Device ids with an open stream.
    pub open_devices: Vec<String>,
}

enum Command {
    Apply(AudioConfig),
    Shutdown,
}

pub struct AudioEngine {
    pub graph: Arc<Graph>,
    tx: Mutex<mpsc::Sender<Command>>,
    status: Arc<Mutex<EngineStatus>>,
    /// The topology that streams were last built for (device, channels, mode per strip).
    built: Mutex<Option<Vec<(Uuid, String, Vec<u16>, ChannelMode, bool)>>>,
}

fn device_name(device_id: &str) -> &str {
    device_id.strip_prefix("cpal:").unwrap_or(device_id)
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

    fn topology(config: &AudioConfig) -> Vec<(Uuid, String, Vec<u16>, ChannelMode, bool)> {
        let mut t: Vec<_> = config
            .inputs
            .iter()
            .map(|i| (i.id, i.device_id.clone(), i.channels.clone(), i.mode, true))
            .chain(
                config
                    .outputs
                    .iter()
                    .map(|o| (o.id, o.device_id.clone(), o.channels.clone(), o.mode, false)),
            )
            .collect();
        t.sort_by_key(|x| x.0);
        t
    }

    /// Applies a configuration. Level/bus/mute changes are applied live; device or channel
    /// changes reopen the streams.
    pub fn apply(&self, config: &AudioConfig, force_rebuild: bool) {
        let topology = Self::topology(config);
        let mut built = self.built.lock().unwrap();
        if !force_rebuild && built.as_ref() == Some(&topology) {
            for input in &config.inputs {
                if let Some(node) = self.graph.producer(input.id) {
                    node.set_gain(db_to_gain(input.fader_db) * db_to_gain(input.gain_db));
                    node.set_muted(input.muted);
                }
                self.graph.set_bus(input.id, input.bus);
            }
            for output in &config.outputs {
                if let Some(node) = self.graph.consumer(output.id) {
                    node.set_gain(db_to_gain(output.volume_db));
                    node.set_muted(output.muted);
                }
                self.graph.set_bus(output.id, output.bus);
            }
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
    let mut strip_ids: Vec<Uuid> = Vec::new();
    while let Ok(command) = rx.recv() {
        match command {
            Command::Shutdown => break,
            Command::Apply(config) => {
                streams.clear(); // stops the old streams
                for id in strip_ids.drain(..) {
                    graph.remove(id);
                }
                let mut new_status = EngineStatus::default();
                build_all(&config, &graph, &mut streams, &mut strip_ids, &mut new_status, &status);
                *status.lock().unwrap() = new_status;
            }
        }
    }
    drop(streams);
}

fn build_all(
    config: &AudioConfig,
    graph: &Arc<Graph>,
    streams: &mut Vec<cpal::Stream>,
    strip_ids: &mut Vec<Uuid>,
    status: &mut EngineStatus,
    shared_status: &Arc<Mutex<EngineStatus>>,
) {
    let host = cpal::default_host();

    // Inputs, grouped per device so a device is opened once.
    let mut by_device: HashMap<String, Vec<&super::InputStrip>> = HashMap::new();
    for input in &config.inputs {
        let node = Node::new(
            input.id,
            input.bus,
            db_to_gain(input.fader_db) * db_to_gain(input.gain_db),
            input.muted,
        );
        graph.add_producer(node);
        strip_ids.push(input.id);
        by_device.entry(input.device_id.clone()).or_default().push(input);
    }
    for (device_id, strips) in by_device {
        let device = host
            .input_devices()
            .ok()
            .and_then(|mut list| list.find(|d| d.name().ok().as_deref() == Some(device_name(&device_id))));
        let Some(device) = device else {
            for s in &strips {
                status.errors.insert(s.id, format!("input device `{}` not found", device_name(&device_id)));
            }
            continue;
        };
        let need = strips.iter().flat_map(|s| s.channels.iter()).copied().max().unwrap_or(0) as u16 + 1;
        let config = match pick_config(device.supported_input_configs().ok().map(|c| c.collect()), device.default_input_config().ok(), need) {
            Some(c) => c,
            None => {
                for s in &strips {
                    status.errors.insert(s.id, "device has no usable input format".into());
                }
                continue;
            }
        };
        let format = config.sample_format();
        let stream_config: StreamConfig = config.into();
        let dev_channels = stream_config.channels as usize;
        let taps: Vec<InputTap> = strips
            .iter()
            .filter_map(|s| {
                if s.channels.iter().any(|c| *c as usize >= dev_channels) {
                    status.errors.insert(s.id, format!("device has only {dev_channels} input channels"));
                    return None;
                }
                Some(InputTap {
                    node: graph.producer(s.id)?,
                    channels: s.channels.iter().map(|c| *c as usize).collect(),
                    resampler: Resampler::new(stream_config.sample_rate.0, ENGINE_RATE),
                    raw: Vec::new(),
                    out: Vec::new(),
                })
            })
            .collect();
        let ids: Vec<Uuid> = strips.iter().map(|s| s.id).collect();
        let result = match format {
            SampleFormat::F32 => build_input::<f32>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::I16 => build_input::<i16>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::U16 => build_input::<u16>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::I32 => build_input::<i32>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::F64 => build_input::<f64>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::U8 => build_input::<u8>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            other => Err(format!("unsupported sample format {other:?}")),
        };
        match result {
            Ok(stream) => {
                status.open_devices.push(device_id);
                streams.push(stream);
            }
            Err(e) => {
                for id in ids {
                    status.errors.insert(id, e.clone());
                }
            }
        }
    }

    // Outputs, grouped per device.
    let mut by_device: HashMap<String, Vec<&super::OutputStrip>> = HashMap::new();
    for output in &config.outputs {
        let node = Node::new(output.id, output.bus, db_to_gain(output.volume_db), output.muted);
        graph.add_consumer(node);
        strip_ids.push(output.id);
        by_device.entry(output.device_id.clone()).or_default().push(output);
    }
    for (device_id, strips) in by_device {
        let device = host
            .output_devices()
            .ok()
            .and_then(|mut list| list.find(|d| d.name().ok().as_deref() == Some(device_name(&device_id))));
        let Some(device) = device else {
            for s in &strips {
                status.errors.insert(s.id, format!("output device `{}` not found", device_name(&device_id)));
            }
            continue;
        };
        let need = strips.iter().flat_map(|s| s.channels.iter()).copied().max().unwrap_or(0) as u16 + 1;
        let config = match pick_config(device.supported_output_configs().ok().map(|c| c.collect()), device.default_output_config().ok(), need) {
            Some(c) => c,
            None => {
                for s in &strips {
                    status.errors.insert(s.id, "device has no usable output format".into());
                }
                continue;
            }
        };
        let format = config.sample_format();
        let stream_config: StreamConfig = config.into();
        let dev_channels = stream_config.channels as usize;
        let taps: Vec<OutputTap> = strips
            .iter()
            .filter_map(|s| {
                if s.channels.iter().any(|c| *c as usize >= dev_channels) {
                    status.errors.insert(s.id, format!("device has only {dev_channels} output channels"));
                    return None;
                }
                Some(OutputTap {
                    node: graph.consumer(s.id)?,
                    channels: s.channels.iter().map(|c| *c as usize).collect(),
                    mono: s.mode == ChannelMode::Mono,
                    resampler: Resampler::new(ENGINE_RATE, stream_config.sample_rate.0),
                    chunk: vec![0.0; 256 * 2],
                    resampled: Vec::new(),
                    fifo: VecDeque::new(),
                })
            })
            .collect();
        let ids: Vec<Uuid> = strips.iter().map(|s| s.id).collect();
        let result = match format {
            SampleFormat::F32 => build_output::<f32>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::I16 => build_output::<i16>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::U16 => build_output::<u16>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::I32 => build_output::<i32>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::F64 => build_output::<f64>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            SampleFormat::U8 => build_output::<u8>(&device, &stream_config, taps, ids.clone(), shared_status.clone()),
            other => Err(format!("unsupported sample format {other:?}")),
        };
        match result {
            Ok(stream) => {
                status.open_devices.push(device_id);
                streams.push(stream);
            }
            Err(e) => {
                for id in ids {
                    status.errors.insert(id, e.clone());
                }
            }
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
        if default.channels() >= need_channels && default.sample_rate().0 == ENGINE_RATE {
            return Some(default.clone());
        }
    }
    // Same format family as the default when possible, with the fewest extra channels.
    let mut candidates: Vec<&cpal::SupportedStreamConfigRange> = ranges.iter().filter(usable).collect();
    candidates.sort_by_key(|r| (r.sample_format() != SampleFormat::F32, r.channels()));
    for range in &candidates {
        if range.min_sample_rate().0 <= ENGINE_RATE && ENGINE_RATE <= range.max_sample_rate().0 {
            return Some((*range).clone().with_sample_rate(cpal::SampleRate(ENGINE_RATE)));
        }
    }
    if let Some(default) = default {
        if default.channels() >= need_channels {
            return Some(default);
        }
    }
    candidates.first().map(|r| (*r).clone().with_max_sample_rate())
}

fn report(status: &Arc<Mutex<EngineStatus>>, ids: &[Uuid], message: String) {
    if let Ok(mut s) = status.lock() {
        for id in ids {
            s.errors.insert(*id, message.clone());
        }
    }
}

fn build_input<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut taps: Vec<InputTap>,
    ids: Vec<Uuid>,
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
            {
                let ids = ids.clone();
                move |e| report(&status, &ids, format!("input stream error: {e}"))
            },
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

fn build_output<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut taps: Vec<OutputTap>,
    ids: Vec<Uuid>,
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
            {
                let ids = ids.clone();
                move |e| report(&status, &ids, format!("output stream error: {e}"))
            },
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}
