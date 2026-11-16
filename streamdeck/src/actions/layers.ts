import { action } from "@elgato/streamdeck";
import { BookOpen, Layers, Shapes, Video } from "lucide";
import { ApiError } from "../client";
import type { Face } from "../keys";
import { store, type BibleReference } from "../store";
import { choice, OpenPresAction, text } from "./base";
import { cameraName } from "./clear";

// ---------------- Bible passage ----------------

type BibleSettings = {
	/** A reference as typed in OpenPres's command bar, e.g. "Juan 3:16-18". */
	query?: string;
	/** show: always shows it; toggle: clears the Bible when this passage is already on screen. */
	mode?: "show" | "toggle";
	label?: string;
};

type Parsed = { reference: BibleReference; label: string } | null;

/**
 * References are parsed by OpenPres (in its primary Bible's language), once per text; a
 * failure is asked again after a while (a Bible may have been installed meanwhile).
 */
const parsed = new Map<string, { value: Parsed; at: number } | "pending">();
let parsedFor = "";
const RETRY_NOT_FOUND_MS = 30_000;

function parse(query: string, redraw: () => void): Parsed | undefined {
	// Another OpenPres, or the same one after a restart, may parse differently.
	const key = `${store.client.address}|${store.version}`;
	if (key !== parsedFor) {
		parsed.clear();
		parsedFor = key;
	}
	const known = parsed.get(query);
	if (known === "pending") return undefined;
	if (known && (known.value || Date.now() - known.at < RETRY_NOT_FOUND_MS)) return known.value;
	if (!store.connected) return known?.value;
	parsed.set(query, "pending");
	store.client
		.get<{ reference: BibleReference | null; label?: string }>(`/bibles/parse?q=${encodeURIComponent(query)}`)
		.then((r) => parsed.set(query, { value: r?.reference ? { reference: r.reference, label: r.label || query } : null, at: Date.now() }))
		.catch((e) => {
			// Not a reference (or no Bible installed): "not found" for now. Unreachable: ask again.
			if (e instanceof ApiError && e.status !== 0 && e.status < 500) parsed.set(query, { value: null, at: Date.now() });
			else parsed.delete(query);
		})
		.finally(redraw);
	return undefined;
}

function parsedNow(query: string): Parsed | undefined {
	const known = parsed.get(query);
	return known && known !== "pending" ? known.value : undefined;
}

function overlaps(a: BibleReference, b: BibleReference): boolean {
	return a.book === b.book && a.chapter === b.chapter && a.verse_start <= b.verse_end && b.verse_start <= a.verse_end;
}

/** Shows a Bible passage. Lit while (part of) it is on screen. */
@action({ UUID: "com.nathandsanta.openpres.bible" })
export class BiblePassage extends OpenPresAction<BibleSettings> {
	protected face(settings: BibleSettings): Face {
		const query = text(settings.query).trim();
		if (!query) return { icon: BookOpen, label: text(settings.label) || "Bible", sub: "no passage", tone: "idle" };
		const p = parse(query, () => this.drawAll());
		const live = store.snap.bible?.reference;
		const on = !!(p && live && overlaps(p.reference, live));
		return {
			icon: BookOpen,
			label: text(settings.label) || p?.label || query,
			sub: p === null ? "not found" : on ? "on screen" : "",
			tone: p === null ? "warn" : on ? "active" : "idle",
		};
	}

	protected async press(settings: BibleSettings): Promise<void> {
		const query = text(settings.query).trim();
		if (!query) throw new Error("no passage set");
		const p = parsedNow(query);
		const live = store.snap.bible?.reference;
		if (settings.mode === "toggle" && p && live && overlaps(p.reference, live)) {
			await store.client.post("/bible/clear");
			return;
		}
		await store.client.post("/bible/show", { query });
	}
}

// ---------------- props and complements ----------------

type PropSettings = {
	layer?: "props" | "complements";
	theme_id?: string;
	design_id?: string;
	/** Name when it was chosen, shown if the design is gone. */
	name?: string;
	/** toggle: on/off; show: always on; hide: always off. */
	mode?: "toggle" | "show" | "hide";
	label?: string;
};

/** Puts a prop (or complement) on screen or takes it off. Lit while it is on. */
@action({ UUID: "com.nathandsanta.openpres.prop" })
export class Prop extends OpenPresAction<PropSettings> {
	protected face(settings: PropSettings): Face {
		const layer = choice(settings.layer, ["props", "complements"] as const);
		const icon = layer === "props" ? Shapes : Layers;
		const label = text(settings.label);
		if (!settings.design_id) return { icon, label: label || (layer === "props" ? "Prop" : "Complement"), sub: "not set", tone: "idle" };
		const theme = store.snap.props.find((t) => t.id === settings.theme_id);
		const design = theme?.designs.find((d) => d.id === settings.design_id);
		const on = store.snap.live[layer].some((p) => p.theme_id === settings.theme_id && p.design_id === settings.design_id);
		return {
			icon,
			label: label || design?.name || text(settings.name) || "Prop",
			sub: !design ? "not found" : on ? "on screen" : layer === "complements" ? "complement" : "",
			tone: !design ? "warn" : on ? "active" : "idle",
		};
	}

	protected async press(settings: PropSettings): Promise<void> {
		if (!settings.theme_id || !settings.design_id) throw new Error("no prop chosen");
		const mode = choice(settings.mode, ["toggle", "show", "hide"] as const);
		await store.client.post("/live/props", {
			layer: choice(settings.layer, ["props", "complements"] as const),
			theme_id: settings.theme_id,
			design_id: settings.design_id,
			...(mode === "toggle" ? {} : { active: mode === "show" }),
		});
	}
}

// ---------------- camera (video input layer) ----------------

type CameraSettings = {
	device_id?: string;
	/** Name when it was chosen, shown while the camera is not connected. */
	name?: string;
	/** toggle: shows it, or clears the video input when it is already showing; show: always shows it. */
	mode?: "toggle" | "show";
	label?: string;
};

/** Shows a camera on the video input layer. Lit while it is on screen. */
@action({ UUID: "com.nathandsanta.openpres.camera" })
export class Camera extends OpenPresAction<CameraSettings> {
	protected face(settings: CameraSettings): Face {
		const id = text(settings.device_id);
		const label = text(settings.label);
		if (!id) return { icon: Video, label: label || "Camera", sub: "not set", tone: "idle" };
		const s = store.snap;
		const connected = s.cameras.some((c) => c.id === id);
		const on = s.live.video_input === id;
		return {
			icon: Video,
			label: label || (connected ? cameraName(s, id) : text(settings.name)) || "Camera",
			sub: on ? "on screen" : connected ? "" : "not connected",
			tone: on ? "active" : connected ? "idle" : "warn",
		};
	}

	protected async press(settings: CameraSettings): Promise<void> {
		const id = text(settings.device_id);
		if (!id) throw new Error("no camera chosen");
		const off = settings.mode !== "show" && store.snap.live.video_input === id;
		await store.client.put("/live/video_input", { device_id: off ? null : id });
	}
}
