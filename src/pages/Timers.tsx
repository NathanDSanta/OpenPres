import { useEffect, useState } from "react";
import { CalendarClock, CalendarPlus, Copy, Pause, Play, Plus, RotateCcw, Timer as TimerIcon, Trash2 } from "lucide-react";
import { markChanged, timersApi, useLive } from "@/api";
import Select from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { useAutosave, saveLabel } from "@/hooks/useAutosave";
import { useNow } from "@/hooks/useScene";
import { currentOrNextService, formatDuration, timerValue } from "@/lib/format";
import { newId } from "@/lib/scene/defaults";
import { nextName } from "@/lib/duplicate";
import { contextEntries } from "@/components/global/ContextMenu";
import { notifyError, useDialogs } from "@/state/Dialogs";
import type { Service, TimerDef, TimerKind, TimerView } from "@/types";
import "@/styles/Timers.css";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type KindType = TimerKind["type"];

const KIND_OPTIONS: { value: KindType; label: string }[] = [
  { value: "service", label: "Church service" },
  { value: "countdown", label: "Countdown" },
  { value: "to_time", label: "Countdown to a time" },
  { value: "count_up", label: "Stopwatch" },
];

function defaultKind(type: KindType, previous: TimerKind): TimerKind {
  switch (type) {
    case "countdown":
      return { type, seconds: previous.type === "countdown" ? previous.seconds : 300 };
    case "to_time":
      return { type, time: previous.type === "to_time" ? previous.time : "10:00" };
    case "service":
      return { type, target: "start", service_id: null };
    default:
      return { type: "count_up" };
  }
}

