import "@/styles/Settings.css";

import { useSettings } from "@/hooks/useSettings";
import {
  Settings2,
  Network,
  Folder,
  Activity,
  Save,
  RefreshCw,
} from "lucide-react";

export default function Settings() {
  const {
    config,
    health,
    apiPort,
    setApiPort,
    loading,
    saving,
    error,
    success,
    save,
    refresh,
  } = useSettings();

  if (loading) {
    return (
      <section className="settings-page">
        <header className="settings-header">
          <h1>Settings</h1>
          <p>Manage your application's configuration.</p>
        </header>
        <div className="settings-message">Loading settings...</div>
      </section>
    );
  }

  return (
    <section className="settings-page">
      <header className="settings-header">
        <div>
          <h1>Settings</h1>
          <p>Manage your application's configuration.</p>
        </div>

        <button
          className="settings-icon-button"
          onClick={() => void refresh()}
          title="Reload settings"
          aria-label="Reload settings"
        >
          <RefreshCw size={17} />
        </button>
      </header>

      {error && (
        <div className="settings-alert error" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="settings-alert success" role="status">
          {success}
        </div>
      )}

      <div className="settings-sections">
        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Network size={19} />
            </div>
            <div>
              <h2>API configuration</h2>
              <p>Configure how the application exposes its API.</p>
            </div>
          </div>

          <div className="settings-field">
            <label htmlFor="api-port">API port</label>
            <p className="settings-field-description">
              The port used by the backend API server.
            </p>

            <div className="settings-input-row">
              <input
                id="api-port"
                type="number"
                min={1}
                max={65535}
                step={1}
                value={apiPort}
                onChange={(event) => setApiPort(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                }}
                disabled={saving}
                placeholder="8787"
              />

              <button
                className="settings-save-button"
                onClick={() => void save()}
                disabled={
                  saving ||
                  apiPort.trim() === "" ||
                  Number(apiPort) === config?.api_port
                }
              >
                <Save size={16} />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>

            <div className="settings-note">
              <Settings2 size={15} />
              Changing the port may require restarting the backend or
              reconnecting the application, depending on its configuration.
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Folder size={19} />
            </div>
            <div>
              <h2>Storage</h2>
              <p>Where the application stores its data.</p>
            </div>
          </div>

          <div className="settings-field">
            <label htmlFor="data-dir">Data directory</label>
            <input
              id="data-dir"
              className="settings-readonly-input"
              type="text"
              value={config?.data_dir ?? "Unavailable"}
              readOnly
            />
            <p className="settings-field-description">
              This path is read-only because the current API does not
              support changing it.
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Activity size={19} />
            </div>
            <div>
              <h2>Application status</h2>
              <p>Current backend health information.</p>
            </div>
          </div>

          <div className="settings-status-row">
            <span className="settings-status-label">
              API connection
            </span>

            <span
              className={`settings-status ${health ? "online" : "offline"
                }`}
            >
              <span className="settings-status-dot" />
              {health ? "Connected" : "Unavailable"}
            </span>
          </div>

          <div className="settings-status-row">
            <span className="settings-status-label">Backend version</span>
            <span className="settings-status-value">
              {health?.version ?? "—"}
            </span>
          </div>

          <div className="settings-status-row">
            <span className="settings-status-label">Backend status</span>
            <span className="settings-status-value">
              {health?.status ?? "Unknown"}
            </span>
          </div>
        </section>
      </div>
    </section>
  );
}

