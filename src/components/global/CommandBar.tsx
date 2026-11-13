import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Command as CommandIcon, CornerDownLeft, Megaphone, Presentation, Search } from "lucide-react";
import {
  audioApi,
  devicesApi,
  libraryApi,
  liveApi,
  mediaApi,
  presenterApi,
  screensApi,
  streamApi,
  systemApi,
  themesApi,
  timersApi,
} from "@/api";
import { search } from "@/lib/search";
import { useApp, type CommandMode } from "@/state/AppContext";
import { NAVIGATION } from "./Sidebar";
import type { PresentationSummary } from "@/types";
import "./styles/CommandBar.css";

interface CommandItem {
  title: string;
  hint?: string;
  /** Text matched against the query (defaults to the title). */
  keywords?: string;
  /** Commands that take a typed value, e.g. "Set API port 9000". */
  argument?: { prefix: string; placeholder: string };
  run: (arg?: string) => Promise<unknown> | void;
}

interface Data {
  presentations: PresentationSummary[];
  commands: CommandItem[];
}

async function loadData(
  navigate: (path: string) => void,
  openImport: () => void,
  importMedia: () => void,
): Promise<Data> {
  const safe = async <T,>(p: Promise<T>, fallback: T) => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };
  const [presentations, audio, props, timers, playlists, cameras, screens] = await Promise.all([
    safe(libraryApi.listAllPresentations(), []),
    safe(audioApi.get(), null),
    safe(themesApi.list("props"), []),
    safe(timersApi.list(), []),
    safe(mediaApi.playlists(), []),
    safe(devicesApi.listVideo(), []),
    safe(screensApi.list(), []),
  ]);

  const commands: CommandItem[] = [
    { title: "Next slide", hint: "slides and announcements", run: () => presenterApi.next("all") },
    { title: "Previous slide", hint: "slides and announcements", run: () => presenterApi.previous("all") },
    { title: "Next slide (slides only)", run: () => presenterApi.next("slides") },
    { title: "Next announcement", run: () => presenterApi.next("announcements") },
    { title: "Clear slides", run: () => presenterApi.clear("slides") },
    { title: "Clear announcements", run: () => presenterApi.clear("announcements") },
    { title: "Clear media", run: () => mediaApi.clear("visual") },
    { title: "Clear audio", run: () => mediaApi.clear("audio") },
    { title: "Clear video input", run: () => liveApi.setVideoInput(null) },
    { title: "Clear props", run: () => liveApi.clearProps("props") },
    { title: "Clear complements", run: () => liveApi.clearProps("complements") },
    { title: "Clear all", hint: "every visual layer", run: () => liveApi.clear("all") },
    { title: "Clear everything", hint: "layers and audio", run: () => liveApi.clear("everything") },
    { title: "Play / pause media", run: () => mediaApi.toggle("visual") },
    { title: "Play / pause audio", run: () => mediaApi.toggle("audio") },
    { title: "Next media item", run: () => mediaApi.next("visual") },
    { title: "Next audio track", run: () => mediaApi.next("audio") },
    { title: "Import song", run: openImport },
    { title: "Import media", run: importMedia },
    { title: "Start stream", run: () => streamApi.start() },
    { title: "Stop stream", run: () => streamApi.stop() },
    { title: "Refresh displays", run: () => screensApi.refreshDisplays() },
    { title: "Refresh devices", run: () => devicesApi.refresh() },
    { title: "Restart audio engine", run: () => audioApi.restart() },
    {
      title: "Set API port",
      argument: { prefix: "set api port", placeholder: "port number, e.g. 8787" },
      run: async (arg) => {
        const port = Number(arg);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Enter a port between 1024 and 65535.");
        await systemApi.updateConfig({ api_port: port });
      },
    },
    {
      title: "Go to slide",
      argument: { prefix: "go to slide", placeholder: "slide number" },
      run: async (arg) => {
        const n = Number(arg);
        if (!Number.isInteger(n) || n < 1) throw new Error("Enter a slide number.");
        await presenterApi.goto(n - 1, "slides");
      },
    },
    ...NAVIGATION.map((n) => ({ title: `Go to ${n.name}`, keywords: `open ${n.name} tab page`, run: () => navigate(n.path) })),
  ];

  for (const input of audio?.config.inputs ?? []) {
    commands.push(
      { title: `Mute ${input.name}`, hint: "audio input", run: () => audioApi.setLevels(input.id, { muted: true }) },
      { title: `Unmute ${input.name}`, hint: "audio input", run: () => audioApi.setLevels(input.id, { muted: false }) },
    );
  }
  for (const output of audio?.config.outputs ?? []) {
    commands.push(
      { title: `Mute output ${output.name}`, run: () => audioApi.setLevels(output.id, { muted: true }) },
      { title: `Unmute output ${output.name}`, run: () => audioApi.setLevels(output.id, { muted: false }) },
    );
  }
  for (const theme of props) {
    for (const design of theme.designs) {
      commands.push(
        { title: `Toggle prop ${design.name}`, hint: theme.name, run: () => liveApi.setProp("props", theme.id, design.id) },
        { title: `Toggle complement ${design.name}`, hint: theme.name, run: () => liveApi.setProp("complements", theme.id, design.id) },
      );
    }
  }
  for (const timer of timers) {
    commands.push(
      { title: `Start timer ${timer.name}`, run: () => timersApi.action(timer.id, "start") },
      { title: `Pause timer ${timer.name}`, run: () => timersApi.action(timer.id, "pause") },
      { title: `Reset timer ${timer.name}`, run: () => timersApi.action(timer.id, "reset") },
    );
  }
  for (const p of playlists) {
    commands.push({
      title: `Play ${p.name}`,
      hint: p.kind === "audio" ? "audio playlist" : "media playlist",
      run: () => mediaApi.play(p.kind === "audio" ? "audio" : "visual", { playlist_id: p.id }),
    });
  }
  for (const cam of cameras) {
    commands.push({ title: `Show camera ${cam.name}`, hint: "video input layer", run: () => liveApi.setVideoInput(cam.id) });
  }
  for (const screen of screens) {
    commands.push({ title: `Edit screen ${screen.name}`, run: () => navigate(`/screens?edit=${screen.id}`) });
  }
  return { presentations, commands };
}

