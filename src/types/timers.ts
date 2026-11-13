import type { UUID } from "./common";

export type TimerKind =
  | { type: "countdown"; seconds: number }
  | { type: "count_up" }
  | { type: "to_time"; time: string };

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
}
