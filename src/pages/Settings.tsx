import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pause, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { markChanged, setHttpTransportPort, systemApi, timersApi, useLive } from "@/api";
import { initServer } from "@/api/server";
import Tabs from "@/components/ui/Tabs";
import { templateNames } from "@/components/import/ImportSongDialog";
import { groupNames, shadeOf } from "@/lib/groups";
import { formatDuration, timerValue } from "@/lib/format";
import { useNow } from "@/hooks/useScene";
import { useApp } from "@/state/AppContext";
import type { GroupClass, ImportTemplate, TimerDef, TimerKind } from "@/types";
import "@/styles/Settings.css";

type TabId = "general" | "network" | "groups" | "templates" | "timers";

function Status({ error, ok }: { error: string | null; ok: string | null }) {
  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}
    </>
  );
}

function GeneralTab() {
  const { data: config, reload } = useLive(() => systemApi.getConfig());
  const [port, setPort] = useState("");
  const [ffmpeg, setFfmpeg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    if (config) {
      setPort(String(config.api_port));
      setFfmpeg(config.ffmpeg_path);
    }
  }, [config]);
  if (!config) return <div className="empty">Loading…</div>;

  const save = async () => {
    setError(null);
    setOk(null);
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      setError("Enter a port between 1024 and 65535.");
      return;
    }
    try {
      const updated = await systemApi.updateConfig({ api_port: p, ffmpeg_path: ffmpeg });
      setHttpTransportPort(updated.api_port);
      await initServer(true);
      setOk("Saved.");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-grid">
      <section className="card">
        <h2 className="card-title">API server</h2>
        <div className="field">
          <label>Port</label>
          <input className="input" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
          <span className="muted small">Used by the web interface (iPad) and other tools.</span>
        </div>
      </section>
      <section className="card">
        <h2 className="card-title">ffmpeg</h2>
        <div className="field">
          <label>Path to the ffmpeg program</label>
          <input className="input" value={ffmpeg} onChange={(e) => setFfmpeg(e.target.value)} placeholder="ffmpeg" />
          <span className="muted small">Needed to stream and record, and to play audio formats like Opus. “ffmpeg” uses the one on the system PATH.</span>
        </div>
      </section>
      <section className="card">
        <h2 className="card-title">About</h2>
        <dl className="settings-facts">
          <dt>Version</dt>
          <dd>{config.version}</dd>
          <dt>Data folder</dt>
          <dd>{config.data_dir}</dd>
        </dl>
      </section>
      <div className="settings-actions">
        <Status error={error} ok={ok} />
        <button className="btn btn-primary" onClick={() => void save()}>
          <Save size={15} /> Save
        </button>
      </div>
    </div>
  );
}

function NetworkTab() {
  const { data: config, reload } = useLive(() => systemApi.getConfig());
  const { data: network } = useLive(() => systemApi.network());
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!config) return <div className="empty">Loading…</div>;

  const run = async (body: Parameters<typeof systemApi.updateSecurity>[0], message: string) => {
    setError(null);
    setOk(null);
    try {
      await systemApi.updateSecurity(body);
      setOk(message);
      setPassword("");
      setConfirmPw("");
      reload();
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-grid">
      <section className="card">
        <h2 className="card-title">Password</h2>
        <p className="muted small">Browsers (e.g. an iPad) must enter it. This desktop app never asks for it.</p>
        <div className="field-row">
          <div className="field">
            <label>{config.password_set ? "New password" : "Password"}</label>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>Repeat</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
        </div>
        <div className="page-actions" style={{ marginTop: 10 }}>
          <button
            className="btn btn-primary"
            disabled={!password || password !== confirmPw}
            onClick={() => void run({ password }, "Password saved. Web browsers must log in again.")}
          >
            {config.password_set ? "Change password" : "Set password"}
          </button>
          {config.password_set && (
            <button
              className="btn btn-danger"
              onClick={() =>
                confirm("Remove the password? Access from other devices will be turned off.") &&
                void run({ password: "", remote_access: false }, "Password removed.")
              }
            >
              Remove password
            </button>
          )}
        </div>
      </section>
      <section className="card">
        <h2 className="card-title">Access from other devices</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={config.remote_access}
            disabled={!config.password_set}
            onChange={(e) => void run({ remote_access: e.target.checked }, e.target.checked ? "Other devices on your network can now connect." : "Only this computer can connect now.")}
          />
          Allow tablets and other computers on the network
        </label>
        {!config.password_set && <p className="muted small">Set a password first.</p>}
        {network && (
          <div className="settings-urls">
            <span className="muted small">Open one of these in the iPad's browser:</span>
            {network.urls.map((url) => (
              <code key={url}>{url}</code>
            ))}
            {!config.remote_access && <span className="muted small">(Only the localhost address works until access is allowed.)</span>}
          </div>
        )}
      </section>
      <div className="settings-actions">
        <Status error={error} ok={ok} />
      </div>
    </div>
  );
}

