// What the next release is (docs/RELEASING.md).
//
//   node scripts/release/plan.mjs beta     On develop: the next beta, X.Y.Z.A (the A-th since
//                                          the newest stable X.Y.Z), and whether it's due.
//   node scripts/release/plan.mjs stable   On main: the stable release just merged. /hotfix
//                                          (only hotfix/* PRs since the last stable) bumps Z,
//                                          /release bumps Y, BUMP=major bumps X.
//
// Outputs (for GitHub Actions, or printed): version (empty: nothing to release), name, tag,
// semver, code (see lib.mjs versionForms), beta, hotfix, count, notes, and for betas: ready
// (due by the rules) and reason.
//
// NOW=true releases a beta even with nothing new (after a hotfix, so betas have it too).
//
// Before a repository's first stable tag, versions count from FIRST_VERSION (set in the
// workflows).
import { betaTags, bumped, changes, fileVersion, lastBetaTag, lastTag, nextBeta, notes, pullRequests, readiness, rulesFromEnv, setOutputs, stableBump, versionForms } from "./lib.mjs";

const mode = process.argv[2] ?? "stable";
const repo = process.env.GITHUB_REPOSITORY;
const strip = (tag) => tag.replace(/^v/, "");

let version = "";
let list;
let ready = { ready: false, reason: "" };
if (mode === "beta") {
  // Betas follow the newest stable, wherever it is (a stable tag sits on main).
  const stableTag = lastTag();
  const stable = stableTag ? strip(stableTag) : fileVersion();
  const betas = betaTags(stable);
  // What develop has that neither the last beta nor the newest stable has (before any tag:
  // what main doesn't have).
  const known = [lastBetaTag(), stableTag].filter(Boolean);
  const range = ["HEAD", ...(known.length ? known : [process.env.MAIN_REF ?? "origin/main"]).map((t) => `^${t}`)];
  list = pullRequests(range, repo) ?? changes(range);
  ready = readiness(list, Date.now(), rulesFromEnv());
  // NOW=true (after a hotfix): a beta right away, even with nothing new on develop, since the
  // newest beta doesn't have the hotfix yet.
  if (process.env.NOW === "true") ready = { ready: true, reason: stableTag ? `it brings in ${strip(stableTag)}` : "asked for" };
  if (list.length || process.env.NOW === "true") version = nextBeta(stable, betas);
} else if (mode === "stable") {
  const tag = lastTag("HEAD");
  const base = tag ?? `v${fileVersion()}`;
  list = pullRequests(tag ? `${tag}..HEAD` : "HEAD", repo) ?? changes(tag ? `${tag}..HEAD` : "HEAD");
  const bump = stableBump(list, process.env.BUMP ?? "");
  if (bump) version = bumped(base, bump);
} else {
  throw new Error(`plan.mjs beta | stable, not ${mode}`);
}

const forms = version ? versionForms(version) : { name: "", tag: "", semver: "", code: "", beta: mode === "beta" };
setOutputs({
  version,
  name: forms.name,
  tag: forms.tag,
  semver: forms.semver,
  code: forms.code,
  beta: mode === "beta" ? "true" : "false",
  hotfix: mode === "stable" && list.length && list.every((c) => c.branch?.startsWith("hotfix/")) ? "true" : "false",
  ready: ready.ready ? "true" : "false",
  reason: ready.reason,
  count: list.length,
  notes: notes(list, { repo }),
});
