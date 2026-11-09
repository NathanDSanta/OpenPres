import { useState } from "react";
import "@/styles/Settings.css";
import { getGroupColor } from "@/components/arrangements/groupColors";

import { useSettings } from "@/hooks/useSettings";
import {
  Settings2,
  Network,
  Folder,
  Activity,
  Save,
  RefreshCw,
  Copy,
  GripVertical,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

export default function Settings() {
  const [draggingGroupIndex, setDraggingGroupIndex] = useState<number | null>(null);
  const [dragOverGroupIndex, setDragOverGroupIndex] = useState<number | null>(null);

  const {
    config,
    health,
    apiPort,
    groupStyles,
    addGroupStyle,
    duplicateGroupStyle,
    reorderGroupStyle,
    updateGroupStyle,
    deleteGroupStyle,
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
              <Settings2 size={19} />
            </div>
            <div>
              <h2>Slide groups</h2>
              <p>
                Manage the groups available when organising presentation slides,
                including their appearance.
              </p>
            </div>
          </div>

          <div className="settings-group-list">
            {groupStyles.map((group, index) => (
              <div
                className={`settings-group-item${dragOverGroupIndex === index ? " is-drag-over" : ""}`}
                key={index}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggingGroupIndex !== null && draggingGroupIndex !== index) {
                    setDragOverGroupIndex(index);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingGroupIndex !== null) {
                    reorderGroupStyle(draggingGroupIndex, index);
                  }
                  setDraggingGroupIndex(null);
                  setDragOverGroupIndex(null);
                }}
              >
                <button
                  type="button"
                  className="settings-group-drag-handle"
                  draggable
                  disabled={saving}
                  title="Drag to reorder"
                  aria-label={`Reorder ${group.name}`}
                  onDragStart={(event) => {
                    setDraggingGroupIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragEnd={() => {
                    setDraggingGroupIndex(null);
                    setDragOverGroupIndex(null);
                  }}
                >
                  <GripVertical size={17} />
                </button>

                <div className="settings-group-preview">
                  <span
                    className="settings-group-preview-label"
                    style={(() => {
                      const color = getGroupColor(group.name, groupStyles);
                      return {
                        background: color.background,
                        borderColor: color.border,
                        color: color.text,
                      };
                    })()}
                  >
                    {group.name || "Group"}
                  </span>
                </div>

                <div className="settings-group-fields">
                  <div className="settings-group-name">
                    <label htmlFor={`group-name-${index}`}>Name</label>
                    <input
                      id={`group-name-${index}`}
                      value={group.name}
                      onChange={(event) =>
                        updateGroupStyle(index, { name: event.target.value })
                      }
                      disabled={saving}
                      placeholder="Group name"
                    />
                  </div>

                  <div className="settings-group-colors">
                    <label>
                      Group colour
                      <input
                        type="color"
                        value={group.color}
                        onChange={(event) =>
                          updateGroupStyle(index, {
                            color: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-group-row-actions">
                  <button
                    type="button"
                    className="settings-group-action"
                    onClick={() => duplicateGroupStyle(index)}
                    disabled={saving}
                    title={`Duplicate ${group.name}`}
                    aria-label={`Duplicate ${group.name}`}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    className="settings-group-action"
                    onClick={() => reorderGroupStyle(index, index - 1)}
                    disabled={saving || index === 0}
                    title="Move up"
                    aria-label={`Move ${group.name} up`}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="settings-group-action"
                    onClick={() => reorderGroupStyle(index, index + 1)}
                    disabled={saving || index === groupStyles.length - 1}
                    title="Move down"
                    aria-label={`Move ${group.name} down`}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="settings-group-delete"
                    onClick={() => deleteGroupStyle(index)}
                    disabled={saving}
                    title={`Delete ${group.name}`}
                    aria-label={`Delete ${group.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

            {groupStyles.length === 0 && (
              <p className="settings-field-description">
                No custom groups configured yet.
              </p>
            )}
          </div>

          <div className="settings-group-actions">
            <button
              type="button"
              className="settings-secondary-button"
              onClick={addGroupStyle}
              disabled={saving}
            >
              + Add group
            </button>

            <button
              type="button"
              className="settings-save-button"
              onClick={() => void save()}
              disabled={saving}
            >
              <Save size={16} />
              {saving ? "Saving..." : "Save groups"}
            </button>
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

