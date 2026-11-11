import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport";

export interface WindowAssignment {
  screen_id: string;
  display_id: string;
}

export interface WindowVisibility {
  display_id: string;
  visible: boolean;
}

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(
      new Error("Native presentation windows are only available in the Tauri desktop app."),
    );
  }
  return invoke<T>(command, args);
}

export const presentationWindowsApi = {
  assign: (screenId: string, displayId: string) =>
    call<void>("assign_presentation_window", { screenId, displayId }),

  setVisible: (displayId: string, visible: boolean) =>
    call<void>("set_presentation_window_visible", { displayId, visible }),

  /** Closes windows for unassigned displays and realigns the rest. */
  refresh: (assignments: WindowAssignment[]) =>
    call<void>("refresh_presentation_windows", { assignments }),

  getVisibility: () => call<WindowVisibility[]>("get_presentation_window_visibility"),

  /** Hides the window this code runs in (used by the presentation page itself). */
  hideCurrent: () => call<void>("hide_current_presentation_window"),
};
