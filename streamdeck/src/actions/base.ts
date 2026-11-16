import streamDeck, {
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { TriangleAlert } from "lucide";
import { ApiError, describe } from "../client";
import { keyImage, type Face } from "../keys";
import { store } from "../store";

/** A key showing one of this plugin's actions. */
export interface Key<S extends JsonObject> {
	action: KeyAction<S>;
	settings: S;
	/** The image last sent, so unchanged faces are not sent again. */
	image?: string;
	/** Text shown for a moment instead of the second line ("Hold to stop"). */
	hint?: { text: string; until: number };
}

const log = streamDeck.logger.createScope("Keys");

/**
 * What every OpenPres key does: draws itself from the shared live state (greyed out while
 * OpenPres cannot be reached), redraws on every change, and runs its command when pressed
 * (a warning triangle on the key when that fails).
 */
export abstract class OpenPresAction<S extends JsonObject = JsonObject> extends SingletonAction<S> {
	protected readonly keys = new Map<string, Key<S>>();
	private stopUpdates: (() => void) | null = null;
	private stopTicks: (() => void) | null = null;

	/** What the key shows (while connected). */
	protected abstract face(settings: S): Face;

	/** What a press does. Throw to show the warning triangle. */
	protected abstract press(settings: S, ev: KeyDownEvent<S>): Promise<void>;

	/** Whether the face changes every second (a clock), so it is redrawn every second. */
	protected ticks(_settings: S): boolean {
		return false;
	}

	override onWillAppear(ev: WillAppearEvent<S>): void {
		// Keys inside a Multi Action have no face of their own to draw.
		if (!ev.action.isKey() || ev.action.isInMultiAction()) return;
		this.keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
		this.stopUpdates ??= store.onUpdate(() => this.drawAll());
		this.updateTicking();
		this.draw(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<S>): void {
		this.keys.delete(ev.action.id);
		if (!this.keys.size) {
			this.stopUpdates?.();
			this.stopUpdates = null;
		}
		this.updateTicking();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): void {
		const key = this.keys.get(ev.action.id);
		if (!key) return;
		key.settings = ev.payload.settings;
		this.updateTicking();
		this.draw(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<S>): Promise<void> {
		// Keys inside a Multi Action are not drawn, so they have no entry: use the event's.
		const settings = this.keys.get(ev.action.id)?.settings ?? ev.payload.settings;
		if (!store.connected) {
			store.poke();
			await ev.action.showAlert();
			return;
		}
		try {
			await this.press(settings, ev);
			store.changed();
		} catch (e) {
			log.warn(`${this.manifestId}: ${e instanceof ApiError ? e.message : describe(e)}`);
			await ev.action.showAlert();
		}
	}

	override onKeyUp(_ev: KeyUpEvent<S>): void | Promise<void> {}

	/** Shows `text` on the second line for a moment. */
	protected hint(id: string, text: string, ms = 2000) {
		const key = this.keys.get(id);
		if (!key) return;
		key.hint = { text, until: Date.now() + ms };
		this.draw(id);
		setTimeout(() => this.draw(id), ms + 50);
	}

	protected drawAll() {
		for (const id of this.keys.keys()) this.draw(id);
	}

	protected draw(id: string) {
		const key = this.keys.get(id);
		if (!key) return;
		let face: Face;
		try {
			face = this.face(key.settings);
		} catch (e) {
			log.error(`${this.manifestId}: ${describe(e)}`);
			face = { icon: TriangleAlert, label: "Error", tone: "warn" };
		}
		if (!store.connected) {
			face = { ...face, tone: "off", sub: /password/i.test(store.error) ? "password?" : "offline" };
		} else if (key.hint && key.hint.until > Date.now()) {
			face = { ...face, sub: key.hint.text };
		}
		const image = keyImage(face);
		if (image === key.image) return;
		key.image = image;
		key.action.setImage(image).catch((e) => log.warn(`setImage: ${describe(e)}`));
	}

	/** Runs a clock only while a visible key needs one. */
	private updateTicking() {
		const needed = [...this.keys.values()].some((k) => this.ticks(k.settings));
		if (needed && !this.stopTicks) {
			this.stopTicks = store.onTick(() => {
				for (const [id, key] of this.keys) if (this.ticks(key.settings)) this.draw(id);
			});
		} else if (!needed && this.stopTicks) {
			this.stopTicks();
			this.stopTicks = null;
		}
	}
}

// ---- helpers for settings, which may be missing or of the wrong type ----

/** A string setting, or `fallback` when missing. */
export function text(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/** One of `choices`, or the first one. */
export function choice<T extends string>(value: unknown, choices: readonly T[]): T {
	return choices.includes(value as T) ? (value as T) : choices[0];
}

/** A positive whole number, or `fallback`. */
export function count(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}
