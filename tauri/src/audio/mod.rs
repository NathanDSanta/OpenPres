//! Real audio routing.
//!
//! Signal flow: **input strips** (a channel or channel pair of an input device) and media
//! players feed one of 16 stereo **buses**; **outputs** take a bus and play it on a device
//! channel or channel pair. Everything runs at 48 kHz internally; devices that run at
//! another rate are resampled. Mono sources are copied to both sides of the bus, mono
//! outputs get (L+R)/2.

pub mod config;
pub mod decode;
pub mod engine;
pub mod graph;
pub mod resample;

pub use config::{AudioConfig, ChannelMode, InputStrip, OutputStrip, BUSES};
pub use engine::AudioEngine;
pub use graph::{Graph, Node};

pub const ENGINE_RATE: u32 = 48_000;

/// dB to linear gain; -100 dB and below is silence (the fader's -inf).
pub fn db_to_gain(db: f32) -> f32 {
    if !db.is_finite() || db <= -100.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}
