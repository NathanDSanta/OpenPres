import { Plus, Trash2 } from "lucide-react";
import type { Arrangement } from "@/types";

interface ArrangementToolbarProps {
  arrangements: Arrangement[];
  selectedArrangement: string;
  saving: boolean;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onDelete: () => void;
}

export function ArrangementToolbar({
  arrangements,
  selectedArrangement,
  saving,
  onSelect,
  onCreate,
  onDelete,
}: ArrangementToolbarProps) {
  return (
    <div className="arrangement-toolbar">
      <select
        className="arrangement-select"
        aria-label="Select arrangement"
        value={selectedArrangement}
        onChange={(event) => onSelect(event.target.value)}
        disabled={saving || arrangements.length === 0}
      >
        {arrangements.map((arrangement) => (
          <option key={arrangement.name} value={arrangement.name}>
            {arrangement.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="arrangement-icon-button"
        onClick={onCreate}
        disabled={saving}
        title="Create arrangement"
        aria-label="Create arrangement"
      >
        <Plus size={16} />
      </button>

      <button
        type="button"
        className="arrangement-icon-button"
        onClick={onDelete}
        disabled={saving || arrangements.length <= 1}
        title="Delete arrangement"
        aria-label="Delete arrangement"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

