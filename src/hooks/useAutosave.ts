import { useEffect, useRef, useState } from "react";

export type SaveState = { status: "idle" | "pending" | "saving" | "saved" | "error"; error?: string };

const UNSET = Symbol("unset");

/**
 * Saves `value` automatically a moment after it stops changing (no Save buttons).
 * `key` identifies the document being edited: when it changes, the new value counts as
 * already saved (it was just loaded) and pending edits of the previous one are written
 * first. Pending edits are also written when the component unmounts.
 */
export function useAutosave<T>(
  key: string | number | null | undefined,
  value: T | null | undefined,
  save: (value: T) => Promise<unknown>,
  delay = 600,
): SaveState {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const saved = useRef<string | null>(null);
  const latest = useRef<{ json: string; value: T; save: (value: T) => Promise<unknown> } | null>(null);
  const keyRef = useRef<unknown>(UNSET);
  const timer = useRef<number | undefined>(undefined);

  const flush = () => {
    window.clearTimeout(timer.current);
    const next = latest.current;
    if (!next || next.json === saved.current) return;
    saved.current = next.json;
    setState({ status: "saving" });
    next
      .save(next.value)
      .then(() => setState((s) => (s.status === "saving" ? { status: "saved" } : s)))
      .catch((err) => {
        saved.current = null; // try again on the next change
        setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
  };

  const json = value === null || value === undefined ? null : JSON.stringify(value);

  useEffect(() => {
    if (json === null || value === null || value === undefined) return;
    if (key !== keyRef.current) {
      flush();
      keyRef.current = key;
      saved.current = json;
      latest.current = { json, value, save };
      setState({ status: "idle" });
      return;
    }
    latest.current = { json, value, save };
    if (json === saved.current) return;
    setState({ status: "pending" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, json, delay]);

  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

export function saveLabel(state: SaveState): string {
  switch (state.status) {
    case "pending":
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return `Not saved: ${state.error}`;
    default:
      return "";
  }
}
