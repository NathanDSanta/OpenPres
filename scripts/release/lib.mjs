// Shared helpers for the release workflows (no dependencies; Node 20+). The same in every
// OpenPres repository (docs/RELEASING.md).
//
// Two kinds of release:
//   stable  X.Y.Z      from main, only when asked (/release on Telegram bumps Y, /hotfix
//                      bumps Z, a major release bumps X only when Nathan asks for one)
//   beta    X.Y.Z.A    from develop, by itself when enough has waited (the rules below):
//                      the A-th beta since stable X.Y.Z, tagged vX.Y.Z.A-beta
//
// Pull request titles follow Conventional Commits (https://www.conventionalcommits.org):
// feat:, fix:, perf:, docs:, ci:, chore:… They decide when a beta is due and group the notes.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

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

/**
 * One change for the notes and the version: { number, branch, title, type, text, breaking,
 * mergedAt (ISO date, when known) }.
 */
function change(number, branch, title, body = "", mergedAt = null) {
  const parsed = parseTitle(title);
  return {
    number,
    branch,
    title,
    type: parsed?.type ?? "other",
    text: parsed?.text ?? title,
    breaking: !!parsed?.breaking || /BREAKING CHANGE/.test(body ?? ""),
    mergedAt,
  };
}

/**
 * The pull requests whose commits are in `range` (a git range, or a list of revisions such as
 * ["HEAD", "^v1.0.0"]), as GitHub knows them: merged into develop
 * or main, oldest first. Release PRs (develop into main) and merges of main back into
 * develop are left out; their changes are listed by their own PRs. Unlike the commit
 * messages, this also finds PRs merged without a merge commit of their own (one stacked on
 * another and merged after it) and never depends on what a merge commit's message says.
 *
 * Null when GitHub can't be asked (no token, offline): then use `changes`.
 */
