import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Keyboard, Plus, RotateCcw, Search, X } from "lucide-react";
import { comboFromEvent, DEFAULT_BIBLE_PREFIX, DEFAULT_COMMAND_PREFIX, DEFAULT_KEYBINDS, dynamicCommands, loadCommandData, prettyCombo, staticCommands, type CommandDef, type Keybinds } from "@/lib/commands";
import { normalize } from "@/lib/search";
import { useApp } from "@/state/AppContext";
import { notifyError, useDialogs } from "@/state/Dialogs";

/** Waits for the next key combination (Escape cancels). */
function Recorder({ onDone }: { onDone: (combo: string | null) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) return onDone(null);
      const combo = comboFromEvent(e);
      if (combo) onDone(combo);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);
  return (
    <span className="kb-recording">
      <Keyboard size={13} /> Press keys… <kbd>Esc</kbd> cancels
    </span>
  );
}

/** Every command with its shortcuts; any command can get one or more. */
export default function Keybindings() {
  const { keybinds, ui, saveUi, biblePrefix, commandPrefix, openCommand, setImportOpen, requestMediaImport } = useApp();
  const { confirm } = useDialogs();
  const navigate = useNavigate();
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    const ctx = { navigate, openCommandBar: openCommand, openImport: () => setImportOpen(true), importMedia: requestMediaImport };
    void loadCommandData().then((d) => setCommands([...staticCommands(ctx), ...dynamicCommands(d)]));
  }, [navigate, openCommand, setImportOpen, requestMediaImport]);

  const byCommand = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [combo, id] of Object.entries(keybinds)) map.set(id, [...(map.get(id) ?? []), combo]);
    return map;
  }, [keybinds]);

  const save = (next: Keybinds) => void saveUi({ ...ui, keybinds: next }).catch(notifyError);

  const assign = async (id: string, combo: string) => {
    const taken = keybinds[combo];
    if (taken && taken !== id) {
      const other = commands.find((c) => c.id === taken)?.title ?? taken;
      if (!(await confirm({ title: `${prettyCombo(combo)} is used`, message: `It runs “${other}”. Use it for this command instead?`, confirmLabel: "Reassign" }))) return;
    }
    save({ ...keybinds, [combo]: id });
  };

  const q = normalize(query);
  const groups = new Map<string, CommandDef[]>();
  for (const c of commands) {
    if (c.argument) continue;
    if (q && !normalize(`${c.title} ${c.group} ${c.hint ?? ""} ${(byCommand.get(c.id) ?? []).join(" ")}`).includes(q)) continue;
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">Command bar</h2>
        <div className="field-row">
          <div className="field">
            <label>Commands start with</label>
            <input className="input" maxLength={2} value={ui.command_prefix ?? DEFAULT_COMMAND_PREFIX} onChange={(e) => void saveUi({ ...ui, command_prefix: e.target.value.trim() || DEFAULT_COMMAND_PREFIX })} />
          </div>
          <div className="field">
            <label>Bible search starts with</label>
            <input className="input" maxLength={2} value={ui.bible_prefix ?? DEFAULT_BIBLE_PREFIX} onChange={(e) => void saveUi({ ...ui, bible_prefix: e.target.value.trim() || DEFAULT_BIBLE_PREFIX })} />
          </div>
        </div>
        <p className="muted small">
          Typing nothing searches songs; <kbd>{commandPrefix}</kbd> lists commands; <kbd>{biblePrefix}</kbd> takes a Bible reference (e.g. {biblePrefix}Juan 3:16) or words to find.
        </p>
      </section>
      <section className="card">
        <h2 className="card-title">
          Keyboard shortcuts
          <div className="page-actions">
            <label className="media-search">
              <Search size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a command or key" />
            </label>
            <button
              className="btn btn-small"
              onClick={() =>
                void confirm({ title: "Restore the default shortcuts?", confirmLabel: "Restore", danger: true }).then((ok) => {
                  if (ok) save({ ...DEFAULT_KEYBINDS });
                })
              }
            >
              <RotateCcw size={14} /> Defaults
            </button>
          </div>
        </h2>
        <p className="muted small">Shortcuts without Ctrl/Alt (like the arrow keys) do nothing while you type in a text field.</p>
        {[...groups.entries()].map(([group, list]) => (
          <div key={group} className="kb-group">
            <h3 className="section-title">
              <span>{group}</span>
            </h3>
            {list.map((c) => (
              <div key={c.id} className="kb-row">
                <span className="kb-title">
                  {c.title}
                  {c.hint && <small>{c.hint}</small>}
                </span>
                <span className="kb-keys">
                  {(byCommand.get(c.id) ?? []).map((combo) => (
                    <span key={combo} className="kb-key">
                      <kbd>{prettyCombo(combo)}</kbd>
                      <button
                        className="icon-btn"
                        title="Remove"
                        onClick={() => {
                          const next = { ...keybinds };
                          delete next[combo];
                          save(next);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {recording === c.id ? (
                    <Recorder
                      onDone={(combo) => {
                        setRecording(null);
                        if (combo) void assign(c.id, combo);
                      }}
                    />
                  ) : (
                    <button className="btn btn-small kb-add" onClick={() => setRecording(c.id)} title="Add a shortcut">
                      <Plus size={13} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
