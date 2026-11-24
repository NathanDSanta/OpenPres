import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Expand, Headphones, Loader2, LogIn, Monitor, Volume2, VolumeX } from "lucide-react";
import { apiGet } from "@/api/client";
import { useLive } from "@/api/events";
import { screensApi } from "@/api/screens";
import { systemApi } from "@/api/system";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import Select from "@/components/ui/Select";
import { useMediaIndex } from "@/hooks/useMediaIndex";
import { useScene } from "@/hooks/useScene";
import { BusListener } from "@/lib/busListener";
import type { AuthStatus } from "@/types";
import "@/styles/PresentationWindow.css";
import "@/styles/Viewer.css";

const SCREEN_KEY = "openpres.viewer.screen";
const BUS_KEY = "openpres.viewer.bus";
const VOLUME_KEY = "openpres.viewer.volume";

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private browsing */
  }
};

interface ViewerInfo {
  buses: { n: number; name: string }[];
}

/**
 * For viewers (the OpenPres Android app, or this page in a browser): one screen, as big as it
 * fits, and a bus to listen to. The admin lets viewers in (Settings → Server & security), with a
 * password of their own or none.
 */
export default function Viewer() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(() => {
    systemApi
      .authStatus()
      .then((s) => {
        setStatus(s);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(check, [check]);

  if (!status)
    return (
      <main className="viewer-message">
        {error ? (
          <>
            <p>Can't reach the OpenPres server: {error}</p>
            <button className="btn" onClick={check}>
              Try again
            </button>
          </>
        ) : (
          <Loader2 className="spin" size={22} />
        )}
      </main>
    );
  const allowed = status.access === "viewer" || status.authenticated;
  if (!allowed && !status.viewers)
    return (
      <main className="viewer-message">
        <Monitor size={28} />
        <p>This server doesn't let viewers watch yet.</p>
        <p className="muted small">The admin turns it on in Settings → Server &amp; security → Viewers.</p>
        <button className="btn" onClick={check}>
          Try again
        </button>
      </main>
    );
  if (!allowed) return <ViewerLogin onDone={check} />;
  return <ViewerScreen />;
}

function ViewerLogin({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await systemApi.login(password, "viewer");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="viewer-message">
      <form className="viewer-login" onSubmit={(e) => void submit(e)}>
        <Monitor size={28} />
        <p>Viewer password</p>
        <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set by the admin" />
        {error && <span className="error-text small">{error}</span>}
        <button className="btn btn-primary" disabled={busy || !password}>
          <LogIn size={14} /> Watch
        </button>
      </form>
    </main>
  );
}

function ViewerScreen() {
  useMediaIndex();
  const { data: screens } = useLive(() => screensApi.list(), [], ["screens"]);
  const { data: info } = useLive(() => apiGet<ViewerInfo>("/viewer"), [], ["audio"]);
  const shown = (screens ?? []).filter((s) => s.kind !== "monitor");
  const [chosen, setChosen] = useState<string | null>(() => remembered(SCREEN_KEY));
  const screenId = shown.some((s) => s.id === chosen) ? chosen : (shown[0]?.id ?? null);
  const { scene, offset } = useScene(screenId);

  const listener = useRef<BusListener | null>(null);
  const [bus, setBus] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [soundError, setSoundError] = useState("");
  const [volume, setVolume] = useState(() => Number(remembered(VOLUME_KEY) ?? 1));
  const [controls, setControls] = useState(true);
  const hide = useRef<number | undefined>(undefined);

  const listen = (n: number | null) => {
    listener.current ??= new BusListener();
    const l = listener.current;
    l.onState = (playing, error) => {
      setListening(playing);
      setSoundError(error);
    };
    l.setVolume(volume);
    setBus(n);
    remember(BUS_KEY, n === null ? null : String(n));
    if (n === null) l.stop();
    else void l.start(n);
  };
  useEffect(() => () => listener.current?.stop(), []);

  // The controls show on a tap and hide after a few seconds.
  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setControls(false), 4000);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hide.current);
  }, [poke]);

  // The screen stays on while watching.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wake = () => {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (document.visibilityState === "visible") void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    wake();
    document.addEventListener("visibilitychange", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const w = scene?.screen.width ?? 16;
  const h = scene?.screen.height ?? 9;
  const savedBus = Number(remembered(BUS_KEY)) || null;
  const buses = info?.buses ?? [];
  return (
    <main className={`presentation-window viewer${controls ? " controls" : ""}`} onPointerDown={poke}>
      {scene && (
        <div className="presentation-window-frame" style={{ width: `min(100vw, calc(100vh * ${w} / ${h}))`, height: `min(100vh, calc(100vw * ${h} / ${w}))` }}>
          <SceneCanvas scene={scene} offset={offset} fit="fill" />
        </div>
      )}
      {screens && !shown.length && <div className="viewer-message">No screens yet.</div>}
      <div className="viewer-bar" onPointerDown={(e) => e.stopPropagation()} onClick={poke}>
        <Monitor size={15} />
        <Select
          value={screenId}
          options={shown.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(id) => {
            setChosen(id);
            remember(SCREEN_KEY, id);
          }}
          placeholder="Screen"
          className="viewer-select"
        />
        <Headphones size={15} />
        <Select
          value={bus === null ? "off" : String(bus)}
          options={[{ value: "off", label: savedBus && bus === null ? `Off (tap to hear ${buses.find((b) => b.n === savedBus)?.name || `bus ${savedBus}`})` : "No sound" }, ...buses.map((b) => ({ value: String(b.n), label: b.name || `Bus ${b.n}`, hint: b.name && b.name !== `Bus ${b.n}` ? `bus ${b.n}` : undefined }))]}
          onChange={(v) => listen(v === "off" ? null : Number(v))}
          className="viewer-select"
        />
        {bus !== null && (
          <>
            <button className="icon-btn" onClick={() => listen(listening ? null : bus)} title={listening ? "Stop listening" : "Listen"}>
              {listening ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <input
              className="viewer-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                listener.current?.setVolume(v);
                remember(VOLUME_KEY, String(v));
              }}
            />
          </>
        )}
        {soundError && <span className="error-text small">Sound: {soundError}</span>}
        {document.fullscreenEnabled && (
          <button className="icon-btn viewer-full" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)} title="Full screen">
            <Expand size={15} />
          </button>
        )}
      </div>
    </main>
  );
}