function GroupsTab() {
  const { groups, reloadGroups } = useApp();
  const [draft, setDraft] = useState<GroupClass[]>(groups);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => setDraft(groups), [groups]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(groups);
  const update = (i: number, patch: Partial<GroupClass>) => setDraft(draft.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const move = (i: number, d: number) => {
    const next = [...draft];
    const [g] = next.splice(i, 1);
    next.splice(i + d, 0, g);
    setDraft(next);
  };
  const save = async () => {
    setError(null);
    setOk(null);
    try {
      await systemApi.saveGroups({ classes: draft });
      await reloadGroups();
      markChanged();
      setOk("Groups saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="settings-grid">
      <section className="card settings-wide">
        <h2 className="card-title">
          Slide groups
          <button
            className="btn btn-small"
            onClick={() => setDraft([...draft, { name: `Group ${draft.length + 1}`, color: "#A78BFA", numbered: false, count: 4, shading: "darken" }])}
          >
            <Plus size={14} /> Add group
          </button>
        </h2>
        <p className="muted small">
          A numbered group (like Verse) provides Verse 1…N in a submenu of the group picker, each a shade of its colour.
          Saved with your data (groups.json).
        </p>
        <div className="group-classes">
          {draft.map((g, i) => (
            <div key={i} className="group-class">
              <div className="group-class-order">
                <button className="btn btn-icon btn-small" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="btn btn-icon btn-small" disabled={i === draft.length - 1} onClick={() => move(i, 1)} title="Move down">
                  <ArrowDown size={13} />
                </button>
              </div>
              <input className="input group-class-name" value={g.name} onChange={(e) => update(i, { name: e.target.value })} />
              <input className="group-class-color" type="color" value={g.color.slice(0, 7)} onChange={(e) => update(i, { color: e.target.value.toUpperCase() })} />
              <label className="check">
                <input type="checkbox" checked={g.numbered} onChange={(e) => update(i, { numbered: e.target.checked })} />
                Numbered
              </label>
              {g.numbered && (
                <>
                  <input
                    className="input group-class-count"
                    type="number"
                    min={1}
                    max={30}
                    value={g.count}
                    onChange={(e) => update(i, { count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                    title="How many numbers"
                  />
                  <select className="select group-class-shading" value={g.shading} onChange={(e) => update(i, { shading: e.target.value as GroupClass["shading"] })}>
                    <option value="darken">Darker each</option>
                    <option value="lighten">Lighter each</option>
                    <option value="none">Same colour</option>
                  </select>
                </>
              )}
              <div className="group-class-preview">
                {groupNames(g)
                  .slice(0, 9)
                  .map((name, n) => {
                    const color = g.numbered && n > 0 ? shadeOf(g, n) : g.color.slice(0, 7);
                    return (
                      <span key={name} className="chip" style={{ borderColor: color, color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
                        {name}
                      </span>
                    );
                  })}
              </div>
              <button className="btn btn-icon btn-small" onClick={() => setDraft(draft.filter((_, j) => j !== i))} title="Delete">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>
      <div className="settings-actions">
        <Status error={error} ok={ok} />
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
          <Save size={15} /> Save groups
        </button>
      </div>
    </div>
  );
}

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function TemplatesTab() {
  const { data, reload } = useLive(() => systemApi.getTemplates());
  const [draft, setDraft] = useState<ImportTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    if (data) setDraft(data.templates);
  }, [data]);
  const update = (i: number, patch: Partial<ImportTemplate>) => setDraft(draft.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const save = async () => {
    setError(null);
    setOk(null);
    try {
      await systemApi.saveTemplates({ templates: draft });
      setOk("Templates saved.");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="settings-grid">
      <section className="card settings-wide">
        <h2 className="card-title">
          Import group templates
          <button
            className="btn btn-small"
            onClick={() => setDraft([...draft, { id: crypto.randomUUID(), name: "New template", prefix: [], repeat: ["Verse {n}"], start: 1 }])}
          >
            <Plus size={14} /> Add template
          </button>
        </h2>
        <p className="muted small">
          When importing a song, paragraph 1 gets the first name, paragraph 2 the second, and so on: first the “once” names,
          then the “repeat” names over and over. <code>{"{n}"}</code> counts the repetitions, starting at “Start”.
        </p>
        <div className="templates">
          {draft.map((t, i) => (
            <div key={t.id} className="template">
              <div className="field-row">
                <div className="field">
                  <label>Name</label>
                  <input className="input" value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Once, at the start (comma separated)</label>
                  <input className="input" defaultValue={t.prefix.join(", ")} onBlur={(e) => update(i, { prefix: list(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Then repeat (comma separated)</label>
                  <input className="input" defaultValue={t.repeat.join(", ")} onBlur={(e) => update(i, { repeat: list(e.target.value) })} />
                </div>
                <div className="field" style={{ maxWidth: 90 }}>
                  <label>Start</label>
                  <input className="input" type="number" min={0} value={t.start} onChange={(e) => update(i, { start: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="template-preview">
                {templateNames(8, t).map((name, n) => (
                  <span key={n} className="chip">
                    {name}
                  </span>
                ))}
                <span className="muted small">…</span>
                <button className="btn btn-icon btn-small" onClick={() => setDraft(draft.filter((_, j) => j !== i))} title="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="settings-actions">
        <Status error={error} ok={ok} />
        <button className="btn btn-primary" onClick={() => void save()}>
          <Save size={15} /> Save templates
        </button>
      </div>
    </div>
  );
}

function kindToForm(kind: TimerKind) {
  return {
    type: kind.type,
    minutes: kind.type === "countdown" ? String(Math.round(kind.seconds / 60)) : "5",
    time: kind.type === "to_time" ? kind.time : "10:00",
  };
}

function TimerRow({ timer }: { timer: TimerDef & { running: boolean; elapsed_ms: number; started_at: number | null } }) {
  const now = useNow(250);
  const [form, setForm] = useState({ name: timer.name, overrun: timer.allow_overrun, ...kindToForm(timer.kind) });
  const save = async () => {
    const kind: TimerKind =
      form.type === "countdown"
        ? { type: "countdown", seconds: Math.max(1, Math.round(Number(form.minutes) * 60)) }
        : form.type === "count_up"
          ? { type: "count_up" }
          : { type: "to_time", time: form.time };
    await timersApi.update({ id: timer.id, name: form.name, kind, allow_overrun: form.overrun });
    markChanged();
  };
  return (
    <div className="timer-row">
      <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={() => void save()} />
      <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TimerKind["type"] })} onBlur={() => void save()}>
        <option value="countdown">Countdown</option>
        <option value="count_up">Stopwatch</option>
        <option value="to_time">Countdown to a time</option>
      </select>
      {form.type === "countdown" && (
        <input className="input" type="number" min={1} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} onBlur={() => void save()} title="Minutes" />
      )}
      {form.type === "to_time" && (
        <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} onBlur={() => void save()} />
      )}
      {form.type === "count_up" && <span />}
      <label className="check" title="Keep counting below zero">
        <input type="checkbox" checked={form.overrun} onChange={(e) => setForm({ ...form, overrun: e.target.checked })} onBlur={() => void save()} />
        Overrun
      </label>
      <span className="timer-value">{formatDuration(timerValue(timer, now), "H:mm:ss")}</span>
      <div className="page-actions">
        <button className="btn btn-icon btn-small" onClick={() => void timersApi.action(timer.id, timer.running ? "pause" : "start").then(markChanged)} title={timer.running ? "Pause" : "Start"}>
          {timer.running ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button className="btn btn-icon btn-small" onClick={() => void timersApi.action(timer.id, "reset").then(markChanged)} title="Reset">
          <RotateCcw size={13} />
        </button>
        <button className="btn btn-icon btn-small" onClick={() => confirm(`Delete “${timer.name}”?`) && void timersApi.remove(timer.id).then(markChanged)} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function TimersTab() {
  const { data: timers } = useLive(() => timersApi.list());
  return (
    <div className="settings-grid">
      <section className="card settings-wide">
        <h2 className="card-title">
          Timers
          <button
            className="btn btn-small"
            onClick={() => void timersApi.create({ name: "New timer", kind: { type: "countdown", seconds: 300 }, allow_overrun: false }).then(markChanged)}
          >
            <Plus size={14} /> Add timer
          </button>
        </h2>
        <p className="muted small">Show a timer on screen by adding a Timer element to a theme or prop. Control them here, on the Home page or from the command bar.</p>
        <div className="timer-list">
          {(timers ?? []).map((t) => (
            <TimerRow key={t.id} timer={t} />
          ))}
          {timers?.length === 0 && <div className="empty">No timers yet.</div>}
        </div>
      </section>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<TabId>("general");
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Application, network, groups, import templates and timers.</p>
        </div>
      </header>
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "general", label: "General" },
          { id: "network", label: "Network & security" },
          { id: "groups", label: "Groups" },
          { id: "templates", label: "Import templates" },
          { id: "timers", label: "Timers" },
        ]}
      />
      <div className="page-scroll">
        {tab === "general" && <GeneralTab />}
        {tab === "network" && <NetworkTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "timers" && <TimersTab />}
      </div>
    </section>
  );
}
