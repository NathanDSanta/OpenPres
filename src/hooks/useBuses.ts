import { useCallback, useMemo } from "react";
import { useApp } from "@/state/AppContext";
import type { AudioView, BusConfig } from "@/types";

export const MAX_BUSES = 16;

/** A bus that was never set up: no devices, default levels and name. */
export function isUnusedBus(bus: BusConfig, number: number): boolean {
  return !bus.input && !bus.outputs?.length && !bus.muted && bus.volume_db === 0 && bus.gain_db === 0 && (bus.name === `Bus ${number}` || !bus.name);
}

export function defaultBus(number: number): BusConfig {
  return { name: `Bus ${number}`, volume_db: 0, gain_db: 0, muted: false, input: null, outputs: [] };
}

/**
 * Which of the 16 mixer buses are shown. Saved with the other interface settings; until the
 * user adds or removes one, every bus that is in use is shown (at least bus 1 and 2).
 */
export function useBuses(view: AudioView | null | undefined) {
  const { ui, saveUi } = useApp();
  const shown = useMemo(() => {
    if (ui.audio_buses?.length) return [...new Set(ui.audio_buses)].filter((n) => n >= 1 && n <= MAX_BUSES).sort((a, b) => a - b);
    const used = (view?.config.buses ?? []).map((b, i) => (isUnusedBus(b, i + 1) ? 0 : i + 1)).filter(Boolean);
    return [...new Set([1, 2, ...used])].sort((a, b) => a - b);
  }, [ui.audio_buses, view]);

  const setShown = useCallback((next: number[]) => saveUi({ ...ui, audio_buses: [...new Set(next)].sort((a, b) => a - b) }), [ui, saveUi]);

  /** Shows the lowest bus not shown yet; returns its number (null when all 16 are shown). */
  const add = useCallback(() => {
    const next = Array.from({ length: MAX_BUSES }, (_, i) => i + 1).find((n) => !shown.includes(n)) ?? null;
    if (next !== null) void setShown([...shown, next]);
    return next;
  }, [shown, setShown]);

  const remove = useCallback((n: number) => setShown(shown.filter((x) => x !== n)), [shown, setShown]);

  /** Options for a bus picker: the shown buses, plus `current` if it is hidden. */
  const options = useCallback(
    (current?: number) =>
      [...new Set([...shown, ...(current ? [current] : [])])]
        .sort((a, b) => a - b)
        .map((n) => ({ value: String(n), label: `${n}. ${view?.config.buses[n - 1]?.name ?? `Bus ${n}`}` })),
    [shown, view],
  );

  return { shown, add, remove, options };
}
