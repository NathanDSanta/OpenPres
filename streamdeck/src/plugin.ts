import streamDeck from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { Clear } from "./actions/clear";
import { BiblePassage, Camera, Prop } from "./actions/layers";
import { Media, Mute } from "./actions/media";
import { GoToSlide, Next, Previous } from "./actions/presenter";
import { Stream } from "./actions/stream";
import { Timer } from "./actions/timer";
import { ApiError, describe, type ConnectionSettings } from "./client";
import { store } from "./store";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("OpenPres");

for (const action of [new Next(), new Previous(), new GoToSlide(), new Clear(), new BiblePassage(), new Prop(), new Camera(), new Media(), new Mute(), new Timer(), new Stream()]) {
	streamDeck.actions.registerAction(action);
}

// ---- connection (the settings are shared by every key: "global settings") ----

type GlobalSettings = ConnectionSettings & JsonObject;

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => store.connect(ev.settings ?? {}));

let lastStatus = "";
store.onUpdate(() => {
	const status = store.status;
	const line = status.connected ? `connected to OpenPres ${status.version} at ${status.address}` : `not connected (${status.address}): ${status.error}`;
	if (line !== lastStatus) {
		lastStatus = line;
		log.info(line);
	}
	sendToInspector();
});

// ---- the settings panel (property inspector) ----

/** Everything a settings panel shows: the connection, and what can be chosen in the lists. */
function inspectorState(): JsonValue {
	const s = store.snap;
	const named = new Set(s.inputs.map((i) => i.device_id));
	return {
		type: "state",
		status: { ...store.status },
		options: {
			props: s.props.map((t) => ({ id: t.id, name: t.name, designs: t.designs.map((d) => ({ id: d.id, name: d.name })) })),
			timers: s.timers.map((t) => ({ id: t.id, name: t.name })),
			cameras: [
				...s.inputs.map((i) => ({ id: i.device_id, name: i.name, connected: s.cameras.some((c) => c.id === i.device_id) })),
				...s.cameras.filter((c) => !named.has(c.id)).map((c) => ({ id: c.id, name: c.name, connected: true })),
			],
			folders: s.folders.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
			buses: s.buses.map((b, i) => ({ n: i + 1, name: b.name })),
		},
	};
}

let lastSent = "";
function sendToInspector(force = false) {
	if (!streamDeck.ui.action) return;
	const message = inspectorState();
	const json = JSON.stringify(message);
	if (!force && json === lastSent) return;
	lastSent = json;
	streamDeck.ui.sendToPropertyInspector(message).catch(() => {});
}

streamDeck.ui.onDidAppear(() => sendToInspector(true));

type InspectorMessage = { type?: string; query?: string };

streamDeck.ui.onSendToPlugin<InspectorMessage & JsonObject>(async (ev) => {
	const message = ev.payload ?? {};
	switch (message.type) {
		case "hello":
			sendToInspector(true);
			break;
		case "retry":
			// "Connect now" in the panel.
			store.poke();
			sendToInspector(true);
			break;
		case "parse": {
			// Checks a Bible reference as it is typed.
			const query = String(message.query ?? "").trim();
			let label: string | null = null;
			let error = "";
			if (query && store.connected) {
				try {
					const r = await store.client.get<{ reference: unknown; label?: string }>(`/bibles/parse?q=${encodeURIComponent(query)}`);
					label = r?.reference ? (r.label ?? query) : null;
				} catch (e) {
					error = e instanceof ApiError ? e.message : describe(e);
				}
			} else if (query) {
				error = "not connected to OpenPres";
			}
			await streamDeck.ui.sendToPropertyInspector({ type: "parsed", query, label, error });
			break;
		}
	}
});

// ---- start ----

await streamDeck.connect();
store.connect((await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {});
