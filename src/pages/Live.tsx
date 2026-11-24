import { useEffect, useRef, useState } from "react";
import { useBuses } from "@/hooks/useBuses";
import { MonitorPlay, Radio, Square, Volume2, VolumeX } from "lucide-react";
import { audioApi, markChanged, screensApi, streamApi, useLive, youtubeApi } from "@/api";
import { apiUrl } from "@/api/server";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import Select from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { useAutosave, saveLabel } from "@/hooks/useAutosave";
import { useScene } from "@/hooks/useScene";
import { formatDuration } from "@/lib/format";
import { notifyError } from "@/state/Dialogs";
import type { EncoderId, StreamSettings, StreamStatus } from "@/types";
import "@/styles/Live.css";

const SIZES: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [854, 480],
];

/**
 * What viewers get: the broadcast in YouTube's own player (from the link in the settings,
 * read like any viewer; a few seconds late) or the local output. The player is embedded
 * through a small page on the local server so YouTube accepts it.
 */
function Preview({ screenId, youtubeUrl }: { screenId: string | null; youtubeUrl: string }) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [source, setSource] = useState<"youtube" | "local">(youtubeUrl ? "youtube" : "local");
  // The link's video (a channel's /live page: what it broadcasts now), once typing stops.
  useEffect(() => {
    const url = youtubeUrl.trim();
    setProblem(null);
    if (!url) {
      setVideoId(null);
      return;
    }
    const timer = setTimeout(() => {
      youtubeApi
        .video(url)
        .then((v) => setVideoId(v.video_id))
        .catch((e) => {
          setVideoId(null);
          setProblem(String(e?.message ?? e).replace(/^invalid input: /, ""));
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [youtubeUrl]);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(80);
  const frame = useRef<HTMLIFrameElement>(null);
  const { scene, offset } = useScene(screenId);
  useEffect(() => {
    if (videoId) setSource("youtube");
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
        ) : source === "youtube" ? (
          <div className="empty">
            <MonitorPlay size={26} />
            {problem ?? (youtubeUrl ? "Looking for the broadcast…" : "Paste the link of your broadcast in “YouTube preview” below.")}
          </div>
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
          <button className={`btn btn-small${source === "youtube" ? " btn-active" : ""}`} onClick={() => setSource("youtube")} title="The broadcast as viewers see it on YouTube">
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
  const buses = useBuses(audio);
  const [encoders, setEncoders] = useState<Awaited<ReturnType<typeof streamApi.encoders>> | null>(null);
  const [draft, setDraft] = useState<StreamSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);
  // Which encoders work here (tried once by the backend, a few seconds the first time).
  useEffect(() => {
    void streamApi
      .encoders()
      .then(setEncoders)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [status?.running]);

  const running = !!status?.running;
  const rates = useStreamRates(running);
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

  const busOptions = buses.options(draft?.bus);

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
            {running && rates && (
              <span className="muted small" title="Frames per second sent to the stream; how many different pictures (what moves); the camera's frame rate">
                {rates.fps} fps · moving {rates.pictures} fps{rates.cameraFps !== null ? ` · camera ${rates.cameraFps} fps` : ""}
              </span>
            )}
            {status?.recording_file && running && <span className="muted small live-file">Recording to {status.recording_file}</span>}
            <span style={{ flex: 1 }} />
            <span className={`save-state${state.status === "error" ? " error" : ""}`}>{running ? "Settings are locked while live" : saveLabel(state)}</span>
            <button className={`btn ${running ? "btn-danger" : "btn-live"}`} disabled={busy} onClick={() => void toggle()}>
              {running ? <Square size={14} /> : <Radio size={15} />}
              {running ? "Stop" : draft.send_rtmp ? "Go live" : "Start recording"}
            </button>
          </div>
          {status?.error && <div className="alert alert-error">{running ? "" : "Last stream: "}{status.error}</div>}
          {running && status && rates && <StreamHealth status={status} rates={rates} />}

          <Preview screenId={draft.screen_id} youtubeUrl={draft.youtube_url ?? ""} />

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
                  <span className="muted small">
                    Sent at this constant rate. If YouTube says the bitrate is lower than recommended, use its number here (e.g. 6800 for 1080p).
                  </span>
                </div>
                <div className="field">
                  <label>Encoder</label>
                  <Select
                    value={draft.encoder ?? "auto"}
                    disabled={running}
                    options={(encoders?.encoders ?? [{ id: "auto" as EncoderId, label: "Automatic", available: true }]).map((e) => ({
                      value: e.id,
                      label:
                        e.id === "auto"
                          ? `Automatic${encoders ? ` (${encoders.automatic_label})` : ""}`
                          : e.available
                            ? e.label
                            : `${e.label} — not on this computer`,
                      disabled: !e.available,
                    }))}
                    onChange={(encoder) => set({ encoder: encoder as EncoderId })}
                  />
                  <span className="muted small">The graphics card's encoder leaves the processor free, like in OBS.</span>
                </div>
              </div>
              {usesX264(draft.encoder, encoders?.automatic) && (
                <div className="field-row">
                  <div className="field">
                    <label>x264 speed</label>
                    <Select
                      value={draft.x264_preset}
                      disabled={running}
                      options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => ({ value: p, label: p === "veryfast" ? "veryfast (recommended)" : p }))}
                      onChange={(x264_preset) => set({ x264_preset })}
                    />
                    <span className="muted small">Faster uses less of the processor, at a little less quality.</span>
                  </div>
                </div>
              )}
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
                <span>YouTube preview</span>
              </h3>
              <div className="field">
                <label>Link of the broadcast: a video, a live link or your channel's /live page</label>
                <input
                  className="input"
                  value={draft.youtube_url ?? ""}
                  placeholder="https://www.youtube.com/@yourchurch/live"
                  onChange={(e) => set({ youtube_url: e.target.value })}
                />
              </div>
              <p className="muted small">Shown in the preview above with YouTube's own player, like any viewer. No YouTube account is needed.</p>
            </section>
            <section className="panel live-card">
              <h3 className="section-title">
                <label className="toggle-inline">
                  <Toggle small disabled={running} checked={draft.record} onChange={(record) => set({ record })} />
                  <span>Record an MP4 file</span>
                </label>
              </h3>
              <div className="field">
                <label>Folder (empty = OpenPres in your Videos folder)</label>
                <input
                  className="input"
                  disabled={running || !draft.record}
                  value={draft.record_dir}
                  placeholder={draft.default_record_dir || undefined}
                  onChange={(e) => set({ record_dir: e.target.value })}
                />
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
      </div>
    </section>
  );
}

function usesX264(encoder: EncoderId | undefined, automatic: EncoderId | undefined): boolean {
  return encoder === "x264" || ((encoder ?? "auto") === "auto" && (automatic ?? "x264") === "x264");
}

interface Rates {
  /** Frames per second going out. */
  fps: number;
  /** Different pictures per second (what moves). */
  pictures: number;
  cameraFps: number | null;
  /** Of the frames in the last seconds: repeated because drawing was late, skipped by the encoder (%). */
  lagged: number;
  skipped: number;
}

/** The stream's rates over the last 2 s, while live (like OBS's statistics). */
function useStreamRates(running: boolean): Rates | null {
  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    if (!running) {
      setRates(null);
      return;
    }
    let last: { t: number; s: StreamStatus } | null = null;
    const sample = () =>
      void streamApi
        .status()
        .then((s) => {
          const now = performance.now();
          if (last && now > last.t) {
            const secs = (now - last.t) / 1000;
            const p = last.s;
            const frames = s.frames - p.frames;
            const lagged = s.lagged - p.lagged;
            const skipped = s.skipped - p.skipped;
            const all = Math.max(1, frames + skipped);
            const camera = s.camera_frames - p.camera_frames;
            setRates({
              fps: Math.round(frames / secs),
              pictures: Math.round((s.pictures - p.pictures) / secs),
              cameraFps: s.video && camera > 0 ? Math.round(camera / secs) : null,
              lagged: (100 * lagged) / all,
              skipped: (100 * skipped) / all,
            });
          }
          last = { t: now, s };
        })
        .catch(() => undefined);
    sample();
    const id = setInterval(sample, 2000);
    return () => clearInterval(id);
  }, [running]);
  return rates;
}

/** The encoder and how the stream keeps up, with what to do when it doesn't (like OBS). */
function StreamHealth({ status, rates }: { status: StreamStatus; rates: Rates }) {
  const p = status.progress;
  const slowEncoder = rates.skipped >= 2 || (p !== null && p.speed > 0 && p.speed < 0.95);
  const lateDrawing = rates.lagged >= 5;
  return (
    <>
      <div className="live-health muted small">
        <span>{status.encoder ?? "Encoder"}</span>
        {p && p.fps > 0 && (
          <span title="ffmpeg's report: frames encoded per second, speed (1.00x = real time), bitrate sent">
            {p.fps.toFixed(0)} fps · {p.speed.toFixed(2)}x · {Math.round(p.kbps).toLocaleString()} kbps
          </span>
        )}
        <span title="Frames repeated because the computer was late drawing them (OBS: rendering lag)">late {rates.lagged.toFixed(1)}%</span>
        <span title="Frames skipped because the encoder fell behind (OBS: encoding lag)">skipped {rates.skipped.toFixed(1)}%</span>
      </div>
      {slowEncoder && (
        <div className="alert alert-warning">
          The encoder can't keep up, so the stream loses frames. Use the graphics card's encoder (Encoder: Automatic or the card's), a faster x264 speed, or a lower
          resolution or frame rate.
        </div>
      )}
      {!slowEncoder && lateDrawing && (
        <div className="alert alert-warning">The computer is too busy to draw every frame. Close other programs, or lower the resolution or frame rate.</div>
      )}
    </>
  );
}
