// Runs the built plugin (npm run build first) against a stand-in OpenPres and a fake
// Stream Deck app, and checks what the keys show and which commands they send.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { background, FakeStreamDeck, PLUGIN_DIR, textOf } from "./fake-stream-deck.ts";
import { MockOpenPres } from "./mock-openpres.ts";

const IDLE = "#1b1a24";
const ACTIVE = "#5b3fd6";
const LIVE = "#d1243a";
const OFF = "#24232b";

if (!existsSync(join(PLUGIN_DIR, "bin/plugin.js"))) throw new Error("build the plugin first: npm run build");

describe("connected to OpenPres", () => {
	let openpres: MockOpenPres;
	let deck: FakeStreamDeck;

	before(async () => {
		openpres = await new MockOpenPres().start();
		deck = await new FakeStreamDeck({ port: openpres.port }).start();
	});
	after(async () => {
		await deck.stop();
		await openpres.stop();
	});

	test("Next shows the position and moves the slides like the arrow keys", async () => {
		deck.appear("next", "next1");
		await deck.imageMatching("next1", (svg) => textOf(svg) === "Next | 1 / 5");
		const before = openpres.requests.length;
		deck.press("next", "next1");
		await deck.imageMatching("next1", (svg) => textOf(svg) === "Next | 2 / 5");
		assert.deepEqual(
			openpres.requests.slice(before).filter((r) => r.method === "POST").map((r) => r.path),
			["/presenter/next?layer=all"],
		);
	});

	test("Previous for the announcements only", async () => {
		deck.appear("previous", "prev1", { target: "announcements", label: "Back" });
		await deck.imageMatching("prev1", (svg) => textOf(svg) === "Back");
		deck.press("previous", "prev1", { target: "announcements", label: "Back" });
		await waitForCommand(openpres, "POST /presenter/previous?layer=announcements");
	});

	test("Clear is lit while there is something to clear", async () => {
		deck.appear("clear", "clear1", { layer: "slides" });
		const svg = await deck.imageMatching("clear1", (s) => textOf(s) === "Clear slides | Amazing Grace");
		assert.equal(background(svg), ACTIVE);
		deck.press("clear", "clear1", { layer: "slides" });
		const cleared = await deck.imageMatching("clear1", (s) => textOf(s) === "Clear slides");
		assert.equal(background(cleared), IDLE);
		assert.ok(openpres.commands().some((r) => r.path === "/presenter/clear?layer=slides"));
	});

	test("a clear group clears its layers, and has its colour", async () => {
		openpres.state.presenter.slides = { presentation_id: "p1", title: "Amazing Grace", slide_index: 0, total_slides: 5 };
		openpres.changed();
		const settings = { group_id: "g1", name: "Text" };
		deck.appear("clear", "group1", settings);
		const lit = await deck.imageMatching("group1", (s) => textOf(s) === "Text | Amazing Grace");
		assert.notEqual(background(lit), ACTIVE, "the group's colour, not the usual one");
		deck.press("clear", "group1", settings);
		await waitForCommand(openpres, "POST /clear-groups/g1/run");
		const cleared = await deck.imageMatching("group1", (s) => textOf(s) === "Text");
		assert.notEqual(background(cleared), IDLE, "a tint of the group's colour");
		deck.appear("clear", "group2", { group_id: "gone", name: "Old group" });
		await deck.imageMatching("group2", (s) => textOf(s) === "Old group | not found");
	});

	test("a prop toggles and is lit while on screen", async () => {
		const settings = { theme_id: "th1", design_id: "d1", name: "Old name" };
		deck.appear("prop", "prop1", settings);
		await deck.imageMatching("prop1", (s) => textOf(s) === "Welcome | banner" && background(s) === IDLE);
		deck.press("prop", "prop1", settings);
		await deck.imageMatching("prop1", (s) => textOf(s) === "Welcome | banner | on screen" && background(s) === ACTIVE);
		const sent = openpres.commands().find((r) => r.path === "/live/props");
		assert.deepEqual(sent?.body, { layer: "props", theme_id: "th1", design_id: "d1" });
	});

	test("one props layer: older keys and an older OpenPres's complements still work", async () => {
		openpres.state.live.complements.push({ theme_id: "th1", design_id: "d2" });
		openpres.changed();
		deck.appear("prop", "prop3", { theme_id: "th1", design_id: "d2", name: "Clock" });
		await deck.imageMatching("prop3", (s) => textOf(s) === "Clock | on screen");
		// A key set to clear the complements clears the props, and the complements too.
		deck.appear("clear", "clear3", { layer: "complements" });
		await deck.imageMatching("clear3", (s) => textOf(s) === "Clear props | 2 on");
		const before = openpres.requests.length;
		deck.press("clear", "clear3", { layer: "complements" });
		await deck.imageMatching("clear3", (s) => textOf(s) === "Clear props");
		assert.deepEqual(
			openpres.requests.slice(before).filter((r) => r.path === "/live/props/clear").map((r) => r.body),
			[{ layer: "props" }, { layer: "complements" }],
		);
	});

	test("a macro runs from its key, with its colour, and a second press stops it", async () => {
		const settings = { macro_id: "m1", name: "Before the service" };
		deck.appear("macro", "macro1", settings);
		const idle = await deck.imageMatching("macro1", (s) => textOf(s) === "Before the | service");
		assert.notEqual(background(idle), IDLE, "a tint of the macro's colour");
		deck.press("macro", "macro1", settings);
		await deck.imageMatching("macro1", (s) => textOf(s) === "Before the | service | running");
		assert.deepEqual(openpres.commands().find((r) => r.path === "/macros/m1/run")?.body, { from: "stream_deck" });
		deck.press("macro", "macro1", settings);
		await waitForCommand(openpres, "POST /macros/m1/stop");
		await deck.imageMatching("macro1", (s) => textOf(s) === "Before the | service");
		deck.appear("macro", "macro2", { macro_id: "gone", name: "Old macro" });
		await deck.imageMatching("macro2", (s) => textOf(s) === "Old macro | not found");
	});

	test("a deleted prop shows a warning", async () => {
		deck.appear("prop", "prop2", { theme_id: "th1", design_id: "gone", name: "Old banner" });
		await deck.imageMatching("prop2", (s) => textOf(s) === "Old banner | not found");
	});

	test("camera, mute bus and media folder", async () => {
		deck.appear("camera", "cam1", { device_id: "cam:0" });
		await deck.imageMatching("cam1", (s) => textOf(s) === "Pulpit | camera");
		deck.press("camera", "cam1", { device_id: "cam:0" });
		await deck.imageMatching("cam1", (s) => textOf(s) === "Pulpit | camera | on screen");

		deck.appear("mute", "mute1", { bus: 2 });
		const muted = await deck.imageMatching("mute1", (s) => textOf(s) === "Stream | muted");
		assert.equal(background(muted), LIVE);
		deck.press("mute", "mute1", { bus: 2 });
		await waitForCommand(openpres, "PUT /audio/buses/2/levels");
		assert.deepEqual(openpres.commands().find((r) => r.path === "/audio/buses/2/levels")?.body, { muted: false });

		deck.appear("media", "media1", { mode: "folder", folder_id: "f1" });
		await deck.imageMatching("media1", (s) => textOf(s) === "Walk-in | music");
		deck.press("media", "media1", { mode: "folder", folder_id: "f1" });
		await waitForCommand(openpres, "POST /player/audio/play");
	});

	test("Bible passages are checked by OpenPres and lit while shown", async () => {
		deck.appear("bible", "bible1", { query: "john 3:16" });
		await deck.imageMatching("bible1", (s) => textOf(s) === "Juan 3:16");
		deck.press("bible", "bible1", { query: "john 3:16" });
		await deck.imageMatching("bible1", (s) => textOf(s) === "Juan 3:16 | on screen");
		assert.deepEqual(openpres.commands().find((r) => r.path === "/bible/show")?.body, { query: "john 3:16" });
		// Next now follows the Bible, like OpenPres's arrow keys.
		await deck.imageMatching("next1", (s) => textOf(s) === "Next | Juan 3:16");

		deck.appear("bible", "bible2", { query: "not a verse" });
		await deck.imageMatching("bible2", (s) => textOf(s) === "not a verse | not found");
	});

	test("a timer shows its time and starts", async () => {
		deck.appear("timer", "timer1", { timer_id: "t1" });
		await deck.imageMatching("timer1", (s) => textOf(s) === "Sermon | 30:00");
		deck.press("timer", "timer1", { timer_id: "t1" });
		await waitForCommand(openpres, "POST /timers/t1/start");
		await deck.imageMatching("timer1", (s) => textOf(s) === "Sermon | 29:59" && background(s) === ACTIVE, 4000);
	});

	test("the stream starts on a press, but only stops when the key is held", async () => {
		deck.appear("stream", "stream1");
		await deck.imageMatching("stream1", (s) => textOf(s) === "Go live");
		deck.press("stream", "stream1");
		await deck.imageMatching("stream1", (s) => textOf(s) === "LIVE | 0:00" && background(s) === LIVE);

		// A short press does not stop it.
		deck.press("stream", "stream1");
		await deck.imageMatching("stream1", (s) => textOf(s) === "LIVE | hold to stop");
		await sleep(1300);
		assert.ok(!openpres.commands().some((r) => r.path === "/stream/stop"), "a short press stopped the stream");

		// Held for a second, it does.
		deck.key("keyDown", "stream", "stream1");
		await sleep(1200);
		deck.key("keyUp", "stream", "stream1");
		await waitForCommand(openpres, "POST /stream/stop");
		await deck.imageMatching("stream1", (s) => textOf(s) === "Go live");
	});

	test("in a Multi Action, keys are not drawn but still run", async () => {
		deck.appear("clear", "multi1", { layer: "props" }, true);
		await sleep(300);
		assert.equal(deck.image("multi1"), "", "drew a key inside a Multi Action");
		deck.send({
			event: "keyDown",
			action: "com.nathandsanta.openpres.clear",
			context: "multi1",
			device: "dev1",
			payload: { settings: { layer: "props" }, coordinates: { column: 0, row: 0 }, state: 0, isInMultiAction: true },
		});
		await waitForCommand(openpres, "POST /live/props/clear");
		assert.deepEqual(openpres.commands().find((r) => r.path === "/live/props/clear")?.body, { layer: "props" });
	});

	test("the settings panel gets the lists to choose from", async () => {
		deck.send({ event: "propertyInspectorDidAppear", action: "com.nathandsanta.openpres.prop", context: "prop1", device: "dev1" });
		deck.send({ event: "sendToPlugin", action: "com.nathandsanta.openpres.prop", context: "prop1", payload: { type: "hello" } });
		const m = await deck.waitFor((x) => x.event === "sendToPropertyInspector" && x.payload?.type === "state");
		assert.equal(m.payload.status.connected, true);
		assert.equal(m.payload.status.version, "9.9.9");
		assert.deepEqual(m.payload.options.props[0].designs.map((d: { name: string }) => d.name), ["Welcome banner", "Clock"]);
		assert.deepEqual(m.payload.options.cameras, [{ id: "cam:0", name: "Pulpit camera", connected: true }]);
		assert.deepEqual(m.payload.options.buses.map((b: { n: number }) => b.n), [1, 2]);
		assert.deepEqual(m.payload.options.clearGroups, [{ id: "g1", name: "Text" }]);
		assert.deepEqual(m.payload.options.macros, [{ id: "m1", name: "Before the service" }]);

		deck.send({ event: "sendToPlugin", action: "com.nathandsanta.openpres.bible", context: "prop1", payload: { type: "parse", query: "Juan 3:16-18" } });
		const parsed = await deck.waitFor((x) => x.event === "sendToPropertyInspector" && x.payload?.type === "parsed");
		assert.equal(parsed.payload.label, "Juan 3:16-18");
	});

	test("keys go grey when OpenPres goes away, and come back", async () => {
		await openpres.stop();
		const off = await deck.imageMatching("next1", (s) => textOf(s) === "Next | offline");
		assert.equal(background(off), OFF);
		// A press while offline shows the warning triangle.
		const sentBefore = deck.received.length;
		deck.press("next", "next1");
		await deck.waitFor((m) => m.event === "showAlert" && m.context === "next1", 2000, sentBefore);

		await openpres.start(openpres.port);
		await deck.imageMatching("next1", (s) => !textOf(s).includes("offline"), 8000);
	});
});