export default function CommandBar() {
  const { commandOpen, openCommand, setImportOpen, requestMediaImport } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!commandOpen) return;
    setQuery(commandOpen === "command" ? ">" : "");
    setSelected(0);
    setError(null);
    void loadData(navigate, () => setImportOpen(true), requestMediaImport).then(setData);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [commandOpen, navigate, setImportOpen, requestMediaImport]);

  const mode: CommandMode = query.startsWith(">") ? "command" : "present";
  const text = mode === "command" ? query.slice(1).trimStart() : query;

  const results = useMemo(() => {
    if (!data) return [];
    if (mode === "present") {
      return search(data.presentations, text, (p) => p.title).slice(0, 50).map((p) => ({ kind: "presentation" as const, p }));
    }
    // Commands with a typed value match on their prefix, the rest by search.
    const lower = text.toLowerCase();
    const withArgs = data.commands
      .filter((c) => c.argument && lower.startsWith(c.argument.prefix))
      .map((c) => ({ kind: "command" as const, c, arg: text.slice(c.argument!.prefix.length).trim() }));
    const matched = search(data.commands, text, (c) => `${c.title} ${c.keywords ?? ""} ${c.hint ?? ""}`)
      .filter((c) => !withArgs.some((w) => w.c === c))
      .map((c) => ({ kind: "command" as const, c, arg: undefined as string | undefined }));
    return [...withArgs, ...matched].slice(0, 60);
  }, [data, mode, text]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".cmd-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!commandOpen) return null;
  const close = () => openCommand(null);

  const run = async (index: number) => {
    const item = results[index];
    if (!item) return;
    setError(null);
    try {
      if (item.kind === "presentation") {
        await presenterApi.load({ presentation_id: item.p.id, index: 0 });
      } else {
        if (item.c.argument && !item.arg) {
          setQuery(`>${item.c.argument.prefix} `);
          return;
        }
        await item.c.run(item.arg);
      }
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const complete = () => {
    const item = results[selected];
    if (item?.kind === "command") {
      setQuery(`>${item.c.argument ? `${item.c.argument.prefix} ` : item.c.title.toLowerCase()}`);
    }
  };

  return (
    <div className="cmd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmd-panel" role="dialog" aria-label="Command bar">
        <div className="cmd-input-row">
          {mode === "command" ? <CommandIcon size={20} /> : <Search size={20} />}
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            placeholder={mode === "command" ? "Type a command…" : "Search all libraries and press Enter to present…"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void run(selected);
              } else if (e.key === "Tab") {
                e.preventDefault();
                complete();
              }
            }}
          />
          <span className={`cmd-mode ${mode}`}>{mode === "command" ? "Command" : "Present"}</span>
        </div>
        {error && <div className="cmd-error">{error}</div>}
        <div className="cmd-results" ref={listRef}>
          {!data && <div className="cmd-empty">Loading…</div>}
          {data && results.length === 0 && (
            <div className="cmd-empty">
              {mode === "present" ? "No presentation matches. Type > for commands." : "No command matches."}
            </div>
          )}
          {results.map((item, i) => (
            <button
              key={item.kind === "presentation" ? item.p.id : `${item.c.title}-${i}`}
              className={`cmd-item${i === selected ? " selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void run(i)}
            >
              {item.kind === "presentation" ? (
                <>
                  {item.p.layer === "announcements" ? <Megaphone size={16} /> : <Presentation size={16} />}
                  <span className="cmd-title">{item.p.title}</span>
                  <span className="cmd-hint">{item.p.library_name}</span>
                </>
              ) : (
                <>
                  <ChevronRight size={16} />
                  <span className="cmd-title">
                    {item.c.argument ? (
                      <>
                        {item.c.title} <em>{item.arg || item.c.argument.placeholder}</em>
                      </>
                    ) : (
                      item.c.title
                    )}
                  </span>
                  {item.c.hint && <span className="cmd-hint">{item.c.hint}</span>}
                </>
              )}
              {i === selected && <CornerDownLeft size={14} className="cmd-enter" />}
            </button>
          ))}
        </div>
        <footer className="cmd-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
          <span><kbd>Enter</kbd> {mode === "present" ? "present first slide" : "run"}</span>
          {mode === "command" && <span><kbd>Tab</kbd> complete</span>}
          <span><kbd>&gt;</kbd> commands</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
