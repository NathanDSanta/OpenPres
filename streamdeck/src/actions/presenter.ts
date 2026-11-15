import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ChevronLeft, ChevronRight, Hash } from "lucide";
import type { Face } from "../keys";
import { store, type LayerState } from "../store";
import { choice, count, OpenPresAction, text } from "./base";

const TARGETS = ["auto", "slides", "announcements", "bible"] as const;
type Target = (typeof TARGETS)[number];

type StepSettings = {
	/** auto: the slides or the Bible passage (whichever was shown last) and the announcements, like the arrow keys. */
	target?: Target;
	label?: string;
};

function position(layer: LayerState | null): string {
	return layer ? `${layer.slide_index + 1} / ${layer.total_slides}` : "";
}

/** Next/Previous: moves the slides, announcements or Bible passage one step. */
abstract class Step extends OpenPresAction<StepSettings> {
	protected abstract readonly forward: boolean;

	protected face(settings: StepSettings): Face {
		const { presenter, bible } = store.snap;
		const target = choice(settings.target, TARGETS);
		let sub = "";
		if (target === "slides") sub = position(presenter.slides);
		else if (target === "announcements") sub = position(presenter.announcements);
		else if (target === "bible") sub = bible?.label ?? "";
		else if (presenter.focus === "bible" && bible) sub = bible.label ?? "";
		else sub = position(presenter.slides ?? presenter.announcements);
		return {
			icon: this.forward ? ChevronRight : ChevronLeft,
			label: text(settings.label) || (this.forward ? "Next" : "Previous"),
			sub,
			tone: "idle",
		};
	}

	protected async press(settings: StepSettings): Promise<void> {
		const target = choice(settings.target, TARGETS);
		const step = this.forward ? "next" : "previous";
		if (target === "bible") await store.client.post(`/bible/${step}`);
		else await store.client.post(`/presenter/${step}?layer=${target === "auto" ? "all" : target}`);
	}
}

@action({ UUID: "com.nathandsanta.openpres.next" })
export class Next extends Step {
	protected readonly forward = true;
}

@action({ UUID: "com.nathandsanta.openpres.previous" })
export class Previous extends Step {
	protected readonly forward = false;
}

type SlideSettings = {
	/** Slide number, from 1. */
	number?: number | string;
	layer?: "slides" | "announcements";
	label?: string;
};

/** Go to slide N of what is live. */
@action({ UUID: "com.nathandsanta.openpres.slide" })
export class GoToSlide extends OpenPresAction<SlideSettings> {
	protected face(settings: SlideSettings): Face {
		const n = count(settings.number, 1);
		const layer = choice(settings.layer, ["slides", "announcements"] as const);
		const live = store.snap.presenter[layer];
		const here = live?.slide_index === n - 1;
		return {
			icon: Hash,
			label: text(settings.label) || `Slide ${n}`,
			sub: here ? "on screen" : live && n > live.total_slides ? `only ${live.total_slides}` : layer === "announcements" ? "announcement" : "",
			tone: here ? "active" : "idle",
		};
	}

	protected async press(settings: SlideSettings, _ev: KeyDownEvent<SlideSettings>): Promise<void> {
		const layer = choice(settings.layer, ["slides", "announcements"] as const);
		await store.client.post(`/presenter/goto?layer=${layer}`, { index: count(settings.number, 1) - 1 });
	}
}
