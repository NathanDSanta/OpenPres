import { Plus, Trash2 } from "lucide-react";
import Select from "@/components/ui/Select";
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
      <div className="arrangement-select">
        <Select
          small
          value={selectedArrangement}
          disabled={saving || arrangements.length === 0}
          options={arrangements.map((a) => ({ value: a.name, label: a.name === "default" ? "Default (as written)" : a.name }))}
          onChange={onSelect}
        />
      </div>

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

