import type { DragEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import { getGroupColor } from "./groupColors";
import type { DragPayload } from "@/hooks/useArrangementEditor";

interface ArrangementGroupRowsProps {
  availableGroups: string[];
  order: string[];
  saving: boolean;
  onAdd: (group: string, index: number) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

function readPayload(event: DragEvent): DragPayload | null {
  try {
    const value = event.dataTransfer.getData("application/json");
    return value ? (JSON.parse(value) as DragPayload) : null;
  } catch {
    return null;
  }
}

export function ArrangementGroupRows({
  availableGroups,
  order,
  saving,
  onAdd,
  onReorder,
  onRemove,
}: ArrangementGroupRowsProps) {
  const handleDropOnAvailable = (event: DragEvent) => {
    event.preventDefault();

    const payload = readPayload(event);

    if (payload?.type === "ordered") {
      onRemove(payload.index);
    }
  };

  const handleDropOnOrder = (
    event: DragEvent,
    targetIndex: number,
  ) => {
    event.preventDefault();

    if (saving) return;

    const payload = readPayload(event);
    if (!payload) return;

    if (payload.type === "available") {
      onAdd(payload.group, targetIndex);
    } else {
      onReorder(payload.index, targetIndex);
    }
  };


  return (
    <div className="arrangement-group-rows">
      <div
        className="arrangement-group-options"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnAvailable}
      >
        {availableGroups.map((group) => {
          const color = getGroupColor(group);

          return (
            <div
              key={group}
              className="arrangement-group-chip"
              style={{
                background: color.background,
                borderColor: color.border,
                color: color.text,
              }}
              draggable={!saving}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(
                  "application/json",
                  JSON.stringify({ type: "available", group }),
                );
              }}
              title={`Drag ${group} into the arrangement`}
            >
              {group}
            </div>
          );
        })}
      </div>

      <div
        className="arrangement-order-list"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnAvailable}
      >
        {order.map((group, index) => {
          const color = getGroupColor(group);

          return (
            <div
              key={`${group}-${index}`}
              className="arrangement-order-item"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDropOnOrder(event, index)}
            >
              <div
                className="arrangement-order-chip"
                style={{
                  background: color.background,
                  borderColor: color.border,
                  color: color.text,
                }}
                draggable={!saving}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({ type: "ordered", index }),
                  );
                }}
                title="Drag to reorder or remove"
              >
                <GripVertical size={12} />
                {group}
              </div>
            </div>
          );
        })}

        <div
          className="arrangement-order-end"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDropOnOrder(event, order.length)}
          title="Drop a group here to add it at the end"
        >
          <Plus size={16} />
        </div>
      </div>
    </div>
  );

}

