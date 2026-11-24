import { Square } from "lucide-react";
import { macrosApi, markChanged, useLive } from "@/api";
import { macroIcon } from "@/lib/macros";
import { notifyError } from "@/state/Dialogs";
import "@/styles/Macros.css";

const run = (p: Promise<unknown>) => void p.then(markChanged).catch(notifyError);

/** A button for each macro the admin set up; a running one stops when pressed again. */
export default function MacrosWidget({ w, cell }: { w: number; cell: number }) {
  const { data } = useLive(() => macrosApi.list(), [], ["macros"]);
  const { data: status } = useLive(() => macrosApi.status(), [], ["macros"]);
  const macros = data?.macros ?? [];
  const running = new Set(status?.running ?? []);
  // Names only fit when the buttons get some width.
  const compact = w * cell < 220;
  if (data && !macros.length) return <div className="wg-empty muted small">No macros yet. The admin makes them in Settings → Macros.</div>;
  return (
    <div className={`wg-macros${compact ? " compact" : ""}`}>
      {macros.map((m) => {
        const on = running.has(m.id);
        const Icon = on ? Square : macroIcon(m.icon);
        return (
          <button
            key={m.id}
            className={`wg-macro${on ? " running" : ""}`}
            style={{ ["--group" as string]: m.color }}
            title={on ? `${m.name}: running. Click to stop it.` : `Run ${m.name}`}
            onClick={() => run(on ? macrosApi.stop(m.id) : macrosApi.run(m.id))}
          >
            <Icon size={16} />
            <span>{m.name}</span>
          </button>
        );
      })}
    </div>
  );
}
