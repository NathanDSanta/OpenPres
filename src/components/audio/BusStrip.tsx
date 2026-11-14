import { ArrowDownToLine, ArrowUpFromLine, Settings2, Volume2, VolumeX } from "lucide-react";
import { audioApi, markChanged } from "@/api";
import { Fader, Knob, Meter } from "@/components/ui/audio";
import { useMeters } from "@/hooks/useMeters";
import { notifyError } from "@/state/Dialogs";
import type { AudioDevice, AudioView } from "@/types";
import "./BusStrip.css";

const channelLabel = (channels: number[]) => channels.map((c) => c + 1).join("+");

/** A device's display name from its id (falls back to the id itself). */
export function deviceName(devices: AudioDevice[] | null | undefined, id: string): string {
  const bare = id.replace(/^cpal:/, "");
  return devices?.find((d) => d.id === id || d.id === bare || d.id.replace(/^cpal:/, "") === bare)?.name ?? bare;
}

/**
 * One mixer bus: post-fader meter, volume fader (what leaves the bus), input gain knob,
 * mute and the settings button (devices). `compact` is the home-widget version.
 */
export function BusStrip({
  number,
  view,
  devices,
  compact,
  onSettings,
  onChange,
}: {
  number: number;
  view: AudioView;
  devices?: AudioDevice[] | null;
  compact?: boolean;
  onSettings?: () => void;
  onChange?: (next: AudioView) => void;
}) {
  const meters = useMeters();
  const bus = view.config.buses[number - 1];
  if (!bus) return null;
  const inputError = view.status.input_errors[String(number)];
  const outputError = view.status.output_errors[String(number)];
  const levels = (l: Parameters<typeof audioApi.setLevels>[1]) =>
    audioApi
      .setLevels(number, l)
      .then((next) => {
        onChange?.(next);
        markChanged();
      })
      .catch(notifyError);

  return (
    <div className={`bus-strip${compact ? " compact" : ""}${bus.muted ? " muted" : ""}`}>
      <header className="bus-head">
        <span className="bus-number">{number}</span>
        <strong title={bus.name}>{bus.name}</strong>
        {onSettings && (
          <button className="icon-btn" onClick={onSettings} title="Input and output devices">
            <Settings2 size={15} />
          </button>
        )}
      </header>
      {!compact && (
        <div className="bus-io">
          <span className={inputError ? "error" : bus.input ? "" : "none"} title={inputError ?? (bus.input ? deviceName(devices, bus.input.device_id) : "No input device")}>
            <ArrowDownToLine size={11} />
            {bus.input ? `${deviceName(devices, bus.input.device_id)} · ${channelLabel(bus.input.channels)}` : "No input"}
          </span>
          <span className={outputError ? "error" : bus.output ? "" : "none"} title={outputError ?? (bus.output ? deviceName(devices, bus.output.device_id) : "No output device")}>
            <ArrowUpFromLine size={11} />
            {bus.output ? `${deviceName(devices, bus.output.device_id)} · ${channelLabel(bus.output.channels)}` : "No output"}
          </span>
        </div>
      )}
      <div className="bus-gain">
        <Knob
          value={bus.gain_db}
          min={-20}
          max={40}
          size={compact ? 34 : 40}
          label="Gain"
          onChange={(gain_db) => void levels({ gain_db })}
        />
      </div>
      <div className="bus-fader-area">
        <Meter levels={meters.buses[number - 1]} length="fill" />
        <Fader vertical value={bus.volume_db} onChange={(volume_db) => void levels({ volume_db })} />
      </div>
      <button className={`btn btn-small mute-btn${bus.muted ? " on" : ""}`} onClick={() => void levels({ muted: !bus.muted })} title={bus.muted ? "Unmute" : "Mute"}>
        {bus.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        {!compact && (bus.muted ? "Muted" : "Mute")}
      </button>
    </div>
  );
}
