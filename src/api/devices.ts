import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { AudioDevice, DeviceRefreshResponse, VideoDevice, VideoInput } from "@/types";

export const devicesApi = {
  listVideo: () => apiGet<VideoDevice[]>("/devices/video"),
  listAudio: () => apiGet<AudioDevice[]>("/devices/audio"),
  refresh: () => apiPost<DeviceRefreshResponse>("/devices/refresh"),
  inputs: () => apiGet<VideoInput[]>("/video-inputs"),
  createInput: (input: Omit<VideoInput, "id">) => apiPost<VideoInput>("/video-inputs", input),
  updateInput: (input: VideoInput) => apiPut<VideoInput>(`/video-inputs/${input.id}`, input),
  removeInput: (id: string) => apiDelete(`/video-inputs/${id}`),
};
