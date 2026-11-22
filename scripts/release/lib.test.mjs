// node --test scripts/release/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpOf, bumped, parseTitle, notes } from "./lib.mjs";

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
