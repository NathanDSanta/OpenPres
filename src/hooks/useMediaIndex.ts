import { useEffect } from "react";
import { mediaApi } from "@/api/media";
import { useLive } from "@/api/events";
import { setDurationReporter, setMediaIndex } from "@/lib/scene/assets";
import type { MediaItem } from "@/types";

/** Keeps the renderer's media index (id -> kind) current. Mount once per window. */
export function useMediaIndex(): MediaItem[] {
  const { data } = useLive(() => mediaApi.list());
  useEffect(() => {
    setDurationReporter((id, duration_ms, width, height) => {
      void mediaApi.setMeta(id, { duration_ms, width, height }).catch(() => undefined);
    });
    return () => setDurationReporter(null);
  }, []);
  useEffect(() => {
    if (data) setMediaIndex(data);
  }, [data]);
  return data ?? [];
}
