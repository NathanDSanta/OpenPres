import type { GroupStyle } from "@/types/system";

export function getGroupColor(name: string, groupStyles: GroupStyle[] = []) {
  const configured = groupStyles.find(
    (style) => style.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  if (configured) {
    return {
      background: `color-mix(in srgb, ${configured.color} 18%, transparent)`,
      border: configured.color,
      text: configured.color,
    };
  }

  return {
    background: "transparent",
    border: "var(--border)",
    text: "var(--text-primary)",
  };
}
