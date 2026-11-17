import { cameraFrameUrl, mediaUrl } from "@/api/server";
import type { MediaItem, MediaKind, SlotState } from "@/types";
import { onFontLoaded } from "@/lib/fonts";

/** Images, videos and camera frames used while drawing, shared by every canvas in a window. */

type Listener = () => void;
const listeners = new Set<Listener>();
/** Listeners that don't draw cameras (the stream's overlay): not woken by camera frames. */
const noCameraListeners = new Set<Listener>();
let notifyQueued = false;
let queuedNonCamera = false;

/** Called when an asset finished loading (canvases redraw). */
export function onAssetChange(listener: Listener, options: { cameras?: boolean } = {}): () => void {
  const set = options.cameras === false ? noCameraListeners : listeners;
  set.add(listener);
  return () => set.delete(listener);
}

/** Redraws every canvas (e.g. after a web font finished loading). */
export function requestRedraw() {
  notify();
}

onFontLoaded(() => {
  layoutCacheReset?.();
  notify();
});

let layoutCacheReset: (() => void) | null = null;
export function onFontChange(reset: () => void) {
  layoutCacheReset = reset;
}

/** `camera`: only a camera frame changed. */
function notify(camera = false) {
  if (!camera) queuedNonCamera = true;
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => {
    notifyQueued = false;
    const all = queuedNonCamera;
    queuedNonCamera = false;
    listeners.forEach((l) => l());
    if (all) noCameraListeners.forEach((l) => l());
  });
}

// ---------- media index (id -> kind) ----------

const mediaIndex = new Map<string, MediaItem>();
let durationReporter: ((id: string, ms: number, w: number, h: number) => void) | null = null;

export function setMediaIndex(items: MediaItem[]) {
  mediaIndex.clear();
  for (const item of items) mediaIndex.set(item.id, item);
  notify();
}

export function mediaKind(id: string): MediaKind | null {
  return mediaIndex.get(id)?.kind ?? null;
}

export function mediaItem(id: string): MediaItem | null {
  return mediaIndex.get(id) ?? null;
}

/** Lets the app tell the backend about video lengths it could not detect itself. */
export function setDurationReporter(fn: typeof durationReporter) {
  durationReporter = fn;
}

// ---------- images ----------

const images = new Map<string, HTMLImageElement>();

export function getImage(url: string): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => notify();
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export const getMediaImage = (id: string) => getImage(mediaUrl(id));

// ---------- videos ----------

interface VideoEntry {
  video: HTMLVideoElement;
  lastUse: number;
}
const videos = new Map<string, VideoEntry>();
const reported = new Set<string>();

/**
 * A muted video element for `mediaId`. `key` separates independent players of the same
 * file (e.g. the media layer vs. a looping element fill). Sound is played by the backend.
 */
export function getVideo(key: string, mediaId: string, loop: boolean): HTMLVideoElement {
  let entry = videos.get(key);
  if (!entry) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.loop = loop;
    video.src = mediaUrl(mediaId);
    video.onloadeddata = () => notify();
    video.onloadedmetadata = () => {
      const item = mediaIndex.get(mediaId);
      if (!reported.has(mediaId) && Number.isFinite(video.duration) && (!item || !item.duration_ms)) {
        reported.add(mediaId);
        durationReporter?.(mediaId, Math.round(video.duration * 1000), video.videoWidth, video.videoHeight);
      }
    };
    if (loop) void video.play().catch(() => undefined);
    entry = { video, lastUse: performance.now() };
    videos.set(key, entry);
  }
  entry.lastUse = performance.now();
  return entry.video;
}

export function videoReady(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0;
}

interface SyncState {
  /** When the last seek started (performance.now()). */
  seekAt: number;
  /** How long seeking takes on this computer (s): a seek aims that far ahead. */
  lead: number;
}
const syncStates = new WeakMap<HTMLVideoElement, SyncState>();

