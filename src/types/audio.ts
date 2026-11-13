import type { UUID } from "./common";

export const BUS_COUNT = 16;
export type ChannelMode = "mono" | "stereo";

export interface InputStrip {
  id: UUID;
  name: string;
  device_id: string;
  mode: ChannelMode;
  channels: number[];
  bus: number;
  fader_db: number;
  gain_db: number;
  muted: boolean;
}

export interface OutputStrip {
  id: UUID;
  name: string;
  device_id: string;
  mode: ChannelMode;
  channels: number[];
  bus: number;
  volume_db: number;
  muted: boolean;
}

export interface AudioConfig {
  inputs: InputStrip[];
  outputs: OutputStrip[];
  bus_names: string[];
}

export interface AudioView {
  config: AudioConfig;
  status: { errors: Record<UUID, string>; open_devices: string[] };
  buses: number;
}

export interface LevelsUpdate {
  fader_db?: number;
  gain_db?: number;
  volume_db?: number;
  muted?: boolean;
  bus?: number;
}

/** Strip id -> [left, right] peak since the last read, 0..1. */
export type Meters = Record<UUID, [number, number]>;
