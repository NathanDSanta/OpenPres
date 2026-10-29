import { apiGet, apiPost } from "./client";
import type { VideoDevice, AudioDevice, DeviceRefreshResponse } from "@/types";

export const devicesApi = {
  listVideo: () => apiGet<VideoDevice[]>("/devices/video"),
  listAudio: () => apiGet<AudioDevice[]>("/devices/audio"),
  refresh: () => apiPost<DeviceRefreshResponse>("/devices/refresh"),
};
