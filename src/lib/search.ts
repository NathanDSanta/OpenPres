/**
 * The search engine used by the command bar, the Songs tab and the Reflow tab.
 * Matching ignores case, accents and symbols (ș/ş -> s, ț/ţ -> t, ă/â -> a, î -> i, ...).
 */

const SPECIAL: Record<string, string> = {
  ș: "s", ş: "s", ț: "t", ţ: "t", ă: "a", â: "a", î: "i", ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ł: "l",
};

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[șşțţăâîßæœøđł]/g, (c) => SPECIAL[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scores how well `text` matches `query` (0 = no match). Every query word must appear;
 * whole-title, prefix and word-start matches rank higher.
 */
export function score(query: string, text: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const t = normalize(text);
  if (!t) return 0;
  if (t === q) return 1000;
  let total = 0;
  if (t.startsWith(q)) total += 400;
  else if (t.includes(q)) total += 200;
  const words = t.split(" ");
  for (const part of q.split(" ")) {
    if (words.some((w) => w === part)) total += 40;
    else if (words.some((w) => w.startsWith(part))) total += 25;
    else if (t.includes(part)) total += 10;
    else return 0;
  }
  // Shorter titles win ties ("Holy" before "Holy, Holy, Holy").
  return total - Math.min(t.length, 100) / 10;
}

/** Items matching `query`, best first. */
export function search<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!normalize(query)) return items;
  return items
    .map((item) => ({ item, s: score(query, text(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}
