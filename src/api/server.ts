import { isTauri } from "./transport";

/**
 * Binary resources (media files, camera frames, uploads, stream frames) go straight to the
 * local HTTP server. In the desktop app that needs its port and the internal key; in a
 * browser it is the same origin and the login cookie.
 */
let base = "";
let key = "";
let ready: Promise<void> | null = null;

export function initServer(force = false): Promise<void> {
  if (ready && !force) return ready;
  ready = (async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ port: number; key: string }>("local_server");
    base = `http://127.0.0.1:${info.port}`;
    key = info.key;
  })().catch((err) => {
    console.error("Could not reach the local server", err);
    ready = null;
  });
  return ready ?? Promise.resolve();
}

export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (key) query.set("k", key);
  const qs = query.toString();
  return `${base}/api${path}${qs ? `?${qs}` : ""}`;
}

export const mediaUrl = (id: string) => apiUrl(`/media/${id}/file`);
export const cameraFrameUrl = (device: string) => apiUrl("/devices/video/frame", { device });
export const cameraMjpegUrl = (device: string) => apiUrl("/devices/video/mjpeg", { device });

/** POSTs a file/blob as the raw request body; reports upload progress (0-1). */
export function uploadRaw<T>(
  path: string,
  params: Record<string, string>,
  body: Blob,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(path, params));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText ? (JSON.parse(xhr.responseText) as T) : (undefined as T));
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = JSON.parse(xhr.responseText).error ?? message;
        } catch {
          /* not JSON */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed: the server could not be reached."));
    xhr.send(body);
  });
}

export async function postBinary(path: string, body: Blob): Promise<Response> {
  return fetch(apiUrl(path), { method: "POST", body, credentials: "include" });
}
