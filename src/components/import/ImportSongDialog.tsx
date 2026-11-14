import { useEffect, useMemo, useRef, useState } from "react";
import Select from "@/components/ui/Select";
import { DesignPicker } from "@/components/pickers/pickers";
import { ClipboardPaste, FileText } from "lucide-react";
import Modal from "@/components/ui/Modal";
import SlideCard from "@/components/slides/SlideCard";
import { libraryApi, markChanged, playlistApi, systemApi, themesApi } from "@/api";
import { lookForSlide, slideState } from "@/lib/looks";
import type { ImportTemplate, Library, Playlist, Presentation, Theme } from "@/types";
import "./ImportSongDialog.css";

type SplitMode = "paragraph" | "1" | "2" | "3" | "4";

const SPLIT_LABELS: Record<SplitMode, string> = {
  paragraph: "One slide per paragraph",
  "1": "Every line",
  "2": "Every 2 lines",
  "3": "Every 3 lines",
  "4": "Every 4 lines",
};

/** Lines the .pres format would read as separators are softened. */
function cleanLine(line: string): string {
  const t = line.trim();
  if (t === "###" || /^-{3,}.*-{3,}$/.test(t) || /^-{6,}$/.test(t)) return t.replace(/-/g, "—").replace(/#/g, "＃");
  return line.replace(/\s+$/, "");
}

/** Paragraphs (separated by blank lines), each split into slides. */
export function splitText(text: string, mode: SplitMode): string[][] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map(cleanLine).filter((l) => l.trim()))
    .filter((lines) => lines.length > 0);
  return paragraphs.map((lines) => {
    if (mode === "paragraph") return [lines.join("\n")];
    const size = Number(mode);
    const slides: string[] = [];
    for (let i = 0; i < lines.length; i += size) slides.push(lines.slice(i, i + size).join("\n"));
    return slides;
  });
}

/** Group name for each paragraph following a template ({n} counts repetitions). */
export function templateNames(count: number, template: ImportTemplate | null): string[] {
  if (!template) return Array.from({ length: count }, () => "Slides");
  const names: string[] = [];
  for (const name of template.prefix) if (names.length < count) names.push(name);
  let n = template.start;
  while (names.length < count) {
    if (template.repeat.length === 0) {
      names.push(`Slides ${names.length + 1}`);
      continue;
    }
    for (const name of template.repeat) {
      if (names.length >= count) break;
      names.push(name.replace(/\{n\}/g, String(n)));
    }
    n += 1;
  }
  return names;
}

/** Turns paragraphs + names into unique groups (consecutive equal names merge). */
export function buildGroups(paragraphs: string[][], names: string[]) {
  const groups: { name: string; slides: { text: string }[] }[] = [];
  const used = new Map<string, number>();
  paragraphs.forEach((slides, i) => {
    const wanted = names[i] ?? "Slides";
    const last = groups[groups.length - 1];
    if (last && last.name === wanted) {
      last.slides.push(...slides.map((text) => ({ text })));
      return;
    }
    let name = wanted;
    const seen = used.get(wanted.toLowerCase()) ?? 0;
    if (seen > 0) name = `${wanted} (${seen + 1})`;
    used.set(wanted.toLowerCase(), seen + 1);
    groups.push({ name: name.replace(/[,\n]/g, " "), slides: slides.map((text) => ({ text })) });
  });
  return groups;
}

