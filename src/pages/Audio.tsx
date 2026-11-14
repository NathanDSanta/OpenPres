import { useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { audioApi, devicesApi, markChanged, useLive } from "@/api";
import { BusStrip } from "@/components/audio/BusStrip";
import BusSettings from "@/components/audio/BusSettings";
import { notifyError } from "@/state/Dialogs";
import "@/styles/Audio.css";

/**
 * The mixer: 16 stereo buses. Each bus takes one input device (plus any media player
 * routed to it) and plays on one output device; the settings button picks both.
 */
export default function Audio() {
  const { data: view, setData } = useLive(() => audioApi.get());
  const { data: devices, reload: reloadDevices } = useLive(() => devicesApi.listAudio());
  const [editing, setEditing] = useState<number | null>(null);

  if (!view) return <section className="page audio-page" />;

  return (
    <section className="page audio-page">
      <div className="audio-toolbar">
        <span className="muted small">
          Audio system: <b>{view.status.host || "…"}</b>
          {view.status.open_devices.length > 0 && ` · ${view.status.open_devices.length} device${view.status.open_devices.length === 1 ? "" : "s"} in use`}
        </span>
        <div className="page-actions">
          <button
            className="btn btn-small"
            onClick={() =>
              void devicesApi
                .refresh()
                .then(() => reloadDevices())
                .catch(notifyError)
            }
          >
            <RefreshCw size={14} /> Refresh devices
          </button>
          <button
            className="btn btn-small"
            onClick={() =>
              void audioApi
                .restart()
                .then((v) => {
                  setData(v);
                  markChanged();
                })
                .catch(notifyError)
            }
            title="Close and reopen every audio device"
          >
            <RotateCcw size={14} /> Restart audio
          </button>
        </div>
      </div>
      <div className="audio-strips">
        {view.config.buses.map((_, i) => (
          <BusStrip key={i} number={i + 1} view={view} devices={devices} onChange={setData} onSettings={() => setEditing(i + 1)} />
        ))}
      </div>
      {editing !== null && <BusSettings number={editing} view={view} onChange={setData} onClose={() => setEditing(null)} />}
    </section>
  );
}
