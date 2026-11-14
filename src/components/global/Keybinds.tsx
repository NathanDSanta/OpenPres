import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { markChanged } from "@/api";
import { comboFromEvent, dynamicCommands, loadCommandData, staticCommands } from "@/lib/commands";
import { notifyError } from "@/state/Dialogs";
import { useApp } from "@/state/AppContext";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/** Runs the command bound to each key combination (Settings, Keyboard shortcuts). */
export default function Keybinds() {
  const { keybinds, openCommand, setImportOpen, requestMediaImport } = useApp();
  const navigate = useNavigate();
  const ctx = useMemo(
    () => ({
      navigate,
      openCommandBar: (mode: "present" | "command" | "bible") => openCommand(mode),
      openImport: () => setImportOpen(true),
      importMedia: requestMediaImport,
    }),
    [navigate, openCommand, setImportOpen, requestMediaImport],
  );
  const statics = useMemo(() => staticCommands(ctx), [ctx]);
  const busy = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat && !e.key.startsWith("Arrow")) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const id = keybinds[combo];
      if (!id) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      // Plain keys belong to text fields, menus and open dialogs.
      if (plain && (isTyping(e.target) || document.querySelector(".modal-backdrop, .cmd-backdrop, [data-menu-panel]"))) return;
      e.preventDefault();
      const run = async () => {
        let command = statics.find((c) => c.id === id);
        if (!command) {
          if (busy.current) return;
          busy.current = true;
          try {
            command = dynamicCommands(await loadCommandData()).find((c) => c.id === id);
          } finally {
            busy.current = false;
          }
        }
        if (!command || command.argument) return;
        await command.run();
        markChanged();
      };
      run().catch((err) => {
        // Nothing live to move is not worth a message.
        if (String(err?.message ?? err).startsWith("nothing is live")) return;
        notifyError(err);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keybinds, statics]);

  return null;
}
