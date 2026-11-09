import type { DragEvent } from "react";
import { Plus } from "lucide-react";
import { getGroupColor } from "./groupColors";
import type { DragPayload } from "@/hooks/useArrangementEditor";
import type { GroupStyle } from "@/types";

interface ArrangementGroupRowsProps {
  availableGroups: string[];
  order: string[];
  saving: boolean;
  onAdd: (group: string, index: number) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  groupStyles: GroupStyle[];
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
  groupStyles,
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
  index: number,
) => {
  event.preventDefault();
  event.stopPropagation();

  if (saving) return;

  const payload = readPayload(event);
  if (!payload) return;

  // Determine whether the pointer is on the left or right
  // half of the target item.
  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;

  const insertIndex =
    event.clientX < midpoint ? index : index + 1;

  if (payload.type === "available") {
    onAdd(payload.group, insertIndex);
  } else {
    // Account for the index shift caused by removing the
    // dragged element before inserting it again.
    onReorder(payload.index, insertIndex);
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
          const color = getGroupColor(group, groupStyles);

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
      >
        {order.map((group, index) => {
          const color = getGroupColor(group, groupStyles);

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

