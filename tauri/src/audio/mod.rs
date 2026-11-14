//! Real audio routing.
//!
//! Signal flow: each of the 16 stereo **buses** takes one input device (a channel or a
//! channel pair) plus any media players routed to it, goes through the bus fader and
//! plays on one output device (and the stream encoder, when it uses that bus). Everything runs at 48 kHz internally; devices that run at
//! another rate are resampled. Mono sources are copied to both sides of the bus, mono
//! outputs get (L+R)/2.

pub mod config;
pub mod decode;
pub mod engine;
pub mod graph;
pub mod resample;

pub use config::{AudioConfig, BusConfig, ChannelMode, DeviceTap, BUSES};
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
