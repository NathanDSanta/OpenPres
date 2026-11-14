import type { UUID } from "./common";

export type TimerKind =
  | { type: "countdown"; seconds: number }
  | { type: "count_up" }
  | { type: "to_time"; time: string }
  | { type: "service"; target: "start" | "end"; service_id: UUID | null };

/** A weekly church service; days 0 = Sunday .. 6 = Saturday. */
export interface Service {
  id: UUID;
  name: string;
  days: number[];
  start: string;
  end: string;
}

export interface TimerDef {
  id: UUID;
  name: string;
  kind: TimerKind;
  allow_overrun: boolean;
}

export interface TimerView extends TimerDef {
  running: boolean;
  elapsed_ms: number;
  started_at: number | null;
  /** Clock-based timers show their value at this moment while paused. */
  paused_at: number | null;
}
