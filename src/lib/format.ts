import type { Service, TimerView } from "@/types";

const pad = (n: number, width = 2) => String(Math.trunc(Math.abs(n))).padStart(width, "0");

/** Clock format with tokens HH H hh h mm m ss s a A (anything else is kept). */
export function formatClock(date: Date, format: string): string {
  const h24 = date.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return format.replace(/HH|H|hh|h|mm|m|ss|s|a|A/g, (token) => {
    switch (token) {
      case "HH": return pad(h24);
      case "H": return String(h24);
      case "hh": return pad(h12);
      case "h": return String(h12);
      case "mm": return pad(date.getMinutes());
      case "m": return String(date.getMinutes());
      case "ss": return pad(date.getSeconds());
      case "s": return String(date.getSeconds());
      case "a": return h24 < 12 ? "am" : "pm";
      case "A": return h24 < 12 ? "AM" : "PM";
      default: return token;
    }
  });
}

/**
 * Duration format: HH/H hours, mm/m minutes, ss/s seconds. Without an hour token the
 * minutes keep counting past 59 (e.g. 75:00).
 */
export function formatDuration(ms: number, format = "mm:ss"): string {
  const negative = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const hasHours = /H/.test(format);
  const hours = Math.floor(total / 3600);
  const minutes = hasHours ? Math.floor((total % 3600) / 60) : Math.floor(total / 60);
  const seconds = total % 60;
  const text = format.replace(/HH|H|mm|m|ss|s/g, (token) => {
    switch (token) {
      case "HH": return pad(hours);
      case "H": return String(hours);
      case "mm": return pad(minutes);
      case "m": return String(minutes);
      case "ss": return pad(seconds);
      case "s": return String(seconds);
      default: return token;
    }
  });
  return negative ? `-${text}` : text;
}

/** The service in progress at `at`, or the next one (local time of this device). */
export function currentOrNextService(services: Service[], at: number, only?: string | null): { service: Service; start: number; end: number } | null {
  const base = new Date(at);
  let best: { service: Service; start: number; end: number } | null = null;
  for (let d = -1; d <= 7; d++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    for (const s of services) {
      if (only && s.id !== only) continue;
      if (!s.days.includes(day.getDay())) continue;
      const [sh, sm] = s.start.split(":").map(Number);
      const [eh, em] = s.end.split(":").map(Number);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm).getTime();
      let end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em).getTime();
      if (end <= start) end += 24 * 3600 * 1000; // ends after midnight
      if (end <= at) continue;
      if (!best || start < best.start) best = { service: s, start, end };
    }
  }
  return best;
}

/** The value a timer shows at `now` (ms since epoch, server-adjusted). */
export function timerValue(timer: TimerView, now: number, services: Service[] = []): number {
  const elapsed = timer.elapsed_ms + (timer.running && timer.started_at ? now - timer.started_at : 0);
  // Clock-based timers freeze while paused.
  const at = !timer.running && timer.paused_at ? timer.paused_at : now;
  switch (timer.kind.type) {
    case "count_up":
      return elapsed;
    case "countdown": {
      const left = timer.kind.seconds * 1000 - elapsed;
      return timer.allow_overrun ? left : Math.max(0, left);
    }
    case "to_time": {
      const [h, m] = timer.kind.time.split(":").map(Number);
      const target = new Date(at);
      target.setHours(h, m, 0, 0);
      const left = target.getTime() - at;
      return timer.allow_overrun ? left : Math.max(0, left);
    }
    case "service": {
      const next = currentOrNextService(services, at, timer.kind.service_id);
      if (!next) return 0;
      const left = (timer.kind.target === "end" ? next.end : next.start) - at;
      return timer.allow_overrun ? left : Math.max(0, left);
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDb(db: number): string {
  if (db <= -100) return "-∞";
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}
