import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { serverApi } from "@/api/serverApi";
import { useLive } from "@/api/events";
import { screensApi } from "@/api/screens";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import { useScene } from "@/hooks/useScene";
import { useMediaIndex } from "@/hooks/useMediaIndex";
import type { RenderScene } from "@/types";
import "@/styles/PresentationWindow.css";

/** A fullscreen output window: draws its virtual screen and nothing else. */
export default function PresentationWindow() {
  const { id } = useParams<{ id: string }>();
  useMediaIndex();
  const { scene, offset } = useScene(id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !id) return;
      event.preventDefault();
      // Hidden by the server (it stays assigned; any manager can show it again).
      void serverApi.setScreenOutputVisible(id, false).catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id]);

  if (scene?.screen.kind === "monitor")
    return (
      <>
        <MonitorView monitor={scene} />
        <Identify screenId={id} />
      </>
    );
  const w = scene?.screen.width ?? 16;
  const h = scene?.screen.height ?? 9;
  return (
    <main className="presentation-window">
      <Identify screenId={id} />
      {scene && (
        <div
          className="presentation-window-frame"
          style={{ width: `min(100vw, calc(100vh * ${w} / ${h}))`, height: `min(100vh, calc(100vw * ${h} / ${w}))` }}
        >
          <SceneCanvas scene={scene} offset={offset} fit="fill" />
        </div>
      )}
    </main>
  );
}

/**
 * "Identify" (from Screens): for a few seconds a big label says which output this is, its
 * screen and its display. In standby the window is only open for this, so it's all it shows.
 */
function Identify({ screenId }: { screenId?: string }) {
  const { data } = useLive(() => screensApi.identifyStatus(), [], ["displays"]);
  const [, tick] = useState(0);
  const [until, setUntil] = useState(0);
  useEffect(() => {
    if (!data?.remaining_ms) return;
    setUntil(Date.now() + data.remaining_ms);
    const t = window.setTimeout(() => tick((n) => n + 1), data.remaining_ms + 50);
    return () => window.clearTimeout(t);
  }, [data]);
  const me = data?.outputs.find((o) => o.screen_id === screenId);
  if (!me || Date.now() >= until) return null;
  return (
    <div className={`identify-overlay${data?.standby ? " standby" : ""}`}>
      <div className="identify-card">
        <span className="identify-number">{me.number}</span>
        <strong>{me.screen_name}</strong>
        <span>
          {me.display_name} · {me.width} × {me.height}
        </span>
        {data?.standby && <em>The server is on standby: nothing else is shown</em>}
      </div>
    </div>
  );
}

/** The screen's picture in its tile, as big as fits, keeping its shape. */
function Fitted({ scene, offset }: { scene: RenderScene; offset: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(area.w / scene.screen.width, area.h / scene.screen.height) || 0;
  return (
    <div ref={ref} className="monitor-fit">
      {scale > 0 && (
        <div className="presentation-window-frame" style={{ width: scene.screen.width * scale, height: scene.screen.height * scale }}>
          <SceneCanvas scene={scene} offset={offset} fit="fill" />
        </div>
      )}
    </div>
  );
}

/** Columns and rows that make the tiles biggest for n screens of about 16:9 in this window. */
function grid(n: number, width: number, height: number): { cols: number; rows: number } {
  let best = { cols: 1, rows: Math.max(1, n), size: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const tileW = width / cols;
    const tileH = height / rows;
    const size = Math.min(tileW, (tileH - 28) * (16 / 9));
    if (size > best.size) best = { cols, rows, size };
  }
  return best;
}

/** A monitoring display: the chosen screens' live outputs side by side, with their names. */
function MonitorView({ monitor }: { monitor: RenderScene }) {
  const ids = monitor.screen.monitor_screens ?? [];
  const { data: screens } = useLive(() => screensApi.list(), [], ["screens"]);
  const names = new Map((screens ?? []).map((s) => [s.id, s.name]));
  const { cols, rows } = grid(ids.length, window.innerWidth, window.innerHeight);
  return (
    <main className="presentation-window monitor-window" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {ids.map((id) => (
        <MonitorTile key={id} id={id} name={names.get(id) ?? "Screen"} />
      ))}
      {ids.length === 0 && <div className="monitor-empty">Choose the screens to show in Screens → {monitor.screen.name}.</div>}
    </main>
  );
}

function MonitorTile({ id, name }: { id: string; name: string }) {
  const { scene, offset } = useScene(id);
  return (
    <section className="monitor-tile">
      <div className="monitor-picture">{scene && <Fitted scene={scene} offset={offset} />}</div>
      <div className="monitor-label">{name}</div>
    </section>
  );
}
