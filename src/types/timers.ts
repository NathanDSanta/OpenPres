import type { UUID } from "./common";

export type TimerKind =
  | { type: "countdown"; seconds: number }
  | { type: "count_up" }
  | { type: "to_time"; time: string }
  | { type: "service"; target: "start" | "end"; service_id: UUID | null };

/** A weekly church service; days 0 = Sunday .. 6 = Saturday. */
/** A church service: every week, or a special one on one date that can cancel that day's weekly ones. */
export interface Service {
  id: UUID;
  name: string;
  /** Days of the week, 0 = Sunday (weekly services). */
  days: number[];
  /** "YYYY-MM-DD": a special service on this date only. */
  date?: string;
  /** A special service that replaces the weekly services of its day. */
  cancels_others?: boolean;
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
