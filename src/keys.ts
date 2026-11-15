import type { IconNode } from "lucide";

/**
 * Key faces are drawn as SVG (icons from Lucide, the set OpenPres uses), so they can show
 * live state: what is on, the stream's time, a timer's value, the current slide…
 *
 * Only plain SVG is used (no nested <svg>, no CSS, no filters) so that every Stream Deck
 * app draws them the same: Elgato's and OpenDeck's.
 */

export type Tone = "idle" | "active" | "live" | "warn" | "off";

export interface Face {
	icon: IconNode;
	/** Main text, up to two lines (wrapped and shortened as needed). */
	label: string;
	/** Second line, smaller (a time, a position, the layer). */
	sub?: string;
	tone: Tone;
}

export const TONES: Record<Tone, { bg: string; fg: string; sub: string; ring?: string }> = {
	idle: { bg: "#1b1a24", fg: "#ecebf5", sub: "#a19fb3" },
	active: { bg: "#5b3fd6", fg: "#ffffff", sub: "#dcd3ff", ring: "#b49aff" },
	live: { bg: "#d1243a", fg: "#ffffff", sub: "#ffd9de", ring: "#ff8b99" },
	warn: { bg: "#8a5200", fg: "#ffffff", sub: "#ffe2b8" },
	off: { bg: "#24232b", fg: "#77758a", sub: "#77758a" },
};

const SIZE = 144;
const FONT = "Inter, 'Segoe UI', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";

function escape(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Splits a label into at most two lines of about `width` characters. */
export function wrap(text: string, width = 12): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (!line) line = word;
		else if ((line + " " + word).length <= width) line += " " + word;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	if (lines.length > 2) {
		lines.length = 2;
		lines[1] = shorten(`${lines[1]} …`, width);
	}
	return lines.map((l) => shorten(l, width + 2));
}

function shorten(text: string, width: number): string {
	if (text.length <= width) return text;
	return text.slice(0, width - 1).trimEnd() + "…";
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/**
 * Rewrites path data with every number separated. Lucide's paths use the compact form of
 * arc flags ("A2 2 0 0022 17"), which some SVG renderers misread.
 */
export function normalizePath(d: string): string {
	const out: string[] = [];
	let i = 0;
	let command = "";
	let arg = 0;
	for (;;) {
		while (i < d.length && /[\s,]/.test(d[i])) i++;
		if (i >= d.length) break;
		const c = d[i];
		if (/[a-zA-Z]/.test(c)) {
			command = c;
			arg = 0;
			out.push(c);
			i++;
			continue;
		}
		// The 4th and 5th arc parameters are one-character flags.
		if ((command === "a" || command === "A") && (arg % 7 === 3 || arg % 7 === 4)) {
			if (c !== "0" && c !== "1") return d;
			out.push(c);
			i++;
			arg++;
			continue;
		}
		const m = NUMBER.exec(d.slice(i));
		if (!m) return d; // not something we understand: keep it as it was
		out.push(m[0]);
		i += m[0].length;
		arg++;
	}
	return out.join(" ");
}

function iconMarkup(icon: IconNode, x: number, y: number, size: number, color: string): string {
	const children = icon
		.map(([tag, attrs]) => {
			const a = Object.entries(attrs)
				.filter(([k]) => k !== "key")
				.map(([k, v]) => `${k}="${escape(k === "d" ? normalizePath(String(v)) : String(v))}"`)
				.join(" ");
			return `<${tag} ${a}/>`;
		})
		.join("");
	const scale = size / 24;
	return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</g>`;
}

/** A font size at which `text` fits the key's width (bold text is about 0.62em per letter). */
function fit(text: string, largest: number, width = 128): number {
	return Math.max(13, Math.min(largest, Math.floor(width / (0.62 * Math.max(1, text.length)))));
}

/** The SVG source of a key face (144x144). */
export function keySvg(face: Face): string {
	const t = TONES[face.tone];
	const lines = wrap(face.label);
	const sub = face.sub ? shorten(face.sub, 16) : "";
	// The icon gets smaller and higher when there is more text under it.
	const textLines = lines.length + (sub ? 1 : 0);
	const iconSize = textLines >= 3 ? 40 : textLines === 2 ? 48 : textLines === 1 ? 56 : 72;
	const iconY = textLines >= 3 ? 12 : textLines === 2 ? 18 : textLines === 1 ? 26 : 36;
	let y = iconY + iconSize + (textLines >= 3 ? 24 : 30);
	const text: string[] = [];
	for (const line of lines) {
		text.push(`<text x="72" y="${y}" fill="${t.fg}" font-size="${fit(line, 23)}" font-weight="700" text-anchor="middle">${escape(line)}</text>`);
		y += 24;
	}
	if (sub) {
		text.push(`<text x="72" y="${y}" fill="${t.sub}" font-size="${fit(sub, 19, 132)}" font-weight="600" text-anchor="middle">${escape(sub)}</text>`);
	}
	const ring = t.ring ? `<rect x="3" y="3" width="138" height="138" rx="14" fill="none" stroke="${t.ring}" stroke-width="4"/>` : "";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${t.bg}"/>${ring}` +
		iconMarkup(face.icon, (SIZE - iconSize) / 2, iconY, iconSize, t.fg) +
		`<g font-family="${escape(FONT)}">${text.join("")}</g>` +
		`</svg>`
	);
}

/** A face as an image for `setImage`. */
export function keyImage(face: Face): string {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(keySvg(face))}`;
}
