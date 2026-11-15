import { action } from "@elgato/streamdeck";
import { Film, Image, Music2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide";
import type { Face } from "../keys";
import { store, type PlayerSlot } from "../store";
import { choice, count, OpenPresAction, text } from "./base";

// ---------------- media and audio player ----------------

const MODES = ["toggle", "next", "previous", "folder"] as const;

type MediaSettings = {
	/** visual: pictures and videos; audio: the audio player. */
	slot?: "visual" | "audio";
	/** toggle: play/pause; next/previous item; folder: plays a media folder (or pauses it). */
	mode?: (typeof MODES)[number];
	folder_id?: string;
	/** Folder name when it was chosen, shown if the folder is gone. */
	name?: string;
	label?: string;
};

function slotOf(settings: MediaSettings): "visual" | "audio" {
	if (choice(settings.mode, MODES) === "folder") {
		const folder = store.snap.folders.find((f) => f.id === settings.folder_id);
		if (folder) return folder.kind === "audio" ? "audio" : "visual";
	}
	return choice(settings.slot, ["visual", "audio"] as const);
}

/** Plays, pauses and skips media or audio, or plays a media folder. */
@action({ UUID: "com.nathandsanta.openpres.media" })
export class Media extends OpenPresAction<MediaSettings> {
	protected face(settings: MediaSettings): Face {
		const mode = choice(settings.mode, MODES);
		const slot = slotOf(settings);
		const state: PlayerSlot | null = store.snap.player?.[slot] ?? null;
		const label = text(settings.label);
		const kind = slot === "audio" ? "Audio" : "Media";
		if (mode === "folder") {
			const folder = store.snap.folders.find((f) => f.id === settings.folder_id);
			const icon = folder?.kind === "audio" ? Music2 : folder?.kind === "image" ? Image : Film;
			if (!settings.folder_id) return { icon, label: label || "Folder", sub: "not set", tone: "idle" };
			const here = !!state && state.playlist_id === settings.folder_id;
			return {
				icon: here && state.playing ? Pause : icon,
				label: label || folder?.name || text(settings.name) || "Folder",
				sub: !folder ? "not found" : here ? (state.playing ? state.name : "paused") : "",
				tone: !folder ? "warn" : here && state.playing ? "active" : "idle",
			};
		}
		if (mode === "next" || mode === "previous") {
			return {
				icon: mode === "next" ? SkipForward : SkipBack,
				label: label || `${mode === "next" ? "Next" : "Previous"} ${slot === "audio" ? "track" : "item"}`,
				sub: state?.name ?? "",
				tone: "idle",
			};
		}
		return {
			icon: state?.playing ? Pause : Play,
			label: label || `${kind} play/pause`,
			sub: state ? (state.playing ? state.name : "paused") : `no ${kind.toLowerCase()}`,
			tone: state?.playing ? "active" : "idle",
		};
	}

	protected async press(settings: MediaSettings): Promise<void> {
		const mode = choice(settings.mode, MODES);
		const slot = slotOf(settings);
		if (mode === "folder") {
			if (!settings.folder_id) throw new Error("no folder chosen");
			const here = store.snap.player?.[slot]?.playlist_id === settings.folder_id;
			if (here) await store.client.post(`/player/${slot}/toggle`);
			else await store.client.post(`/player/${slot}/play`, { playlist_id: settings.folder_id });
			return;
		}
		await store.client.post(`/player/${slot}/${mode}`);
	}
}

// ---------------- audio bus mute ----------------

type MuteSettings = {
	/** Mixer bus, 1-16. */
	bus?: number | string;
	mode?: "toggle" | "mute" | "unmute";
	label?: string;
};

/** Mutes or unmutes a mixer bus. Red while muted. */
@action({ UUID: "com.nathandsanta.openpres.mute" })
export class Mute extends OpenPresAction<MuteSettings> {
	protected face(settings: MuteSettings): Face {
		const n = count(settings.bus, 1);
		const bus = store.snap.buses[n - 1];
		return {
			icon: bus?.muted ? VolumeX : Volume2,
			label: text(settings.label) || bus?.name || `Bus ${n}`,
			sub: !bus ? "no such bus" : bus.muted ? "muted" : "",
			tone: !bus ? "warn" : bus.muted ? "live" : "idle",
		};
	}

	protected async press(settings: MuteSettings): Promise<void> {
		const n = count(settings.bus, 1);
		const mode = choice(settings.mode, ["toggle", "mute", "unmute"] as const);
		const muted = mode === "toggle" ? !store.snap.buses[n - 1]?.muted : mode === "mute";
		await store.client.put(`/audio/buses/${n}/levels`, { muted });
	}
}
