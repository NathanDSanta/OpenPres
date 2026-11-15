import streamDeck, { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import { Radio } from "lucide";
import { describe } from "../client";
import { formatDuration } from "../format";
import type { Face } from "../keys";
import { store } from "../store";
import { choice, OpenPresAction, text } from "./base";

const MODES = ["toggle", "start", "stop"] as const;
/** How long to hold the key to stop a live stream (when "Hold to stop" is on). */
export const HOLD_MS = 1000;

type StreamSettings = {
	/** toggle: starts, or stops when live; start/stop: only that. */
	mode?: (typeof MODES)[number];
	/** Stopping needs the key held for a second, so a stray press cannot end the stream. On by default. */
	hold?: boolean;
	label?: string;
};

const log = streamDeck.logger.createScope("Stream");

/** Starts and stops the stream (and recording), and shows how long it has been live. */
@action({ UUID: "com.nathandsanta.openpres.stream" })
export class Stream extends OpenPresAction<StreamSettings> {
	/** Keys being held to stop: the timer that stops the stream. */
	private holding = new Map<string, ReturnType<typeof setTimeout>>();

	protected override ticks(): boolean {
		return !!store.snap.stream?.running;
	}

	protected face(settings: StreamSettings): Face {
		const status = store.snap.stream;
		const mode = choice(settings.mode, MODES);
		const label = text(settings.label);
		if (status?.running) {
			const since = status.started_at_ms ? store.now() - status.started_at_ms : 0;
			return {
				icon: Radio,
				label: label || (status.streaming ? "LIVE" : "REC"),
				sub: formatDuration(Math.max(0, since)),
				tone: "live",
			};
		}
		return {
			icon: Radio,
			label: label || (mode === "stop" ? "Stop stream" : "Go live"),
			sub: status?.error ? "failed" : status ? "" : "unavailable",
			tone: status?.error ? "warn" : "idle",
		};
	}

	protected async press(settings: StreamSettings, ev: KeyDownEvent<StreamSettings>): Promise<void> {
		const mode = choice(settings.mode, MODES);
		const running = !!store.snap.stream?.running;
		if (mode === "start" || (mode === "toggle" && !running)) {
			if (!running) await store.client.post("/stream/start");
			return;
		}
		if (!running) return;
		// In a Multi Action there is no holding: the key is "pressed" once.
		if (settings.hold === false || ev.action.isInMultiAction()) {
			await store.client.post("/stream/stop");
			return;
		}
		const id = ev.action.id;
		clearTimeout(this.holding.get(id));
		this.holding.set(
			id,
			setTimeout(() => {
				this.holding.delete(id);
				store.client
					.post("/stream/stop")
					.then(() => store.changed())
					.catch((e) => {
						log.warn(`stop: ${describe(e)}`);
						void ev.action.showAlert();
					});
			}, HOLD_MS),
		);
		this.hint(id, "hold…", HOLD_MS);
	}

	override onKeyUp(ev: KeyUpEvent<StreamSettings>): void {
		const timer = this.holding.get(ev.action.id);
		if (timer === undefined) return;
		// Let go too early: the stream goes on.
		clearTimeout(timer);
		this.holding.delete(ev.action.id);
		this.hint(ev.action.id, "hold to stop");
	}
}