export default function ImportSongDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"source" | "settings">("source");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [libraryId, setLibraryId] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [split, setSplit] = useState<SplitMode>("paragraph");
  const [themeId, setThemeId] = useState("");
  const [designId, setDesignId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [theme, setTheme] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([libraryApi.listLibraries(), playlistApi.list(), systemApi.getTemplates()])
      .then(([libs, pls, tpl]) => {
        setLibraries(libs);
        setPlaylists(pls);
        setTemplates(tpl.templates);
        setLibraryId((current) => current || libs[0]?.id || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!themeId) {
      setTheme(null);
      return;
    }
    void themesApi.get(themeId).then((t) => {
      setTheme(t);
      setDesignId((d) => (t.designs.some((x) => x.id === d) ? d : t.designs[0]?.id ?? ""));
    });
  }, [themeId]);

  const begin = (content: string, name?: string) => {
    const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? "Untitled";
    setText(content);
    setTitle(name ? name.replace(/\.[^.]+$/, "") : firstLine.trim().slice(0, 80));
    setStep("settings");
  };

  const fromClipboard = async () => {
    setError(null);
    try {
      const content = await navigator.clipboard.readText();
      if (content.trim()) {
        begin(content);
        return;
      }
    } catch {
      /* permission denied: paste by hand */
    }
    setPasteMode(true);
  };

  const template = templates.find((t) => t.id === templateId) ?? null;
  const paragraphs = useMemo(() => splitText(text, split), [text, split]);
  const groups = useMemo(() => buildGroups(paragraphs, templateNames(paragraphs.length, template)), [paragraphs, template]);
  const flat = useMemo(() => groups.flatMap((g) => g.slides.map((s) => ({ group: g.name, text: s.text }))), [groups]);
  const previewPresentation = useMemo(
    () => ({ id: "preview", nameid: title, metadata: designId ? { design: designId } : {}, groups, arrangements: [] }) as Presentation,
    [designId, groups, title],
  );

  const save = async () => {
    if (!libraryId) {
      setError("Choose the library to import into.");
      return;
    }
    if (!title.trim()) {
      setError("Enter a title.");
      return;
    }
    if (flat.length === 0) {
      setError("There is no text to import.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const metadata: Record<string, string> = { title: title.trim().replace(/\n/g, " ") };
      if (themeId) metadata.theme = themeId;
      if (themeId && designId) metadata.design = designId;
      const created = await libraryApi.createPresentation(libraryId, { nameid: title.trim(), metadata, groups });
      if (playlistId) {
        const playlist = await playlistApi.get(playlistId);
        await playlistApi.update(playlistId, {
          name: playlist.name,
          presentation_ids: [...playlist.presentation_ids, created.id],
        });
      }
      markChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (step === "source") {
    return (
      <Modal title="Import song" onClose={onClose}>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.text,.md,.lyrics,text/plain"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) begin(await file.text(), file.name);
          }}
        />
        {!pasteMode ? (
          <div className="import-sources">
            <button className="import-source" onClick={() => fileInput.current?.click()}>
              <FileText size={28} />
              <strong>From a file</strong>
              <span>A plain text file with the lyrics</span>
            </button>
            <button className="import-source" onClick={() => void fromClipboard()}>
              <ClipboardPaste size={28} />
              <strong>From the clipboard</strong>
              <span>Lyrics you copied</span>
            </button>
          </div>
        ) : (
          <div className="field">
            <label>Paste the lyrics (Ctrl/⌘ + V)</label>
            <textarea className="textarea" rows={12} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            <div className="page-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setPasteMode(false)}>Back</button>
              <button className="btn btn-primary" disabled={!text.trim()} onClick={() => begin(text)}>
                Continue
              </button>
            </div>
          </div>
        )}
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </Modal>
    );
  }

  return (
    <Modal
      title="Import song"
      onClose={onClose}
      wide
      footer={
        <>
          {error && <span className="import-footer-error">{error}</span>}
          <button className="btn" onClick={() => setStep("source")}>Back</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Importing…" : `Import ${flat.length} slide${flat.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="import-layout">
        <aside className="import-settings">
          <div className="field">
            <label>Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Library (required)</label>
            <Select value={libraryId || null} placeholder="Choose…" onChange={setLibraryId} options={libraries.map((l) => ({ value: l.id, label: l.name }))} />
          </div>
          <div className="field">
            <label>Add to playlist (optional)</label>
            <Select value={playlistId} onChange={setPlaylistId} options={[{ value: "", label: "None" }, ...playlists.map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
          <div className="field">
            <label>Slides</label>
            <Select<SplitMode> value={split} onChange={setSplit} options={(Object.entries(SPLIT_LABELS) as [SplitMode, string][]).map(([value, label]) => ({ value, label }))} />
            <span className="muted small">Groups follow the paragraphs (blank lines) of the text.</span>
          </div>
          <div className="field">
            <label>Design</label>
            <DesignPicker
              value={themeId ? { theme_id: themeId, design_id: designId } : null}
              noneLabel="Default look"
              onChange={(ref) => {
                setThemeId(ref?.theme_id ?? "");
                setDesignId(ref?.design_id ?? "");
              }}
            />
          </div>
          <div className="field">
            <label>Group template (optional)</label>
            <Select value={templateId} onChange={setTemplateId} options={[{ value: "", label: "None (one group)" }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
            <span className="muted small">Edit templates in Settings → Import templates.</span>
          </div>
          <details className="import-text-details">
            <summary>Edit text</summary>
            <textarea className="textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          </details>
        </aside>
        <section className="import-preview">
          {flat.length === 0 ? (
            <div className="empty">No text found.</div>
          ) : (
            <div className="import-grid">
              {flat.map((slide, i) => (
                <SlideCard
                  key={i}
                  look={lookForSlide(theme, previewPresentation, slide.group)}
                  slide={slideState(title, flat, i)}
                  number={i + 1}
                  group={slide.group}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
