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
  /** Frames sent to ffmpeg. */
  frames: number;
  /** Camera frames that went into the stream. */
  camera_frames: number;
  /** Pictures of the slides/graphics received from the main window. */
  overlays: number;
  video: StreamVideo | null;
  error: string | null;
  log: string[];
}
