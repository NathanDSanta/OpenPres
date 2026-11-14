import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Download, FileUp, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { bibleApi, markChanged, useLive } from "@/api";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { DesignPicker } from "@/components/pickers/pickers";
import { normalize } from "@/lib/search";
import { notifyError, notify, useDialogs } from "@/state/Dialogs";
import type { BibleSettings, BiblesView, CatalogEntry, ImportMeta } from "@/types";

const LANGUAGES: Record<string, string> = { es: "Spanish", spa: "Spanish", ro: "Romanian", ron: "Romanian", en: "English", eng: "English" };
const languageName = (code: string) => LANGUAGES[code.toLowerCase()] ?? code;

function ImportDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<ImportMeta>({ language: "es" });
  const [progress, setProgress] = useState<number | null>(null);
  const run = async () => {
    if (!file) return;
    try {
      setProgress(0);
      const b = await bibleApi.importFile(file, meta, setProgress);
      markChanged();
      notify(`${b.abbreviation} (${b.name}) was added.`, "ok");
      onClose();
    } catch (e) {
      setProgress(null);
      notifyError(e);
    }
  };
  return (
    <Modal
      title="Import a Bible file"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!file || progress !== null} onClick={() => void run()}>
            {progress !== null ? `Importing… ${Math.round(progress * 100)}%` : "Import"}
          </button>
        </>
      }
    >
      <div className="form-stack">
        <p className="muted small">
          Zefania XML, OSIS, OpenSong, USFM or JSON. Import only versions your church is licensed to use (for example NKJV or Cornilescu revised): they stay on this computer.
        </p>
        <input
          ref={input}
          type="file"
          hidden
          accept=".xml,.osis,.usfm,.sfm,.json,.gz,.xmm,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            setFile(f);
            if (f && !meta.name) setMeta((m) => ({ ...m, name: f.name.replace(/\.[^.]+$/, "") }));
          }}
        />
        <button className="btn" onClick={() => input.current?.click()}>
          <FileUp size={14} /> {file ? file.name : "Choose a file…"}
        </button>
        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input className="input" value={meta.name ?? ""} placeholder="From the file" onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Abbreviation</label>
            <input className="input" value={meta.abbreviation ?? ""} placeholder="NKJV" onChange={(e) => setMeta({ ...meta, abbreviation: e.target.value })} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Language</label>
            <Select
              value={meta.language ?? "es"}
              options={[
                { value: "es", label: "Spanish" },
                { value: "ro", label: "Romanian" },
                { value: "en", label: "English" },
                { value: "other", label: "Other (book names from the file)" },
              ]}
              onChange={(language) => setMeta({ ...meta, language })}
            />
          </div>
          <div className="field">
            <label>Copyright line (shown with passages)</label>
            <input className="input" value={meta.attribution ?? ""} placeholder="Optional" onChange={(e) => setMeta({ ...meta, attribution: e.target.value })} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CatalogDialog({ onClose }: { onClose: () => void }) {
  const { data, error } = useLive(() => bibleApi.catalog());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => {
    const q = normalize(query);
    return (data?.translations ?? [])
      .filter((t) => !q || normalize(`${t.name} ${t.english_name ?? ""} ${t.abbreviation ?? ""} ${t.language} ${t.language_name ?? ""}`).includes(q))
      .slice(0, 300);
  }, [data, query]);
  const download = async (t: CatalogEntry) => {
    setBusy(t.id);
    try {
      const b = await bibleApi.download(t.id, { abbreviation: t.abbreviation ?? undefined, name: t.name, language: t.language });
      markChanged();
      notify(`${b.abbreviation} (${b.name}) was added.`, "ok");
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Download a free Bible" wide onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="form-stack">
        <p className="muted small">
          Free-to-use translations from the Free Use Bible API (bible.helloao.org): public domain and openly licensed texts. Check each one's licence link before using it publicly.
        </p>
        <label className="media-search catalog-search">
          <Search size={14} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Language or name (e.g. spa, Română, Reina)" />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        {!data && !error && <p className="muted">Loading the catalog…</p>}
        <div className="catalog-list">
          {list.map((t) => (
            <div key={t.id} className="catalog-row">
              <span className="catalog-abbr">{t.abbreviation ?? t.id}</span>
              <span className="grow">
                {t.name}
                {t.english_name && t.english_name !== t.name && <small> · {t.english_name}</small>}
              </span>
              <span className="muted small">{t.language_name ?? t.language}</span>
              {t.license_url && (
                <a className="muted small" href={t.license_url} target="_blank" rel="noreferrer">
                  licence
                </a>
              )}
              <button className="btn btn-small" disabled={busy !== null} onClick={() => void download(t)}>
                <Download size={13} /> {busy === t.id ? "Downloading…" : "Add"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Installed Bibles, which ones are shown (up to 4) and with which design. */
export default function BibleSettingsPanel() {
  const { data, setData } = useLive(() => bibleApi.list());
  const { confirm } = useDialogs();
  const [dialog, setDialog] = useState<"import" | "catalog" | null>(null);
  if (!data) return <div className="empty">Loading…</div>;
  const view: BiblesView = data;

  const saveSettings = (s: BibleSettings) =>
    void bibleApi
      .saveSettings(s)
      .then((v) => {
        setData(v);
        markChanged();
      })
      .catch(notifyError);
  const versions = view.settings.versions;
  const move = (i: number, d: number) => {
    const next = [...versions];
    const [v] = next.splice(i, 1);
    next.splice(i + d, 0, v);
    saveSettings({ ...view.settings, versions: next });
  };

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">Shown versions</h2>
        <p className="muted small">
          Up to {view.max_versions} versions are shown side by side. The first one is the main version: its language is used to understand references (Juan / Ioan / John).
        </p>
        <div className="bible-versions">
          {versions.map((id, i) => {
            const b = view.installed.find((x) => x.id === id);
            return (
              <div key={id} className="bible-version">
                <span className="bible-version-index">{i + 1}</span>
                <strong>{b?.abbreviation ?? id}</strong>
                <span className="grow muted">{b?.name}</span>
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="icon-btn" disabled={i === versions.length - 1} onClick={() => move(i, 1)} title="Move down">
                  <ArrowDown size={13} />
                </button>
                <button className="icon-btn" disabled={versions.length <= 1} onClick={() => saveSettings({ ...view.settings, versions: versions.filter((v) => v !== id) })} title="Stop showing">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          {versions.length < view.max_versions && view.installed.some((b) => !versions.includes(b.id)) && (
            <Select
              value=""
              placeholder="+ Show another version"
              options={view.installed.filter((b) => !versions.includes(b.id)).map((b) => ({ value: b.id, label: `${b.abbreviation} · ${b.name}`, hint: languageName(b.language) }))}
              onChange={(id) => saveSettings({ ...view.settings, versions: [...versions, id] })}
            />
          )}
        </div>
        <div className="field-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Design</label>
            <DesignPicker kind="slides" value={view.settings.design} noneLabel="Default (versions side by side)" onChange={(design) => saveSettings({ ...view.settings, design })} />
            <span className="muted small">Any slides design works; use “Bible text” and “Bible reference” elements (one per version) to place each version.</span>
          </div>
          <label className="toggle-inline">
            <Toggle checked={view.settings.verse_numbers} onChange={(verse_numbers) => saveSettings({ ...view.settings, verse_numbers })} />
            <span className="small">Verse numbers when showing several verses</span>
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">
          Installed Bibles
          <div className="page-actions">
            <button className="btn btn-small" onClick={() => setDialog("import")}>
              <FileUp size={14} /> Import file
            </button>
            <button className="btn btn-small btn-primary" onClick={() => setDialog("catalog")}>
              <Plus size={14} /> Download
            </button>
          </div>
        </h2>
        <div className="bible-installed">
          {view.installed.map((b) => (
            <div key={b.id} className="bible-row">
              <BookOpen size={15} />
              <strong>{b.abbreviation}</strong>
              <span className="grow">
                {b.name}
                <small>
                  {languageName(b.language)}
                  {b.license ? ` · ${b.license}` : ""}
                  {b.bundled ? " · included with OpenPres" : ""}
                </small>
              </span>
              <button
                className="icon-btn"
                title="Delete"
                onClick={() =>
                  void confirm({ title: `Delete ${b.abbreviation}?`, message: b.bundled ? "It can be added back from the list of included Bibles." : "Import or download it again to use it.", confirmLabel: "Delete", danger: true }).then((ok) => {
                    if (ok)
                      void bibleApi
                        .remove(b.id)
                        .then(() => bibleApi.list())
                        .then((v) => {
                          setData(v);
                          markChanged();
                        })
                        .catch(notifyError);
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {view.installed.length === 0 && <div className="empty">No Bibles installed.</div>}
        </div>
        {view.available_bundled.length > 0 && (
          <div className="bible-restore">
            <span className="muted small">Included with OpenPres, not installed:</span>
            {view.available_bundled.map((b) => (
              <button
                key={b.id}
                className="btn btn-small"
                onClick={() =>
                  void bibleApi
                    .restoreBundled(b.id)
                    .then(() => bibleApi.list())
                    .then((v) => {
                      setData(v);
                      markChanged();
                    })
                    .catch(notifyError)
                }
              >
                <RotateCcw size={13} /> {b.abbreviation}
              </button>
            ))}
          </div>
        )}
      </section>
      {dialog === "import" && (
        <ImportDialog
          onClose={() => {
            setDialog(null);
            void bibleApi.list().then(setData);
          }}
        />
      )}
      {dialog === "catalog" && (
        <CatalogDialog
          onClose={() => {
            setDialog(null);
            void bibleApi.list().then(setData);
          }}
        />
      )}
    </div>
  );
}
