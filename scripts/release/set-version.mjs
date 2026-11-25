// Writes a version into the server's files before a release build:
//   node scripts/release/set-version.mjs 0.7.1-3
// (package.json, tauri/tauri.conf.json, tauri/Cargo.toml and tauri/Cargo.lock).
// The server program carries betas as X.Y.(Z+1)-A (the "semver" form, docs/RELEASING.md).
// Releases are tagged; the files in the repository aren't changed by them.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "") ?? "";
if (!/^\d+\.\d+\.\d+(-\d+)?$/.test(version)) {
  console.error(`not a version: "${version}" (X.Y.Z or X.Y.Z-A)`);
  process.exit(2);
}

const edit = (file, change) => {
  const before = readFileSync(file, "utf8");
  const after = change(before);
  if (after === before && !before.includes(version)) throw new Error(`${file}: version not found`);
  writeFileSync(file, after);
};

for (const file of ["package.json", "tauri/tauri.conf.json"]) {
  edit(file, (s) => s.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
}
// \r?\n: Windows checkouts have CRLF line endings.
edit("tauri/Cargo.toml", (s) => s.replace(/(\[package\][^[]*?\r?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`));
edit("tauri/Cargo.lock", (s) => s.replace(/(\[\[package\]\]\r?\nname = "openpres"\r?\nversion = ")[^"]+(")/, `$1${version}$2`));
console.log(`version ${version}`);
