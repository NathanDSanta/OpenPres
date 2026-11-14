import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { markChanged, setHttpTransportPort, systemApi, useLive } from "@/api";
import { initServer } from "@/api/server";
import Tabs from "@/components/ui/Tabs";
import Select from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import Keybindings from "@/components/settings/Keybindings";
import BibleSettingsPanel from "@/components/settings/BibleSettings";
import YoutubeSettings from "@/components/settings/YoutubeSettings";
import SystemInfo from "@/components/settings/SystemInfo";
import { templateNames } from "@/components/import/ImportSongDialog";
import { useAutosave, saveLabel } from "@/hooks/useAutosave";
import { groupNames, shadeOf } from "@/lib/groups";
import { newId } from "@/lib/scene/defaults";
import { useApp } from "@/state/AppContext";
import { notify, notifyError, useDialogs } from "@/state/Dialogs";
import type { GroupClass, ImportTemplate } from "@/types";
import "@/styles/Settings.css";

type TabId = "general" | "keys" | "bibles" | "youtube" | "network" | "groups" | "templates" | "system";

function SaveState({ state }: { state: ReturnType<typeof useAutosave> }) {
  const label = saveLabel(state);
  return label ? <span className={`save-state${state.status === "error" ? " error" : ""}`}>{label}</span> : null;
}

function GeneralTab() {
  const { data: config, reload } = useLive(() => systemApi.getConfig());
  const [port, setPort] = useState("");
  const [ffmpeg, setFfmpeg] = useState("");
  useEffect(() => {
    if (config) {
      setPort(String(config.api_port));
      setFfmpeg(config.ffmpeg_path === "ffmpeg" ? "" : config.ffmpeg_path);
    }
  }, [config]);
  if (!config) return <div className="empty">Loading…</div>;

  // The port is the one setting with an explicit Apply: changing it moves the server.
  const applyPort = async () => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      notify("Enter a port between 1024 and 65535.");
      return;
    }
    try {
      const updated = await systemApi.updateConfig({ api_port: p });
      setHttpTransportPort(updated.api_port);
      await initServer(true);
      notify(`The server now listens on port ${updated.api_port}.`, "ok");
      reload();
    } catch (err) {
      notifyError(err);
    }
  };

  const saveFfmpeg = () => {
    if (ffmpeg.trim() === (config.ffmpeg_path === "ffmpeg" ? "" : config.ffmpeg_path)) return;
    void systemApi
      .updateConfig({ ffmpeg_path: ffmpeg.trim() })
      .then(() => {
        reload();
        notify("ffmpeg path saved.", "ok");
      })
      .catch(notifyError);
  };

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">Server port</h2>
        <div className="settings-inline">
          <input className="input" type="number" value={port} onChange={(e) => setPort(e.target.value)} style={{ maxWidth: 160 }} />
          <button className="btn btn-primary" disabled={port === String(config.api_port)} onClick={() => void applyPort()}>
            <Check size={14} /> Apply
          </button>
        </div>
        <span className="muted small">Used by the web interface (iPad) and other tools.</span>
      </section>
      <section className="card">
        <h2 className="card-title">ffmpeg</h2>
        <div className="field">
          <label>Path to ffmpeg (optional)</label>
          <input className="input" value={ffmpeg} onChange={(e) => setFfmpeg(e.target.value)} onBlur={saveFfmpeg} placeholder="Empty: the ffmpeg included with OpenPres" />
          <span className="muted small">Used to stream, record and play some audio formats. Saved when you leave the field.</span>
        </div>
      </section>
    </div>
  );
}

