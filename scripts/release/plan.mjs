// What the next release is.
//
//   node scripts/release/plan.mjs release   On main: the changes since the last release tag.
//   node scripts/release/plan.mjs next      On develop: the changes not in main yet (for the
//                                           "Release vX.Y.Z" pull request).
//
// Outputs (for GitHub Actions, or printed): version (empty: nothing to release), tag, bump,
// notes, hotfix (a hotfix/* branch is among the changes).
import { bumpOf, bumped, changes, fileVersion, lastTag, notes, setOutputs } from "./lib.mjs";

const mode = process.argv[2] ?? "release";

// Before the first tagged release: 0.3.0 was this commit (main when releases started).
const FIRST_RELEASE_BASE = "7ba5965923e4f832c6cf6153a159bb7b34767afc";
const repo = process.env.GITHUB_REPOSITORY;

let base;
let range;
if (mode === "next") {
  base = lastTag() ?? `v${fileVersion()}`;
  range = `${process.env.MAIN_REF ?? "origin/main"}..HEAD`;
} else {
  const tag = lastTag("HEAD");
  base = tag ?? `v${fileVersion()}`;
  range = tag ? `${tag}..HEAD` : `${FIRST_RELEASE_BASE}..HEAD`;
}

const list = changes(range);
const bump = bumpOf(list);
const version = bump ? bumped(base, bump) : "";
setOutputs({
  base,
  version,
  tag: version ? `v${version}` : "",
  bump: bump ?? "",
  count: list.length,
  hotfix: list.some((c) => c.branch?.startsWith("hotfix/")) ? "true" : "false",
  notes: notes(list, { repo }),
});
