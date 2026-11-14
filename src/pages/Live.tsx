import { useEffect, useRef, useState } from "react";
import { KeyRound, MonitorPlay, Radio, Square, Volume2, VolumeX } from "lucide-react";
import { audioApi, markChanged, screensApi, streamApi, useLive, youtubeApi } from "@/api";
import { apiUrl } from "@/api/server";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import YoutubeChat from "@/components/live/YoutubeChat";
import Select from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { useAutosave, saveLabel } from "@/hooks/useAutosave";
import { useScene } from "@/hooks/useScene";
import { formatDuration } from "@/lib/format";
import { notify, notifyError } from "@/state/Dialogs";
import type { StreamSettings } from "@/types";
import "@/styles/Live.css";

const SIZES: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [854, 480],
];

/**
 * What viewers get: YouTube's own player (the stream as YouTube receives it, a few
 * seconds late) or the local output. The YouTube player is embedded through a small
 * page on the local server so YouTube accepts it.
 */
function Preview({ screenId, videoId }: { screenId: string | null; videoId: string | null }) {
  const [source, setSource] = useState<"youtube" | "local">(videoId ? "youtube" : "local");
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(80);
  const frame = useRef<HTMLIFrameElement>(null);
  const { scene, offset } = useScene(screenId);
  useEffect(() => {
    if (!videoId) setSource("local");
  }, [videoId]);
  const command = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage({ func, args }, "*");
  return (
    <div className="panel live-preview">
      <div className="live-preview-frame">
        {source === "youtube" && videoId ? (
          <iframe
            ref={frame}
            title="YouTube preview"
            src={apiUrl("/youtube/embed", { v: videoId })}
            allow="autoplay; encrypted-media"
            onLoad={() => {
              command(muted ? "mute" : "unMute");
              command("setVolume", [volume]);
            }}
          />
        ) : scene ? (
          <SceneCanvas scene={scene} offset={offset} />
        ) : (
          <div className="empty">
            <MonitorPlay size={26} />
            Choose the screen to stream below.
          </div>
        )}
      </div>
      <div className="live-preview-bar">
        <div className="btn-group">
          <button className={`btn btn-small${source === "youtube" ? " btn-active" : ""}`} disabled={!videoId} onClick={() => setSource("youtube")} title={videoId ? "What YouTube receives" : "Connect YouTube and schedule a broadcast"}>
            YouTube
          </button>
          <button className={`btn btn-small${source === "local" ? " btn-active" : ""}`} onClick={() => setSource("local")}>
            Local output
          </button>
        </div>
        {source === "youtube" && videoId && (
          <div className="live-volume">
            <button
              className="icon-btn"
              onClick={() => {
                setMuted(!muted);
                command(muted ? "unMute" : "mute");
              }}
              title={muted ? "Unmute the preview" : "Mute the preview"}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                command("setVolume", [Number(e.target.value)]);
              }}
            />
            <span className="muted small">plays on the system output</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Live() {
  const { data: saved } = useLive(() => streamApi.settings());
  const { data: status } = useLive(() => streamApi.status());
  const { data: screens } = useLive(() => screensApi.list());
  const { data: audio } = useLive(() => audioApi.get());
  const { data: yt } = useLive(() => youtubeApi.status());
  const [draft, setDraft] = useState<StreamSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);
  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [status?.running]);

  const running = !!status?.running;
  const state = useAutosave("stream", running ? null : draft, async (d) => {
    const result = await streamApi.saveSettings(d);
    setDraft((cur) => (cur && cur.stream_key === d.stream_key ? { ...cur, stream_key: result.stream_key, stream_key_set: result.stream_key_set } : cur));
    markChanged();
  });

  if (!draft) return <section className="page live-page" />;
  const set = (patch: Partial<StreamSettings>) => setDraft({ ...draft, ...patch });

  const toggle = async () => {
    setBusy(true);
    try {
      if (running) await streamApi.stop();
      else {
        await streamApi.saveSettings(draft);
        await streamApi.start();
      }
      markChanged();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const useYoutubeKey = async () => {
    try {
      await youtubeApi.useStreamKey();
      const fresh = await streamApi.settings();
      setDraft(fresh);
      notify("The stream key of your YouTube broadcast is set.", "ok");
    } catch (e) {
      notifyError(e);
    }
  };

  const busOptions = (audio?.config.buses ?? Array.from({ length: 16 }, (_, i) => ({ name: `Bus ${i + 1}` }))).map((b, i) => ({ value: String(i + 1), label: `${i + 1}. ${b.name}` }));

  return (
    <section className="page live-page">
      <div className="live-layout">
        <div className="live-main">
          <div className="live-status-bar">
            {running && status?.started_at_ms ? (
              <span className="badge-live">
                {status.streaming ? "LIVE" : "RECORDING"} {formatDuration(now - status.started_at_ms, "H:mm:ss")}
              </span>
            ) : (
              <span className="muted small">Off air</span>
            )}
            {running && <span className="muted small">{status?.frames ?? 0} frames sent</span>}
            {status?.recording_file && running && <span className="muted small live-file">Recording to {status.recording_file}</span>}
            <span style={{ flex: 1 }} />
            <span className={`save-state${state.status === "error" ? " error" : ""}`}>{running ? "Settings are locked while live" : saveLabel(state)}</span>
            <button className={`btn ${running ? "btn-danger" : "btn-live"}`} disabled={busy} onClick={() => void toggle()}>
              {running ? <Square size={14} /> : <Radio size={15} />}
              {running ? "Stop" : draft.send_rtmp ? "Go live" : "Start recording"}
            </button>
          </div>
          {status?.error && <div className="alert alert-error">{running ? "" : "Last stream: "}{status.error}</div>}

          <Preview screenId={draft.screen_id} videoId={yt?.broadcast?.id ?? null} />

          <div className="live-settings">
            <section className="panel live-card">
              <h3 className="section-title">
                <span>Video</span>
              </h3>
              <div className="field-row">
                <div className="field">
                  <label>Virtual screen</label>
                  <Select value={draft.screen_id ?? ""} disabled={running} placeholder="Choose…" options={(screens ?? []).map((s) => ({ value: s.id, label: s.name }))} onChange={(screen_id) => set({ screen_id })} />
                </div>
                <div className="field">
                  <label>Resolution</label>
                  <Select
                    value={`${draft.width}x${draft.height}`}
                    disabled={running}
                    options={SIZES.map(([w, h]) => ({ value: `${w}x${h}`, label: `${h}p (${w} × ${h})` }))}
                    onChange={(v) => {
                      const [width, height] = v.split("x").map(Number);
                      set({ width, height });
                    }}
                  />
                </div>
                <div className="field">
                  <label>Frame rate</label>
                  <Select value={String(draft.fps)} disabled={running} options={[24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} fps` }))} onChange={(v) => set({ fps: Number(v) })} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Video bitrate (kbps)</label>
                  <input className="input" type="number" disabled={running} value={draft.video_kbps} onChange={(e) => set({ video_kbps: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Encoder speed</label>
                  <Select
                    value={draft.x264_preset}
                    disabled={running}
                    options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => ({ value: p, label: p === "veryfast" ? "veryfast (recommended)" : p }))}
                    onChange={(x264_preset) => set({ x264_preset })}
                  />
                </div>
              </div>
            </section>
            <section className="panel live-card">
              <h3 className="section-title">
                <span>Audio</span>
              </h3>
              <div className="field-row">
                <div className="field">
                  <label>Bus</label>
                  <Select value={String(draft.bus)} disabled={running} options={busOptions} onChange={(v) => set({ bus: Number(v) })} />
                </div>
                <div className="field">
                  <label>Channels</label>
                  <Select
                    value={draft.mono ? "mono" : "stereo"}
                    disabled={running}
                    options={[
                      { value: "stereo", label: "Stereo" },
                      { value: "mono", label: "Mono" },
                    ]}
                    onChange={(v) => set({ mono: v === "mono" })}
                  />
                </div>
                <div className="field">
                  <label>Bitrate (kbps)</label>
                  <input className="input" type="number" disabled={running} value={draft.audio_kbps} onChange={(e) => set({ audio_kbps: Number(e.target.value) })} />
                </div>
              </div>
            </section>
            <section className="panel live-card">
              <h3 className="section-title">
                <label className="toggle-inline">
                  <Toggle small disabled={running} checked={draft.send_rtmp} onChange={(send_rtmp) => set({ send_rtmp })} />
                  <span>Stream to YouTube</span>
                </label>
                {yt?.connected && (
                  <button className="btn btn-small" disabled={running} onClick={() => void useYoutubeKey()} title="Use the stream key of your scheduled or live broadcast">
                    <KeyRound size={13} /> Use my broadcast's key
                  </button>
                )}
              </h3>
              <div className="field-row">
                <div className="field">
                  <label>Server (RTMP)</label>
                  <input className="input" disabled={running || !draft.send_rtmp} value={draft.rtmp_url} onChange={(e) => set({ rtmp_url: e.target.value })} />
                </div>
                <div className="field">
                  <label>Stream key</label>
                  <input
                    className="input"
                    type="password"
                    disabled={running || !draft.send_rtmp}
                    value={draft.stream_key}
                    placeholder="From YouTube Studio"
                    onFocus={(e) => e.target.value.includes("•") && set({ stream_key: "" })}
                    onBlur={() => !draft.stream_key && saved?.stream_key && set({ stream_key: saved.stream_key })}
                    onChange={(e) => set({ stream_key: e.target.value })}
                  />
                </div>
              </div>
            </section>
            <section className="panel live-card">
              <h3 className="section-title">
                <label className="toggle-inline">
                  <Toggle small disabled={running} checked={draft.record} onChange={(record) => set({ record })} />
                  <span>Record an MP4 file</span>
                </label>
              </h3>
              <div className="field">
                <label>Folder (empty = the OpenPres data folder / recordings)</label>
                <input className="input" disabled={running || !draft.record} value={draft.record_dir} onChange={(e) => set({ record_dir: e.target.value })} />
              </div>
            </section>
            {status?.log && status.log.length > 0 && (
              <section className="panel live-card live-log">
                <h3 className="section-title">
                  <span>ffmpeg messages</span>
                </h3>
                <pre>{status.log.slice(-12).join("\n")}</pre>
              </section>
            )}
          </div>
        </div>
        <YoutubeChat />
      </div>
    </section>
  );
}
