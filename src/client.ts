/**
 * Talks to OpenPres's HTTP API, like the app's own windows and the iPad remote do.
 *
 * - With the server's operator password, the plugin logs in and sends the session token as
 *   `Authorization: Bearer …` (on the same computer before the server is set up, requests
 *   need nothing else).
 */

export interface ConnectionSettings {
	/** Computer running OpenPres; empty = this computer. */
	host?: string;
	/** OpenPres's API port (Settings → Network); empty = 8787. */
	port?: number | string;
	/** The server's operator password. */
	password?: string;
}

export const DEFAULT_PORT = 8787;

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** Reads are quick; a command (e.g. going live) may take OpenPres a little longer. */
const READ_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 15_000;
/** The server sends a keep-alive comment every ~15 s; silence for longer means the link is dead. */
const EVENTS_SILENCE_MS = 40_000;

export class OpenPresClient {
	private token: string | null = null;
	private connection: ConnectionSettings = {};

	/** Returns whether anything changed. */
	setConnection(connection: ConnectionSettings) {
		const next: ConnectionSettings = {
			host: String(connection.host ?? "").trim(),
			port: String(connection.port ?? "").trim(),
			password: String(connection.password ?? ""),
		};
		const changed = JSON.stringify(next) !== JSON.stringify(this.connection);
		this.connection = next;
		if (changed) this.token = null;
		return changed;
	}

	get address(): string {
		const host = String(this.connection.host ?? "").trim() || "127.0.0.1";
		const port = Number(this.connection.port) || DEFAULT_PORT;
		// IPv6 literals need brackets in URLs.
		return `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
	}

	private get base(): string {
		return `http://${this.address}/api`;
	}

	private headers(json: boolean): Record<string, string> {
		const headers: Record<string, string> = {};
		if (json) headers["content-type"] = "application/json";
		if (this.token) headers.authorization = `Bearer ${this.token}`;
		return headers;
	}

	async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
		let res: Response;
		try {
			res = await fetch(this.base + path, {
				method,
				headers: this.headers(body !== undefined),
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(method === "GET" ? READ_TIMEOUT_MS : COMMAND_TIMEOUT_MS),
			});
		} catch (e) {
			throw new ApiError(0, `OpenPres is not reachable at ${this.address} (${describe(e)})`);
		}
		if (res.status === 401 && retry) {
			await this.login();
			return this.request<T>(method, path, body, false);
		}
		if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
		const text = await res.text();
		return (text ? JSON.parse(text) : null) as T;
	}

	get<T>(path: string) {
		return this.request<T>("GET", path);
	}

	post<T>(path: string, body: unknown = {}) {
		return this.request<T>("POST", path, body);
	}

	put<T>(path: string, body: unknown) {
		return this.request<T>("PUT", path, body);
	}

	/** Logs in with the password; the session token is kept for the next requests. */
	async login(): Promise<void> {
		const password = String(this.connection.password ?? "");
		if (!password) throw new ApiError(401, "enter the OpenPres operator password in the plugin's connection settings");
		let res: Response;
		try {
			res = await fetch(`${this.base}/auth/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ password }),
				signal: AbortSignal.timeout(READ_TIMEOUT_MS),
			});
		} catch (e) {
			throw new ApiError(0, `OpenPres is not reachable at ${this.address} (${describe(e)})`);
		}
		if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "wrong OpenPres password" : await errorMessage(res));
		const cookie = res.headers.getSetCookie().find((c) => c.startsWith("openpres_session="));
		// No cookie: OpenPres has no password after all.
		this.token = cookie ? cookie.slice("openpres_session=".length).split(";")[0] : null;
	}

	/**
	 * Follows OpenPres's change notifications (server-sent events) and calls `onChange` for
	 * each. Returns when the connection ends; throws when it cannot be opened.
	 */
	async events(signal: AbortSignal, onChange: () => void, retry = true): Promise<void> {
		const watchdog = new AbortController();
		const both = AbortSignal.any([signal, watchdog.signal]);
		let timer = setTimeout(() => watchdog.abort(), EVENTS_SILENCE_MS);
		const alive = () => {
			clearTimeout(timer);
			timer = setTimeout(() => watchdog.abort(), EVENTS_SILENCE_MS);
		};
		try {
			let res: Response;
			try {
				res = await fetch(`${this.base}/events`, { headers: { ...this.headers(false), accept: "text/event-stream" }, signal: both });
			} catch (e) {
				throw new ApiError(0, `OpenPres is not reachable at ${this.address} (${describe(e)})`);
			}
			if (res.status === 401 && retry) {
				await this.login();
				return this.events(signal, onChange, false);
			}
			if (!res.ok || !res.body) throw new ApiError(res.status, await errorMessage(res));
			const decoder = new TextDecoder();
			let buffer = "";
			let event = "";
			const reader = res.body.getReader();
			for (;;) {
				const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
				if (done) return;
				alive();
				buffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, newline).replace(/\r$/, "");
					buffer = buffer.slice(newline + 1);
					if (line.startsWith("event:")) event = line.slice(6).trim();
					else if (line === "") {
						if (event === "changed") onChange();
						event = "";
					}
				}
			}
		} finally {
			clearTimeout(timer);
		}
	}
}

async function errorMessage(res: Response): Promise<string> {
	const text = await res.text().catch(() => "");
	try {
		const parsed = JSON.parse(text) as { error?: string };
		if (parsed.error) return parsed.error;
	} catch {
		/* not JSON */
	}
	return text || `HTTP ${res.status}`;
}

export function describe(e: unknown): string {
	if (e instanceof Error) {
		const cause = (e as { cause?: { code?: string; message?: string } }).cause;
		return cause?.code ?? cause?.message ?? e.message;
	}
	return String(e);
}
