export interface VideoDevice {
  id: string;
  name: string;
  resolutions: [number, number][];
}
export interface AudioDevice {
  id: string;
  name: string;
  input_channels: number;
  output_channels: number;
  sample_rates: number[];
}
export interface DeviceRefreshResponse {
  video: VideoDevice[];
  audio: AudioDevice[];
  warnings: string[];
}

/** A named camera / capture card and the format it is captured in. */
export interface VideoInput {
  id: string;
  name: string;
  device_id: string;
  width: number;
  height: number;
  fps: number;
}
