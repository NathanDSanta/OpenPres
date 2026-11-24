// Plays the Stream Deck app for tests: starts the built plugin the way Elgato's app and
// OpenDeck do (a WebSocket port and registration arguments), shows it keys, presses them,
// and records what the plugin sends back (key images, alerts, messages to the panel).
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "com.nathandsanta.openpres.sdPlugin");
export const PLUGIN_UUID = "com.nathandsanta.openpres";

type Message = { event: string; context?: string; payload?: any; id?: string; [k: string]: unknown };

export class FakeStreamDeck {
	received: Message[] = [];
	global: Record<string, unknown>;
	output = "";
	port = 0;
	private info: unknown;
	private server!: WebSocketServer;
	private socket!: WebSocket;
	private inspectors = new Map<string, WebSocket>();
	/** Keys shown, with their settings (the app keeps these). */
	keys = new Map<string, { action: string; settings: Record<string, unknown> }>();
	private plugin!: ChildProcess;
	private waiters: { test: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];

	constructor(global: Record<string, unknown> = {}) {
		this.global = global;
	}

	/** `version`: the Stream Deck app's; `pluginVersion`: the plugin's (a release writes its own). */
	async start(version = "7.1.0", pluginVersion = "0.1.0.0"): Promise<this> {
		this.server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		await once(this.server, "listening");
		this.port = (this.server.address() as { port: number }).port;
		const info = {
			application: { font: "", language: "en", platform: "windows", platformVersion: "10.0.19045", version },
			colors: {},
			devicePixelRatio: 2,
			devices: [{ id: "dev1", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
			plugin: { uuid: PLUGIN_UUID, version: pluginVersion },
		};
		this.info = info;
		// The plugin and settings panels connect to the same port, like with the real app.
		this.server.on("connection", (socket) => {
			socket.once("message", (data) => {
				const first = JSON.parse(String(data)) as Message;
				if (first.event === "registerPlugin") {
					this.socket = socket;
					socket.on("message", (d) => this.onMessage(JSON.parse(String(d))));
					this.onMessage(first);
				} else if (first.event === "registerPropertyInspector") {
					const context = String(first.uuid);
					this.inspectors.set(context, socket);
					socket.on("message", (d) => this.onInspectorMessage(context, JSON.parse(String(d))));
					socket.on("close", () => {
						this.inspectors.delete(context);
						this.send({ event: "propertyInspectorDidDisappear", action: this.keys.get(context)?.action, context, device: "dev1" });
					});
					// The app tells the plugin when a key's settings panel opens.
					this.inspect(context);
				}
			});
		});
		this.plugin = spawn(process.execPath, ["bin/plugin.js", "-port", String(this.port), "-pluginUUID", PLUGIN_UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
			cwd: PLUGIN_DIR,
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.plugin.stdout!.on("data", (d) => (this.output += d));
		this.plugin.stderr!.on("data", (d) => (this.output += d));
		await this.waitFor((m) => m.event === "registerPlugin", 8000);
		return this;
	}

	/** Messages from a settings panel, handled like the app does. */
	private onInspectorMessage(context: string, m: Message) {
		const panel = this.inspectors.get(context)!;
		const key = this.keys.get(context);
		switch (m.event) {
			case "getGlobalSettings":
				panel.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: this.global } }));
				break;
			case "setGlobalSettings":
				this.setGlobal(m.payload);
				break;
			case "getSettings":
				panel.send(JSON.stringify({ event: "didReceiveSettings", action: key?.action, context, payload: { settings: key?.settings ?? {} } }));
				break;
			case "setSettings":
				if (key) {
					key.settings = m.payload;
					this.settings(key.action.slice(PLUGIN_UUID.length + 1), context, m.payload);
				}
				break;
			case "sendToPlugin":
				this.send({ event: "sendToPlugin", action: m.action as string, context, payload: m.payload });
				break;
		}
	}

	/** Opens a key's settings panel: what the app tells the plugin. */
	inspect(context: string) {
		const key = this.keys.get(context);
		this.send({ event: "propertyInspectorDidAppear", action: key?.action, context, device: "dev1" });
	}

	/** The arguments the app gives a settings panel's connectElgatoStreamDeckSocket(). */
	inspectorArgs(context: string): [number, string, string, string, string] {
		const key = this.keys.get(context)!;
		const actionInfo = { action: key.action, context, device: "dev1", payload: { settings: key.settings, coordinates: { column: 0, row: 0 } } };
		return [this.port, context, "registerPropertyInspector", JSON.stringify(this.info), JSON.stringify(actionInfo)];
	}

