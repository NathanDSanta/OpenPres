import assert from "node:assert/strict";
import { test } from "node:test";
import { BookOpen, ChevronRight } from "lucide";
import { formatDuration, timerValue } from "../src/format.ts";
import { keyImage, keySvg, normalizePath, wrap } from "../src/keys.ts";

test("labels wrap onto two lines at most", () => {
	assert.deepEqual(wrap("Next"), ["Next"]);
	assert.deepEqual(wrap("Clear announcements"), ["Clear", "announcements"]);
	assert.deepEqual(wrap("A very long label that keeps going"), ["A very long", "label that …"]);
	assert.deepEqual(wrap("   "), []);
});

test("arc flags are written out", () => {
	assert.equal(normalizePath("M20.001 19A2 2 0 0022 17V5"), "M 20.001 19 A 2 2 0 0 0 22 17 V 5");
	assert.equal(normalizePath("a.5.5 0 0 1 .777-.416"), "a .5 .5 0 0 1 .777 -.416");
	assert.equal(normalizePath("m9 18 6-6-6-6"), "m 9 18 6 -6 -6 -6");
	// Several arcs after one command.
	assert.equal(normalizePath("a5 5 0 0 1 4 2 5 5 0 0 1 4-2"), "a 5 5 0 0 1 4 2 5 5 0 0 1 4 -2");
});

test("key faces are plain SVG with the text escaped", () => {
	const svg = keySvg({ icon: BookOpen, label: "Psalm <23> & more", sub: `"quoted"`, tone: "active" });
	assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
	assert.ok(!/<svg[^>]*>.*<svg/.test(svg), "no nested <svg>");
	assert.match(svg, /Psalm &lt;23&gt;/);
	assert.match(svg, />Psalm &lt;23&gt; &amp;</);
	assert.match(svg, /&quot;quoted&quot;/);
	assert.match(svg, /A 2 2 0 0 0 22 17/, "icon paths normalised");
	const url = keyImage({ icon: ChevronRight, label: "Next", tone: "idle" });
	assert.ok(url.startsWith("data:image/svg+xml;charset=utf8,%3Csvg"));
});

test("durations look like OpenPres's", () => {
	assert.equal(formatDuration(0), "0:00");
	assert.equal(formatDuration(59_999), "0:59");
	assert.equal(formatDuration(61_000), "1:01");
	assert.equal(formatDuration(3_723_000), "1:02:03");
	assert.equal(formatDuration(-12_500), "-0:12");
});

test("timer values", () => {
	const base = { id: "t", name: "T", allow_overrun: false, running: false, elapsed_ms: 0, started_at: null, paused_at: null };
	const countdown = { ...base, kind: { type: "countdown" as const, seconds: 60 } };
	assert.equal(timerValue(countdown, 1000), 60_000);
	const t0 = 1_000_000;
	assert.equal(timerValue({ ...countdown, running: true, started_at: t0 }, t0 + 10_000), 50_000);
	assert.equal(timerValue({ ...countdown, running: true, started_at: t0 }, t0 + 70_000), 0, "stops at zero without overrun");
	assert.equal(timerValue({ ...countdown, allow_overrun: true, running: true, started_at: t0 }, t0 + 70_000), -10_000);
	assert.equal(timerValue({ ...base, kind: { type: "count_up" as const }, elapsed_ms: 5000, running: true, started_at: t0 }, t0 + 2000), 7000);
});