function TimerCard({ timer, services, names }: { timer: TimerView; services: Service[]; names: string[] }) {
  const now = useNow(250);
  const { confirm } = useDialogs();
  const [def, setDef] = useState<TimerDef>({ id: timer.id, name: timer.name, kind: timer.kind, allow_overrun: timer.allow_overrun });
  const state = useAutosave(timer.id, def, async (d) => {
    await timersApi.update(d);
    markChanged();
  });
  const value = timerValue({ ...timer, ...def }, now, services);
  const action = (a: "start" | "pause" | "reset") => void timersApi.action(timer.id, a).then(markChanged).catch(notifyError);
  const next = def.kind.type === "service" ? currentOrNextService(services, now, def.kind.service_id) : null;
  const duplicate = () => void timersApi.create({ name: nextName(def.name, names), kind: def.kind, allow_overrun: def.allow_overrun }).then(markChanged).catch(notifyError);
  const remove = () =>
    void confirm({ title: `Delete “${def.name}”?`, message: "Designs that show it will show --:--.", confirmLabel: "Delete", danger: true }).then((ok) => {
      if (ok) void timersApi.remove(timer.id).then(markChanged).catch(notifyError);
    });
  return (
    <article
      className={`timer-card${timer.running ? " running" : ""}`}
      ref={(el) =>
        contextEntries(el, () => [
          { key: "duplicate", label: "Duplicate", icon: <Copy size={13} />, onSelect: duplicate },
          { key: "delete", label: "Delete", icon: <Trash2 size={13} />, danger: true, onSelect: remove },
        ])
      }
    >
      <header>
        <input className="timer-name" value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} />
        <span className={`save-state${state.status === "error" ? " error" : ""}`}>{state.status === "error" ? saveLabel(state) : ""}</span>
        <button className="icon-btn" title="Duplicate" onClick={duplicate}>
          <Copy size={14} />
        </button>
        <button className="icon-btn" title="Delete" onClick={remove}>
          <Trash2 size={14} />
        </button>
      </header>
      <div className={`timer-display${value < 0 ? " over" : ""}`}>{formatDuration(value, "H:mm:ss")}</div>
      {next && (
        <div className="timer-next muted small">
          {next.service.name} · {DAYS[new Date(next.start).getDay()]} {next.service.start}–{next.service.end}
        </div>
      )}
      <div className="timer-controls">
        <button className={`btn btn-small${timer.running ? "" : " btn-primary"}`} onClick={() => action(timer.running ? "pause" : "start")}>
          {timer.running ? <Pause size={14} /> : <Play size={14} />}
          {timer.running ? "Pause" : def.kind.type === "service" || def.kind.type === "to_time" ? (timer.paused_at ? "Resume" : "Live") : "Start"}
        </button>
        <button className="btn btn-small" onClick={() => action("reset")}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="timer-settings">
        <div className="field">
          <label>Type</label>
          <Select value={def.kind.type} options={KIND_OPTIONS} onChange={(t) => setDef({ ...def, kind: defaultKind(t, def.kind) })} />
        </div>
        {def.kind.type === "countdown" && (
          <div className="field">
            <label>Minutes</label>
            <input
              className="input"
              type="number"
              min={0.1}
              step={0.5}
              value={Math.round((def.kind.seconds / 60) * 100) / 100}
              onChange={(e) => setDef({ ...def, kind: { type: "countdown", seconds: Math.max(1, Math.round(Number(e.target.value) * 60)) } })}
            />
          </div>
        )}
        {def.kind.type === "to_time" && (
          <div className="field">
            <label>Time</label>
            <input className="input" type="time" value={def.kind.time} onChange={(e) => setDef({ ...def, kind: { type: "to_time", time: e.target.value || "10:00" } })} />
          </div>
        )}
        {def.kind.type === "service" && (
          <>
            <div className="field">
              <label>Counts down to</label>
              <Select
                value={def.kind.target}
                options={[
                  { value: "start", label: "The start" },
                  { value: "end", label: "The end" },
                ]}
                onChange={(target) => def.kind.type === "service" && setDef({ ...def, kind: { ...def.kind, target } })}
              />
            </div>
            <div className="field">
              <label>Service</label>
              <Select
                value={def.kind.service_id ?? ""}
                options={[{ value: "", label: "The next one" }, ...services.map((s) => ({ value: s.id, label: s.name }))]}
                onChange={(id) => def.kind.type === "service" && setDef({ ...def, kind: { ...def.kind, service_id: id || null } })}
              />
            </div>
          </>
        )}
        {def.kind.type !== "count_up" && (
          <label className="timer-overrun" title="Keep counting below zero instead of stopping at 0:00">
            <Toggle small checked={def.allow_overrun} onChange={(allow_overrun) => setDef({ ...def, allow_overrun })} />
            <span className="small">Count past zero</span>
          </label>
        )}
      </div>
    </article>
  );
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The weekly services, then the special ones (on one date, maybe cancelling that day's weekly services). */
function ServicesEditor() {
  const { data } = useLive(() => timersApi.services());
  const [services, setServices] = useState<Service[] | null>(null);
  useEffect(() => {
    if (data && services === null) setServices(data);
  }, [data, services]);
  const state = useAutosave("services", services, async (list) => {
    await timersApi.saveServices(list.filter((s) => s.name.trim() && (s.date || s.days.length)));
    markChanged();
  });
  if (!services) return null;
  const update = (id: string, patch: Partial<Service>) => setServices(services.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => setServices(services.filter((s) => s.id !== id));
  const weekly = services.filter((s) => !s.date);
  const today = todayIso();
  // Soonest first; past ones at the end.
  const special = services.filter((s) => s.date).sort((a, b) => ((a.date! < today) !== (b.date! < today) ? (a.date! < today ? 1 : -1) : a.date!.localeCompare(b.date!)));
  const times = (s: Service) => (
    <>
      <input className="input" type="time" value={s.start} onChange={(e) => update(s.id, { start: e.target.value || "10:00" })} title="Start" />
      <span className="muted">–</span>
      <input className="input" type="time" value={s.end} onChange={(e) => update(s.id, { end: e.target.value || "12:00" })} title="End" />
      <button className="icon-btn" onClick={() => remove(s.id)} title="Remove">
        <Trash2 size={14} />
      </button>
    </>
  );
  return (
    <section className="panel services-panel">
      <header className="panel-header">
        <h2>
          <CalendarClock size={15} /> Services
        </h2>
        <span className={`save-state${state.status === "error" ? " error" : ""}`}>{saveLabel(state)}</span>
        <button className="btn btn-small" onClick={() => setServices([...services, { id: newId(), name: weekly.length ? `Service ${weekly.length + 1}` : "Sunday morning", days: [0], start: "10:00", end: "12:00" }])}>
          <Plus size={14} /> Weekly service
        </button>
        <button
          className="btn btn-small"
          onClick={() => setServices([...services, { id: newId(), name: special.length ? `Special service ${special.length + 1}` : "Special service", days: [], date: today, cancels_others: false, start: "19:00", end: "21:00" }])}
          title="A service on one date (a wedding, Christmas Eve…), outside the weekly schedule"
        >
          <CalendarPlus size={14} /> Special service
        </button>
      </header>
      <div className="panel-body">
        <p className="muted small services-help">
          Your weekly schedule, and special services on a date of their own. “Church service” timers count down to the start or the end of the service in progress or the next one.
        </p>
        <h3 className="services-subtitle">Every week</h3>
        <div className="services-list">
          {weekly.map((s) => (
            <div key={s.id} className="service-row">
              <input className="input" value={s.name} placeholder="Name" onChange={(e) => update(s.id, { name: e.target.value })} />
              <div className="service-days">
                {DAY_ORDER.map((d) => (
                  <button key={d} className={`day-chip${s.days.includes(d) ? " on" : ""}`} onClick={() => update(s.id, { days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort() })}>
                    {DAYS[d]}
                  </button>
                ))}
              </div>
              {times(s)}
            </div>
          ))}
          {weekly.length === 0 && <div className="empty">No weekly services yet (e.g. Saturday 19:00–20:00, Sunday 10:00–12:30 and 18:00–20:00).</div>}
        </div>
        <h3 className="services-subtitle">Special services</h3>
        <div className="services-list">
          {special.map((s) => {
            const past = s.date! < today;
            const weekday = new Date(`${s.date}T12:00`).getDay();
            const replaced = weekly.filter((w) => w.days.includes(weekday)).map((w) => w.name);
            return (
              <div key={s.id} className={`service-row special${past ? " past" : ""}`}>
                <input className="input" value={s.name} placeholder="Name" onChange={(e) => update(s.id, { name: e.target.value })} />
                <div className="service-special-when">
                  <input className="input" type="date" value={s.date} onChange={(e) => e.target.value && update(s.id, { date: e.target.value })} title="Date" />
                  <label className="service-cancels" title={replaced.length ? `That day: ${replaced.join(", ")}` : "No weekly service that day"}>
                    <Toggle small checked={!!s.cancels_others} onChange={(cancels_others) => update(s.id, { cancels_others })} />
                    <span className="small">{replaced.length ? `Instead of ${replaced.join(", ")}` : "Cancels that day's services"}</span>
                  </label>
                  {past && <span className="service-past">Past</span>}
                </div>
                {times(s)}
              </div>
            );
          })}
          {special.length === 0 && <div className="empty">None. Add one for a service outside the weekly schedule; it can cancel that day's weekly services.</div>}
        </div>
      </div>
    </section>
  );
}

/** The Services page: the services (weekly and special), then the timers. */
export default function Services() {
  const { data: timers } = useLive(() => timersApi.list());
  const { data: services } = useLive(() => timersApi.services());
  const add = () =>
    void timersApi
      .create({ name: services?.length ? "Service starts in" : "Countdown", kind: services?.length ? { type: "service", target: "start", service_id: null } : { type: "countdown", seconds: 300 }, allow_overrun: false })
      .then(markChanged)
      .catch(notifyError);
  return (
    <section className="page timers-page">
      <ServicesEditor />
      <section className="panel timers-panel">
        <header className="panel-header">
          <h2>
            <TimerIcon size={15} /> Timers
          </h2>
          <span className="muted small">Show one on screen with a Timer element in a theme or prop.</span>
          <button className="btn btn-small btn-primary" onClick={add}>
            <Plus size={14} /> Add timer
          </button>
        </header>
        <div className="panel-body timers-grid">
          {(timers ?? []).map((t) => (
            <TimerCard key={t.id} timer={t} services={services ?? []} names={(timers ?? []).map((x) => x.name)} />
          ))}
          {timers?.length === 0 && <div className="empty">No timers yet.</div>}
        </div>
      </section>
    </section>
  );
}
