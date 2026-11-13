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

export interface StreamStatus {
  running: boolean;
  started_at_ms: number | null;
  streaming: boolean;
  recording_file: string | null;
  frames: number;
  error: string | null;
  log: string[];
}
