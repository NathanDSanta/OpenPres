import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { systemApi } from "@/api/system";
import { DEFAULT_BIBLE_PREFIX, DEFAULT_COMMAND_PREFIX, DEFAULT_KEYBINDS, type Keybinds, type UiSettings } from "@/lib/commands";
import type { GroupClass } from "@/types";

export type CommandMode = "present" | "command" | "bible";

interface AppContextValue {
  groups: GroupClass[];
  reloadGroups: () => Promise<void>;
  /** Presentation selected in the Songs tab (kept while switching tabs). */
  songsSelection: string | null;
  setSongsSelection: (id: string | null) => void;
  /** Presentation being edited in Reflow; follows Songs until changed in Reflow. */
  reflowSelection: string | null;
  setReflowSelection: (id: string | null) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  mediaImportRequest: number;
  requestMediaImport: () => void;
  commandOpen: CommandMode | null;
  openCommand: (mode: CommandMode | null) => void;
  /** Keyboard shortcuts and command bar prefixes (saved on the server). */
  ui: UiSettings;
  keybinds: Keybinds;
  biblePrefix: string;
  commandPrefix: string;
  saveUi: (next: UiSettings) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<GroupClass[]>([]);
  const [songsSelection, setSongs] = useState<string | null>(null);
  const [reflowSelection, setReflowSelection] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mediaImportRequest, setMediaImportRequest] = useState(0);
  const [commandOpen, openCommand] = useState<CommandMode | null>(null);
  const [ui, setUi] = useState<UiSettings>({});

  useEffect(() => {
    systemApi
      .getUiSettings<UiSettings>()
      .then((s) => setUi(s ?? {}))
      .catch(() => {});
  }, []);

  const saveUi = useCallback(async (next: UiSettings) => {
    setUi(next);
    await systemApi.saveUiSettings(next);
  }, []);

  const reloadGroups = useCallback(async () => {
    try {
      setGroups((await systemApi.getGroups()).classes);
    } catch {
      /* not logged in yet */
    }
  }, []);

  useEffect(() => {
    void reloadGroups();
  }, [reloadGroups]);

  const setSongsSelection = useCallback((id: string | null) => {
    setSongs(id);
    // A new choice in Songs carries over to Reflow.
    if (id) setReflowSelection(id);
  }, []);

  const value = useMemo(
    () => ({
      groups,
      reloadGroups,
      songsSelection,
      setSongsSelection,
      reflowSelection,
      setReflowSelection,
      importOpen,
      setImportOpen,
      mediaImportRequest,
      requestMediaImport: () => setMediaImportRequest((n) => n + 1),
      commandOpen,
      openCommand,
      ui,
      keybinds: ui.keybinds ?? DEFAULT_KEYBINDS,
      biblePrefix: ui.bible_prefix || DEFAULT_BIBLE_PREFIX,
      commandPrefix: ui.command_prefix || DEFAULT_COMMAND_PREFIX,
      saveUi,
    }),
    [groups, reloadGroups, songsSelection, setSongsSelection, reflowSelection, importOpen, mediaImportRequest, commandOpen, ui, saveUi],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
