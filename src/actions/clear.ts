import { action } from "@elgato/streamdeck";
import { BookOpen, Eraser, Image, Megaphone, Music2, Presentation, Shapes, Video, X, type IconNode } from "lucide";
import type { Face } from "../keys";
import { store, type Snapshot } from "../store";
import { choice, OpenPresAction, text } from "./base";

interface Layer {
	label: string;
	icon: IconNode;
	/** What is on this layer now ("" = nothing). */
	on(s: Snapshot): string;
	clear(): Promise<unknown>;
}

const c = () => store.client;

const visualLayers = (s: Snapshot): string[] =>
	[
		s.presenter.slides && "slides",
		s.bible && "Bible",
		s.presenter.announcements && "announcements",
		s.player?.visual && "media",
		s.live.video_input && "camera",
		propsOn(s) && "props",
	].filter((x): x is string => !!x);

/** Props on screen (older OpenPres also had a second layer of them, the complements). */
const propsOn = (s: Snapshot) => s.live.props.length + s.live.complements.length;

function layersOn(names: string[]): string {
	return names.length === 0 ? "" : names.length === 1 ? names[0] : `${names.length} layers`;
}

/** Like the Clear widget on OpenPres's Home page. */
const LAYERS = {
	all: {
		label: "Clear all",
		icon: Eraser,
		on: (s) => layersOn(visualLayers(s)),
		clear: () => c().post("/live/clear", { scope: "all" }),
	},
	everything: {
		label: "Clear everything",
		icon: X,
		on: (s) => layersOn([...visualLayers(s), ...(s.player?.audio ? ["audio"] : [])]),
		clear: () => c().post("/live/clear", { scope: "everything" }),
	},
	slides: {
		label: "Clear slides",
		icon: Presentation,
		on: (s) => s.presenter.slides?.title ?? "",
		clear: () => c().post("/presenter/clear?layer=slides"),
	},
	bible: {
		label: "Clear Bible",
		icon: BookOpen,
		on: (s) => (s.bible ? s.bible.label || "passage" : ""),
		clear: () => c().post("/bible/clear"),
	},
	announcements: {
		label: "Clear announcements",
		icon: Megaphone,
		on: (s) => s.presenter.announcements?.title ?? "",
		clear: () => c().post("/presenter/clear?layer=announcements"),
	},
	media: {
		label: "Clear media",
		icon: Image,
		on: (s) => s.player?.visual?.name ?? "",
		clear: () => c().post("/player/visual/clear"),
	},
	video_input: {
		label: "Clear camera",
		icon: Video,
		on: (s) => (s.live.video_input ? cameraName(s, s.live.video_input) : ""),
		clear: () => c().put("/live/video_input", { device_id: null }),
	},
	props: {
		label: "Clear props",
		icon: Shapes,
		on: (s) => count(propsOn(s)),
		clear: async () => {
			await c().post("/live/props/clear", { layer: "props" });
			if (store.snap.live.complements.length) await c().post("/live/props/clear", { layer: "complements" });
		},
	},
	audio: {
		label: "Stop audio",
		icon: Music2,
		on: (s) => s.player?.audio?.name ?? "",
		clear: () => c().post("/player/audio/clear"),
	},
} satisfies Record<string, Layer>;

const LAYER_IDS = Object.keys(LAYERS) as (keyof typeof LAYERS)[];

function count(n: number): string {
	return n ? `${n} on` : "";
}

export function cameraName(s: Snapshot, deviceId: string): string {
	return s.inputs.find((i) => i.device_id === deviceId)?.name ?? s.cameras.find((d) => d.id === deviceId)?.name ?? "camera";
}

/** Keys set to clear the complements (an older OpenPres's) clear the props: there is one layer now. */
const layerOf = (settings: ClearSettings) => choice((settings.layer as string) === "complements" ? "props" : settings.layer, LAYER_IDS);

type ClearSettings = {
	layer?: keyof typeof LAYERS;
	/** One of the admin's clear groups instead of a layer. */
	group_id?: string;
	/** The group's name when it was chosen (shown if it's deleted). */
	name?: string;
	label?: string;
};

/** What is on the group's layers ("Amazing Grace", "3 layers"). */
function groupOn(s: Snapshot, layers: string[]): string {
	const on = layers.flatMap((l) => {
		const what = (LAYERS as Record<string, Layer>)[l]?.on(s);
		return what ? [what] : [];
	});
	return on.length === 1 ? on[0] : layersOn(on);
}

/**
 * Clears one layer, every visual layer, everything, or one of the admin's clear groups. Lit
 * while there is something to clear.
 */
@action({ UUID: "com.nathandsanta.openpres.clear" })
export class Clear extends OpenPresAction<ClearSettings> {
	protected face(settings: ClearSettings): Face {
		if (settings.group_id) {
			const group = store.snap.clearGroups.find((g) => g.id === settings.group_id);
			if (!group) return { icon: Eraser, label: text(settings.label) || text(settings.name, "Clear group"), sub: store.connected ? "not found" : "", tone: store.connected ? "warn" : "idle" };
			const on = groupOn(store.snap, group.layers);
			return { icon: Eraser, label: text(settings.label) || group.name, sub: on, tone: on ? "active" : "idle", color: group.color };
		}
		const layer: Layer = LAYERS[layerOf(settings)];
		const on = layer.on(store.snap);
		return {
			icon: layer.icon,
			label: text(settings.label) || layer.label,
			sub: on,
			tone: on ? "active" : "idle",
		};
	}

	protected async press(settings: ClearSettings): Promise<void> {
		if (settings.group_id) await c().post(`/clear-groups/${settings.group_id}/run`);
		else await LAYERS[layerOf(settings)].clear();
	}
}
