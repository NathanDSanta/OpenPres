// node --test scripts/release/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpOf, bumped, changes, parseTitle, notes, pickPullRequests } from "./lib.mjs";

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
  assert.equal(bumped("0.4.2", "major"), "0.5.0");
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
