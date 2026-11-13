import { useEffect, useState } from "react";
import { Camera, CameraOff, Plus, RefreshCw, Trash2, Video, X } from "lucide-react";
import { audioApi, cameraMjpegUrl, devicesApi, liveApi, markChanged, useLive } from "@/api";
import { BusSelect, InputStripView } from "@/components/audio/Strips";
import type { AudioDevice, AudioView, ChannelMode, InputStrip } from "@/types";
import "@/styles/Inputs.css";

function AddInputForm({ device, view, onDone }: { device: AudioDevice; view: AudioView; onDone: (v: AudioView) => void }) {
  const [mode, setMode] = useState<ChannelMode>(device.input_channels >= 2 ? "stereo" : "mono");
  const [first, setFirst] = useState(0);
  const [bus, setBus] = useState(1);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const channels = mode === "stereo" ? [first, first + 1] : [first];
  const maxFirst = device.input_channels - (mode === "stereo" ? 2 : 1);
  const add = async () => {
    try {
      const strip: Omit<InputStrip, "id"> = {
        name: name.trim() || `${device.name} ${channels.map((c) => c + 1).join("+")}`,
        device_id: device.id,
        mode,
        channels,
        bus,
        fader_db: 0,
        gain_db: 0,
        muted: false,
      };
      onDone(await audioApi.addInput(strip));
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="input-add-form">
      <div className="field-row">
        <div className="field">
          <label>Name</label>
          <input className="input" value={name} placeholder="e.g. Pastor mic" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Type</label>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as ChannelMode)}>
            <option value="mono">Mono (1 channel)</option>
            {device.input_channels >= 2 && <option value="stereo">Stereo (channel pair)</option>}
          </select>
        </div>
        <div className="field">
          <label>{mode === "stereo" ? "Channels" : "Channel"}</label>
          <select className="select" value={Math.min(first, maxFirst)} onChange={(e) => setFirst(Number(e.target.value))}>
            {Array.from({ length: Math.max(0, maxFirst + 1) }, (_, i) => i)
              .filter((i) => mode === "mono" || i % 2 === 0)
              .map((i) => (
                <option key={i} value={i}>
                  {mode === "stereo" ? `${i + 1} + ${i + 2}` : i + 1}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label>Bus</label>
          <BusSelect value={bus} names={view.config.bus_names} onChange={setBus} />
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="page-actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary btn-small" onClick={() => void add()}>
          <Plus size={14} /> Add input
        </button>
      </div>
    </div>
  );
}

export default function Inputs() {
  const { data: video, reload: reloadVideo } = useLive(() => devicesApi.listVideo());
  const { data: audioDevices, reload: reloadAudio } = useLive(() => devicesApi.listAudio());
  const { data: liveState } = useLive(() => liveApi.get());
  const { data: fetched } = useLive(() => audioApi.get());
  const [view, setView] = useState<AudioView | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (fetched) setView(fetched);
  }, [fetched]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await devicesApi.refresh();
      if (result.warnings.length) setError(result.warnings.join(" · "));
      reloadVideo();
      reloadAudio();
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async (strip: InputStrip) => {
    if (!confirm(`Remove the input “${strip.name}”?`)) return;
    setView(await audioApi.removeStrip(strip.id));
    markChanged();
  };

  const inputDevices = (audioDevices ?? []).filter((d) => d.input_channels > 0);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Inputs</h1>
          <p>Cameras and capture cards for the video layer; audio inputs routed to the 16 buses.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => void audioApi.restart().then(setView)} title="Reopen every audio device">
            Restart audio
          </button>
          <button className="btn" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh devices
          </button>
        </div>
      </header>
      {error && <div className="alert alert-info">{error}</div>}

      <div className="inputs-columns">
        <section className="card inputs-column">
          <h2 className="card-title">Video inputs</h2>
          {(video ?? []).length === 0 && <div className="empty">No cameras or capture cards found.</div>}
          <div className="list">
            {(video ?? []).map((device) => {
              const isLive = liveState?.video_input === device.id;
              return (
                <div key={device.id} className="video-input">
                  <div className="video-input-row">
                    <Video size={16} />
                    <span className="grow">{device.name}</span>
                    {isLive && <span className="badge-live">On video layer</span>}
                  </div>
                  {preview === device.id && (
                    <img className="video-preview" src={cameraMjpegUrl(device.id)} alt={`${device.name} preview`} />
                  )}
                  <div className="page-actions">
                    <button className="btn btn-small" onClick={() => setPreview(preview === device.id ? null : device.id)}>
                      {preview === device.id ? <CameraOff size={14} /> : <Camera size={14} />}
                      {preview === device.id ? "Hide preview" : "Preview"}
                    </button>
                    {isLive ? (
                      <button className="btn btn-small btn-danger" onClick={() => void liveApi.setVideoInput(null).then(markChanged)}>
                        <X size={14} /> Clear video layer
                      </button>
                    ) : (
                      <button className="btn btn-small btn-primary" onClick={() => void liveApi.setVideoInput(device.id).then(markChanged)}>
                        Show on video layer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted small">
            Which screens show the video input layer is set per screen in Screens → Layers.
          </p>
        </section>

        <section className="card inputs-column">
          <h2 className="card-title">Audio inputs</h2>
          {!view ? (
            <div className="empty">Loading…</div>
          ) : (
            <>
              {inputDevices.length === 0 && <div className="empty">No audio input devices found.</div>}
              {inputDevices.map((device) => {
                const strips = view.config.inputs.filter((s) => s.device_id === device.id);
                return (
                  <div key={device.id} className="audio-device">
                    <div className="audio-device-head">
                      <strong>{device.name}</strong>
                      <span className="muted small">{device.input_channels} channels</span>
                      <button className="btn btn-small" onClick={() => setAdding(adding === device.id ? null : device.id)}>
                        <Plus size={14} /> Use input
                      </button>
                    </div>
                    {adding === device.id && (
                      <AddInputForm
                        device={device}
                        view={view}
                        onDone={(v) => {
                          setView(v);
                          setAdding(null);
                        }}
                      />
                    )}
                    <div className="audio-strips">
                      {strips.map((strip) => (
                        <div key={strip.id} className="audio-strip-wrap">
                          <InputStripView strip={strip} view={view} onChange={setView} />
                          <button className="btn btn-icon btn-small audio-strip-remove" onClick={() => void remove(strip)} title="Remove input">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {view.config.inputs
                .filter((s) => !inputDevices.some((d) => d.id === s.device_id))
                .map((strip) => (
                  <div key={strip.id} className="audio-strip-wrap">
                    <InputStripView strip={strip} view={view} onChange={setView} />
                    <button className="btn btn-icon btn-small audio-strip-remove" onClick={() => void remove(strip)} title="Remove input">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
