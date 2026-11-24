/**
 * Checks for a newer plugin: every OpenPres release on GitHub has one attached
 * (OpenPres-X.Y.Z-StreamDeck-Plugin.streamDeckPlugin). Asked when the plugin starts, then once
 * a day. A plugin that isn't from a release (built by hand) doesn't ask.
 */

const LATEST = process.env.OPENPRES_UPDATE_URL || "https://api.github.com/repos/NathanDSanta/OpenPres/releases/latest";
const DAY = 24 * 60 * 60 * 1000;
/** The version in the repository's manifest: releases write theirs before packing. */
const TEST_BUILD = "0.1.0";

export interface UpdateInfo {
	/** This plugin's version ("0.7.0"). */
	current: string;
	/** Not from a release: it doesn't check. */
	test_build: boolean;
	/** A newer version, and where to get it. */
	latest: string | null;
	url: string | null;
	checked_at_ms: number | null;
	error: string;
}

function parts(version: string): number[] | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	return m ? m.slice(1, 4).map(Number) : null;
}

export function isNewer(version: string, than: string): boolean {
	const a = parts(version);
	const b = parts(than);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

type Release = { tag_name?: string; html_url?: string; assets?: { name?: string; browser_download_url?: string }[] };

export class UpdateCheck {
	info: UpdateInfo;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		pluginVersion: string,
		private onChange: () => void,
	) {
		// Stream Deck versions have four parts ("0.7.0.0").
		const current = pluginVersion.split(".").slice(0, 3).join(".");
		this.info = { current, test_build: current === TEST_BUILD, latest: null, url: null, checked_at_ms: null, error: "" };
	}

	start() {
		if (this.info.test_build || this.timer) return;
		void this.check();
		this.timer = setInterval(() => void this.check(), DAY);
		this.timer.unref?.();
	}

	async check(): Promise<void> {
		try {
			const res = await fetch(LATEST, { headers: { accept: "application/vnd.github+json", "user-agent": "openpres-streamdeck" }, signal: AbortSignal.timeout(15_000) });
			if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
			const release = (await res.json()) as Release;
			const version = (release.tag_name ?? "").replace(/^v/, "");
			const asset = release.assets?.find((a) => a.name?.endsWith(".streamDeckPlugin"));
			const newer = isNewer(version, this.info.current) && !!asset;
			Object.assign(this.info, {
				latest: newer ? version : null,
				url: newer ? (asset?.browser_download_url ?? release.html_url ?? null) : null,
				checked_at_ms: Date.now(),
				error: "",
			});
		} catch (e) {
			this.info.error = e instanceof Error ? e.message : String(e);
		}
		this.onChange();
	}
}
