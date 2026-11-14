import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import Modal from "@/components/ui/Modal";

/**
 * In-app confirm / prompt dialogs and toasts. The browser's own confirm() and prompt()
 * do not work in every desktop webview (prompt() returns nothing on macOS), and they
 * cannot be styled.
 */

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Returns an error message for invalid input. */
  validate?: (value: string) => string | null;
}

type ToastKind = "error" | "ok" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface DialogsValue {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  notify: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<DialogsValue | null>(null);

/** Shows errors from anywhere (even outside React components). */
let globalNotify: (message: string, kind?: ToastKind) => void = (m) => console.warn(m);
export function notify(message: string, kind: ToastKind = "error") {
  globalNotify(message, kind);
}
export function notifyError(err: unknown) {
  notify(err instanceof Error ? err.message : String(err), "error");
}

type Pending =
  | { type: "confirm"; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { type: "prompt"; options: PromptOptions; resolve: (v: string | null) => void };

function PromptBody({ options, onDone }: { options: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(options.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = () => {
    const v = value.trim();
    const problem = options.validate?.(v) ?? (v ? null : "Enter a value.");
    if (problem) {
      setError(problem);
      return;
    }
    onDone(v);
  };
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {options.confirmLabel ?? "OK"}
          </button>
        </>
      }
    >
      <div className="field">
        {options.label && <label>{options.label}</label>}
        <input
          ref={input}
          className="input"
          value={value}
          placeholder={options.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        {error && <span className="field-error">{error}</span>}
      </div>
    </Modal>
  );
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ type: "confirm", options, resolve })), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => setPending({ type: "prompt", options, resolve })), []);
  const notifyFn = useCallback((message: string, kind: ToastKind = "error") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  useEffect(() => {
    globalNotify = notifyFn;
  }, [notifyFn]);

  const value = useMemo(() => ({ confirm, prompt, notify: notifyFn }), [confirm, prompt, notifyFn]);

  const finish = (v: boolean | string | null) => {
    if (!pending) return;
    if (pending.type === "confirm") pending.resolve(v === true);
    else pending.resolve(typeof v === "string" ? v : null);
    setPending(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {pending?.type === "confirm" && (
        <Modal
          title={pending.options.title}
          onClose={() => finish(false)}
          footer={
            <>
              <button className="btn" onClick={() => finish(false)}>
                Cancel
              </button>
              <button className={`btn ${pending.options.danger ? "btn-danger" : "btn-primary"}`} autoFocus onClick={() => finish(true)}>
                {pending.options.confirmLabel ?? "OK"}
              </button>
            </>
          }
        >
          {pending.options.message && <div className="dialog-message">{pending.options.message}</div>}
        </Modal>
      )}
      {pending?.type === "prompt" && <PromptBody options={pending.options} onDone={finish} />}
      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.kind === "error" ? <AlertTriangle size={16} /> : t.kind === "ok" ? <CheckCircle2 size={16} /> : <Info size={16} />}
              <span>{t.message}</span>
              <button className="icon-btn" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useDialogs(): DialogsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDialogs must be used inside DialogsProvider");
  return ctx;
}
