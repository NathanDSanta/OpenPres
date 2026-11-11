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

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers:
        body !== undefined && contentType
          ? { "Content-Type": contentType }
          : undefined,
      body,
    });

    return {
      status: res.status,
      body: await res.text(),
    };
  }
}

/** `__TAURI_INTERNALS__` is set by the Tauri runtime; otherwise we're in a browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/* Pick the right one at runtime. */
export function defaultTransport(): Transport {
  return isTauri() ? new TauriTransport() : new HttpTransport();
}
