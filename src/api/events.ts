import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "./transport";
import { apiGet } from "./client";

/**
 * A revision number that increases whenever anything changes in the backend. Desktop
 * windows get Tauri events, browsers get server-sent events; both fall back to polling.
 */
let revision = 0;
let started = false;
const listeners = new Set<() => void>();

function bump(next?: number) {
  const value = typeof next === "number" && Number.isFinite(next) ? next : revision + 1;
  if (value === revision) return;
  revision = value;
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<number>("openpres://changed", (e) => bump(e.payload)),
    );
  } else {
    const connect = () => {
      const source = new EventSource("/api/events", { withCredentials: true });
      source.addEventListener("changed", (e) => bump(Number((e as MessageEvent).data)));
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

export function useRevision(): number {
  start();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => revision,
  );
}

/** Notifies listeners locally right away (after our own requests). */
export function markChanged() {
  bump();
}

/**
 * Loads data and reloads it whenever the backend changes. Never runs two requests at
 * once: changes during a request trigger exactly one follow-up.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const rev = useRevision();
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
