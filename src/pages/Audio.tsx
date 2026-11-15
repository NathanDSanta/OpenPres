import { useState } from "react";
import { Plus, RefreshCw, RotateCcw } from "lucide-react";
import { audioApi, devicesApi, markChanged, useLive } from "@/api";
import { BusStrip } from "@/components/audio/BusStrip";
import BusSettings from "@/components/audio/BusSettings";
import { defaultBus, isUnusedBus, MAX_BUSES, useBuses } from "@/hooks/useBuses";
import { notifyError, useDialogs } from "@/state/Dialogs";
import "@/styles/Audio.css";

/**
 * The mixer: up to 16 stereo buses, added and removed as needed. Each bus takes one input
 * device (plus any media player routed to it) and plays on one output device; the settings
 * button picks both.
 */
export default function Audio() {
  const { data: view, setData } = useLive(() => audioApi.get());
  const { data: devices, reload: reloadDevices } = useLive(() => devicesApi.listAudio());
  const [editing, setEditing] = useState<number | null>(null);
  const { confirm } = useDialogs();
  const buses = useBuses(view);

  const removeBus = async (n: number) => {
    if (!view) return;
    const bus = view.config.buses[n - 1];
    if (bus && !isUnusedBus(bus, n)) {
      const ok = await confirm({
        title: `Remove “${bus.name}”?`,
        message: "Its devices are disconnected and its settings reset. Media and streams routed to it go silent until you choose another bus.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      try {
        setData(await audioApi.updateBus(n, defaultBus(n)));
        markChanged();
      } catch (err) {
        notifyError(err);
        return;
      }
    }
    await buses.remove(n);
  };

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
        {buses.shown.map((n) => (
          <BusStrip
            key={n}
            number={n}
            view={view}
            devices={devices}
            onChange={setData}
            onSettings={() => setEditing(n)}
            onRemove={() => void removeBus(n)}
          />
        ))}
        {buses.shown.length < MAX_BUSES && (
          <button
            className="bus-add"
            onClick={() => {
              const n = buses.add();
              if (n !== null) setEditing(n);
            }}
            title={`Add a bus (up to ${MAX_BUSES})`}
          >
            <Plus size={18} />
            Add bus
          </button>
        )}
      </div>
      {editing !== null && <BusSettings number={editing} view={view} onChange={setData} onClose={() => setEditing(null)} />}
    </section>
  );
}
