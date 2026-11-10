import { Activity } from "lucide-react";
import type { HealthResponse } from "@/types";

export default function SettingsApplicationStatus({ health }: { health: HealthResponse | null }) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-icon"><Activity size={19} /></div>
        <div><h2>Application status</h2><p>Current backend health information.</p></div>
      </div>
      <div className="settings-status-row">
        <span className="settings-status-label">API connection</span>
        <span className={`settings-status ${health ? "online" : "offline"}`}><span className="settings-status-dot" />{health ? "Connected" : "Unavailable"}</span>
      </div>
      <div className="settings-status-row"><span className="settings-status-label">Backend version</span><span className="settings-status-value">{health?.version ?? "—"}</span></div>
      <div className="settings-status-row"><span className="settings-status-label">Backend status</span><span className="settings-status-value">{health?.status ?? "Unknown"}</span></div>
    </section>
  );
}
