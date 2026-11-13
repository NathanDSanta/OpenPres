import { useEffect, useState } from "react";
import { audioApi } from "@/api/audio";
import type { Meters } from "@/types";

/** One shared poller for every meter on screen, with a peak-hold style decay. */
let current: Meters = {};
const listeners = new Set<(m: Meters) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const fresh = await audioApi.meters();
      const next: Meters = {};
      const ids = new Set([...Object.keys(fresh), ...Object.keys(current)]);
      for (const id of ids) {
        const [nl, nr] = fresh[id] ?? [0, 0];
        const [ol, or] = current[id] ?? [0, 0];
        next[id] = [Math.max(nl, ol * 0.7), Math.max(nr, or * 0.7)];
      }
      current = next;
      listeners.forEach((l) => l(current));
    } catch {
      /* engine not reachable */
    }
  }, 80);
}

export function useMeters(): Meters {
  const [meters, setMeters] = useState<Meters>(current);
  useEffect(() => {
    listeners.add(setMeters);
    startPolling();
    return () => {
      listeners.delete(setMeters);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return meters;
}
