// Draws the plugin's images: the action icons (Stream Deck's action list), the default key
// images (before the plugin draws live ones) and the category icon. Run after changing
// them, with Node 22.18 or newer: node scripts/icons.ts
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BookOpen, ChevronLeft, ChevronRight, Eraser, Hash, Play, Radio, Shapes, Timer, Video, Volume2, VolumeX, type IconNode } from "lucide";
import { keySvg, normalizePath, type Face } from "../src/keys.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "com.nathandsanta.openpres.sdPlugin");

const ACTIONS: Record<string, { icon: IconNode; key: Face }> = {
	next: { icon: ChevronRight, key: { icon: ChevronRight, label: "Next", tone: "idle" } },
	previous: { icon: ChevronLeft, key: { icon: ChevronLeft, label: "Previous", tone: "idle" } },
	slide: { icon: Hash, key: { icon: Hash, label: "Slide 1", tone: "idle" } },
	clear: { icon: Eraser, key: { icon: Eraser, label: "Clear all", tone: "idle" } },
	bible: { icon: BookOpen, key: { icon: BookOpen, label: "Bible", tone: "idle" } },
	prop: { icon: Shapes, key: { icon: Shapes, label: "Prop", tone: "idle" } },
	camera: { icon: Video, key: { icon: Video, label: "Camera", tone: "idle" } },
	media: { icon: Play, key: { icon: Play, label: "Media play/pause", tone: "idle" } },
	mute: { icon: VolumeX, key: { icon: Volume2, label: "Mute", tone: "idle" } },
	timer: { icon: Timer, key: { icon: Timer, label: "Timer", tone: "idle" } },
	stream: { icon: Radio, key: { icon: Radio, label: "Go live", tone: "idle" } },
};

/** A white Lucide icon, as Stream Deck wants for the action list (20x20, transparent). */
function listIcon(icon: IconNode): string {
	const children = icon
		.map(([tag, attrs]) => {
			const a = Object.entries(attrs)
				.map(([k, v]) => `${k}="${k === "d" ? normalizePath(String(v)) : String(v)}"`)
				.join(" ");
			return `<${tag} ${a}/>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>\n`;
}

function write(path: string, text: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

for (const [name, { icon, key }] of Object.entries(ACTIONS)) {
	write(join(plugin, "imgs/actions", name, "icon.svg"), listIcon(icon));
	write(join(plugin, "imgs/actions", name, "key.svg"), keySvg(key) + "\n");
}

// Category (next to the actions in the list): stacked slides with a cross, like the app's logo.
write(
	join(plugin, "imgs/plugin/category.svg"),
	`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
		`<path d="M4 9 V 20 A 2 2 0 0 0 6 22 H 20"/><rect x="8" y="5" width="17" height="13" rx="2"/><path d="M16.5 7.5 V 15.5 M 13.5 10 H 19.5"/></svg>\n`,
);

// The plugin's icon is the app's.
mkdirSync(join(plugin, "imgs/plugin"), { recursive: true });
copyFileSync(join(root, "../tauri/icons/128x128@2x.png"), join(plugin, "imgs/plugin/marketplace.png"));
copyFileSync(join(root, "../tauri/icons/icon.png"), join(plugin, "imgs/plugin/marketplace@2x.png"));

console.log(`images written to ${plugin}/imgs`);
