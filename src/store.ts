import { ApiError, describe, type ConnectionSettings, OpenPresClient } from "./client";

// ---- What OpenPres reports (only the fields the keys use) ----

export interface PropRef {
	theme_id: string;
	design_id: string;
}

export interface LiveLayers {
	video_input: string | null;
	props: PropRef[];
	complements: PropRef[];
}

export interface LayerState {
	presentation_id: string;
	title: string;
	slide_index: number;
	total_slides: number;
	current?: { index: number; group?: string | null } | null;
}

export interface PresenterState {
	slides: LayerState | null;
	announcements: LayerState | null;
	/** What Next/Previous with the "slides or Bible" target move (newer OpenPres only). */
	focus?: "slides" | "bible";
}

export interface StreamStatus {
	running: boolean;
	started_at_ms: number | null;
	streaming: boolean;
	recording_file: string | null;
	error: string | null;
}

export type TimerKind =
	| { type: "countdown"; seconds: number }
	| { type: "count_up" }
	| { type: "to_time"; time: string }
	| { type: "service"; target: "start" | "end"; service_id: string | null };

export interface Timer {
	id: string;
	name: string;
	kind: TimerKind;
	allow_overrun: boolean;
	running: boolean;
	elapsed_ms: number;
	started_at: number | null;
	paused_at: number | null;
}

export interface Service {
	id: string;
	name: string;
	days: number[];
	start: string;
	end: string;
}

export interface BibleReference {
	book: string;
	chapter: number;
	verse_start: number;
	verse_end: number;
}

export interface BibleLive {
	reference: BibleReference;
	label?: string;
}

export interface PlayerSlot {
	playlist_id: string | null;
	name: string;
	playing: boolean;
}

export interface Player {
	now_ms: number;
	visual: PlayerSlot | null;
	audio: PlayerSlot | null;
}

export interface PropsCollection {
	id: string;
	name: string;
	/** Whose props they are (newer OpenPres): the Stage's or the Livestream's. */
	props_for?: "stage" | "livestream";
	designs: { id: string; name: string }[];
}

export interface Bus {
	name: string;
	muted: boolean;
}

/** A button that clears several layers at once, set up by OpenPres's admin. */
export interface ClearGroup {
	id: string;
	name: string;
	color?: string;
	/** "slides", "bible", "props"… */
	layers: string[];
}

/** One of OpenPres's macros (Settings → Macros): steps that run from one press. */
export interface Macro {
	id: string;
	name: string;
	/** A Lucide icon name ("Church"). */
	icon: string;
	color?: string;
}

export interface Folder {
	id: string;
	name: string;
	kind: "image" | "video" | "audio";
}

export interface Camera {
	id: string;
	name: string;
}

/** A video input set up in OpenPres (Media → Video inputs): a camera with a name. */
export interface VideoInput {
	id: string;
	name: string;
	device_id: string;
}

export interface Snapshot {
	live: LiveLayers;
	presenter: PresenterState;
	stream: StreamStatus | null;
	timers: Timer[];
	services: Service[];
	bible: BibleLive | null;
	player: Player | null;
	props: PropsCollection[];
	clearGroups: ClearGroup[];
	macros: Macro[];
	/** Macros running now. */
	macrosRunning: string[];
	/** Mixer buses; bus n is `buses[n - 1]`. */
	buses: Bus[];
	folders: Folder[];
	cameras: Camera[];
	inputs: VideoInput[];
	/** Server clock minus this computer's clock (ms), for timers and the stream time. */
	offset: number;
}

const EMPTY: Snapshot = {
	live: { video_input: null, props: [], complements: [] },
	presenter: { slides: null, announcements: null },
	stream: null,
	timers: [],
	services: [],
	bible: null,
	player: null,
	props: [],
	clearGroups: [],
	macros: [],
	macrosRunning: [],
	buses: [],
	folders: [],
	cameras: [],
	inputs: [],
	offset: 0,
};

export interface ConnectionStatus {
	connected: boolean;
	/** Where the plugin looks for OpenPres, e.g. "127.0.0.1:8787". */
	address: string;
	/** OpenPres's version when connected. */
	version: string;
	/** Why it is not connected (or why the last refresh failed). */
	error: string;
}

/**
 * The live state of OpenPres, kept up to date from its change notifications and shared by
 * every key. Reconnects by itself when OpenPres restarts or the network drops.
 */
export class Store {
	readonly client = new OpenPresClient();
	connected = false;
	version = "";
	error = "";
	snap: Snapshot = EMPTY;

	private listeners = new Set<() => void>();
	private tickListeners = new Set<() => void>();
	private ticker: ReturnType<typeof setInterval> | null = null;
	private abort: AbortController | null = null;
	private refreshing: Promise<void> | null = null;
	private again = false;
	private wake: (() => void) | null = null;

	/** (Re)connects with these settings; nothing happens when they did not change. */
	connect(settings: ConnectionSettings) {
		const changed = this.client.setConnection(settings);
		if (!changed && this.abort) return;
		this.abort?.abort();
		const abort = new AbortController();
		this.abort = abort;
		this.snap = EMPTY;
		this.setConnected(false, "connecting…");
		void this.run(abort.signal);
	}

