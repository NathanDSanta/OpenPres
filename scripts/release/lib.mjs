// Shared helpers for the release workflows (no dependencies; Node 20+).
//
// Versions come from the pull requests merged since the last release. Their titles follow
// Conventional Commits (https://www.conventionalcommits.org):
//   feat: ...        a new feature                -> minor version (0.4.0 -> 0.5.0)
//   fix: / perf: ... a non-breaking fix or speedup -> patch version (0.4.0 -> 0.4.1)
//   feat!: ... (or "BREAKING CHANGE" in the body)  -> major version (0.x: minor)
//   docs: ci: chore: refactor: test: build: style: -> no new version on their own
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

export function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const TYPES = ["feat", "fix", "perf", "refactor", "docs", "ci", "chore", "build", "test", "style", "revert"];
const TITLE = new RegExp(`^(${TYPES.join("|")})(\\([^)]*\\))?(!)?:\\s+(.+)$`);

/** "feat(stream)!: Thing" -> { type, scope, breaking, text } (null if not conventional). */
export function parseTitle(title) {
  const m = TITLE.exec(title.trim());
  if (!m) return null;
  return { type: m[1], scope: m[2]?.slice(1, -1) ?? null, breaking: !!m[3], text: m[4] };
}

/** One change for the notes and the version: { number, branch, title, type, text, breaking }. */
function change(number, branch, title, body = "") {
  const parsed = parseTitle(title);
  return {
    number,
    branch,
    title,
    type: parsed?.type ?? "other",
    text: parsed?.text ?? title,
    breaking: !!parsed?.breaking || /BREAKING CHANGE/.test(body ?? ""),
  };
}

/**
 * The pull requests whose commits are in `range`, as GitHub knows them: merged into develop
 * or main, oldest first. Release PRs (develop into main) and merges of main back into
 * develop are left out; their changes are listed by their own PRs. Unlike the commit
 * messages, this also finds PRs merged without a merge commit of their own (one stacked on
 * another and merged after it) and never depends on what a merge commit's message says.
 *
 * Null when GitHub can't be asked (no token, offline): then use `changes`.
 */
export function pullRequests(range, repo, list = mergedPullRequests) {
  if (!repo || !(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) return null;
  const shas = git("log", "--format=%H %cI", range).split("\n").filter(Boolean);
  if (!shas.length) return [];
  const oldest = shas.map((l) => l.split(" ")[1]).sort()[0];
  let prs;
  try {
    prs = list(repo, oldest);
  } catch (e) {
    console.warn(`Couldn't ask GitHub for the pull requests (${e.message}); reading the commit messages instead.`);
    return null;
  }
  return pickPullRequests(prs, new Set(shas.map((l) => l.split(" ")[0])));
}

/** Closed pull requests into develop and main, updated since `since` (newest first). */
function mergedPullRequests(repo, since) {
  const out = [];
  for (const base of ["develop", "main"]) {
    for (let page = 1; page <= 10; page++) {
      const path = `repos/${repo}/pulls?state=closed&base=${base}&sort=updated&direction=desc&per_page=100&page=${page}`;
      const batch = JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      out.push(...batch);
      if (batch.length < 100 || batch.some((pr) => pr.updated_at < since)) break;
    }
  }
  return out;
}

/**
 * GitHub's pull requests -> the changes: merged ones whose last commit (or merge commit) is
 * among `shas` (all when not given), each once, oldest first.
 */
export function pickPullRequests(prs, shas) {
  const found = new Map();
  for (const pr of prs) {
    const into = pr.base?.ref;
    const from = pr.head?.ref;
    if (!pr.merged_at || (into !== "develop" && into !== "main")) continue;
    if (from === "develop" || from === "main") continue;
    if (shas && !shas.has(pr.head?.sha) && !shas.has(pr.merge_commit_sha)) continue;
    found.set(pr.number, pr);
  }
  return [...found.values()]
    .sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.number - b.number)
    .map((pr) => change(pr.number, pr.head.ref, pr.title, pr.body));
}

/**
 * Without GitHub: the pull requests (and squashed commits) in a range of commits, read from
 * the commit messages, newest first. Merges of develop into main (release PRs) and of main
 * back into develop are skipped: their changes are listed by their own PRs.
 */
