import { useEffect, useRef, useState } from "react";
import { screensApi } from "@/api/screens";
import { useLive } from "@/api/events";
import type { RenderScene } from "@/types";

/**
 * The live scene of a screen, refetched on every change, plus the offset between the
 * server clock and this device's clock (for timers and video sync).
 */
export function useScene(screenId: string | null | undefined) {
  const [offset, setOffset] = useState(0);
  const sentAt = useRef(0);
  const { data, error } = useLive<RenderScene | null>(async () => {
    if (!screenId) return null;
    sentAt.current = Date.now();
    const scene = await screensApi.render(screenId);
    const received = Date.now();
    setOffset(scene.now_ms - (sentAt.current + received) / 2);
    return scene;
  }, [screenId]);
  return { scene: screenId ? data : null, error, offset };
}

/** Re-renders every `ms` milliseconds (clocks in widgets). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
