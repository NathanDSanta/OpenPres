import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type { AudioView, InputStrip, LevelsUpdate, Meters, OutputStrip } from "@/types";

export const audioApi = {
  get: () => apiGet<AudioView>("/audio"),
  addInput: (input: Omit<InputStrip, "id">) => apiPost<AudioView>("/audio/inputs", input),
  updateInput: (id: string, input: InputStrip) => apiPut<AudioView>(`/audio/inputs/${id}`, input),
  addOutput: (output: Omit<OutputStrip, "id">) => apiPost<AudioView>("/audio/outputs", output),
  updateOutput: (id: string, output: OutputStrip) => apiPut<AudioView>(`/audio/outputs/${id}`, output),
  removeStrip: (id: string) => apiDelete<AudioView>(`/audio/inputs/${id}`),
  setLevels: (id: string, levels: LevelsUpdate) => apiPut<AudioView>(`/audio/strips/${id}/levels`, levels),
  setBusNames: (bus_names: string[]) => apiPut<AudioView>("/audio/buses", { bus_names }),
  meters: () => apiGet<Meters>("/audio/meters"),
  restart: () => apiPost<AudioView>("/audio/restart"),
};
