// Writes a version into the app's files before a release build:
//   node scripts/release/set-version.mjs 1.2.3
// (package.json, tauri/tauri.conf.json, tauri/Cargo.toml and tauri/Cargo.lock). Releases
// are tagged; the files in the repository aren't changed by them.
import { readFileSync, writeFileSync } from "node:fs";
import { parseVersion } from "./lib.mjs";

const version = process.argv[2]?.replace(/^v/, "");
parseVersion(version ?? "");

const edit = (file, change) => {
  const before = readFileSync(file, "utf8");
  const after = change(before);
  if (after === before) throw new Error(`${file}: version not found`);
  writeFileSync(file, after);
};

for (const file of ["package.json", "tauri/tauri.conf.json"]) {
  edit(file, (s) => s.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
}
edit("tauri/Cargo.toml", (s) => s.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`));
edit("tauri/Cargo.lock", (s) => s.replace(/(\[\[package\]\]\nname = "openpres"\nversion = ")[^"]+(")/, `$1${version}$2`));
console.log(`version ${version}`);
