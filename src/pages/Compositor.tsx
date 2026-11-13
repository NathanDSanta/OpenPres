import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { postBinary } from "@/api/server";
import { drawScene } from "@/lib/scene/draw";
import { useScene } from "@/hooks/useScene";
import { useMediaIndex } from "@/hooks/useMediaIndex";
import "@/styles/Compositor.css";

/**
 * The stream's video source. Opened by the app while streaming: draws the chosen screen at
 * the stream size and sends JPEG frames to the backend, which pipes them into ffmpeg.
 * It doubles as a confidence monitor of what goes out.
 */
export default function Compositor() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const width = Number(params.get("w")) || 1280;
  const height = Number(params.get("h")) || 720;
  const fps = Math.min(60, Math.max(5, Number(params.get("fps")) || 30));
  useMediaIndex();
  const { scene, offset } = useScene(id);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState({ sent: 0, dropped: 0, stopped: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let inFlight = 0;
    let sent = 0;
    let dropped = 0;
    let stopped = false;
    // setInterval, not requestAnimationFrame: keeps running while the window is covered.
    const timer = setInterval(() => {
      const current = sceneRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (current) {
        const sw = current.screen.width;
        const sh = current.screen.height;
        const scale = Math.min(width / sw, height / sh);
        ctx.setTransform(scale, 0, 0, scale, (width - sw * scale) / 2, (height - sh * scale) / 2);
        drawScene(ctx, current, sw, sh, Date.now() + offsetRef.current, "compositor");
      }
      if (inFlight >= 2 || stopped) {
        dropped += 1;
        return;
      }
      inFlight += 1;
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            inFlight -= 1;
            return;
          }
          void postBinary("/stream/frame", blob)
            .then((res) => {
              if (res.status === 410) stopped = true;
              else sent += 1;
            })
            .catch(() => (dropped += 1))
            .finally(() => (inFlight -= 1));
        },
        "image/jpeg",
        0.85,
      );
    }, 1000 / fps);
    const statsTimer = setInterval(() => setStats({ sent, dropped, stopped }), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(statsTimer);
    };
  }, [width, height, fps]);

  return (
    <main className="compositor">
      <canvas ref={canvasRef} className="compositor-canvas" />
      <footer className="compositor-status">
        <span className={stats.stopped ? "" : "badge-live"}>{stats.stopped ? "Stream stopped" : "Sending to stream"}</span>
        <span>
          {width}×{height} @ {fps} fps · {stats.sent} frames{stats.dropped ? ` · ${stats.dropped} skipped` : ""}
        </span>
        <span className="compositor-hint">Keep this window open (it can be covered, not minimized).</span>
      </footer>
    </main>
  );
}
