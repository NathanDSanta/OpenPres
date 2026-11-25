// node --test scripts/release/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betaTags, bumpOf, bumped, changes, fileVersion, lastBetaTag, nextBeta, parseTitle, notes, pickPullRequests, readiness, rulesFromEnv, stableBump, versionForms } from "./lib.mjs";

test("titles", () => {
  assert.deepEqual(parseTitle("feat(stream)!: New thing"), { type: "feat", scope: "stream", breaking: true, text: "New thing" });
  assert.equal(parseTitle("Merge branch x"), null);
});

test("versions", () => {
  const c = (type, breaking = false) => ({ type, breaking });
  assert.equal(bumpOf([c("docs"), c("ci")]), null);
  assert.equal(bumpOf([c("fix"), c("docs")]), "patch");
  assert.equal(bumpOf([c("fix"), c("feat")]), "minor");
  assert.equal(bumpOf([c("fix", true)]), "major");
  assert.equal(bumped("v0.4.2", "patch"), "0.4.3");
  assert.equal(bumped("0.4.2", "minor"), "0.5.0");
  // Major releases are only made when asked for: they always bump X.
  assert.equal(bumped("0.4.2", "major"), "1.0.0");
  assert.equal(bumped("1.4.2", "major"), "2.0.0");
});

test("notes", () => {
  const text = notes([
    { type: "feat", text: "Log files", number: 12, breaking: false },
    { type: "fix", text: "A crash", number: 13, breaking: false },
    { type: "docs", text: "Docs", number: 14, breaking: false },
  ], { repo: "o/r" });
  assert.match(text, /### New features\n\n- Log files \(\[#12\]\(https:\/\/github.com\/o\/r\/pull\/12\)\)/);
  assert.match(text, /### Fixes\n\n- A crash/);
  assert.match(text, /### Other changes\n\n- Docs/);
});

test("pull requests from GitHub: the ones in the range, each once, without release PRs", () => {
  const pr = (number, title, head, base, sha, merged_at = "2026-11-22T17:14:15Z", body = "") => ({
    number,
    title,
    head: { ref: head, sha },
    base: { ref: base },
    merge_commit_sha: `m${number}`,
    merged_at,
    body,
  });
  // #12 and #13 were stacked under #14 and merged after it: no merge commits of their own,
  // but their last commits are in the range.
  const prs = [
    pr(12, "feat: Log files", "feature/log-files", "develop", "a12", "2026-11-22T17:14:17Z"),
    pr(13, "feat: Updates", "feature/auto-updates", "develop", "a13", "2026-11-22T17:14:17Z"),
    pr(14, "feat: Installer", "feature/server-installer", "develop", "a14"),
    pr(11, "ci: Releases", "ci/release-automation", "main", "a11"),
    pr(15, "Release v0.4.0", "develop", "main", "a14"),
    pr(16, "chore: bring hotfix v0.4.1 into develop", "main", "develop", "a16"),
    pr(17, "fix: Crash", "hotfix/crash", "main", "x17", "2026-11-23T10:00:00Z", "BREAKING CHANGE: no"),
    pr(18, "feat: Closed, not merged", "feature/x", "develop", "a18", null),
  ];
  // develop, not yet in main (#11 already is): a12, a13, a14 and #14's merge commit.
  const next = pickPullRequests(prs, new Set(["a12", "a13", "a14", "m14"]));
  assert.deepEqual(next.map((c) => c.number), [14, 12, 13]);
  assert.equal(next[0].branch, "feature/server-installer");
  assert.equal(bumpOf(next), "minor");
  // A squashed hotfix: only its merge (squash) commit is in the range.
  const hotfix = pickPullRequests(prs, new Set(["m17"]));
  assert.deepEqual(hotfix.map((c) => c.number), [17]);
  assert.equal(bumpOf(hotfix), "major");
});

test("commit messages: a merge without the PR's title uses the commits it brought", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    run("init", "-q", "-b", "develop");
    run("config", "user.email", "t@t");
    run("config", "user.name", "t");
    run("commit", "-q", "--allow-empty", "-m", "start");
    const base = run("rev-parse", "HEAD");
    run("checkout", "-q", "-b", "feature/x");
    run("commit", "-q", "--allow-empty", "-m", "feat: Log files");
    run("commit", "-q", "--allow-empty", "-m", "docs: A screenshot");
    run("checkout", "-q", "develop");
    // GitHub's merge commit, here without a description.
    run("merge", "-q", "--no-ff", "feature/x", "-m", "Merge pull request #14 from owner/feature/x");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const list = changes(`${base}..HEAD`);
      // Newest first, like `git log`.
      assert.deepEqual(list.map((c) => [c.number, c.type, c.text]), [
        [14, "docs", "A screenshot"],
        [14, "feat", "Log files"],
      ]);
      assert.equal(bumpOf(list), "minor");
    } finally {
      process.chdir(cwd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("when a beta is due", () => {
  const now = Date.parse("2026-12-01T12:00:00Z");
  const ago = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const c = (type, days, breaking = false) => ({ type, breaking, mergedAt: ago(days) });
  assert.equal(readiness([c("docs", 30)], now).ready, false, "nothing to release");
  assert.equal(readiness([c("feat", 1), c("feat", 1)], now).ready, false, "two features wait for a third");
  assert.match(readiness([c("feat", 1), c("feat", 1)], now).reason, /waiting for 1 more feature \(or 13 more days\)/);
  assert.equal(readiness([c("feat", 1), c("feat", 1), c("feat", 0)], now).ready, true);
  assert.equal(readiness([c("fix", 1)], now).ready, false);
  assert.match(readiness([c("fix", 1)], now).reason, /waiting for 2 more fixes \(or 2 more days\)/);
  assert.match(readiness([c("fix", 1), c("fix", 1), c("fix", 0)], now).reason, /^3 fixes are waiting$/);
  assert.equal(readiness([c("fix", 1), c("perf", 1), c("fix", 0)], now).ready, true, "a few fixes: patch release");
  assert.equal(readiness([c("fix", 3)], now).ready, true, "a fix waiting 3 days");
  assert.equal(readiness([c("feat", 3), c("fix", 3)], now).ready, false, "fixes wait with the features");
  assert.equal(readiness([c("feat", 14)], now).ready, true, "nothing waits more than 2 weeks");
  // Betas don't wait for a person: a breaking change counts as a feature.
  assert.equal(readiness([c("fix", 0, true), c("feat", 1), c("feat", 1)], now).ready, true);
  assert.deepEqual(rulesFromEnv({ RELEASE_FEATURES: "5", RELEASE_FIXES: "x" }), { features: 5, fixes: 3, fixDays: 3, maxDays: 14 });
  assert.equal(readiness([c("feat", 1), c("feat", 1)], now, { ...rulesFromEnv({}), features: 2 }).ready, true);
});

test("the version before the first release", () => {
  assert.equal(fileVersion({ FIRST_VERSION: "0.6.0" }), "0.6.0");
  assert.equal(fileVersion({}), "0.0.0");
});

test("beta numbers follow the stable they build on", () => {
  const tags = ["v0.7.0.1-beta", "v0.7.0.10-beta", "v0.7.0.2-beta", "v0.6.0.4-beta", "v0.7.0.x-beta", "v0.7.0"];
  assert.deepEqual(betaTags("0.7.0", tags), ["v0.7.0.10-beta", "v0.7.0.2-beta", "v0.7.0.1-beta"]);
  assert.equal(nextBeta("0.7.0", betaTags("0.7.0", tags)), "0.7.0.11");
  assert.equal(nextBeta("0.7.1", betaTags("0.7.1", tags)), "0.7.1.1");
  assert.equal(lastBetaTag([...tags, "v0.6.9.40-beta"]), "v0.7.0.10-beta");
  assert.equal(lastBetaTag(["v0.7.0"]), null);
});

test("a version in every form", () => {
  assert.deepEqual(versionForms("0.7.0"), { version: "0.7.0", beta: false, name: "0.7.0", tag: "v0.7.0", semver: "0.7.0", code: 70000 });
  assert.deepEqual(versionForms("0.7.0.3"), { version: "0.7.0.3", beta: true, name: "0.7.0.3 beta", tag: "v0.7.0.3-beta", semver: "0.7.1-3", code: 70003 });
  assert.equal(versionForms("1.2.3").code, 1020300);
  // A beta of 0.7.0 comes after 0.7.0 and before the hotfix 0.7.1, in every form.
  const order = ["0.7.0", "0.7.0.3", "0.7.1", "0.7.1.1", "0.8.0"].map(versionForms);
  assert.deepEqual(order.map((f) => f.code), [...order.map((f) => f.code)].sort((a, b) => a - b));
  assert.throws(() => versionForms("0.7.0.0"));
  assert.throws(() => versionForms("0.7"));
});

test("stable releases: /release bumps Y, /hotfix bumps Z, major only when asked", () => {
  const hotfix = { branch: "hotfix/crash", type: "fix" };
  const feature = { branch: "feature/x", type: "feat" };
  const docs = { branch: "docs/y", type: "docs" };
  assert.equal(stableBump([hotfix]), "patch");
  assert.equal(stableBump([feature, hotfix]), "minor");
  assert.equal(stableBump([docs]), "minor");
  assert.equal(stableBump([]), null);
  assert.equal(stableBump([hotfix], "major"), "major");
  assert.equal(bumped("0.7.3", "minor"), "0.8.0");
  assert.equal(bumped("0.7.3", "patch"), "0.7.4");
  assert.equal(bumped("0.7.3", "major"), "1.0.0");
});

test("plan.mjs through betas, /release and /hotfix", () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-"));
  const plan = join(process.cwd(), "scripts/release/plan.mjs");
  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const run = (mode, env = {}) => {
    const out = execFileSync("node", [plan, mode], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, FIRST_VERSION: "0.6.0", MAIN_REF: "main", ...env } });
    return Object.fromEntries(out.split("\n").filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  };
  // A pull request merged into the current branch (a merge commit, as GitHub makes them).
  let n = 0;
  const pr = (branch, title, base) => {
    n += 1;
    g("checkout", "-q", "-b", `${branch}-${n}`, base);
    g("commit", "-q", "--allow-empty", "-m", title);
    g("checkout", "-q", base);
    g("merge", "-q", "--no-ff", `${branch}-${n}`, "-m", `Merge pull request #${n} from o/${branch}`, "-m", title);
  };
  const tag = (t) => g("tag", t);
  try {
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    g("commit", "-q", "--allow-empty", "-m", "import");
    g("checkout", "-q", "-b", "develop");

    // Betas count from FIRST_VERSION until there's a stable tag.
    pr("feature/a", "feat: A", "develop");
    let p = run("beta");
    assert.deepEqual([p.version, p.name, p.tag, p.semver, p.count], ["0.6.0.1", "0.6.0.1 beta", "v0.6.0.1-beta", "0.6.1-1", "1"]);
    assert.equal(p.ready, "false", "one feature waits for more");
    tag(p.tag);
    pr("fix/b", "fix: B", "develop");
    p = run("beta");
    assert.deepEqual([p.version, p.count], ["0.6.0.2", "1"]);
    tag(p.tag);
    assert.equal(run("beta").version, "", "nothing new since the last beta");

    // /release: develop into main bumps Y.
    g("checkout", "-q", "main");
    g("merge", "-q", "--no-ff", "develop", "-m", "Merge pull request #90 from o/develop", "-m", "Release v0.7.0");
    p = run("stable");
    assert.deepEqual([p.version, p.tag, p.hotfix, p.beta], ["0.7.0", "v0.7.0", "false", "false"]);
    tag(p.tag);

    // Betas now build on 0.7.0.
    g("checkout", "-q", "develop");
    assert.equal(run("beta").version, "", "0.7.0 has everything develop has");
    pr("feature/c", "feat: C", "develop");
    p = run("beta");
    assert.equal(p.version, "0.7.0.1");
    tag(p.tag);

    // /hotfix: a hotfix PR into main bumps Z.
    pr("hotfix/crash", "fix: crash", "main");
    p = run("stable");
    assert.deepEqual([p.version, p.hotfix], ["0.7.1", "true"]);
    tag(p.tag);
    // The fix goes into develop, and a beta follows right away.
    g("checkout", "-q", "develop");
    g("merge", "-q", "--no-ff", "main", "-m", "Merge branch 'main' into develop");
    assert.equal(run("beta").version, "", "on its own, nothing new");
    p = run("beta", { NOW: "true" });
    assert.deepEqual([p.version, p.ready, p.reason], ["0.7.1.1", "true", "it brings in 0.7.1"]);

    // A major release only when asked.
    g("checkout", "-q", "main");
    g("merge", "-q", "--no-ff", "develop", "-m", "Merge pull request #91 from o/develop", "-m", "Release v1.0.0");
    assert.equal(run("stable", { BUMP: "major" }).version, "1.0.0");
    assert.equal(run("stable").version, "0.8.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