describe("with a password", () => {
	let openpres: MockOpenPres;
	let deck: FakeStreamDeck;

	before(async () => {
		openpres = await new MockOpenPres("secret").start();
		deck = await new FakeStreamDeck({ port: openpres.port }).start();
	});
	after(async () => {
		await deck.stop();
		await openpres.stop();
	});

	test("asks for the password, then logs in with it", async () => {
		deck.appear("next", "n");
		await deck.imageMatching("n", (s) => textOf(s) === "Next | password?");
		deck.setGlobal({ port: openpres.port, password: "secret" });
		await deck.imageMatching("n", (s) => textOf(s) === "Next | 1 / 5");
		deck.press("next", "n");
		await waitForCommand(openpres, "POST /presenter/next?layer=all");
		const sent = openpres.commands().find((r) => r.path.startsWith("/presenter/next"));
		assert.equal(sent?.authorization, "Bearer token-123");
	});
});

describe("not connected", () => {
	test("keys show they are offline, and a press warns", async () => {
		// Nothing listens on this port.
		const deck = await new FakeStreamDeck({ port: 9 }).start();
		try {
			deck.appear("clear", "c");
			const svg = await deck.imageMatching("c", (s) => textOf(s) === "Clear all | offline");
			assert.equal(background(svg), OFF);
			deck.press("clear", "c");
			await deck.waitFor((m) => m.event === "showAlert" && m.context === "c");
		} finally {
			await deck.stop();
		}
	});
});

async function waitForCommand(openpres: MockOpenPres, what: string, ms = 3000) {
	const [method, path] = what.split(" ");
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (openpres.requests.some((r) => r.method === method && r.path === path)) return;
		await sleep(25);
	}
	assert.fail(`${what} was not sent; got: ${openpres.commands().map((r) => `${r.method} ${r.path}`).join(", ")}`);
}
