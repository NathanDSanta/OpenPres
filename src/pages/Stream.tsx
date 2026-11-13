import { useEffect, useState } from "react";
import { MessageSquare, Radio, Save, Square } from "lucide-react";
import { audioApi, markChanged, screensApi, streamApi, useLive } from "@/api";
import { BusSelect } from "@/components/audio/Strips";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import { useScene } from "@/hooks/useScene";
import { formatDuration } from "@/lib/format";
import type { StreamSettings } from "@/types";
import "@/styles/Stream.css";

const SIZES: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [854, 480],
];

export default function Stream() {
  const { data: saved } = useLive(() => streamApi.settings());
  const { data: status } = useLive(() => streamApi.status());
  const { data: screens } = useLive(() => screensApi.list());
  const { data: audio } = useLive(() => audioApi.get());
  const [draft, setDraft] = useState<StreamSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { scene, offset } = useScene(draft?.screen_id ?? null);

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);
  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [status?.running]);

  if (!draft) return <section className="page"><div className="card empty">Loading…</div></section>;
  const set = (patch: Partial<StreamSettings>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const running = !!status?.running;

  const save = async () => {
    setError(null);
    try {
      const result = await streamApi.saveSettings(draft);
      setDraft(result);
      setNotice("Settings saved.");
      markChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const toggle = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (running) await streamApi.stop();
      else {
        if (dirty && !(await save())) return;
        await streamApi.start();
      }
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Stream</h1>
          <p>Send a virtual screen and a bus to YouTube (RTMP), and/or record it to an MP4 file. Requires ffmpeg.</p>
        </div>
        <div className="page-actions">
          {running && status?.started_at_ms && (
            <span className="badge-live">
              {status.streaming ? "LIVE" : "RECORDING"} {formatDuration(now - status.started_at_ms, "H:mm:ss")}
            </span>
          )}
          <button className="btn" disabled={!dirty || running} onClick={() => void save()}>
            <Save size={15} /> Save
          </button>
          <button className={`btn ${running ? "btn-danger" : "btn-live"}`} disabled={busy} onClick={() => void toggle()}>
            {running ? <Square size={14} /> : <Radio size={15} />}
            {running ? "Stop" : draft.send_rtmp ? "Go live" : "Start recording"}
          </button>
        </div>
      </header>
      {error && <div className="alert alert-error">{error}</div>}
      {status?.error && !running && <div className="alert alert-error">Last stream: {status.error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="stream-layout">
        <div className="stream-settings">
          <section className="card">
            <h2 className="card-title">Video</h2>
            <div className="field-row">
              <div className="field">
                <label>Virtual screen</label>
                <select className="select" value={draft.screen_id ?? ""} disabled={running} onChange={(e) => set({ screen_id: e.target.value || null })}>
                  <option value="">Choose…</option>
                  {(screens ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Resolution</label>
                <select
                  className="select"
                  disabled={running}
                  value={`${draft.width}x${draft.height}`}
                  onChange={(e) => {
                    const [width, height] = e.target.value.split("x").map(Number);
                    set({ width, height });
                  }}
                >
                  {SIZES.map(([w, h]) => (
                    <option key={w} value={`${w}x${h}`}>
                      {h}p ({w}×{h})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Frame rate</label>
                <select className="select" disabled={running} value={draft.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
                  {[24, 25, 30, 50, 60].map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Video bitrate (kbps)</label>
                <input className="input" type="number" disabled={running} value={draft.video_kbps} onChange={(e) => set({ video_kbps: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Encoder speed</label>
                <select className="select" disabled={running} value={draft.x264_preset} onChange={(e) => set({ x264_preset: e.target.value })}>
                  {["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">Audio</h2>
            <div className="field-row">
              <div className="field">
                <label>Bus</label>
                <BusSelect value={draft.bus} names={audio?.config.bus_names ?? Array.from({ length: 16 }, (_, i) => `Bus ${i + 1}`)} onChange={(bus) => set({ bus })} />
              </div>
              <div className="field">
                <label>Channels</label>
                <select className="select" disabled={running} value={draft.mono ? "mono" : "stereo"} onChange={(e) => set({ mono: e.target.value === "mono" })}>
                  <option value="stereo">Stereo</option>
                  <option value="mono">Mono</option>
                </select>
              </div>
              <div className="field">
                <label>Audio bitrate (kbps)</label>
                <input className="input" type="number" disabled={running} value={draft.audio_kbps} onChange={(e) => set({ audio_kbps: Number(e.target.value) })} />
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">YouTube</h2>
            <label className="check">
              <input type="checkbox" disabled={running} checked={draft.send_rtmp} onChange={(e) => set({ send_rtmp: e.target.checked })} />
              Stream to YouTube
            </label>
            <div className="field-row" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Server URL (RTMP)</label>
                <input className="input" disabled={running || !draft.send_rtmp} value={draft.rtmp_url} onChange={(e) => set({ rtmp_url: e.target.value })} />
              </div>
              <div className="field">
                <label>Stream key</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  disabled={running || !draft.send_rtmp}
                  value={draft.stream_key}
                  placeholder={draft.stream_key_set ? "Saved (type to replace)" : "From YouTube Studio → Go live"}
                  onFocus={(e) => e.target.value.includes("•") && set({ stream_key: "" })}
                  onBlur={() => !draft.stream_key && saved?.stream_key && set({ stream_key: saved.stream_key })}
                  onChange={(e) => set({ stream_key: e.target.value })}
                />
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">Recording</h2>
            <label className="check">
              <input type="checkbox" disabled={running} checked={draft.record} onChange={(e) => set({ record: e.target.checked })} />
              Save an MP4 while streaming
            </label>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Folder (empty = the OpenPres data folder / recordings)</label>
              <input className="input" disabled={running || !draft.record} value={draft.record_dir} onChange={(e) => set({ record_dir: e.target.value })} />
            </div>
            {status?.recording_file && <p className="muted small">Last file: {status.recording_file}</p>}
          </section>
        </div>

        <div className="stream-side">
          <section className="card">
            <h2 className="card-title">
              Preview
              {running && <span className="muted small">{status?.frames ?? 0} frames sent</span>}
            </h2>
            <div className="stream-preview">{scene ? <SceneCanvas scene={scene} offset={offset} /> : <div className="empty">Choose a screen.</div>}</div>
            <p className="muted small">
              While streaming, a small “Stream output” window renders this screen for the encoder. Keep it open (it may be covered).
            </p>
            {status && status.log.length > 0 && (
              <details className="stream-log">
                <summary>ffmpeg messages</summary>
                <pre>{status.log.join("\n")}</pre>
              </details>
            )}
          </section>
          <section className="card stream-chat-placeholder">
            <MessageSquare size={22} />
            <strong>YouTube chat</strong>
            <span>Reserved for the chat integration.</span>
          </section>
        </div>
      </div>
    </section>
  );
}
