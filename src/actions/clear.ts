import { action } from "@elgato/streamdeck";
import { BookOpen, Eraser, Image, Layers, Megaphone, Music2, Presentation, Shapes, Video, X, type IconNode } from "lucide";
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
		s.live.props.length && "props",
		s.live.complements.length && "complements",
	].filter((x): x is string => !!x);

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
		on: (s) => count(s.live.props.length),
		clear: () => c().post("/live/props/clear", { layer: "props" }),
	},
	complements: {
		label: "Clear complements",
		icon: Layers,
		on: (s) => count(s.live.complements.length),
		clear: () => c().post("/live/props/clear", { layer: "complements" }),
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

type ClearSettings = {
	layer?: keyof typeof LAYERS;
	label?: string;
};

/** Clears one layer, every visual layer, or everything. Lit while there is something to clear. */
@action({ UUID: "com.nathandsanta.openpres.clear" })
export class Clear extends OpenPresAction<ClearSettings> {
	protected face(settings: ClearSettings): Face {
		const layer: Layer = LAYERS[choice(settings.layer, LAYER_IDS)];
		const on = layer.on(store.snap);
		return {
			icon: layer.icon,
			label: text(settings.label) || layer.label,
			sub: on,
			tone: on ? "active" : "idle",
		};
	}

	protected async press(settings: ClearSettings): Promise<void> {
		await LAYERS[choice(settings.layer, LAYER_IDS)].clear();
	}
}
