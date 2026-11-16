// A stand-in for OpenPres's HTTP API, with just what the plugin uses, so the plugin can be
// tested without the app. Records every request and notifies changes like OpenPres does.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Request {
	method: string;
	path: string;
	body: unknown;
	authorization: string | undefined;
}

export function initialState() {
	return {
		live: { video_input: null as string | null, props: [] as { theme_id: string; design_id: string }[], complements: [] as { theme_id: string; design_id: string }[] },
		presenter: {
			slides: { presentation_id: "p1", title: "Amazing Grace", slide_index: 0, total_slides: 5, current: { index: 0, group: "Verse 1" } } as Record<string, unknown> | null,
			announcements: null as Record<string, unknown> | null,
			focus: "slides" as "slides" | "bible",
		},
		stream: { running: false, started_at_ms: null as number | null, streaming: false, recording_file: null as string | null, error: null as string | null },
		timers: [
			{ id: "t1", name: "Sermon", kind: { type: "countdown", seconds: 1800 }, allow_overrun: true, running: false, elapsed_ms: 0, started_at: null as number | null, paused_at: null as number | null },
		],
		services: [] as unknown[],
		bible: null as { reference: { book: string; chapter: number; verse_start: number; verse_end: number }; label: string } | null,
		player: { visual: null as Record<string, unknown> | null, audio: null as Record<string, unknown> | null },
		props: [{ id: "th1", name: "Props", kind: "props", designs: [{ id: "d1", name: "Welcome banner" }, { id: "d2", name: "Clock" }] }],
		buses: [
			{ name: "Main", muted: false },
			{ name: "Stream", muted: true },
		],
		folders: [{ id: "f1", name: "Walk-in music", kind: "audio" }],
		cameras: [{ id: "cam:0", name: "USB Camera" }],
		inputs: [{ id: "i1", name: "Pulpit camera", device_id: "cam:0" }],
	};
}

export class MockOpenPres {
	state = initialState();
	requests: Request[] = [];
	private server: Server;
	private streams = new Set<ServerResponse>();
	private token = "token-123";
	port = 0;
	password: string;

	constructor(password = "") {
		this.password = password;
		this.server = createServer((req, res) => void this.handle(req, res));
	}

	async start(port = 0): Promise<this> {
		await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
		this.port = (this.server.address() as AddressInfo).port;
		return this;
	}

	async stop() {
		for (const s of this.streams) s.destroy();
		this.server.closeAllConnections();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	/** Like OpenPres after any change: tells the listeners. */
	changed() {
		for (const s of this.streams) s.write(`event: changed\ndata: ${Date.now()}\n\n`);
	}

	/** Requests other than the reads every refresh makes. */
	commands(): Request[] {
		return this.requests.filter((r) => r.method !== "GET");
	}

	private async handle(req: IncomingMessage, res: ServerResponse) {
		const url = new URL(req.url ?? "/", "http://x");
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const text = Buffer.concat(chunks).toString();
		const body = text ? JSON.parse(text) : undefined;
		const path = url.pathname.replace(/^\/api/, "") + url.search;
		this.requests.push({ method: req.method ?? "GET", path, body, authorization: req.headers.authorization });

		const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
			res.writeHead(status, { "content-type": "application/json", ...headers });
			res.end(JSON.stringify(value));
		};
		const s = this.state;
		const route = `${req.method} ${url.pathname.replace(/^\/api/, "")}`;

		if (route === "GET /health") return json(200, { status: "ok", version: "9.9.9" });
		if (route === "POST /auth/login") {
			if (body?.password !== this.password) return json(401, { error: "wrong password" });
			return json(200, { ok: true }, { "set-cookie": `openpres_session=${this.token}; HttpOnly; Path=/` });
		}
		if (this.password && req.headers.authorization !== `Bearer ${this.token}`) return json(401, { error: "login required" });

		switch (route) {
			case "GET /events":
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				res.write(": hello\n\n");
				this.streams.add(res);
				req.on("close", () => this.streams.delete(res));
				return;
			case "GET /live":
				return json(200, s.live);
			case "GET /presenter/state":
				return json(200, s.presenter);
			case "GET /stream/status":
				return json(200, s.stream);
			case "GET /timers":
				return json(200, s.timers);
			case "GET /services":
				return json(200, s.services);
			case "GET /bible/live":
				return json(200, s.bible);
			case "GET /player":
				return json(200, { ...s.player, volumes: [0, 0], now_ms: Date.now() });
			case "GET /themes":
				return json(200, s.props);
			case "GET /audio":
				return json(200, { config: { buses: s.buses }, buses: s.buses.length });
			case "GET /media/playlists":
				return json(200, s.folders);
			case "GET /devices/video":
				return json(200, s.cameras);
			case "GET /video-inputs":
				return json(200, s.inputs);
			case "GET /bibles/parse": {
				const q = url.searchParams.get("q") ?? "";
				const m = /^(john|juan)\s+(\d+):(\d+)(?:-(\d+))?$/i.exec(q.trim());
				if (!m) return json(200, { reference: null });
				const reference = { book: "JHN", chapter: +m[2], verse_start: +m[3], verse_end: +(m[4] ?? m[3]) };
				return json(200, { reference, label: `Juan ${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ""}` });
			}
		}

		// Commands: change the state a little, like OpenPres would.
		if (req.method !== "GET") {
			const slides = s.presenter.slides as { slide_index: number; total_slides: number } | null;
			if (route === "POST /presenter/next" && slides) slides.slide_index = Math.min(slides.slide_index + 1, slides.total_slides - 1);
			else if (route === "POST /presenter/previous" && slides) slides.slide_index = Math.max(slides.slide_index - 1, 0);
			else if (route === "POST /presenter/clear") s.presenter.slides = null;
			else if (route === "POST /stream/start") Object.assign(s.stream, { running: true, streaming: true, started_at_ms: Date.now() });
			else if (route === "POST /stream/stop") Object.assign(s.stream, { running: false, streaming: false, started_at_ms: null });
			else if (route === "POST /live/props") {
				const list = s.live[body.layer as "props" | "complements"];
				const i = list.findIndex((p) => p.theme_id === body.theme_id && p.design_id === body.design_id);
				const on = body.active ?? i < 0;
				if (on && i < 0) list.push({ theme_id: body.theme_id, design_id: body.design_id });
				if (!on && i >= 0) list.splice(i, 1);
			} else if (route === "PUT /live/video_input") s.live.video_input = body.device_id;
			else if (/^PUT \/audio\/buses\/\d+\/levels$/.test(route)) {
				const n = Number(route.split("/")[3]);
				s.buses[n - 1].muted = body.muted;
			} else if (/^POST \/timers\/[^/]+\/start$/.test(route)) Object.assign(s.timers[0], { running: true, started_at: Date.now() });
			else if (route === "POST /bible/show") {
				s.bible = { reference: { book: "JHN", chapter: 3, verse_start: 16, verse_end: 16 }, label: "Juan 3:16" };
				s.presenter.focus = "bible";
			}
			json(200, {});
			this.changed();
			return;
		}
		json(404, { error: "not found" });
	}
}
