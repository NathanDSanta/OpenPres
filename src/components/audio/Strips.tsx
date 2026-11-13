import { Trash2, Volume2, VolumeX } from "lucide-react";
import { audioApi, markChanged } from "@/api";
import { Fader, Knob, Meter } from "@/components/ui/audio";
import { useMeters } from "@/hooks/useMeters";
import type { AudioView, InputStrip, OutputStrip } from "@/types";
import "./Strips.css";

export function BusSelect({ value, names, onChange }: { value: number; names: string[]; onChange: (bus: number) => void }) {
  return (
    <select className="select strip-bus" value={value} onChange={(e) => onChange(Number(e.target.value))} title="Bus">
      {names.map((name, i) => (
        <option key={i} value={i + 1}>
          {i + 1}. {name}
        </option>
      ))}
    </select>
  );
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button className={`btn btn-small mute-btn${muted ? " on" : ""}`} onClick={onToggle} title={muted ? "Unmute" : "Mute"}>
      {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      {muted ? "Muted" : "Mute"}
    </button>
  );
}

const channelLabel = (channels: number[]) => channels.map((c) => c + 1).join("+");

/** One mixer input: meter, gain knob, fader, mute, bus. `compact` is used by home widgets. */
export function InputStripView({
  strip,
  view,
  compact,
  onChange,
}: {
  strip: InputStrip;
  view: AudioView;
  compact?: boolean;
  onChange?: (next: AudioView) => void;
}) {
  const meters = useMeters();
  const error = view.status.errors[strip.id];
  const levels = async (l: Parameters<typeof audioApi.setLevels>[1]) => {
    const next = await audioApi.setLevels(strip.id, l);
    onChange?.(next);
    markChanged();
  };
  return (
    <div className={`strip${compact ? " compact" : ""}${strip.muted ? " muted" : ""}`}>
      <div className="strip-head">
        <strong title={strip.name}>{strip.name}</strong>
        {!compact && (
          <span className="muted small">
            {strip.mode === "stereo" ? "Stereo" : "Mono"} ch {channelLabel(strip.channels)}
          </span>
        )}
      </div>
      {error && <div className="strip-error" title={error}>{error}</div>}
      <div className="strip-body">
        <Meter levels={meters[strip.id]} length={compact ? 70 : 120} />
        <div className="strip-controls">
          <Knob value={strip.gain_db} min={-20} max={40} onChange={(gain_db) => void levels({ gain_db })} />
          <Fader value={strip.fader_db} onChange={(fader_db) => void levels({ fader_db })} />
          <div className="strip-row">
            <MuteButton muted={strip.muted} onToggle={() => void levels({ muted: !strip.muted })} />
            {!compact && <BusSelect value={strip.bus} names={view.config.bus_names} onChange={(bus) => void levels({ bus })} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function OutputStripView({
  strip,
  view,
  compact,
  onChange,
  onRemove,
}: {
  strip: OutputStrip;
  view: AudioView;
  compact?: boolean;
  onChange?: (next: AudioView) => void;
  onRemove?: () => void;
}) {
  const meters = useMeters();
  const error = view.status.errors[strip.id];
  const levels = async (l: Parameters<typeof audioApi.setLevels>[1]) => {
    const next = await audioApi.setLevels(strip.id, l);
    onChange?.(next);
    markChanged();
  };
  return (
    <div className={`strip${compact ? " compact" : ""}${strip.muted ? " muted" : ""}`}>
      <div className="strip-head">
        <strong title={strip.name}>{strip.name}</strong>
        {!compact && (
          <span className="muted small">
            {strip.device_id.replace(/^[^:]+:/, "")} · {strip.mode === "stereo" ? "Stereo" : "Mono"} ch {channelLabel(strip.channels)}
          </span>
        )}
        {onRemove && (
          <button className="btn btn-icon btn-small" onClick={onRemove} title="Remove output">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {error && <div className="strip-error" title={error}>{error}</div>}
      <div className="strip-body">
        <Meter levels={meters[strip.id]} length={compact ? 70 : 120} />
        <div className="strip-controls">
          {!compact && (
            <div className="field">
              <label>Plays bus</label>
              <BusSelect value={strip.bus} names={view.config.bus_names} onChange={(bus) => void levels({ bus })} />
            </div>
          )}
          <Fader value={strip.volume_db} onChange={(volume_db) => void levels({ volume_db })} />
          <MuteButton muted={strip.muted} onToggle={() => void levels({ muted: !strip.muted })} />
        </div>
      </div>
    </div>
  );
}
