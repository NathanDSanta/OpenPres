//! Video encoders for the stream, like OBS offers them: x264 on the processor, or the
//! graphics card's own encoder (NVIDIA NVENC, Intel Quick Sync, AMD AMF, Apple
//! VideoToolbox, VA-API on Linux), which leaves the processor free. Each one is tried once
//! with the exact settings the stream uses, so only encoders that really work are used.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    process::{Command, Stdio},
    sync::Mutex,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Encoder {
    /// The first hardware encoder that works, else x264.
    #[default]
    Auto,
    X264,
    Nvenc,
    Qsv,
    Amf,
    VideoToolbox,
    Vaapi,
}

/// The device VA-API encodes on (the first GPU).
const VAAPI_DEVICE: &str = "/dev/dri/renderD128";

impl Encoder {
    pub fn label(self) -> &'static str {
        match self {
            Encoder::Auto => "Automatic",
            Encoder::X264 => "x264 (processor)",
            Encoder::Nvenc => "NVIDIA NVENC",
            Encoder::Qsv => "Intel Quick Sync",
            Encoder::Amf => "AMD AMF",
            Encoder::VideoToolbox => "Apple VideoToolbox",
            Encoder::Vaapi => "VA-API (graphics card)",
        }
    }

    /// Hardware encoders that can exist on this system, in the order Automatic tries them.
    pub fn hardware() -> &'static [Encoder] {
        if cfg!(target_os = "macos") {
            &[Encoder::VideoToolbox]
        } else if cfg!(windows) {
            &[Encoder::Nvenc, Encoder::Qsv, Encoder::Amf]
        } else {
            &[Encoder::Nvenc, Encoder::Vaapi, Encoder::Qsv]
        }
    }
}

/// How the stream wants its video encoded.
#[derive(Debug, Clone)]
pub struct Params {
    pub fps: u32,
    pub kbps: u32,
    /// Constant bitrate (sending to a server); otherwise capped variable (recording).
    pub constant: bool,
    /// x264 speed preset.
    pub preset: String,
}

/// Options before the input (devices).
pub fn input_args(encoder: Encoder) -> Vec<String> {
    match encoder {
        Encoder::Vaapi => vec!["-vaapi_device".into(), VAAPI_DEVICE.into()],
        _ => vec![],
    }
}

