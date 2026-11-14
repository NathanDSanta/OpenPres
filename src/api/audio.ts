import { apiGet, apiPost, apiPut } from "./client";
import type { AudioConfig, AudioView, BusConfig, LevelsUpdate, Meters } from "@/types";

export const audioApi = {
  get: () => apiGet<AudioView>("/audio"),
  replace: (config: AudioConfig) => apiPut<AudioView>("/audio", config),
  /** Bus numbers are 1-16. */
  updateBus: (n: number, bus: BusConfig) => apiPut<AudioView>(`/audio/buses/${n}`, bus),
  setLevels: (n: number, levels: LevelsUpdate) => apiPut<AudioView>(`/audio/buses/${n}/levels`, levels),
  meters: () => apiGet<Meters>("/audio/meters"),
  restart: () => apiPost<AudioView>("/audio/restart"),
};
