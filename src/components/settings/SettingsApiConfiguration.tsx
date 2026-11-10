import { Network, Save, Settings2 } from "lucide-react";

type Props = { apiPort: string; originalPort?: number; saving: boolean; onPortChange: (value: string) => void; onSave: () => void };

export default function SettingsApiConfiguration({ apiPort, originalPort, saving, onPortChange, onSave }: Props) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-icon"><Network size={19} /></div>
        <div><h2>API configuration</h2><p>Configure how the application exposes its API.</p></div>
      </div>
      <div className="settings-field">
        <label htmlFor="api-port">API port</label>
        <p className="settings-field-description">The port used by the backend API server.</p>
        <div className="settings-input-row">
          <input id="api-port" type="number" min={1} max={65535} step={1} value={apiPort}
            onChange={(event) => onPortChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onSave(); }}
            disabled={saving} placeholder="8787" />
          <button className="settings-save-button" onClick={onSave}
            disabled={saving || apiPort.trim() === "" || Number(apiPort) === originalPort}>
            <Save size={16} />{saving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="settings-note"><Settings2 size={15} />Changing the port may require restarting the backend or reconnecting the application, depending on its configuration.</div>
      </div>
    </section>
  );
}
