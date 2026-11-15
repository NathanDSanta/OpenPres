import type { Service, Timer } from "./store";

/**
 * "2:03", or "1:02:03" from an hour on; negative values (overrun) get a minus sign. Whole
 * seconds are counted like in OpenPres, so a key and the app show the same.
 */
export function formatDuration(ms: number): string {
	const negative = ms < 0;
	const total = Math.floor(Math.abs(ms) / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const body = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
	return negative ? `-${body}` : body;
}

// The two functions below are OpenPres's own (src/lib/format.ts), so keys show what the
// app shows.

/** The service in progress at `at`, or the next one (local time of this computer). */
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

/** The value a timer shows at `now` (ms since epoch, server time). */
export function timerValue(timer: Timer, now: number, services: Service[] = []): number {
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
		default:
			return 0;
	}
}

/** Whether a timer counts down (its value is time left), rather than up. */
export function countsDown(timer: Timer): boolean {
	return timer.kind.type !== "count_up";
}
