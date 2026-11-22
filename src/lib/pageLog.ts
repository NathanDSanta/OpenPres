import { hasTauriRuntime } from "@/api/transport";

/**
 * Copies the page's console (and uncaught errors) to the log file of the program showing it:
 * the server's for its own windows, the manager's for the interface opened in the manager.
 * In a browser (an iPad, another computer) there's no log file: nothing changes.
 */
type Level = "error" | "warn" | "info" | "log" | "debug";
type Line = { level: Level; message: string };

const MAX_LINE = 8000;
const FLUSH_MS = 300;

let queue: Line[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function push(level: Level, args: unknown[]) {
  // A line logged while sending (an error inside invoke) isn't sent again: no loops.
  if (sending) return;
  let message = args.map(text).join(" ");
  if (message.length > MAX_LINE) message = `${message.slice(0, MAX_LINE)}…`;
  queue.push({ level, message });
  if (queue.length > 500) queue = queue.slice(-500);
  timer ??= setTimeout(flush, FLUSH_MS);
}

async function flush() {
  timer = undefined;
  if (queue.length === 0) return;
  const lines = queue;
  queue = [];
  sending = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("page_log", { lines });
  } catch {
    // An older app without page_log, or not allowed: the console still has it.
  } finally {
    sending = false;
  }
}

export function installPageLog() {
  if (!hasTauriRuntime()) return;
  for (const level of ["error", "warn", "info", "log", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      push(level, args);
    };
  }
  window.addEventListener("error", (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : "";
    push("error", [`uncaught: ${e.error instanceof Error ? text(e.error) : e.message}${where}`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    push("error", ["unhandled promise rejection:", e.reason]);
  });
  // Don't lose the last lines when the page goes away (reload, another server).
  window.addEventListener("pagehide", () => void flush());
  push("info", [`page opened: ${location.pathname}`]);
}
