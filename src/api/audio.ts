import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type {
  AudioRoutingResponse,
  ChannelMapping,
  NewAudioChannelRequest,
  ReplaceAudioRoutingRequest,
} from "@/types";

export const audioApi = {
  getRouting: () => apiGet<AudioRoutingResponse>("/audio/routing"),
  replaceRouting: (body: ReplaceAudioRoutingRequest) =>
    apiPut<AudioRoutingResponse>("/audio/routing", body),

  addChannel: (body: NewAudioChannelRequest) =>
    apiPost<ChannelMapping>("/audio/routing/channels", body),
  updateChannel: (index: number, body: NewAudioChannelRequest) =>
    apiPut<AudioRoutingResponse>(`/audio/routing/channels/${index}`, body),
  removeChannel: (index: number) =>
    apiDelete<AudioRoutingResponse>(`/audio/routing/channels/${index}`),
};
