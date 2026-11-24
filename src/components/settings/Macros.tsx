import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Copy,
  Keyboard,
  Play,
  Plus,
  Presentation,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  audioApi,
  devicesApi,
  libraryApi,
  liveApi,
  macrosApi,
  markChanged,
  mediaApi,
  screensApi,
  themesApi,
  timersApi,
  useLive,
} from "@/api";
import Select, { type SelectOption } from "@/components/ui/Select";
import { Recorder } from "@/components/settings/Keybindings";
import { saveLabel, useAutosave } from "@/hooks/useAutosave";
import { CLEAR_LAYERS } from "@/lib/clearLayers";
import { prettyCombo } from "@/lib/commands";
import {
  busName,
  copyName,
  describeStep,
  MACRO_COLORS,
  MACRO_ICONS,
  macroIcon,
  macroSummary,
  MOVE_LAYERS,
  newStep,
  stepComplete,
  STEP_TYPES,
  type MacroData,
} from "@/lib/macros";
import { newId } from "@/lib/scene/defaults";
import { useApp } from "@/state/AppContext";
import { notifyError, useDialogs } from "@/state/Dialogs";
import type { Macro, MacroRun, MacroStep, MacroStepType, MacroTrigger, MacrosStatus, Service } from "@/types";
import "@/styles/Macros.css";

const BUSES = 16;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Everything the steps and triggers can point at. */
function useMacroData(): MacroData {
  const { data } = useLive(
    async () => {
      const safe = async <T,>(p: Promise<T>, fallback: T) => {
        try {
          return await p;
        } catch {
          return fallback;
        }
      };
      const [presentations, clearGroups, props, cameras, folders, audio, timers, screens, presets, services] = await Promise.all([
        safe(libraryApi.listAllPresentations(), []),
        safe(liveApi.clearGroups().then((f) => f.groups), []),
        safe(themesApi.list("props"), []),
        safe(devicesApi.listVideo(), []),
        safe(mediaApi.playlists(), []),
        safe(audioApi.get(), null),
        safe(timersApi.list(), []),
        safe(screensApi.list(), []),
        safe(screensApi.presets().then((f) => f.presets), []),
        safe(timersApi.services(), []),
      ]);
      return { presentations, clearGroups, props, cameras, folders, audio, timers, screens, presets, services };
    },
    [],
    ["libraries", "presentations", "clear-groups", "themes", "devices", "media", "audio", "timers", "services", "screens", "screen-presets"],
  );
  return data ?? { presentations: [], clearGroups: [], props: [], cameras: [], folders: [], audio: null, timers: [], screens: [], presets: [], services: [] };
}