/// The video filter (pixel format the encoder takes) and encoder options.
pub fn video_args(encoder: Encoder, p: &Params) -> Vec<String> {
    let k = |v: u32| format!("{v}k");
    let rate = k(p.kbps);
    let gop = (p.fps * 2).to_string(); // a keyframe every 2 s, as YouTube asks
    let s = |list: &[&str]| list.iter().map(|x| x.to_string()).collect::<Vec<String>>();
    let mut args = match encoder {
        Encoder::Auto | Encoder::X264 => {
            let mut a = s(&["-vf", "format=yuv420p", "-c:v", "libx264", "-preset", &p.preset, "-tune", "zerolatency", "-profile:v", "high"]);
            a.extend(s(&["-b:v", &rate, "-maxrate", &rate]));
            if p.constant {
                // Slides are mostly still: without padding x264 sends far less than asked
                // and YouTube warns that the bitrate is low (OBS's CBR does the same).
                a.extend(s(&["-minrate", &rate, "-bufsize", &rate, "-x264-params", "nal-hrd=cbr"]));
            } else {
                a.extend(s(&["-bufsize", &k(p.kbps * 2)]));
            }
            a
        }
        Encoder::Nvenc => {
            let mut a = s(&["-vf", "format=yuv420p", "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq", "-profile:v", "high", "-bf", "2"]);
            if p.constant {
                a.extend(s(&["-rc", "cbr", "-b:v", &rate, "-maxrate", &rate, "-bufsize", &rate]));
            } else {
                a.extend(s(&["-rc", "vbr", "-b:v", &rate, "-maxrate", &rate, "-bufsize", &k(p.kbps * 2)]));
            }
            a
        }
        Encoder::Qsv => {
            // Quick Sync uses constant bitrate when the maximum equals the target.
            let mut a = s(&["-vf", "format=nv12", "-c:v", "h264_qsv", "-preset", "veryfast", "-profile:v", "high", "-b:v", &rate, "-maxrate", &rate]);
            a.extend(s(&["-bufsize", &if p.constant { rate.clone() } else { k(p.kbps * 2) }]));
            a
        }
        Encoder::Amf => {
            let rc = if p.constant { "cbr" } else { "vbr_peak" };
            s(&["-vf", "format=nv12", "-c:v", "h264_amf", "-usage", "transcoding", "-quality", "speed", "-profile:v", "high", "-rc", rc, "-b:v", &rate, "-maxrate", &rate, "-bufsize", &rate])
        }
        Encoder::VideoToolbox => s(&["-vf", "format=nv12", "-c:v", "h264_videotoolbox", "-realtime", "1", "-allow_sw", "0", "-profile:v", "high", "-b:v", &rate]),
        Encoder::Vaapi => {
            let mode = if p.constant { "CBR" } else { "VBR" };
            s(&["-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-rc_mode", mode, "-b:v", &rate, "-maxrate", &rate, "-bufsize", &rate])
        }
    };
    args.extend(s(&["-g", &gop, "-keyint_min", &gop]));
    // The compositor's colours (yuv.rs): players then show them as they were drawn.
    args.extend(s(&["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]));
    args
}

fn ffmpeg_command(ffmpeg: &str) -> Command {
    let mut cmd = Command::new(ffmpeg);
    crate::tools::no_window(&mut cmd);
    cmd
}

/// Encodes a second of black with `encoder` exactly as the stream would.
fn works(ffmpeg: &str, encoder: Encoder) -> bool {
    let params = Params { fps: 30, kbps: 2500, constant: true, preset: "veryfast".into() };
    let mut cmd = ffmpeg_command(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .args(input_args(encoder))
        .args(["-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30", "-frames:v", "30"])
        .args(video_args(encoder, &params))
        .args(["-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// Results of trying the encoders, per ffmpeg.
static TESTED: Mutex<Option<(String, HashMap<Encoder, bool>)>> = Mutex::new(None);

/// Which encoders work with this ffmpeg on this computer (tried once, then remembered).
pub fn available(ffmpeg: &str) -> HashMap<Encoder, bool> {
    if let Some((path, results)) = TESTED.lock().unwrap().as_ref() {
        if path == ffmpeg {
            return results.clone();
        }
    }
    let mut results = HashMap::new();
    results.insert(Encoder::X264, works(ffmpeg, Encoder::X264));
    for &e in Encoder::hardware() {
        results.insert(e, works(ffmpeg, e));
    }
    *TESTED.lock().unwrap() = Some((ffmpeg.to_string(), results.clone()));
    results
}

/// The encoder a setting stands for: Automatic picks the first hardware encoder that
/// works. A chosen one that doesn't work falls back the same way, then to x264.
pub fn resolve(ffmpeg: &str, wanted: Encoder) -> Encoder {
    let found = available(ffmpeg);
    let ok = |e: Encoder| found.get(&e).copied().unwrap_or(false);
    if wanted != Encoder::Auto && ok(wanted) {
        return wanted;
    }
    Encoder::hardware().iter().copied().find(|&e| ok(e)).unwrap_or(Encoder::X264)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> Params {
        Params { fps: 30, kbps: 6800, constant: true, preset: "veryfast".into() }
    }

    #[test]
    fn keyframes_every_two_seconds() {
        for e in [Encoder::X264, Encoder::Nvenc, Encoder::Qsv, Encoder::Amf, Encoder::VideoToolbox, Encoder::Vaapi] {
            let a = video_args(e, &params());
            assert!(a.windows(2).any(|w| w[0] == "-g" && w[1] == "60"), "{e:?}");
            assert!(a.windows(2).any(|w| w[0] == "-b:v" && w[1] == "6800k"), "{e:?}");
        }
    }

    #[test]
    fn streams_use_constant_bitrate() {
        let cbr = video_args(Encoder::X264, &params());
        assert!(cbr.windows(2).any(|w| w[0] == "-minrate" && w[1] == "6800k"));
        assert!(cbr.iter().any(|a| a.contains("nal-hrd=cbr")));
        let vbr = video_args(Encoder::X264, &Params { constant: false, ..params() });
        assert!(!vbr.iter().any(|a| a == "-minrate" || a.contains("nal-hrd")));
        assert!(video_args(Encoder::Nvenc, &params()).windows(2).any(|w| w[0] == "-rc" && w[1] == "cbr"));
    }

    /// `OPENPRES_TEST_FFMPEG=… cargo test --lib encoders -- --ignored`
    #[test]
    #[ignore]
    fn x264_always_works() {
        let ffmpeg = std::env::var("OPENPRES_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into());
        assert!(works(&ffmpeg, Encoder::X264));
        // Without a graphics card here, Automatic ends up on x264.
        println!("{:?}", available(&ffmpeg));
        assert_eq!(resolve(&ffmpeg, Encoder::Auto), Encoder::X264);
    }
}
