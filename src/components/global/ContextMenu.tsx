import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Command, Copy, Eraser, FileUp, ImagePlus, RotateCw, X } from "lucide-react";
import { liveApi, markChanged, presenterApi } from "@/api";
import { divider, useMenu, type MenuEntry } from "@/components/ui/Menu";
import { can } from "@/lib/manager";
import { useApp } from "@/state/AppContext";
import { notifyError } from "@/state/Dialogs";
import { useManager } from "@/state/Manager";

/**
 * Menus that add their own entries before the general ones: an element with
 * `data-context-menu` gets them from `contextEntries` (set by the component that draws it).
 */
const providers = new WeakMap<Element, () => MenuEntry[]>();

/** `<div ref={(el) => contextEntries(el, () => [...])}>`: these come first in its right-click menu. */
export function contextEntries(el: Element | null, entries: () => MenuEntry[]) {
  if (el) providers.set(el, entries);
}

const run = (p: Promise<unknown>) =>
  void p.then(markChanged).catch((e) => {
    if (!String(e?.message ?? e).startsWith("nothing is live")) notifyError(e);
  });

/**
 * Right-click anywhere: OpenPres's menu instead of the browser's (Back, Reload, Inspect…).
 * Lists, rows and widgets with their own menu open theirs (they prevent this one); text
 * fields keep the system's, for cut, copy and paste.
 */
export default function ContextMenu() {
  const menu = useMenu();
  const open = menu.open;
  const { mode } = useManager();
  const { setImportOpen, requestMediaImport, openCommand } = useApp();

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      e.preventDefault();

      const entries: MenuEntry[] = [];
      // Entries of what was clicked (closest first).
      for (let el = target; el; el = el.parentElement) {
        const own = providers.get(el);
        if (own) {
          entries.push(...own(), divider(`own-${entries.length}`));
          break;
        }
      }
      const selection = window.getSelection()?.toString() ?? "";
      if (selection.trim()) {
        entries.push(
          { key: "copy", label: "Copy", icon: <Copy size={13} />, hint: "Ctrl+C", onSelect: () => void navigator.clipboard?.writeText(selection).catch(() => document.execCommand("copy")) },
          divider("d-copy"),
        );
      }
      if (can(mode, "stage")) {
        entries.push(
          { key: "previous", label: "Previous slide", icon: <ChevronLeft size={13} />, hint: "←", onSelect: () => run(presenterApi.previous("all")) },
          { key: "next", label: "Next slide", icon: <ChevronRight size={13} />, hint: "→", onSelect: () => run(presenterApi.next("all")) },
          { key: "clear-all", label: "Clear all", icon: <Eraser size={13} />, hint: "every layer shown", onSelect: () => run(liveApi.clear("all")) },
          { key: "clear-everything", label: "Clear everything", icon: <X size={13} />, hint: "and the audio", danger: true, onSelect: () => run(liveApi.clear("everything")) },
          divider("d-show"),
        );
      }
      if (can(mode, "stage")) {
        entries.push(
          { key: "import-song", label: "Import a song…", icon: <FileUp size={13} />, onSelect: () => setImportOpen(true) },
          { key: "import-media", label: "Import media…", icon: <ImagePlus size={13} />, onSelect: requestMediaImport },
          { key: "commands", label: "Command bar…", icon: <Command size={13} />, onSelect: () => openCommand("command") },
        );
      }
      entries.push(divider("d-end"), { key: "reload", label: "Reload the interface", icon: <RotateCw size={13} />, onSelect: () => window.location.reload() });
      open({ x: e.clientX, y: e.clientY }, entries, 210);
    };
    window.addEventListener("contextmenu", onContext);
    return () => window.removeEventListener("contextmenu", onContext);
  }, [open, mode, openCommand, requestMediaImport, setImportOpen]);

  return menu.element;
}
