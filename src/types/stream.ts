import type { UUID } from "./common";

export interface StreamSettings {
  screen_id: UUID | null;
  width: number;
  height: number;
  fps: number;
  video_kbps: number;
  audio_kbps: number;
  bus: number;
  mono: boolean;
  send_rtmp: boolean;
  rtmp_url: string;
  /** Masked when read back; sending the masked value keeps the saved key. */
  stream_key: string;
  stream_key_set?: boolean;
  record: boolean;
  record_dir: string;
  x264_preset: string;
  /** x264 on the processor, or the graphics card's encoder. */
  encoder: EncoderId;
}

export type EncoderId = "auto" | "x264" | "nvenc" | "qsv" | "amf" | "video_toolbox" | "vaapi";

export interface EncoderChoice {
  id: EncoderId;
  label: string;
  /** Works on this computer (tried with the stream's settings). */
  available: boolean;
}

export interface EncoderList {
  encoders: EncoderChoice[];
  /** What Automatic uses here. */
  automatic: EncoderId;
  automatic_label: string;
}

/** ffmpeg's report on the encoding, every second. */
export interface EncoderProgress {
  fps: number;
  /** Below 1.0 the encoder can't keep up with real time. */
  speed: number;
  kbps: number;
}

/** What the app's main window draws while the stream runs. */
export interface StreamVideo {
  screen_id: string;
  width: number;
  height: number;
  fps: number;
}

export interface StreamStatus {
  running: boolean;
  started_at_ms: number | null;
  streaming: boolean;
  recording_file: string | null;
  /** The encoder in use. */
  encoder: string | null;
  /** Frames sent to the encoder. */
  frames: number;
  /** Different pictures put together (how smoothly things move). */
  pictures: number;
  /** Frames repeated because the computer was late drawing them (OBS: rendering lag). */
  lagged: number;
  /** Frames skipped because the encoder fell behind (OBS: encoding lag). */
  skipped: number;
  /** Camera frames that went into the stream. */
  camera_frames: number;
  /** Pictures of the slides/graphics received from the main window. */
  overlays: number;
  progress: EncoderProgress | null;
  video: StreamVideo | null;
  error: string | null;
  log: string[];
}