/** Drift (s) below which a playing video is left alone. */
const IN_STEP = 0.03;
/** Drift (s) above which a playing video jumps instead of catching up gently. */
const JUMP = 1.0;

/**
 * Keeps a video in step with a playback slot published by the backend, the way video
 * players follow a clock: small drift is caught up by playing a little faster or slower
 * (invisible), and only a big one (start, seek, a stall) makes it jump, aiming ahead by the
 * time seeking takes here. Seeking whenever it was slightly off made the picture stutter:
 * each seek stalls the video, which then is off again.
 */
export function syncVideo(video: HTMLVideoElement, state: SlotState, serverNow: number) {
  const target = (state.playing ? state.position_ms + (serverNow - state.anchor_ms) : state.position_ms) / 1000;
  const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
  const end = Math.max(0, duration - 0.05);
  const clamped = Math.min(Math.max(0, target), end);
  let sync = syncStates.get(video);
  if (!sync) {
    sync = { seekAt: -Infinity, lead: 0.15 };
    syncStates.set(video, sync);
  }
  if (video.readyState < 1 || video.seeking) return;
  const drift = clamped - video.currentTime; // > 0: the video is behind
  const seek = (to: number) => {
    const s = sync!;
    s.seekAt = performance.now();
    video.addEventListener(
      "seeked",
      () => {
        const took = (performance.now() - s.seekAt) / 1000;
        s.lead = Math.min(1, Math.max(0.05, s.lead * 0.5 + took * 0.5));
      },
      { once: true },
    );
    video.currentTime = Math.min(to, end);
  };

  if (!state.playing) {
    if (!video.paused) video.pause();
    if (video.playbackRate !== 1) video.playbackRate = 1;
    if (Math.abs(drift) > 0.04) seek(clamped); // paused: show the exact frame
    return;
  }
  if (video.paused && target < duration) void video.play().catch(() => undefined);
  if (Math.abs(drift) > JUMP) {
    // Not again right away: a video that just jumped needs a moment to play.
    if (performance.now() - sync.seekAt > 1500) {
      video.playbackRate = 1;
      seek(clamped + sync.lead);
    }
    return;
  }
  const rate = Math.abs(drift) < IN_STEP ? 1 : 1 + Math.max(-0.08, Math.min(0.08, drift * 0.5));
  if (Math.abs(video.playbackRate - rate) > 0.004) video.playbackRate = rate;
}

// ---------- cameras ----------

interface CameraFeed {
  frame: ImageBitmap | HTMLImageElement | null;
  lastUse: number;
  running: boolean;
}
const cameras = new Map<string, CameraFeed>();

async function runCamera(device: string, feed: CameraFeed) {
  feed.running = true;
  while (performance.now() - feed.lastUse < 2500) {
    const started = performance.now();
    try {
      const res = await fetch(cameraFrameUrl(device), { cache: "no-store", credentials: "include" });
      if (res.status === 200) {
        const blob = await res.blob();
        const bitmap = "createImageBitmap" in window ? await createImageBitmap(blob) : null;
        if (bitmap) {
          if (feed.frame && "close" in feed.frame) feed.frame.close();
          feed.frame = bitmap;
          notify(true);
        }
      } else if (res.status >= 400) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
    const wait = 33 - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  feed.running = false;
}

export function getCamera(device: string): ImageBitmap | HTMLImageElement | null {
  let feed = cameras.get(device);
  if (!feed) {
    feed = { frame: null, lastUse: performance.now(), running: false };
    cameras.set(device, feed);
  }
  feed.lastUse = performance.now();
  if (!feed.running) void runCamera(device, feed);
  return feed.frame;
}

// Free videos nobody drew for a while.
setInterval(() => {
  const now = performance.now();
  for (const [key, entry] of videos) {
    if (now - entry.lastUse > 15_000) {
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.load();
      videos.delete(key);
    }
  }
}, 5000);
