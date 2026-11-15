import { action } from "@elgato/streamdeck";
import { Timer as TimerIcon } from "lucide";
import { countsDown, formatDuration, timerValue } from "../format";
import type { Face } from "../keys";
import { store } from "../store";
import { choice, OpenPresAction, text } from "./base";

const MODES = ["toggle", "start", "pause", "reset"] as const;

type TimerSettings = {
	timer_id?: string;
	/** Name when it was chosen, shown if the timer is gone. */
	name?: string;
	/** toggle: start/pause. */
	mode?: (typeof MODES)[number];
	label?: string;
};

/** Starts, pauses or resets a timer, and shows its time. */
@action({ UUID: "com.nathandsanta.openpres.timer" })
export class Timer extends OpenPresAction<TimerSettings> {
	protected override ticks(): boolean {
		return true;
	}

	protected face(settings: TimerSettings): Face {
		const label = text(settings.label);
		if (!settings.timer_id) return { icon: TimerIcon, label: label || "Timer", sub: "not set", tone: "idle" };
		const timer = store.snap.timers.find((t) => t.id === settings.timer_id);
		if (!timer) return { icon: TimerIcon, label: label || text(settings.name) || "Timer", sub: "not found", tone: "warn" };
		const value = timerValue(timer, store.now(), store.snap.services);
		const over = countsDown(timer) && value < 0;
		return {
			icon: TimerIcon,
			label: label || timer.name,
			sub: formatDuration(value),
			tone: over ? "live" : timer.running ? "active" : "idle",
		};
	}

	protected async press(settings: TimerSettings): Promise<void> {
		if (!settings.timer_id) throw new Error("no timer chosen");
		let mode: string = choice(settings.mode, MODES);
		if (mode === "toggle") mode = store.snap.timers.find((t) => t.id === settings.timer_id)?.running ? "pause" : "start";
		await store.client.post(`/timers/${encodeURIComponent(settings.timer_id)}/${mode}`);
	}
}