function NetworkTab() {
  const { data: config, reload } = useLive(() => systemApi.getConfig());
  const { data: network } = useLive(() => systemApi.network());
  const { confirm } = useDialogs();
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  if (!config) return <div className="empty">Loading…</div>;

  const run = async (body: Parameters<typeof systemApi.updateSecurity>[0], message: string) => {
    try {
      await systemApi.updateSecurity(body);
      notify(message, "ok");
      setPassword("");
      setConfirmPw("");
      reload();
      markChanged();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <div className="settings-stack">
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
          <button className="btn btn-primary" disabled={!password || password !== confirmPw} onClick={() => void run({ password }, "Password set. Web browsers must log in again.")}>
            {config.password_set ? "Change password" : "Set password"}
          </button>
          {config.password_set && (
            <button
              className="btn btn-danger"
              onClick={() =>
                void confirm({ title: "Remove the password?", message: "Access from other devices is turned off.", confirmLabel: "Remove", danger: true }).then((ok) => {
                  if (ok) void run({ password: "", remote_access: false }, "Password removed.");
                })
              }
            >
              Remove password
            </button>
          )}
        </div>
      </section>
      <section className="card">
        <h2 className="card-title">Access from other devices</h2>
        <label className="toggle-inline">
          <Toggle
            checked={config.remote_access}
            disabled={!config.password_set}
            onChange={(on) => void run({ remote_access: on }, on ? "Other devices on your network can now connect." : "Only this computer can connect now.")}
          />
          <span>Allow tablets and other computers on the network</span>
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
    </div>
  );
}

function GroupsTab() {
  const { groups, reloadGroups } = useApp();
  const [draft, setDraft] = useState<GroupClass[] | null>(null);
  useEffect(() => {
    if (draft === null && groups.length) setDraft(groups);
  }, [groups, draft]);
  const state = useAutosave("groups", draft, async (classes) => {
    await systemApi.saveGroups({ classes: classes.filter((g) => g.name.trim()) });
    await reloadGroups();
    markChanged();
  });
  if (!draft) return <div className="empty">Loading…</div>;
  const update = (i: number, patch: Partial<GroupClass>) => setDraft(draft.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const move = (i: number, d: number) => {
    const next = [...draft];
    const [g] = next.splice(i, 1);
    next.splice(i + d, 0, g);
    setDraft(next);
  };
  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">
          Slide groups
          <div className="page-actions">
            <SaveState state={state} />
            <button className="btn btn-small" onClick={() => setDraft([...draft, { name: `Group ${draft.length + 1}`, color: "#A78BFA", numbered: false, count: 4, shading: "darken" }])}>
              <Plus size={14} /> Add group
            </button>
          </div>
        </h2>
        <p className="muted small">A numbered group (like Verse) provides Verse 1…N in a submenu of the group picker, each a shade of its colour.</p>
        <div className="group-classes">
          {draft.map((g, i) => (
            <div key={i} className="group-class">
              <div className="group-class-order">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="icon-btn" disabled={i === draft.length - 1} onClick={() => move(i, 1)} title="Move down">
                  <ArrowDown size={13} />
                </button>
              </div>
              <input className="input group-class-name" value={g.name} onChange={(e) => update(i, { name: e.target.value })} />
              <input className="group-class-color" type="color" value={g.color.slice(0, 7)} onChange={(e) => update(i, { color: e.target.value.toUpperCase() })} />
              <label className="toggle-inline">
                <Toggle small checked={g.numbered} onChange={(numbered) => update(i, { numbered })} />
                <span className="small">Numbered</span>
              </label>
              {g.numbered && (
                <>
                  <input className="input group-class-count" type="number" min={1} max={30} value={g.count} onChange={(e) => update(i, { count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} title="How many numbers" />
                  <div className="group-class-shading">
                    <Select
                      small
                      value={g.shading}
                      options={[
                        { value: "darken", label: "Darker each" },
                        { value: "lighten", label: "Lighter each" },
                        { value: "none", label: "Same colour" },
                      ]}
                      onChange={(shading) => update(i, { shading })}
                    />
                  </div>
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
              <button className="icon-btn" onClick={() => setDraft(draft.filter((_, j) => j !== i))} title="Delete">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function TemplatesTab() {
  const { data } = useLive(() => systemApi.getTemplates());
  const [draft, setDraft] = useState<ImportTemplate[] | null>(null);
  useEffect(() => {
    if (data && draft === null) setDraft(data.templates);
  }, [data, draft]);
  const state = useAutosave("templates", draft, (templates) => systemApi.saveTemplates({ templates }));
  if (!draft) return <div className="empty">Loading…</div>;
  const update = (i: number, patch: Partial<ImportTemplate>) => setDraft(draft.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">
          Import group templates
          <div className="page-actions">
            <SaveState state={state} />
            <button className="btn btn-small" onClick={() => setDraft([...draft, { id: newId(), name: "New template", prefix: [], repeat: ["Verse {n}"], start: 1 }])}>
              <Plus size={14} /> Add template
            </button>
          </div>
        </h2>
        <p className="muted small">
          When importing a song, paragraph 1 gets the first name, paragraph 2 the second, and so on: first the “once” names, then the “repeat” names over and over. <code>{"{n}"}</code> counts the repetitions, starting at “Start”.
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
                <button className="icon-btn" onClick={() => setDraft(draft.filter((_, j) => j !== i))} title="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<TabId>("general");
  return (
    <section className="page">
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "general", label: "General" },
          { id: "keys", label: "Keyboard shortcuts" },
          { id: "bibles", label: "Bibles" },
          { id: "youtube", label: "YouTube" },
          { id: "network", label: "Network & security" },
          { id: "groups", label: "Groups" },
          { id: "templates", label: "Import templates" },
          { id: "system", label: "System" },
        ]}
      />
      <div className="page-scroll">
        {tab === "general" && <GeneralTab />}
        {tab === "keys" && <Keybindings />}
        {tab === "bibles" && <BibleSettingsPanel />}
        {tab === "youtube" && <YoutubeSettings />}
        {tab === "network" && <NetworkTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "system" && <SystemInfo />}
      </div>
    </section>
  );
}