export function pullRequests(range, repo, list = mergedPullRequests) {
  if (!repo || !(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) return null;
  const shas = git("log", "--format=%H %cI", ...[].concat(range)).split("\n").filter(Boolean);
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
    .map((pr) => change(pr.number, pr.head.ref, pr.title, pr.body, pr.merged_at));
}

/**
 * Without GitHub: the pull requests (and squashed commits) in a range of commits, read from
 * the commit messages, newest first. Merges of develop into main (release PRs) and of main
 * back into develop are skipped: their changes are listed by their own PRs.
 */
export function changes(range) {
  const sep = "\u001e";
  const raw = git("log", "--format=%H%x1f%cI%x1f%s%x1f%b" + sep, ...[].concat(range));
  const out = [];
  for (const entry of raw.split(sep)) {
    const [sha, date = null, subject = "", body = ""] = entry.trim().split("\u001f");
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
          for (const t of own) out.push({ sha, ...change(number, branch, t, "", date) });
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
    out.push({ sha, ...change(number, branch, title, body, date) });
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

/**
 * When a beta is released by itself (beta.yaml): a few features together, or small betas for
 * fixes. Numbers can be changed with repository variables (Settings → Secrets and variables →
 * Actions → Variables).
 */
export const RELEASE_RULES = {
  features: 3, // RELEASE_FEATURES: a beta once this many features wait
  fixes: 3, // RELEASE_FIXES: a beta once this many fixes wait (and no features)
  fixDays: 3, // RELEASE_FIX_DAYS: …or once the oldest fix has waited this many days
  maxDays: 14, // RELEASE_MAX_DAYS: anything waiting this long is released anyway
};

const DAY = 24 * 60 * 60 * 1000;
const RELEASED = new Set(["feat", "fix", "perf", "revert"]);

/** Is it time for a beta of what's waiting? { ready, reason }: `reason` says why, or what it's waiting for. */
export function readiness(list, now = Date.now(), rules = RELEASE_RULES) {
  const waiting = list.filter((c) => c.breaking || RELEASED.has(c.type));
  if (!waiting.length) return { ready: false, reason: "nothing that needs a new version yet" };
  const features = waiting.filter((c) => c.type === "feat" || c.breaking).length;
  const fixes = waiting.length - features;
  const dates = waiting.map((c) => Date.parse(c.mergedAt ?? "")).filter((t) => !Number.isNaN(t));
  const days = dates.length ? Math.floor((now - Math.min(...dates)) / DAY) : 0;
  const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
  if (features >= rules.features) return { ready: true, reason: `${plural(features, "new feature")} are waiting` };
  if (!features && fixes >= rules.fixes) return { ready: true, reason: `${plural(fixes, "fix", "fixes")} are waiting` };
  if (!features && days >= rules.fixDays) return { ready: true, reason: `fixes have waited ${plural(days, "day")}` };
  if (days >= rules.maxDays) return { ready: true, reason: `changes have waited ${plural(days, "day")}` };
  const wait = features
    ? `${plural(rules.features - features, "more feature")} (or ${plural(rules.maxDays - days, "more day")})`
    : `${plural(rules.fixes - fixes, "more fix", "more fixes")} (or ${plural(rules.fixDays - days, "more day")})`;
  return { ready: false, reason: `waiting for ${wait}` };
}

/** The rules, with the repository variables (RELEASE_FEATURES, …) where they're set. */
export function rulesFromEnv(env = process.env) {
  const n = (key, fallback) => {
    const v = Number.parseInt(env[key] ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    features: n("RELEASE_FEATURES", RELEASE_RULES.features),
    fixes: n("RELEASE_FIXES", RELEASE_RULES.fixes),
    fixDays: n("RELEASE_FIX_DAYS", RELEASE_RULES.fixDays),
    maxDays: n("RELEASE_MAX_DAYS", RELEASE_RULES.maxDays),
  };
}

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`not a version: ${v}`);
  return m.slice(1).map(Number);
}

export function bumped(version, bump) {
  const [major, minor, patch] = parseVersion(version);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor}.${patch}`;
}

/** The beta tags (vX.Y.Z.A-beta) of stable X.Y.Z, newest first. */
export function betaTags(stable, all = git("tag", "--list", "v*-beta").split("\n")) {
  const prefix = `v${stable}.`;
  return all
    .filter((t) => t.startsWith(prefix) && /^\d+-beta$/.test(t.slice(prefix.length)))
    .sort((a, b) => betaNumber(b) - betaNumber(a));
}

function betaNumber(tag) {
  return Number(/\.(\d+)-beta$/.exec(tag)?.[1] ?? 0);
}

/** The newest beta of any stable (by version), or null. */
export function lastBetaTag(all = git("tag", "--list", "v*-beta").split("\n")) {
  const betas = all.filter((t) => /^v\d+\.\d+\.\d+\.\d+-beta$/.test(t));
  const code = (t) => versionForms(t.slice(1, -"-beta".length)).code;
  return betas.sort((a, b) => code(b) - code(a))[0] ?? null;
}

/** The next beta of stable X.Y.Z: "X.Y.Z.A". */
export function nextBeta(stable, tags = betaTags(stable)) {
  return `${stable}.${(tags.length ? betaNumber(tags[0]) : 0) + 1}`;
}

/**
 * A release's version in every form a program needs. `version` is "X.Y.Z" (stable) or
 * "X.Y.Z.A" (beta).
 *   name    "0.7.0" / "0.7.0.3 beta"          what people see
 *   tag     "v0.7.0" / "v0.7.0.3-beta"
 *   semver  "0.7.0" / "0.7.1-3"               for programs that need X.Y.Z (the desktop apps'
 *                                             updater): a beta of 0.7.0 sorts after 0.7.0 and
 *                                             before the hotfix 0.7.1
 *   code    700 / 703                         Android's versionCode: X·1000000 + Y·10000 + Z·100 + A
 */
export function versionForms(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (!m) throw new Error(`not a version: ${version}`);
  const [x, y, z] = m.slice(1, 4).map(Number);
  const beta = m[4] === undefined ? null : Number(m[4]);
  if (beta !== null && (beta < 1 || beta > 99)) throw new Error(`beta number out of range: ${version}`);
  return {
    version,
    beta: beta !== null,
    name: beta === null ? version : `${version} beta`,
    tag: beta === null ? `v${version}` : `v${version}-beta`,
    semver: beta === null ? version : `${x}.${y}.${z + 1}-${beta}`,
    code: x * 1_000_000 + y * 10_000 + z * 100 + (beta ?? 0),
  };
}

/**
 * A stable release's bump: a hotfix (only hotfix/* pull requests since the last stable) bumps
 * Z; anything else (/release brought develop in) bumps Y. A major release is asked for
 * explicitly (BUMP=major).
 */
export function stableBump(list, asked = "") {
  if (asked === "major") return "major";
  if (!list.length) return null;
  return list.every((c) => c.branch?.startsWith("hotfix/")) ? "patch" : "minor";
}

/** The newest release tag (vX.Y.Z) reachable from `ref`, or the newest overall. */
export function lastTag(ref) {
  const tags = git("tag", "--list", "v*.*.*", "--sort=-v:refname", ...(ref ? ["--merged", ref] : [])).split("\n").filter(Boolean);
  return tags.find((t) => /^v\d+\.\d+\.\d+$/.test(t)) ?? null;
}

/**
 * The version before this repository's first release tag: FIRST_VERSION, set in the release
 * workflows (what was released before the repository had releases of its own).
 */
export function fileVersion(env = process.env) {
  return env.FIRST_VERSION || "0.0.0";
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
