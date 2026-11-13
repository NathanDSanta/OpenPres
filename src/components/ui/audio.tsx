import { useEffect, useRef, useState } from "react";
import { formatDb } from "@/lib/format";

/**
 * Fader law: 75% of the travel is 0 dB, the top is +10 dB, the bottom is -inf.
 * Below 0 dB the scale is logarithmic like a console fader.
 */
export function faderToDb(p: number): number {
  if (p <= 0.001) return -100;
  if (p >= 0.75) return ((p - 0.75) / 0.25) * 10;
  return -60 * Math.pow((0.75 - p) / 0.75, 1.5);
}

export function dbToFader(db: number): number {
  if (db <= -100) return 0;
  if (db >= 0) return 0.75 + (Math.min(db, 10) / 10) * 0.25;
  if (db <= -60) return 0.002;
  return 0.75 - 0.75 * Math.pow(-db / 60, 1 / 1.5);
}

/** Sends changes at most every `ms` while dragging, and the final value on release. */
function useThrottled(send: (v: number) => void, ms = 60) {
  const last = useRef(0);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (value: number, final = false) => {
    pending.current = value;
    const now = performance.now();
    const flush = () => {
      if (pending.current !== null) {
        send(pending.current);
        pending.current = null;
        last.current = performance.now();
      }
    };
    if (final || now - last.current > ms) {
      if (timer.current) clearTimeout(timer.current);
      flush();
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        flush();
      }, ms);
    }
  };
}

interface FaderProps {
  value: number;
  onChange: (db: number) => void;
  vertical?: boolean;
  disabled?: boolean;
}

/** A volume fader from -inf to +10 dB. Double-click resets to 0 dB. */
export function Fader({ value, onChange, vertical, disabled }: FaderProps) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const send = useThrottled(onChange);
  return (
    <div className={`fader${vertical ? " vertical" : ""}`}>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(dbToFader(local) * 1000)}
        disabled={disabled}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => {
          dragging.current = false;
          send(local, true);
        }}
        onDoubleClick={() => {
          setLocal(0);
          send(0, true);
        }}
        onChange={(e) => {
          const db = Math.round(faderToDb(Number(e.target.value) / 1000) * 10) / 10;
          setLocal(db);
          send(db);
        }}
        aria-label="Volume"
        title="Double-click for 0 dB"
      />
      <span className="fader-value">{formatDb(local)}</span>
    </div>
  );
}

interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label?: string;
  size?: number;
  defaultValue?: number;
}

/** A rotary knob (drag up/down, wheel, double-click to reset), like a console gain pot. */
export function Knob({ value, min, max, onChange, label = "Gain", size = 44, defaultValue = 0 }: KnobProps) {
  const [local, setLocal] = useState(value);
  const drag = useRef<{ y: number; v: number } | null>(null);
  useEffect(() => {
    if (!drag.current) setLocal(value);
  }, [value]);
  const send = useThrottled(onChange);
  const set = (v: number, final = false) => {
    const clamped = Math.round(Math.max(min, Math.min(max, v)) * 2) / 2;
    setLocal(clamped);
    send(clamped, final);
  };
  const t = (local - min) / (max - min);
  const angle = -135 + t * 270;
  const r = size / 2 - 4;
  const arc = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [size / 2 + Math.cos(rad) * r, size / 2 + Math.sin(rad) * r];
  };
  const [sx, sy] = arc(-135);
  const [ex, ey] = arc(angle);
  return (
    <div
      className="knob"
      title={`${label}: double-click to reset, drag or scroll to change`}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { y: e.clientY, v: local };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        set(drag.current.v + ((drag.current.y - e.clientY) / 150) * (max - min));
      }}
      onPointerUp={() => {
        drag.current = null;
        set(local, true);
      }}
      onWheel={(e) => set(local - Math.sign(e.deltaY), true)}
      onDoubleClick={() => set(defaultValue, true)}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={local}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") set(local + 1, true);
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(local - 1, true);
      }}
    >
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="#0d0d12" stroke="var(--border)" strokeWidth="2" />
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${angle + 135 > 180 ? 1 : 0} 1 ${ex} ${ey}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line x1={size / 2} y1={size / 2} x2={ex} y2={ey} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="knob-label">
        {label} {local > 0 ? "+" : ""}
        {local.toFixed(1)}
      </span>
    </div>
  );
}

const toPercent = (peak: number) => {
  if (peak <= 0.0001) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};

/** Stereo peak meter (values 0..1). */
export function Meter({ levels, vertical = true, length = 100 }: { levels?: [number, number]; vertical?: boolean; length?: number }) {
  const [l, r] = levels ?? [0, 0];
  const bar = (v: number, key: string) => (
    <div
      key={key}
      className="meter-bar"
      style={vertical ? { width: 6, height: length } : { height: 6, width: length }}
    >
      <div
        className="meter-fill"
        style={vertical ? { height: `${toPercent(v)}%`, ["--meter-size" as string]: `${length}px` } : { width: `${toPercent(v)}%` }}
      />
    </div>
  );
  return <div className={`meter${vertical ? "" : " horizontal"}`} style={vertical ? {} : { flexDirection: "column" }}>{[bar(l, "l"), bar(r, "r")]}</div>;
}