	stop() {
		this.abort?.abort();
		this.abort = null;
	}

	get status(): ConnectionStatus {
		return { connected: this.connected, address: this.client.address, version: this.version, error: this.error };
	}

	/** Called on every change of the state or the connection. */
	onUpdate(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Called every second (clocks on keys) while someone listens. */
	onTick(listener: () => void): () => void {
		this.tickListeners.add(listener);
		this.ticker ??= setInterval(() => this.tickListeners.forEach((l) => l()), 1000);
		return () => {
			this.tickListeners.delete(listener);
			if (!this.tickListeners.size && this.ticker) {
				clearInterval(this.ticker);
				this.ticker = null;
			}
		};
	}

	/** Server time now (ms). */
	now(): number {
		return Date.now() + this.snap.offset;
	}

	/** Try to connect now instead of waiting for the next attempt (e.g. a key was pressed). */
	poke() {
		this.wake?.();
	}

	/** After a key changed something: refresh now rather than wait for the notification. */
	changed() {
		if (this.connected) this.scheduleRefresh();
	}

	private emit() {
		for (const l of this.listeners) {
			try {
				l();
			} catch {
				/* one bad listener must not stop the others */
			}
		}
	}

	private setConnected(connected: boolean, error = "") {
		if (this.connected === connected && this.error === error) return;
		this.connected = connected;
		this.error = error;
		this.emit();
	}

	private async run(signal: AbortSignal) {
		let delay = 1000;
		while (!signal.aborted) {
			try {
				const health = await this.client.get<{ version?: string }>("/health");
				this.version = health?.version ?? "";
				await this.refresh();
				if (signal.aborted) return;
				this.setConnected(true);
				delay = 1000;
				await this.client.events(signal, () => this.scheduleRefresh());
				if (!signal.aborted) throw new ApiError(0, "the connection to OpenPres was closed");
			} catch (e) {
				if (signal.aborted) return;
				this.setConnected(false, e instanceof ApiError ? e.message : describe(e));
				await this.sleep(delay, signal);
				delay = Math.min(delay * 2, 5000);
			}
		}
	}

	private sleep(ms: number, signal: AbortSignal) {
		return new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.wake = null;
				signal.removeEventListener("abort", done);
				resolve();
			};
			const timer = setTimeout(done, ms);
			this.wake = done;
			signal.addEventListener("abort", done);
		});
	}

	/** Several changes in a burst cause one refresh (plus one if more came meanwhile). */
	private scheduleRefresh() {
		if (this.refreshing) {
			this.again = true;
			return;
		}
		this.refreshing = this.refresh()
			.catch((e) => {
				this.error = e instanceof ApiError ? e.message : describe(e);
			})
			.finally(() => {
				this.refreshing = null;
				if (this.again) {
					this.again = false;
					this.scheduleRefresh();
				}
			});
	}

	async refresh(): Promise<void> {
		const c = this.client;
		const optional = <T>(p: Promise<T>, fallback: T) =>
			p.catch((e) => {
				// A feature missing from an older OpenPres must not break the rest.
				if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return fallback;
				throw e;
			});
		const sent = Date.now();
		const [live, presenter, stream, timers, services, bible, player, props, audio, folders, cameras, inputs, clearGroups, macros, macroStatus] = await Promise.all([
			c.get<LiveLayers>("/live"),
			c.get<PresenterState>("/presenter/state"),
			optional(c.get<StreamStatus>("/stream/status"), null),
			optional(c.get<Timer[]>("/timers"), []),
			optional(c.get<Service[]>("/services"), []),
			optional(c.get<BibleLive | null>("/bible/live"), null),
			optional(c.get<Player>("/player"), null),
			optional(c.get<PropsCollection[]>("/themes?kind=props"), []),
			optional(c.get<{ config?: { buses?: Bus[] } }>("/audio"), null),
			optional(c.get<Folder[]>("/media/playlists"), []),
			optional(c.get<Camera[]>("/devices/video"), []),
			optional(c.get<VideoInput[]>("/video-inputs"), []),
			optional(c.get<{ groups?: ClearGroup[] }>("/clear-groups"), null),
			optional(c.get<{ macros?: Macro[] }>("/macros"), null),
			optional(c.get<{ running?: string[] }>("/macros/status"), null),
		]);
		const received = Date.now();
		this.snap = {
			live: { video_input: live?.video_input ?? null, props: live?.props ?? [], complements: live?.complements ?? [] },
			presenter: { slides: presenter?.slides ?? null, announcements: presenter?.announcements ?? null, focus: presenter?.focus },
			stream,
			timers: timers ?? [],
			services: services ?? [],
			bible,
			player,
			props: props ?? [],
			clearGroups: clearGroups?.groups ?? [],
			macros: macros?.macros ?? [],
			macrosRunning: macroStatus?.running ?? [],
			buses: audio?.config?.buses ?? [],
			folders: folders ?? [],
			cameras: cameras ?? [],
			inputs: inputs ?? [],
			// The player's clock is the server's: assume it was read halfway through.
			offset: player?.now_ms ? player.now_ms - (sent + received) / 2 : this.snap.offset,
		};
		this.emit();
	}
}

/** The one store all keys share. */
export const store = new Store();