	async stop() {
		for (const panel of this.inspectors.values()) panel.close();
		this.plugin.kill();
		this.server.close();
		for (const c of this.server.clients) c.terminate();
	}

	private onMessage(m: Message) {
		this.received.push(m);
		// The app answers these by itself.
		if (m.event === "getGlobalSettings") this.send({ event: "didReceiveGlobalSettings", id: m.id, payload: { settings: this.global } });
		if (m.event === "setGlobalSettings") this.global = m.payload;
		if (m.event === "sendToPropertyInspector" && m.context) {
			this.inspectors.get(m.context)?.send(JSON.stringify({ event: "sendToPropertyInspector", action: this.keys.get(m.context)?.action, context: m.context, payload: m.payload }));
		}
		for (const w of [...this.waiters]) {
			if (w.test(m)) {
				this.waiters.splice(this.waiters.indexOf(w), 1);
				w.resolve(m);
			}
		}
	}

	send(m: Message) {
		this.socket.send(JSON.stringify(m));
	}

	/** Resolves with the first message (already received after `since`, or coming) that passes. */
	waitFor(test: (m: Message) => boolean, ms = 4000, since = 0): Promise<Message> {
		const seen = this.received.slice(since).find(test);
		if (seen) return Promise.resolve(seen);
		return new Promise((resolve, reject) => {
			const waiter = { test, resolve };
			this.waiters.push(waiter);
			setTimeout(() => {
				const i = this.waiters.indexOf(waiter);
				if (i >= 0) {
					this.waiters.splice(i, 1);
					reject(new Error(`timed out waiting for a message; plugin output:\n${this.output}`));
				}
			}, ms);
		});
	}

	/** Changes the connection settings as the settings panel does. */
	setGlobal(settings: Record<string, unknown>) {
		this.global = settings;
		this.send({ event: "didReceiveGlobalSettings", payload: { settings } });
	}

	appear(action: string, context: string, settings: Record<string, unknown> = {}, isInMultiAction = false) {
		this.keys.set(context, { action: `${PLUGIN_UUID}.${action}`, settings });
		this.send({
			event: "willAppear",
			action: `${PLUGIN_UUID}.${action}`,
			context,
			device: "dev1",
			payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", state: 0, isInMultiAction },
		});
	}

	settings(action: string, context: string, settings: Record<string, unknown>) {
		this.send({ event: "didReceiveSettings", action: `${PLUGIN_UUID}.${action}`, context, device: "dev1", payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", state: 0, isInMultiAction: false } });
	}

	key(event: "keyDown" | "keyUp", action: string, context: string, settings: Record<string, unknown> = {}) {
		this.send({ event, action: `${PLUGIN_UUID}.${action}`, context, device: "dev1", payload: { settings, coordinates: { column: 0, row: 0 }, state: 0, isInMultiAction: false } });
	}

	/** Press and let go. */
	press(action: string, context: string, settings: Record<string, unknown> = {}) {
		this.key("keyDown", action, context, settings);
		this.key("keyUp", action, context, settings);
	}

	/** The SVG last drawn on a key. */
	image(context: string): string {
		const m = [...this.received].reverse().find((x) => x.event === "setImage" && x.context === context);
		return m ? svgOf(m.payload.image) : "";
	}

	/** Waits until a key's image matches (e.g. shows some text). */
	async imageMatching(context: string, test: (svg: string) => boolean, ms = 4000): Promise<string> {
		const now = this.image(context);
		if (now && test(now)) return now;
		try {
			const m = await this.waitFor((x) => x.event === "setImage" && x.context === context && test(svgOf(x.payload.image)), ms, this.received.length);
			return svgOf(m.payload.image);
		} catch {
			throw new Error(`key ${context} never showed what was expected; it shows: "${this.text(context)}"`);
		}
	}

	/** Text on a key: its <text> elements, joined with " | ". */
	text(context: string): string {
		return textOf(this.image(context));
	}
}

export function svgOf(image: string): string {
	const prefix = "data:image/svg+xml;charset=utf8,";
	if (!image?.startsWith(prefix)) throw new Error(`not an SVG image: ${String(image).slice(0, 40)}`);
	return decodeURIComponent(image.slice(prefix.length));
}

export function textOf(svg: string): string {
	return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")).join(" | ");
}

/** The key's background colour (its tone). */
export function background(svg: string): string {
	return /<rect width="144" height="144" fill="([^"]+)"/.exec(svg)?.[1] ?? "";
}