export function changes(range) {
  const sep = "\u001e";
  const raw = git("log", "--format=%H%x1f%s%x1f%b" + sep, range);
  const out = [];
  for (const entry of raw.split(sep)) {
    const [sha, subject = "", body = ""] = entry.trim().split("\u001f");
    if (!sha) continue;
    const merge = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(subject);
    let number = null;
    let branch = null;
    let title = subject;
    if (merge) {
      number = Number(merge[1]);
      branch = merge[2];
      if (branch === "develop" || branch === "main") continue;
      title = body.split("\n")[0].trim();
      if (!title) {
        // A merge commit without the PR's title: its own commits say what it brought.
        const own = git("log", "--no-merges", "--format=%s", `${sha}^1..${sha}^2`).split("\n").filter((t) => parseTitle(t));
        if (own.length) {
          for (const t of own) out.push({ sha, ...change(number, branch, t) });
          continue;
        }
        title = subject;
      }
    } else {
      // A squash merge: "feat: thing (#12)". Commits made inside a PR's branch are
      // skipped (the PR's merge commit stands for them).
      const squash = /\(#(\d+)\)$/.exec(subject);
      if (!squash) continue;
      number = Number(squash[1]);
      title = subject.replace(/\s*\(#\d+\)$/, "");
    }
    out.push({ sha, ...change(number, branch, title, body) });
  }
  return out;
}

/** "major" | "minor" | "patch" | null (nothing to release). */
export function bumpOf(list) {
  if (list.some((c) => c.breaking)) return "major";
  if (list.some((c) => c.type === "feat")) return "minor";
  if (list.some((c) => c.type === "fix" || c.type === "perf" || c.type === "revert")) return "patch";
  return null;
}

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`not a version: ${v}`);
  return m.slice(1).map(Number);
}

export function bumped(version, bump) {
  const [major, minor, patch] = parseVersion(version);
  // Before 1.0, breaking changes bump the minor version (semver's 0.x rule).
  if (bump === "major") return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor}.${patch}`;
}

/** The newest release tag (vX.Y.Z) reachable from `ref`, or the newest overall. */
export function lastTag(ref) {
  const tags = git("tag", "--list", "v*.*.*", "--sort=-v:refname", ...(ref ? ["--merged", ref] : [])).split("\n").filter(Boolean);
  return tags.find((t) => /^v\d+\.\d+\.\d+$/.test(t)) ?? null;
}

/** The version written in the app's files (used before the first tag). */
export function fileVersion() {
  return JSON.parse(readFileSync("tauri/tauri.conf.json", "utf8")).version;
}

const SECTIONS = [
  ["breaking", "Big changes"],
  ["feat", "New features"],
  ["fix", "Fixes"],
  ["perf", "Faster"],
];

/** Release notes in Markdown, grouped by kind. */
export function notes(list, { repo } = {}) {
  const line = (c) => `- ${c.text}${c.number ? ` (${repo ? `[#${c.number}](https://github.com/${repo}/pull/${c.number})` : `#${c.number}`})` : ""}`;
  const parts = [];
  const used = new Set();
  for (const [key, heading] of SECTIONS) {
    const items = list.filter((c) => !used.has(c) && (key === "breaking" ? c.breaking : c.type === key));
    items.forEach((c) => used.add(c));
    if (items.length) parts.push(`### ${heading}\n\n${items.map(line).join("\n")}`);
  }
  const rest = list.filter((c) => !used.has(c));
  if (rest.length) parts.push(`### Other changes\n\n${rest.map(line).join("\n")}`);
  return parts.join("\n\n") || "No changes.";
}

/** Writes `key=value` lines for later workflow steps (multi-line values supported). */
export function setOutputs(values) {
  const lines = Object.entries(values).map(([k, v]) => {
    const text = String(v ?? "");
    if (!text.includes("\n")) return `${k}=${text}`;
    const mark = `EOF_${Math.random().toString(36).slice(2)}`;
    return `${k}<<${mark}\n${text}\n${mark}`;
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  else console.log(lines.join("\n"));
}
