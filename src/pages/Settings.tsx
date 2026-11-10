import "@/styles/Settings.css";
import { RefreshCw } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import SettingsApiConfiguration from "@/components/settings/SettingsApiConfiguration";
import SettingsStorage from "@/components/settings/SettingsStorage";
import SettingsGroupStyles from "@/components/settings/SettingsGroupStyles";
import SettingsApplicationStatus from "@/components/settings/SettingsApplicationStatus";

export default function Settings() {
  const settings = useSettings();

  if (settings.loading) {
    return (
      <section className="settings-page">
        <header className="settings-header"><div><h1>Settings</h1><p>Manage your application's configuration.</p></div></header>
        <div className="settings-message">Loading settings...</div>
      </section>
    );
  }

  return (
    <section className="settings-page">
      <header className="settings-header">
        <div><h1>Settings</h1><p>Manage your application's configuration.</p></div>
        <button className="settings-icon-button" onClick={() => void settings.refresh()} title="Reload settings" aria-label="Reload settings">
          <RefreshCw size={17} />
        </button>
      </header>

      {settings.error && <div className="settings-alert error" role="alert">{settings.error}</div>}
      {settings.success && <div className="settings-alert success" role="status">{settings.success}</div>}

      <div className="settings-sections">
        <SettingsApiConfiguration apiPort={settings.apiPort} originalPort={settings.config?.api_port}
          saving={settings.saving} onPortChange={settings.setApiPort} onSave={() => void settings.save()} />
        <SettingsStorage dataDirectory={settings.config?.data_dir} />
        <SettingsGroupStyles groupStyles={settings.groupStyles} saving={settings.saving}
          onAdd={settings.addGroupStyle} onDuplicate={settings.duplicateGroupStyle}
          onReorder={settings.reorderGroupStyle} onUpdate={settings.updateGroupStyle}
          onDelete={settings.deleteGroupStyle} onSave={() => void settings.save()} />
        <SettingsApplicationStatus health={settings.health} />
      </div>
    </section>
  );
}
