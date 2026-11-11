import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Save } from "lucide-react";
import { getGroupColor } from "@/components/arrangements/groupColors";
import type { GroupStyle } from "@/types";
import "./styles/SettingsGroupStyles.css";

type Props = {
  groupStyles: GroupStyle[];
  saving: boolean;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onUpdate: (index: number, updates: Partial<GroupStyle>) => void;
  onDelete: (index: number) => void;
  onSave: () => void;
};

export default function SettingsGroupStyles({
  groupStyles, saving, onAdd, onDuplicate, onReorder, onUpdate, onDelete, onSave,
}: Props) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-icon"><Save size={19} /></div>
        <div>
          <h2>Slide groups</h2>
          <p>Manage the groups available when organising presentation slides, including their appearance.</p>
        </div>
      </div>

      <div className="settings-group-list">
        {groupStyles.map((group, index) => {
          const color = getGroupColor(group.name, groupStyles);
          return (
            <div
              className={`settings-group-item${dragOverIndex === index ? " is-drag-over" : ""}`}
              key={index}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggingIndex !== null && draggingIndex !== index) setDragOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingIndex !== null) onReorder(draggingIndex, index);
                setDraggingIndex(null);
                setDragOverIndex(null);
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
                  setDraggingIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(index));
                }}
                onDragEnd={() => { setDraggingIndex(null); setDragOverIndex(null); }}
              ><GripVertical size={17} /></button>

              <div className="settings-group-preview">
                <span className="settings-group-preview-label" style={{
                  background: color.background, borderColor: color.border, color: color.text,
                }}>{group.name || "Group"}</span>
              </div>

              <div className="settings-group-fields">
                <div className="settings-group-name">
                  <label htmlFor={`group-name-${index}`}>Name</label>
                  <input
                    id={`group-name-${index}`}
                    value={group.name}
                    onChange={(event) => onUpdate(index, { name: event.target.value })}
                    disabled={saving}
                    placeholder="Group name"
                  />
                </div>
                <div className="settings-group-colors">
                  <label>Group colour
                    <input
                      type="color"
                      value={group.color}
                      onChange={(event) => onUpdate(index, { color: event.target.value })}
                      disabled={saving}
                    />
                  </label>
                </div>
              </div>

              <div className="settings-group-row-actions">
                <button type="button" className="settings-group-action" onClick={() => onDuplicate(index)} disabled={saving} title={`Duplicate ${group.name}`} aria-label={`Duplicate ${group.name}`}><Copy size={15} /></button>
                <button type="button" className="settings-group-action" onClick={() => onReorder(index, index - 1)} disabled={saving || index === 0} title="Move up" aria-label={`Move ${group.name} up`}><ArrowUp size={15} /></button>
                <button type="button" className="settings-group-action" onClick={() => onReorder(index, index + 1)} disabled={saving || index === groupStyles.length - 1} title="Move down" aria-label={`Move ${group.name} down`}><ArrowDown size={15} /></button>
                <button type="button" className="settings-group-delete" onClick={() => onDelete(index)} disabled={saving} title={`Delete ${group.name}`} aria-label={`Delete ${group.name}`}>×</button>
              </div>
            </div>
          );
        })}
        {groupStyles.length === 0 && <p className="settings-field-description">No custom groups configured yet.</p>}
      </div>

      <div className="settings-group-actions">
        <button type="button" className="settings-secondary-button" onClick={onAdd} disabled={saving}>+ Add group</button>
        <button type="button" className="settings-save-button" onClick={onSave} disabled={saving}>
          <Save size={16} />{saving ? "Saving..." : "Save groups"}
        </button>
      </div>
    </section>
  );
}
