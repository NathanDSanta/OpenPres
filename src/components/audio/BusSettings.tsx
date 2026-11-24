import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Plus, RefreshCw, Trash2 } from "lucide-react";
import { audioApi, devicesApi, markTopicsChanged } from "@/api";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { Fader, Knob, Meter } from "@/components/ui/audio";
import { useAutosave, saveLabel } from "@/hooks/useAutosave";
import { useMeters } from "@/hooks/useMeters";
import { notifyError } from "@/state/Dialogs";
import type { AudioDevice, AudioView, BusConfig, ChannelMode, DeviceTap } from "@/types";

function channelOptions(count: number, mode: ChannelMode) {
  const out: { value: string; label: string }[] = [];
  if (mode === "mono") {
    for (let c = 0; c < count; c++) out.push({ value: String(c), label: `Channel ${c + 1}` });
  } else {
    for (let c = 0; c + 1 < count; c += 1) out.push({ value: `${c},${c + 1}`, label: `Channels ${c + 1} + ${c + 2}` });
  }
  return out;
}

/** Device, mono/stereo and channel(s) of one side of a bus. */
function TapEditor({
  side,
  title,
  tap,
  devices,
  error,
  onChange,
  onRemove,
}: {
  side: "input" | "output";
  title?: string;
  tap: DeviceTap | null;
  devices: AudioDevice[];
  error?: string;
  onChange: (tap: DeviceTap | null) => void;
  onRemove?: () => void;
}) {
  const usable = devices.filter((d) => (side === "input" ? d.input_channels : d.output_channels) > 0);
  const device = usable.find((d) => d.id === tap?.device_id);
  const count = device ? (side === "input" ? device.input_channels : device.output_channels) : 2;
  const missing = tap && !device;
  return (
    <div className="bus-side">
      <h3 className="section-title">
        <span>
          {side === "input" ? <ArrowDownToLine size={13} /> : <ArrowUpFromLine size={13} />} {title ?? (side === "input" ? "Input" : "Output")}
        </span>
        {onRemove && (
          <button className="icon-btn" onClick={onRemove} title="Remove this output">
            <Trash2 size={13} />
          </button>
        )}
      </h3>
      <div className="field">
        <label>Device</label>
        <Select
          value={tap?.device_id ?? ""}
          placeholder="None"
          options={[
            { value: "", label: "None" },
            ...(missing ? [{ value: tap!.device_id, label: `${tap!.device_id.replace(/^cpal:/, "")} (not connected)` }] : []),
            ...usable.map((d) => ({
              value: d.id,
              label: d.name,
              hint: `${side === "input" ? d.input_channels : d.output_channels} ch`,
            })),
          ]}
          onChange={(id) => {
            if (!id) return onChange(null);
            const d = usable.find((x) => x.id === id);
            const n = d ? (side === "input" ? d.input_channels : d.output_channels) : 2;
            const mode: ChannelMode = n >= 2 ? "stereo" : "mono";
            onChange({ device_id: id, mode, channels: mode === "stereo" ? [0, 1] : [0] });
          }}
        />
      </div>
      {tap && (
        <div className="field-row">
          <div className="field">
            <label>Mode</label>
            <Select
              value={tap.mode}
              options={[
                { value: "mono", label: "Mono" },
                { value: "stereo", label: "Stereo", disabled: count < 2 },
              ]}
              onChange={(mode) =>
                onChange({ ...tap, mode, channels: mode === "stereo" ? [tap.channels[0] ?? 0, (tap.channels[0] ?? 0) + 1].map((c) => Math.min(c, count - 1)) : [tap.channels[0] ?? 0] })
              }
            />
          </div>
          <div className="field">
            <label>{tap.mode === "stereo" ? "Channels" : "Channel"}</label>
            <Select
              value={tap.channels.join(",")}
              options={channelOptions(count, tap.mode)}
              onChange={(v) => onChange({ ...tap, channels: v.split(",").map(Number) })}
            />
          </div>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {!tap && <p className="muted small">{side === "input" ? "Media players routed to this bus still play on it." : "Nothing plays this bus on a device (the stream can still use it)."}</p>}
    </div>
  );
}

/** The settings of one bus: name, input device on the left, output device on the right. */
export default function BusSettings({ number, view, onClose, onChange }: { number: number; view: AudioView; onClose: () => void; onChange: (v: AudioView) => void }) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [bus, setBus] = useState<BusConfig>(view.config.buses[number - 1]);
  const meters = useMeters();
  const loadDevices = () => devicesApi.listAudio().then(setDevices).catch(notifyError);
  useEffect(() => {
    void loadDevices();
  }, []);

  const state = useAutosave(number, bus, async (b) => {
    const next = await audioApi.updateBus(number, b);
    onChange(next);
    markTopicsChanged(["audio"]);
  });

  return (
    <Modal
      title={`Bus ${number}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className={`save-state${state.status === "error" ? " error" : ""}`}>{saveLabel(state)}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => void devicesApi.refresh().then(() => loadDevices())}>
            <RefreshCw size={14} /> Refresh devices
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="bus-settings">
        <div className="field bus-settings-name">
          <label>Name</label>
          <input className="input" value={bus.name} maxLength={40} onChange={(e) => setBus({ ...bus, name: e.target.value })} />
        </div>
        <div className="bus-settings-sides">
          <div className="bus-settings-col">
            <TapEditor side="input" tap={bus.input} devices={devices} error={view.status.input_errors[String(number)]} onChange={(input) => setBus({ ...bus, input })} />
            <div className="bus-settings-level">
              <Knob value={bus.gain_db} min={-20} max={40} label="Gain" onChange={(gain_db) => setBus((b) => ({ ...b, gain_db }))} />
              <div className="bus-settings-meter">
                <span className="muted small">Input level</span>
                <Meter levels={meters.inputs[number - 1]} vertical={false} length={220} />
              </div>
            </div>
          </div>
          <div className="bus-settings-col">
            {(bus.outputs.length ? bus.outputs : [null]).map((tap, k) => (
              <TapEditor
                key={k}
                side="output"
                title={bus.outputs.length > 1 ? `Output ${k + 1}` : "Output"}
                tap={tap}
                devices={devices}
                error={k === 0 ? view.status.output_errors[String(number)] : undefined}
                onChange={(t) =>
                  setBus({ ...bus, outputs: t ? (bus.outputs.length ? bus.outputs.map((x, j) => (j === k ? t : x)) : [t]) : bus.outputs.filter((_, j) => j !== k) })
                }
                onRemove={bus.outputs.length > 1 ? () => setBus({ ...bus, outputs: bus.outputs.filter((_, j) => j !== k) }) : undefined}
              />
            ))}
            {bus.outputs.length > 0 && bus.outputs.length < 8 && (
              <button
                className="btn btn-small bus-add-output"
                onClick={() => {
                  const d = devices.find((x) => x.output_channels > 0 && !bus.outputs.some((o) => o.device_id === x.id)) ?? devices.find((x) => x.output_channels > 0);
                  if (!d) return;
                  const stereo = d.output_channels >= 2;
                  setBus({ ...bus, outputs: [...bus.outputs, { device_id: d.id, mode: stereo ? "stereo" : "mono", channels: stereo ? [0, 1] : [0] }] });
                }}
                title="Send this bus to another device too (each gets the whole mix)"
              >
                <Plus size={13} /> Add another output
              </button>
            )}
            <div className="bus-settings-level">
              <div className="bus-settings-meter">
                <span className="muted small">Volume</span>
                <Fader value={bus.volume_db} onChange={(volume_db) => setBus((b) => ({ ...b, volume_db }))} />
                <Meter levels={meters.buses[number - 1]} vertical={false} length={220} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
