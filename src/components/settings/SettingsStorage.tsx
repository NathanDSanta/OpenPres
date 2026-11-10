import { Folder } from "lucide-react";

type Props = { dataDirectory?: string };

export default function SettingsStorage({ dataDirectory }: Props) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-icon"><Folder size={19} /></div>
        <div><h2>Storage</h2><p>Where the application stores its data.</p></div>
      </div>
      <div className="settings-field">
        <label htmlFor="data-dir">Data directory</label>
        <input id="data-dir" className="settings-readonly-input" type="text" value={dataDirectory ?? "Unavailable"} readOnly />
        <p className="settings-field-description">This path is read-only because the current API does not support changing it.</p>
      </div>
    </section>
  );
}
