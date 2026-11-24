import { action } from "@elgato/streamdeck";
import {
	Baby,
	Bell,
	BookOpen,
	Camera,
	Church,
	Clapperboard,
	Coffee,
	DoorOpen,
	Flag,
	Gift,
	HandHeart,
	Heart,
	Hourglass,
	Lightbulb,
	Megaphone,
	Mic,
	Monitor,
	Moon,
	Music,
	PartyPopper,
	Play,
	Power,
	Presentation,
	Radio,
	Sparkles,
	Star,
	Sunrise,
	Timer,
	Users,
	Video,
	Volume2,
	Zap,
	type IconNode,
} from "lucide";
import type { Face } from "../keys";
import { store } from "../store";
import { OpenPresAction, text } from "./base";

/** The icons a macro can have in OpenPres (Settings → Macros), by their Lucide names. */
const ICONS: Record<string, IconNode> = {
	Zap,
	Sparkles,
	Church,
	Sunrise,
	Moon,
	Bell,
	Mic,
	Music,
	BookOpen,
	Presentation,
	Megaphone,
	Video,
	Camera,
	Clapperboard,
	Play,
	Radio,
	Monitor,
	Volume2,
	Timer,
	Hourglass,
	Coffee,
	Baby,
	Users,
	HandHeart,
	Heart,
	Gift,
	PartyPopper,
	Star,
	Flag,
	Lightbulb,
	DoorOpen,
	Power,
};

type MacroSettings = {
	macro_id?: string;
	/** Name when it was chosen, shown if the macro is gone. */
	name?: string;
	label?: string;
};

/**
 * Runs one of OpenPres's macros (several steps from one press), with the macro's icon and
 * colour. Lit while it runs; a press then stops it.
 */
@action({ UUID: "com.nathandsanta.openpres.macro" })
export class Macro extends OpenPresAction<MacroSettings> {
	protected face(settings: MacroSettings): Face {
		const label = text(settings.label);
		if (!settings.macro_id) return { icon: Zap, label: label || "Macro", sub: "not set", tone: "idle" };
		const macro = store.snap.macros.find((m) => m.id === settings.macro_id);
		if (!macro) return { icon: Zap, label: label || text(settings.name) || "Macro", sub: store.connected ? "not found" : "", tone: store.connected ? "warn" : "idle" };
		const running = store.snap.macrosRunning.includes(macro.id);
		return { icon: ICONS[macro.icon] ?? Zap, label: label || macro.name, sub: running ? "running" : "", tone: running ? "active" : "idle", color: macro.color };
	}

	protected async press(settings: MacroSettings): Promise<void> {
		const id = text(settings.macro_id);
		if (!id) throw new Error("no macro chosen");
		if (store.snap.macrosRunning.includes(id)) await store.client.post(`/macros/${id}/stop`);
		else await store.client.post(`/macros/${id}/run`, { from: "stream_deck" });
	}
}