const runLabel = (run: MacroRun) => {
  const at = new Date(run.at_ms);
  const today = new Date().toDateString() === at.toDateString();
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? `Today ${time}` : `${at.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
};

function serviceLabel(s: Service): { label: string; hint: string } {
  if (s.date) {
    const d = new Date(`${s.date}T00:00`);
    return { label: s.name, hint: `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${s.start}` };
  }
  return { label: s.name, hint: `${s.days.map((d) => DAYS[d]).join(", ")} ${s.start}` };
}

// ---------- one step ----------

function StepFields({ step, data, onChange }: { step: MacroStep; data: MacroData; onChange: (step: MacroStep) => void }) {
  switch (step.type) {
    case "wait":
      return (
        <>
          <input
            className="input macro-num"
            type="number"
            min={0}
            max={3600}
            step={0.5}
            value={step.seconds}
            onChange={(e) => onChange({ ...step, seconds: Math.min(3600, Math.max(0, Number(e.target.value) || 0)) })}
          />
          <span className="muted small">seconds</span>
        </>
      );
    case "present": {
      const options: SelectOption[] = [...data.presentations]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => ({ value: p.id, label: p.title, group: p.library_name }));
      return <Select value={step.presentation_id || null} placeholder="Choose a song or presentation…" options={options} searchable onChange={(presentation_id) => onChange({ ...step, presentation_id })} />;
    }
    case "next":
    case "previous":
      return <Select value={step.layer} options={MOVE_LAYERS} onChange={(layer) => onChange({ ...step, layer })} />;
    case "bible":
      return <input className="input" placeholder="John 3:16" value={step.reference} maxLength={80} onChange={(e) => onChange({ ...step, reference: e.target.value })} />;
    case "clear":
      return (
        <div className="clear-group-layers">
          {CLEAR_LAYERS.map(({ layer, label, icon: L }) => {
            const on = step.layers.includes(layer);
            const layers = on ? step.layers.filter((x) => x !== layer) : CLEAR_LAYERS.map((x) => x.layer).filter((x) => x === layer || step.layers.includes(x));
            return (
              <button key={layer} className={`chip clear-layer-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange({ ...step, layers })}>
                <L size={12} /> {label}
              </button>
            );
          })}
        </div>
      );
    case "clear_group":
      return (
        <Select
          value={step.group_id || null}
          placeholder="Choose a clear group…"
          options={data.clearGroups.map((g) => ({ value: g.id, label: g.name }))}
          onChange={(group_id) => onChange({ ...step, group_id })}
        />
      );
    case "prop":
      return (
        <>
          <Select value={step.show ? "show" : "hide"} className="macro-verb" options={[{ value: "show", label: "Show" }, { value: "hide", label: "Hide" }]} onChange={(v) => onChange({ ...step, show: v === "show" })} />
          <Select
            value={step.design_id ? `${step.theme_id}:${step.design_id}` : null}
            placeholder="Choose a prop…"
            options={data.props.flatMap((t) => t.designs.map((d) => ({ value: `${t.id}:${d.id}`, label: d.name, group: t.name })))}
            onChange={(v) => {
              const [theme_id, design_id] = v.split(":");
              onChange({ ...step, theme_id, design_id });
            }}
          />
        </>
      );
    case "camera":
      return (
        <Select
          value={step.device_id ?? ""}
          options={[...data.cameras.map((c) => ({ value: c.id, label: c.name })), { value: "", label: "Nothing (clear the layer)" }]}
          onChange={(v) => onChange({ ...step, device_id: v || null })}
        />
      );
    case "media_folder":
      return (
        <Select
          value={step.playlist_id || null}
          placeholder="Choose a media folder…"
          options={data.folders.map((f) => ({ value: f.id, label: f.name, hint: f.kind === "audio" ? "audio" : f.kind === "video" ? "video" : "pictures" }))}
          onChange={(playlist_id) => onChange({ ...step, playlist_id, audio: data.folders.find((f) => f.id === playlist_id)?.kind === "audio" })}
        />
      );
    case "mute":
      return (
        <>
          <Select value={step.muted ? "mute" : "unmute"} className="macro-verb" options={[{ value: "mute", label: "Mute" }, { value: "unmute", label: "Unmute" }]} onChange={(v) => onChange({ ...step, muted: v === "mute" })} />
          <Select
            value={String(step.bus)}
            options={Array.from({ length: BUSES }, (_, i) => ({ value: String(i + 1), label: busName(data, i + 1), hint: `bus ${i + 1}` }))}
            onChange={(v) => onChange({ ...step, bus: Number(v) })}
          />
        </>
      );
    case "timer":
      return (
        <>
          <Select
            value={step.action}
            className="macro-verb"
            options={[
              { value: "start", label: "Start" },
              { value: "pause", label: "Pause" },
              { value: "reset", label: "Reset" },
            ]}
            onChange={(action) => onChange({ ...step, action })}
          />
          <Select value={step.timer_id || null} placeholder="Choose a timer…" options={data.timers.map((t) => ({ value: t.id, label: t.name }))} onChange={(timer_id) => onChange({ ...step, timer_id })} />
        </>
      );
    case "screen_preset":
      return (
        <>
          <Select value={step.screen_id || null} placeholder="Choose a screen…" options={data.screens.map((s) => ({ value: s.id, label: s.name }))} onChange={(screen_id) => onChange({ ...step, screen_id })} />
          <span className="muted small">to</span>
          <Select value={step.preset_id || null} placeholder="Choose a preset…" options={data.presets.map((p) => ({ value: p.id, label: p.name }))} onChange={(preset_id) => onChange({ ...step, preset_id })} />
        </>
      );
    case "stream":
      return (
        <Select
          value={step.start ? "start" : "stop"}
          options={[
            { value: "start", label: "Start streaming / recording" },
            { value: "stop", label: "Stop streaming / recording" },
          ]}
          onChange={(v) => onChange({ ...step, start: v === "start" })}
        />
      );
    case "power":
      return (
        <Select
          value={step.power}
          options={[
            { value: "active", label: "On (active)" },
            { value: "standby", label: "Standby: nothing on screen" },
          ]}
          onChange={(power) => onChange({ ...step, power })}
        />
      );
  }
}

