import { defaultTransport, HttpTransport, type Transport } from "./transport";
import type { ApiErrorBody } from "@/types";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let transport: Transport = defaultTransport();

/** Called when the server asks for a login (browser access with a password). */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}
export function setTransport(t: Transport) {
  transport = t;
}

async function raw(
  method: string,
  path: string,
  body?: string,
  contentType?: string,
): Promise<{ status: number; body: string }> {
  const res = await transport.request(method, path, body, contentType);
  if (res.status >= 400) {
    let message = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(res.body) as Partial<ApiErrorBody>;
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && !path.startsWith("/auth/")) unauthorizedHandler?.();
    throw new ApiError(res.status, message);
  }
  return res;
}

function parseJson<T>(body: string): T {
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

export async function apiGet<T>(path: string): Promise<T> {
  const { body } = await raw("GET", path);
  return parseJson<T>(body);
}

export async function apiGetText(path: string): Promise<string> {
  const { body } = await raw("GET", path);
  return body;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await raw(
    "POST",
    path,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? undefined : "application/json",
  );
  return parseJson<T>(res.body);
}

export async function apiPostText<T>(
  path: string,
  body: string,
  contentType = "text/plain",
) {
  const res = await raw("POST", path, body, contentType);
  return parseJson<T>(res.body);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await raw(
    "PUT",
    path,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? undefined : "application/json",
  );
  return parseJson<T>(res.body);
}

export async function apiPutText<T>(
  path: string,
  body: string,
  contentType = "text/plain",
) {
  const res = await raw("PUT", path, body, contentType);
  return parseJson<T>(res.body);
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const res = await raw("DELETE", path);
  return parseJson<T>(res.body);
}

export function getHttpTransportPort(): number | null {
  return transport instanceof HttpTransport ? transport.getPort() : null;
}

export function setHttpTransportPort(port: number): boolean {
  if (!(transport instanceof HttpTransport)) {
    return false;
  }

  transport.setPort(port);
  return true;
}
