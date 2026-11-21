import { currentMode } from "@/lib/manager";
export interface RawResponse {
  status: number;
  body: string;
}

export interface Transport {
  request(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
  ): Promise<RawResponse>;
}

/* ------------------------------------------------------------------ */
/* Tauri: goes through the `api_request` command, no socket, no port. */
/* ------------------------------------------------------------------ */
export class TauriTransport implements Transport {
  async request(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
  ) {
    const { invoke } = await import("@tauri-apps/api/core");
    // NOTE: `ApiRequest` is a plain serde struct with no rename attribute,
    //       so the field must literally be `content_type` (snake_case).
    return await invoke<RawResponse>("api_request", {
      req: {
        method,
        path,
        body: body ?? null,
        content_type: contentType ?? null,
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Browser dev: hit the real HTTP server (CorsLayer::permissive).     */
/* ------------------------------------------------------------------ */

const DEFAULT_HTTP_PORT = 8787;
const HTTP_PORT_STORAGE_KEY = "httpTransportPort";

function readHttpPort(): number {
  if (typeof window === "undefined") {
    return DEFAULT_HTTP_PORT;
  }

  const saved = window.localStorage.getItem(HTTP_PORT_STORAGE_KEY);
  const port = Number(saved);

  return saved && Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_HTTP_PORT;
}

export class HttpTransport implements Transport {
  private port: number;

  constructor(port = readHttpPort()) {
    this.port = port;
  }

  getPort(): number {
    return this.port;
  }

  setPort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer between 1 and 65535.");
    }

    this.port = port;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(HTTP_PORT_STORAGE_KEY, String(port));
    }
  }

  async request(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
  ): Promise<RawResponse> {
    const baseUrl = `/api`;

    const headers: Record<string, string> = {};
    if (body !== undefined && contentType) headers["Content-Type"] = contentType;
    const mode = currentMode();
    if (mode) headers["X-OpenPres-Mode"] = mode;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      headers,
      body,
    });

    return {
      status: res.status,
      body: await res.text(),
    };
  }
}

/** The Tauri runtime is there (an app window, or a server's page opened in the manager). */
export function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * One of the app's own windows: the manager's server list, or a server's output, stream
 * graphics and setup windows (they talk to their backend in-process). A server's interface
 * opened in the manager (or in a browser) is a web page like any other and uses HTTP.
 */
export function isTauri(): boolean {
  if (!hasTauriRuntime()) return false;
  const { protocol, hostname, port } = window.location;
  return protocol === "tauri:" || hostname === "tauri.localhost" || (import.meta.env.DEV && port === "5173");
}

/* Pick the right one at runtime. */
export function defaultTransport(): Transport {
  return isTauri() ? new TauriTransport() : new HttpTransport();
}
