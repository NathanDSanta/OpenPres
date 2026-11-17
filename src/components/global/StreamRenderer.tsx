import { useEffect, useMemo, useRef } from "react";
import { streamApi, useLive } from "@/api";
import { postBinary } from "@/api/server";
import { isTauri } from "@/api/transport";
import { useMediaIndex } from "@/hooks/useMediaIndex";
import { useScene } from "@/hooks/useScene";
import { onAssetChange } from "@/lib/scene/assets";
import { drawScene, overlayMotion, type NativeVideo } from "@/lib/scene/draw";
import { startTicker } from "@/lib/ticker";
import type { StreamVideo } from "@/types";

/** Lets a browser draw the stream too (for testing): localStorage["openpres.streamRenderer"] = "1". */
const BROWSER_FLAG = "openpres.streamRenderer";

function drawsTheStream(): boolean {
  if (isTauri()) return true; // the app's main window (presentation windows don't load the app shell)
  try {
    return localStorage.getItem(BROWSER_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * While the stream runs, the main window draws the streamed screen's slides, Bible,
 * announcements, props and mask and sends that picture to the backend whenever it changes.
 * The backend draws the background, the camera and the media layer itself (videos are
 * decoded natively, at the stream's full frame rate, like OBS does) and puts this picture
 * on top. Nothing is shown here, and no extra window is needed.
 */
export default function StreamRenderer() {
  const enabled = useMemo(drawsTheStream, []);
  const { data: status } = useLive(() => (enabled ? streamApi.status() : Promise.resolve(null)), [enabled]);
  const video = status?.running ? status.video : null;
  if (!enabled || !video) return null;
  return <OverlayLoop key={`${video.screen_id}-${video.width}x${video.height}@${video.fps}`} video={video} />;
}

function OverlayLoop({ video }: { video: StreamVideo }) {
  useMediaIndex();
  const { scene, offset } = useScene(video.screen_id);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const dirty = useRef(true);

  useEffect(() => {
    dirty.current = true;
  }, [scene]);
  // Pictures and fonts that finish loading (camera frames don't matter: the camera is native).
  useEffect(() => onAssetChange(() => (dirty.current = true), { cameras: false }), []);

  useEffect(() => {
    const { width, height, fps } = video;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let busy = false;
    let stopped = false;
    let last = 0;
    // A worker-driven timer: keeps going while the window is minimised or covered.
    const stopTicker = startTicker(1000 / fps, () => {
      const current = sceneRef.current;
      if (busy || stopped || !current) return;
      const t = performance.now();
      const motion = overlayMotion(current);
      // Unchanged pictures are re-sent now and then, in case one was lost.
      const due = dirty.current || motion === "fast" || (motion === "slow" && t - last >= 250) || t - last >= 5000;
      if (!due) return;
      dirty.current = false;
      last = t;
      busy = true;

      const sw = current.screen.width;
      const sh = current.screen.height;
      const scale = Math.min(width / sw, height / sh);
      const ox = (width - sw * scale) / 2;
      const oy = (height - sh * scale) / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      let native: NativeVideo | null = null;
      drawScene(ctx, current, sw, sh, Date.now() + offsetRef.current, "stream", {
        nativeBase: true,
        onNativeVideo: (v) => (native = v),
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      let pixels: Uint8ClampedArray<ArrayBuffer>;
      try {
        pixels = ctx.getImageData(0, 0, width, height).data as Uint8ClampedArray<ArrayBuffer>;
      } catch (e) {
        // A picture without CORS taints the canvas: nothing can be read back.
        console.error("stream: cannot read the picture", e);
        busy = false;
        return;
      }
      const params: Record<string, string> = { w: String(width), h: String(height) };
      const video = native as NativeVideo | null;
      if (video) {
        // A design's background video: the backend decodes it and puts it under the picture.
        params.lv = video.media_id;
        params.lx = String(Math.round(ox + video.x * scale));
        params.ly = String(Math.round(oy + video.y * scale));
        params.lw = String(Math.round(video.w * scale));
        params.lh = String(Math.round(video.h * scale));
        params.lfit = video.fit;
        params.lloop = String(video.loop);
      }
      void postBinary("/stream/overlay", pixels, params)
        .then((res) => {
          if (res.status === 410) stopped = true;
          else if (!res.ok) dirty.current = true;
        })
        .catch(() => (dirty.current = true))
        .finally(() => (busy = false));
    });
    return stopTicker;
  }, [video]);

  return null;
}
