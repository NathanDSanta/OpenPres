import { invoke } from "@tauri-apps/api/core";

export interface WindowAssignment {
  screen_id: string;
  display_id: string;
}

function requireTauri() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Native presentation windows are only available in the Tauri desktop app.");
  }
}

export const presentationWindowsApi = {
  assign: async (screenId: string, displayId: string) => {
    requireTauri();
    await invoke("assign_presentation_window", {
      screenId,
      displayId,
    });
  },

  setVisible: async (displayId: string, visible: boolean) => {
    requireTauri();
    await invoke("set_presentation_window_visible", {
      displayId,
      visible,
    });
  },

  refresh: async (assignments: WindowAssignment[]) => {
    requireTauri();
    await invoke("refresh_presentation_windows", { assignments });
  },

  getVisibility: async (): Promise<
    Array<{ display_id: string; visible: boolean }>
  > => {
    requireTauri();
    return invoke("get_presentation_window_visibility");
  },
};
