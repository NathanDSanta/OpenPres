import type { ReactNode } from "react";

/** On/off switch. */
export function Toggle({
  checked,
  onChange,
  disabled,
  title,
  small,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle${checked ? " on" : ""}${small ? " small" : ""}`}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/** A labelled row with a switch on the right (layer lists, options). */
export function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row${disabled ? " disabled" : ""}`} onClick={() => !disabled && onChange(!checked)}>
      {icon && <span className="toggle-row-icon">{icon}</span>}
      <span className="toggle-row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
