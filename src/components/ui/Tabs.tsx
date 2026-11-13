import type { ReactNode } from "react";

interface TabsProps<T extends string> {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
}

export default function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          className={`tab${t.id === value ? " active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
