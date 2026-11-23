import { dashboardIcon, useDashboardPresets } from "./dashboardPresets";

/** A grid of this mode's dashboards; click one to switch to it. */
export default function DashboardsWidget({ w, h, cell }: { w: number; h: number; cell: number }) {
  const { value, switchTo } = useDashboardPresets();
  const presets = value?.presets ?? [];
  if (presets.length < 2) return <div className="wg-empty">Add dashboards with + next to the dashboard name in Edit layout.</div>;
  // As square as the widget allows; names only when each tile has room.
  const area = w * h * cell * cell;
  const cols = Math.max(1, Math.ceil(Math.sqrt((presets.length * w * cell) / (h * cell))));
  const labels = area / presets.length >= 90 * 60;
  return (
    <div className={`wg-dashboards${labels ? " labels" : ""}`} style={{ gridTemplateColumns: `repeat(${Math.min(cols, presets.length)}, minmax(0, 1fr))` }}>
      {presets.map((p) => {
        const Icon = dashboardIcon(p.icon);
        const on = p.id === value?.active;
        return (
          <button key={p.id} className={`wg-dash-btn${on ? " on" : ""}`} onClick={() => switchTo(p.id)} title={on ? `${p.name}: showing` : `Switch to ${p.name}`} aria-pressed={on}>
            <Icon size={labels ? 18 : 16} />
            {labels && <span>{p.name}</span>}
          </button>
        );
      })}
    </div>
  );
}
