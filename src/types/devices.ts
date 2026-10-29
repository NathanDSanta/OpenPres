export interface VideoDevice {
  id: string;
  name: string;
  resolutions: [number, number][];
}
export interface AudioDevice {
  id: string;
  name: string;
  input_channels: number;
  sample_rates: number[];
}
export interface DeviceRefreshResponse {
  video: VideoDevice[];
  audio: AudioDevice[];
  warnings: string[];
}
