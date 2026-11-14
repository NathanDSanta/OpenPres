import { useEffect, useState } from "react";
import { audioApi } from "@/api/audio";
import type { Meters } from "@/types";

/** One shared poller for every meter on screen, with a peak-hold style decay. */
const empty = (): Meters => ({
  buses: Array.from({ length: 16 }, () => [0, 0] as [number, number]),
  inputs: Array.from({ length: 16 }, () => [0, 0] as [number, number]),
});
let current: Meters = empty();
const listeners = new Set<(m: Meters) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const decay = (fresh: [number, number][] | undefined, old: [number, number][]) =>
  old.map(([ol, or], i) => {
    const [nl, nr] = fresh?.[i] ?? [0, 0];
    return [Math.max(nl, ol * 0.7), Math.max(nr, or * 0.7)] as [number, number];
  });

function startPolling() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const fresh = await audioApi.meters();
      current = { buses: decay(fresh.buses, current.buses), inputs: decay(fresh.inputs, current.inputs) };
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
