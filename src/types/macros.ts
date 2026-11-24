import type { UUID } from "./common";
import type { ClearLayer } from "./live";

/** What Next / Previous moves ("all": like the arrow keys). */
export type MoveLayer = "all" | "slides" | "announcements" | "bible";

/** One thing a macro does. */
export type MacroStep =
  | { type: "wait"; seconds: number }
  | { type: "present"; presentation_id: UUID; arrangement?: string | null }
  | { type: "next"; layer: MoveLayer }
  | { type: "previous"; layer: MoveLayer }
  | { type: "bible"; reference: string }
  | { type: "clear"; layers: ClearLayer[] }
  | { type: "clear_group"; group_id: UUID }
  | { type: "prop"; theme_id: UUID; design_id: UUID; show: boolean }
  | { type: "camera"; device_id: string | null }
  | { type: "media_folder"; playlist_id: UUID; audio: boolean }
  | { type: "mute"; bus: number; muted: boolean }
  | { type: "timer"; timer_id: UUID; action: "start" | "pause" | "reset" }
  | { type: "screen_preset"; screen_id: UUID; preset_id: UUID }
  | { type: "stream"; start: boolean }
  | { type: "power"; power: "active" | "standby" };

export type MacroStepType = MacroStep["type"];

/** When a macro starts by itself. No service / presentation: any of them. */
export type MacroTrigger =
  | { type: "service"; service_id: UUID | null; minutes_before: number }
  | { type: "presentation"; presentation_id: UUID | null; when: "begins" | "ends" };

export interface Macro {
  id: UUID;
  name: string;
  /** A Lucide icon name ("Church"), also for Stream Deck keys. */
  icon: string;
  color: string;
  steps: MacroStep[];
  triggers: MacroTrigger[];
}

export interface MacrosFile {
  macros: Macro[];
}

export interface MacroRun {
  run_id: UUID;
  macro_id: UUID;
  name: string;
  /** What started it: "By hand", "30 minutes before Sunday morning"… */
  why: string;
  at_ms: number;
  finished: boolean;
  stopped: boolean;
  errors: string[];
}

export interface MacrosStatus {
  running: UUID[];
  recent: MacroRun[];
}
