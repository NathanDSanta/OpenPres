import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "./transport";
import { apiGet } from "./client";

/**
 * A revision number that increases whenever anything changes in the backend. Desktop
 * windows get Tauri events, browsers get server-sent events; both fall back to polling.
 *
 * Each change says what it was about (topics: the API area, like "audio" or "presenter").
 * A page that only shows some areas passes them to `useLive` and refetches only when one of
 * them changes: moving a fader doesn't make every screen preview reload.
 */
let revision = 0;
/** The last change about anything (no topics). */
let allRevision = 0;
const topicRevision = new Map<string, number>();
let started = false;
const listeners = new Set<() => void>();

function bump(next?: number, topics?: string[]) {
  const value = typeof next === "number" && Number.isFinite(next) ? next : revision + 1;
  if (value === revision) return;
  revision = value;
  if (topics && topics.length) topics.forEach((t) => topicRevision.set(t, value));
  else allRevision = value;
  listeners.forEach((l) => l());
}

/** The revision a page with these topics cares about. */
function revisionOf(topics?: readonly string[]): number {
  if (!topics) return revision;
  let r = allRevision;
  for (const t of topics) r = Math.max(r, topicRevision.get(t) ?? 0);
  return r;
}

/** "12 audio,stream" (or an older "12"). */
function parseChange(data: unknown): { revision: number; topics: string[] } {
  if (typeof data === "number") return { revision: data, topics: [] };
  if (data && typeof data === "object") {
    const d = data as { revision?: number; topics?: string[] };
    return { revision: Number(d.revision), topics: d.topics ?? [] };
  }
  const [rev, topics] = String(data).split(" ");
  return { revision: Number(rev), topics: topics ? topics.split(",").filter(Boolean) : [] };
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<unknown>("openpres://changed", (e) => {
        const change = parseChange(e.payload);
        bump(change.revision, change.topics);
      }),
    );
  } else {
    const connect = () => {
      const source = new EventSource("/api/events", { withCredentials: true });
      source.addEventListener("changed", (e) => {
        const change = parseChange((e as MessageEvent).data);
        bump(change.revision, change.topics);
      });
      source.onerror = () => {
        source.close();
        setTimeout(connect, 3000);
      };
    };
    connect();
  }
  // Safety net (missed events, sleeping laptops, timers that only tick client-side).
  setInterval(() => {
    apiGet<{ revision: number }>("/revision")
      .then((r) => bump(r.revision))
      .catch(() => undefined);
  }, 4000);
}

/** The current revision; with topics, it only moves when one of them changes. */
export function useRevision(topics?: readonly string[]): number {
  start();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => revisionOf(topics),
  );
}

/** Notifies listeners locally right away (after our own requests). */
export function markChanged() {
  bump();
}

/** Same, for a change about these topics only (as in `useLive`). */
export function markTopicsChanged(topics: string[]) {
  bump(undefined, topics);
}

/**
 * Loads data and reloads it whenever the backend changes (with `topics`: only when one of
 * those areas changes, e.g. ["audio"]). Never runs two requests at once: changes during a
 * request trigger exactly one follow-up.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[] = [], topics?: readonly string[]) {
  const rev = useRevision(topics);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const busy = useRef(false);
  const again = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    generation.current += 1;
    const run = async () => {
      if (busy.current) {
        // A request is in flight: run once more when it finishes.
        again.current = true;
        return;
      }
      busy.current = true;
      const started = generation.current;
      try {
        const result = await loadRef.current();
        if (!mounted.current) return;
        if (started === generation.current) {
          setData(result);
          setError(null);
        } else {
          again.current = true; // inputs changed meanwhile: this result is stale
        }
      } catch (err) {
        if (mounted.current && started === generation.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        busy.current = false;
        if (again.current && mounted.current) {
          again.current = false;
          void run();
        }
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, tick, ...deps]);

  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

/** What a screen's picture depends on (see useScene). */
export const SCENE_TOPICS = [
  "presenter",
  "live",
  "screens",
  "themes",
  "media",
  "player",
  "bible",
  "bibles",
  "timers",
  "presentations",
  "libraries",
  "services",
  "groups",
  "video-inputs",
] as const;

/** Everything about the show (what's on screens, songs, playlists, media...). */
export const SHOW_TOPICS = [...SCENE_TOPICS, "playlists"] as const;
