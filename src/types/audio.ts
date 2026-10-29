export const MAX_CHANNELS = 16;


export interface ChannelMapping {
  /** Output slot, 0-15. */
  index: number;
  source_device: string;
  /** Zero-based source channel. */
  source_channel: number;
  label: string;
  gain_db: number;
  muted: boolean;
}

export interface AudioChannelView extends ChannelMapping {
  available: boolean;
}

export interface AudioRoutingResponse {
  max_channels: number;
  used: number;
  channels: AudioChannelView[];
}

export interface NewAudioChannelRequest {
  /** Omit to allocate the next free output slot. */
  index?: number;
  source_device: string;
  source_channel: number;
  label?: string;
  gain_db?: number;
  muted?: boolean;
}

export interface ReplaceAudioRoutingRequest { channels: ChannelMapping[] }
