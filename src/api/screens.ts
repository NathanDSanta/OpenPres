import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type {
  BindDisplayRequest,
  IdentifyStatus,
  LayerKind,
  PhysicalDisplay,
  RenderScene,
  ScreenInput,
  ScreenPresetsFile,
  ScreenView,
} from "@/types";

export const screensApi = {
  list: () => apiGet<ScreenView[]>("/screens"),
  /** The virtual screens in this order (every list of screens follows it). */
  reorder: (ids: string[]) => apiPut<ScreenView[]>("/screens/order", { ids }),
  create: (input: ScreenInput) => apiPost<ScreenView>("/screens", input),
  update: (id: string, input: ScreenInput) => apiPut<ScreenView>(`/screens/${id}`, input),
  remove: (id: string) => apiDelete(`/screens/${id}`),
  setLayer: (id: string, kind: LayerKind, enabled: boolean) =>
    apiPut<ScreenView>(`/screens/${id}/layers/${kind}`, { enabled }),

  /** Switches the screen's layers to a screen preset's. */
  applyPreset: (id: string, preset_id: string) => apiPut<ScreenView>(`/screens/${id}/preset`, { preset_id }),
  presets: () => apiGet<ScreenPresetsFile>("/screen-presets"),
  /** Admin only. */
  savePresets: (file: ScreenPresetsFile) => apiPut<ScreenPresetsFile>("/screen-presets", file),

  setBinding: (id: string, body: BindDisplayRequest) =>
    apiPut<ScreenView>(`/screens/${id}/binding`, body),
  clearBinding: (id: string) => apiDelete(`/screens/${id}/binding`),

  listDisplays: () => apiGet<PhysicalDisplay[]>("/displays"),
  refreshDisplays: () => apiPost<PhysicalDisplay[]>("/displays/refresh"),
  /** Every output shows its number, screen and display for a few seconds (also in standby). */
  identify: () => apiPost<IdentifyStatus>("/displays/identify"),
  identifyStatus: () => apiGet<IdentifyStatus>("/displays/identify"),

  render: (id: string) => apiGet<RenderScene>(`/screens/${id}/render`),
};