const STEP_OPTIONS: SelectOption<MacroStepType>[] = STEP_TYPES.map((t) => ({ value: t.type, label: t.label, group: t.group }));

// ---------- one trigger ----------

function TriggerFields({ trigger, data, onChange }: { trigger: MacroTrigger; data: MacroData; onChange: (t: MacroTrigger) => void }) {
  if (trigger.type === "service") {
    return (
      <>
        <CalendarClock size={14} className="macro-trigger-icon" />
        <input
          className="input macro-num"
          type="number"
          min={0}
          max={1440}
          value={trigger.minutes_before}
          onChange={(e) => onChange({ ...trigger, minutes_before: Math.min(1440, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
        />
        <span className="muted small">{trigger.minutes_before ? "minutes before" : "minutes before (when it starts)"}</span>
        <Select
          value={trigger.service_id ?? ""}
          options={[{ value: "", label: "Any service" }, ...data.services.map((s) => ({ value: s.id, ...serviceLabel(s), group: s.date ? "Special services" : "Every week" }))]}
          onChange={(v) => onChange({ ...trigger, service_id: v || null })}
        />
      </>
    );
  }
  const options: SelectOption[] = [
    { value: "", label: "Any song or presentation" },
    ...[...data.presentations].sort((a, b) => a.title.localeCompare(b.title)).map((p) => ({ value: p.id, label: p.title, group: p.library_name })),
  ];
  return (
    <>
      <Presentation size={14} className="macro-trigger-icon" />
      <span className="muted small">When</span>
      <Select value={trigger.presentation_id ?? ""} options={options} searchable onChange={(v) => onChange({ ...trigger, presentation_id: v || null })} />
      <Select
        value={trigger.when}
        className="macro-verb"
        options={[
          { value: "begins", label: "goes live" },
          { value: "ends", label: "comes off" },
        ]}
        onChange={(when) => onChange({ ...trigger, when })}
      />
    </>
  );
}

// ---------- one macro ----------

function MacroEditor({
  macro,
  data,
  status,
  saved,
  onChange,
  onDuplicate,
  onDelete,
}: {
  macro: Macro;
  data: MacroData;
  status: MacrosStatus | null;
  /** Whether the server has this version (it can only run what it has). */
  saved: boolean;
  onChange: (m: Macro) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { keybinds, ui, saveUi } = useApp();
  const { confirm } = useDialogs();
  const [recording, setRecording] = useState(false);
  const commandId = `macro.run:${macro.id}`;
  const combos = Object.entries(keybinds)
    .filter(([, id]) => id === commandId)
    .map(([combo]) => combo);
  const running = status?.running.includes(macro.id) ?? false;
  const runs = (status?.recent ?? []).filter((r) => r.macro_id === macro.id).slice(0, 5);
  const Icon = macroIcon(macro.icon);

  const setSteps = (steps: MacroStep[]) => onChange({ ...macro, steps });
  const setTriggers = (triggers: MacroTrigger[]) => onChange({ ...macro, triggers });
  const move = (i: number, d: number) => {
    const steps = [...macro.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + d, 0, s);
    setSteps(steps);
  };

  const assign = async (combo: string | null) => {
    setRecording(false);
    if (!combo) return;
    const taken = keybinds[combo];
    if (taken && taken !== commandId) {
      if (!(await confirm({ title: `${prettyCombo(combo)} is used`, message: `It already runs “${taken}”. Use it for this macro instead?`, confirmLabel: "Reassign" }))) return;
    }
    void saveUi({ ...ui, keybinds: { ...keybinds, [combo]: commandId } }).catch(notifyError);
  };
  const unassign = (combo: string) => {
    const next = { ...keybinds };
    delete next[combo];
    void saveUi({ ...ui, keybinds: next }).catch(notifyError);
  };

  return (
    <div className="macro-editor" style={{ ["--group" as string]: macro.color }}>
      <div className="macro-head">
        <span className="clear-group-badge">
          <Icon size={18} />
        </span>
        <input className="input macro-name" value={macro.name} maxLength={40} onChange={(e) => onChange({ ...macro, name: e.target.value })} aria-label="Name" />
        <div className="macro-head-actions">
          {running ? (
            <button className="btn btn-small" onClick={() => void macrosApi.stop(macro.id).then(markChanged).catch(notifyError)}>
              <Square size={13} /> Stop
            </button>
          ) : (
            <button
              className="btn btn-small btn-primary"
              disabled={!saved || !macro.steps.length}
              title={!saved ? "Saving…" : !macro.steps.length ? "Add a step first" : "Run it now"}
              onClick={() => void macrosApi.run(macro.id).then(markChanged).catch(notifyError)}
            >
              <Play size={13} /> Run
            </button>
          )}
          <button className="icon-btn" onClick={onDuplicate} title="Duplicate">
            <Copy size={14} />
          </button>
          <button className="icon-btn" onClick={onDelete} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="macro-looks">
        <div className="clear-group-icons" role="radiogroup" aria-label="Icon">
          {Object.entries(MACRO_ICONS).map(([name, I]) => (
            <button key={name} className={`icon-btn${macro.icon === name ? " active" : ""}`} onClick={() => onChange({ ...macro, icon: name })} title={name} role="radio" aria-checked={macro.icon === name}>
              <I size={14} />
            </button>
          ))}
        </div>
        <div className="macro-colors" role="radiogroup" aria-label="Colour">
          {MACRO_COLORS.map((c) => (
            <button key={c} className={`macro-color${macro.color.toUpperCase() === c ? " active" : ""}`} style={{ background: c }} onClick={() => onChange({ ...macro, color: c })} title={c} role="radio" aria-checked={macro.color.toUpperCase() === c} />
          ))}
          <input className="group-class-color" type="color" value={macro.color.slice(0, 7)} onChange={(e) => onChange({ ...macro, color: e.target.value.toUpperCase() })} title="Another colour" />
        </div>
      </div>

      <h3 className="macro-section">Steps</h3>
      {macro.steps.length ? (
        <ol className="macro-steps">
          {macro.steps.map((step, i) => (
            <li key={i} className={`macro-step${stepComplete(step) ? "" : " incomplete"}`}>
              <span className="macro-step-n">{i + 1}</span>
              <Select value={step.type} options={STEP_OPTIONS} onChange={(type) => setSteps(macro.steps.map((s, j) => (j === i ? newStep(type, data) : s)))} className="macro-step-type" />
              <div className="macro-step-fields">
                <StepFields step={step} data={data} onChange={(s) => setSteps(macro.steps.map((x, j) => (j === i ? s : x)))} />
              </div>
              <div className="macro-step-actions">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="icon-btn" disabled={i === macro.steps.length - 1} onClick={() => move(i, 1)} title="Move down">
                  <ArrowDown size={13} />
                </button>
                <button className="icon-btn" onClick={() => setSteps(macro.steps.filter((_, j) => j !== i))} title="Remove step">
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No steps yet. Add what it should do, in order.</p>
      )}
      <div className="macro-add">
        <Select<MacroStepType>
          value={null}
          placeholder={
            <>
              <Plus size={13} /> Add a step
            </>
          }
          options={STEP_OPTIONS}
          onChange={(type) => setSteps([...macro.steps, newStep(type, data)])}
          disabled={macro.steps.length >= 50}
        />
      </div>

      <h3 className="macro-section">Starts by itself</h3>
      {macro.triggers.map((t, i) => (
        <div key={i} className="macro-trigger">
          <TriggerFields trigger={t} data={data} onChange={(next) => setTriggers(macro.triggers.map((x, j) => (j === i ? next : x)))} />
          <button className="icon-btn" onClick={() => setTriggers(macro.triggers.filter((_, j) => j !== i))} title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="macro-add">
        <button className="btn btn-small" disabled={macro.triggers.length >= 8} onClick={() => setTriggers([...macro.triggers, { type: "service", service_id: null, minutes_before: 30 }])}>
          <CalendarClock size={13} /> Before a service
        </button>
        <button className="btn btn-small" disabled={macro.triggers.length >= 8} onClick={() => setTriggers([...macro.triggers, { type: "presentation", presentation_id: null, when: "begins" }])}>
          <Presentation size={13} /> When a presentation goes live or comes off
        </button>
      </div>
      {macro.triggers.some((t) => t.type === "service") && <p className="muted small">It runs once for each service, and never for a service that has already begun.</p>}

      <h3 className="macro-section">Shortcut and Stream Deck</h3>
      <div className="macro-shortcut">
        <Keyboard size={14} className="macro-trigger-icon" />
        {combos.map((combo) => (
          <span key={combo} className="kb-key">
            <kbd>{prettyCombo(combo)}</kbd>
            <button className="icon-btn" onClick={() => unassign(combo)} title="Remove shortcut">
              <X size={11} />
            </button>
          </span>
        ))}
        {recording ? (
          <Recorder onDone={(combo) => void assign(combo)} />
        ) : (
          <button className="btn btn-small" onClick={() => setRecording(true)}>
            <Plus size={13} /> {combos.length ? "Another shortcut" : "Set a shortcut"}
          </button>
        )}
      </div>
      <p className="muted small">
        It's also in the Macros widget and the command bar, and on the Stream Deck: put the OpenPres <b>Macro</b> action on a key and choose “{macro.name.trim() || "this macro"}”. The key shows this icon and colour.
      </p>

      {runs.length > 0 && (
        <>
          <h3 className="macro-section">Last runs</h3>
          <ul className="macro-runs">
            {runs.map((r) => (
              <li key={r.run_id} className={r.errors.length ? "failed" : ""}>
                {r.errors.length ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}
                <span className="macro-run-when">{runLabel(r)}</span>
                <span className="macro-run-why">{r.why}</span>
                <span className="macro-run-result">{!r.finished ? (running ? "Running…" : "Didn't finish") : r.stopped ? "Stopped" : r.errors.length ? r.errors.join(" · ") : "Done"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------- the tab ----------

/** Macros: steps the server runs in order, from a button or by themselves. The admin's. */
export default function MacrosTab() {
  const { data } = useLive(() => macrosApi.list(), [], ["macros"]);
  const { data: status } = useLive(() => macrosApi.status(), [], ["macros"]);
  const macroData = useMacroData();
  const { keybinds, ui, saveUi } = useApp();
  const { confirm } = useDialogs();
  const [draft, setDraft] = useState<Macro[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (data && draft === null) {
      setDraft(data.macros);
      setSelected(data.macros[0]?.id ?? null);
    }
  }, [data, draft]);
  // A macro with a step still to choose isn't saved until it's chosen.
  const valid = draft?.every((m) => m.name.trim() && m.steps.every(stepComplete)) ?? false;
  const state = useAutosave("macros", valid ? draft : null, (macros) => macrosApi.save({ macros }));
  const savedJson = useMemo(() => new Map((data?.macros ?? []).map((m) => [m.id, JSON.stringify(m)])), [data]);
  if (!draft) return <div className="empty">Loading…</div>;

  const current = draft.find((m) => m.id === selected) ?? null;
  const update = (m: Macro) => setDraft(draft.map((x) => (x.id === m.id ? m : x)));
  const add = (m: Macro, after?: string) => {
    const at = after ? draft.findIndex((x) => x.id === after) + 1 : draft.length;
    setDraft([...draft.slice(0, at), m, ...draft.slice(at)]);
    setSelected(m.id);
  };
  const remove = async (m: Macro) => {
    if (!(await confirm({ title: `Delete “${m.name}”?`, message: "Its shortcuts and Stream Deck keys stop working.", confirmLabel: "Delete", danger: true }))) return;
    const i = draft.findIndex((x) => x.id === m.id);
    const rest = draft.filter((x) => x.id !== m.id);
    setDraft(rest);
    setSelected(rest[Math.min(i, rest.length - 1)]?.id ?? null);
    const combos = Object.entries(keybinds).filter(([, id]) => id === `macro.run:${m.id}`);
    if (combos.length) {
      const next = { ...keybinds };
      for (const [combo] of combos) delete next[combo];
      void saveUi({ ...ui, keybinds: next }).catch(notifyError);
    }
  };

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">
          Macros
          <div className="page-actions">
            {valid ? saveLabel(state) && <span className={`save-state${state.status === "error" ? " error" : ""}`}>{saveLabel(state)}</span> : <span className="save-state error">Choose what each step does to save</span>}
            <button
              className="btn btn-small"
              disabled={draft.length >= 64}
              onClick={() => {
                const names = draft.map((m) => m.name);
                const name = names.some((n) => n.trim().toLowerCase() === "macro") ? copyName("Macro", names) : "Macro";
                add({ id: newId(), name, icon: "Zap", color: MACRO_COLORS[draft.length % MACRO_COLORS.length], steps: [], triggers: [] });
              }}
            >
              <Plus size={14} /> New macro
            </button>
          </div>
        </h2>
        <p className="muted small">
          Several steps in a row (present a song, show a prop, unmute a bus, wait, start the stream…) from one button, a shortcut or a Stream Deck key, or by themselves before a service or when a
          presentation goes live. Anyone can run them; only the admin changes them.
        </p>
        {draft.length ? (
          <div className="macros-layout">
            <div className="macro-list" role="listbox" aria-label="Macros">
              {draft.map((m) => {
                const I = macroIcon(m.icon);
                const running = status?.running.includes(m.id);
                return (
                  <button
                    key={m.id}
                    className={`macro-item${m.id === selected ? " active" : ""}`}
                    style={{ ["--group" as string]: m.color }}
                    onClick={() => setSelected(m.id)}
                    role="option"
                    aria-selected={m.id === selected}
                    title={m.steps.map((s) => describeStep(s, macroData)).join(" → ")}
                  >
                    <span className="clear-group-badge">
                      <I size={15} />
                    </span>
                    <span className="macro-item-text">
                      <span className="macro-item-name">
                        {m.name || "Untitled"}
                        {running && <span className="macro-running-dot" title="Running" />}
                      </span>
                      <span className="macro-item-summary">{macroSummary(m, macroData)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {current && (
              <MacroEditor
                macro={current}
                data={macroData}
                status={status ?? null}
                saved={savedJson.get(current.id) === JSON.stringify(current)}
                onChange={update}
                onDuplicate={() => add({ ...current, id: newId(), name: copyName(current.name, draft.map((m) => m.name)) }, current.id)}
                onDelete={() => void remove(current)}
              />
            )}
          </div>
        ) : (
          <div className="empty">No macros yet.</div>
        )}
      </section>
    </div>
  );
}
