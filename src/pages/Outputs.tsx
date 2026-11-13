import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { audioApi, devicesApi, markChanged, useLive } from "@/api";
import { BusSelect, OutputStripView } from "@/components/audio/Strips";
import type { AudioView, ChannelMode, OutputStrip } from "@/types";
import "@/styles/Inputs.css";

export default function Outputs() {
  const { data: devices } = useLive(() => devicesApi.listAudio());
  const { data: fetched } = useLive(() => audioApi.get());
  const [view, setView] = useState<AudioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", device_id: "", mode: "stereo" as ChannelMode, first: 0, bus: 1 });
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (fetched) {
      setView(fetched);
      setNames(fetched.config.bus_names);
    }
  }, [fetched]);

  const outputDevices = (devices ?? []).filter((d) => d.output_channels > 0);
  const device = outputDevices.find((d) => d.id === draft.device_id) ?? outputDevices[0];
  const maxFirst = device ? device.output_channels - (draft.mode === "stereo" ? 2 : 1) : 0;

  const add = async () => {
    if (!device) return;
    setError(null);
    const first = Math.min(draft.first, Math.max(0, maxFirst));
    const channels = draft.mode === "stereo" ? [first, first + 1] : [first];
    const output: Omit<OutputStrip, "id"> = {
      name: draft.name.trim() || `${device.name} ${channels.map((c) => c + 1).join("+")}`,
      device_id: device.id,
      mode: draft.mode,
      channels,
      bus: draft.bus,
      volume_db: 0,
      muted: false,
    };
    try {
      setView(await audioApi.addOutput(output));
      setDraft((d) => ({ ...d, name: "" }));
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (strip: OutputStrip) => {
    if (!confirm(`Remove the output “${strip.name}”?`)) return;
    setView(await audioApi.removeStrip(strip.id));
    markChanged();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Outputs</h1>
          <p>Send a bus to a device. Each output is independent, so an input can go to one device while something else plays on another.</p>
        </div>
      </header>
      {error && <div className="alert alert-error">{error}</div>}
      {!view ? (
        <div className="card empty">Loading…</div>
      ) : (
        <div className="inputs-columns">
          <section className="card inputs-column">
            <h2 className="card-title">Outputs</h2>
            {view.config.outputs.length === 0 && <div className="empty">No outputs yet. Add one on the right.</div>}
            <div className="audio-strips">
              {view.config.outputs.map((strip) => (
                <OutputStripView key={strip.id} strip={strip} view={view} onChange={setView} onRemove={() => void remove(strip)} />
              ))}
            </div>
          </section>
          <div className="inputs-column">
            <section className="card">
              <h2 className="card-title">New output</h2>
              {outputDevices.length === 0 ? (
                <div className="empty">No audio output devices found.</div>
              ) : (
                <div className="input-add-form" style={{ border: 0, padding: 0, background: "transparent" }}>
                  <div className="field">
                    <label>Name</label>
                    <input className="input" value={draft.name} placeholder="e.g. Stream mix, Lobby speakers" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Device</label>
                    <select className="select" value={device?.id ?? ""} onChange={(e) => setDraft({ ...draft, device_id: e.target.value, first: 0 })}>
                      {outputDevices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.output_channels} ch)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Type</label>
                      <select className="select" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as ChannelMode, first: 0 })}>
                        <option value="stereo">Stereo</option>
                        <option value="mono">Mono</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Channels</label>
                      <select className="select" value={Math.min(draft.first, Math.max(0, maxFirst))} onChange={(e) => setDraft({ ...draft, first: Number(e.target.value) })}>
                        {Array.from({ length: Math.max(0, maxFirst + 1) }, (_, i) => i)
                          .filter((i) => draft.mode === "mono" || i % 2 === 0)
                          .map((i) => (
                            <option key={i} value={i}>
                              {draft.mode === "stereo" ? `${i + 1} + ${i + 2}` : i + 1}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Plays bus</label>
                      <BusSelect value={draft.bus} names={view.config.bus_names} onChange={(bus) => setDraft({ ...draft, bus })} />
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => void add()}>
                    <Plus size={14} /> Add output
                  </button>
                </div>
              )}
            </section>
            <section className="card">
              <h2 className="card-title">
                Bus names
                <button
                  className="btn btn-small"
                  disabled={JSON.stringify(names) === JSON.stringify(view.config.bus_names)}
                  onClick={() => void audioApi.setBusNames(names).then((v) => (setView(v), markChanged()))}
                >
                  Save names
                </button>
              </h2>
              <div className="bus-names">
                {names.map((name, i) => (
                  <label key={i} className="bus-name">
                    <span>{i + 1}</span>
                    <input className="input" value={name} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
                  </label>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
