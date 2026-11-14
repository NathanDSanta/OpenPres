export const BUS_COUNT = 16;
export type ChannelMode = "mono" | "stereo";

/** A device channel (mono) or channel pair (stereo). */
export interface DeviceTap {
  device_id: string;
  mode: ChannelMode;
  channels: number[];
}

export interface BusConfig {
  name: string;
  /** Bus fader, -100 (= -inf) .. +10 dB. */
  volume_db: number;
  /** Input gain, -20 .. +40 dB. */
  gain_db: number;
  muted: boolean;
  input: DeviceTap | null;
  output: DeviceTap | null;
}

export interface AudioConfig {
  buses: BusConfig[];
}

export interface AudioView {
  config: AudioConfig;
  status: {
    input_errors: Record<string, string>;
    output_errors: Record<string, string>;
    open_devices: string[];
    host: string;
  };
  buses: number;
}

export interface LevelsUpdate {
  volume_db?: number;
  gain_db?: number;
  muted?: boolean;
}

/** Peaks since the last read, 0..1: post-fader per bus, and each bus' input. */
export interface Meters {
  buses: [number, number][];
  inputs: [number, number][];
}
