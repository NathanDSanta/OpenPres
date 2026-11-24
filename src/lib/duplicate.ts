import { libraryApi } from "@/api";

/**
 * The name for a copy: the next number after the name instead of "copy". "Sunday" → "Sunday 2"
 * (or "Sunday 3" when "Sunday 2" exists), "Sunday 2" → "Sunday 3".
 */
export function nextName(name: string, taken: Iterable<string>): string {
  const names = [...taken].map((n) => n.trim());
  const trimmed = name.trim() || "Untitled";
  // A number at the end counts as a copy's number only when the name without it exists too
  // ("Sunday 2" next to "Sunday"); "Psalm 23" stays "Psalm 23" (its copy is "Psalm 23 2").
  const numbered = /^(.*\S)\s+\d+$/.exec(trimmed);
  const base = numbered && names.some((n) => n.toLowerCase() === numbered[1].toLowerCase()) ? numbered[1] : trimmed;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, "i");
  let highest = 1;
  for (const other of names) {
    const m = pattern.exec(other);
    if (m) highest = Math.max(highest, m[1] ? Number(m[1]) : 1);
  }
  return `${base} ${highest + 1}`;
}

/** A copy of a song or presentation in the same library, with its arrangements and designs. */
export async function duplicatePresentation(id: string, libraryId: string): Promise<string> {
  const [original, siblings] = await Promise.all([libraryApi.getPresentation(id), libraryApi.listPresentations(libraryId)]);
  const title = nextName(original.metadata.title ?? original.nameid, siblings.map((p) => p.title));
  const copy = await libraryApi.createPresentation(libraryId, { metadata: { ...original.metadata, title }, groups: original.groups });
  for (const a of original.arrangements) {
    if (a.name !== "default") await libraryApi.setArrangement(copy.id, a.name, { order: a.order });
  }
  return copy.id;
}
