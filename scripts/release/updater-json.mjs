// Builds latest.json, the file installed apps check for updates
// (https://github.com/<repo>/releases/latest/download/latest.json), from a release's
// update bundles and their signatures:
//   node scripts/release/updater-json.mjs <version> <folder with the .sig files> <repo> <tag> > latest.json
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [version, folder, repo, tag] = process.argv.slice(2);
const notes = process.env.RELEASE_NOTES ?? "";

// Update bundle name -> updater platform keys. The app looks for "<os>-<arch>-<installer>"
// first (so a .deb install gets the .deb), then "<os>-<arch>".
const KINDS = [
  { test: /\.AppImage$/, platforms: ["linux-x86_64-appimage", "linux-x86_64"] },
  { test: /\.deb$/, platforms: ["linux-x86_64-deb"] },
  { test: /\.rpm$/, platforms: ["linux-x86_64-rpm"] },
  { test: /-setup\.exe$/, platforms: ["windows-x86_64-nsis", "windows-x86_64"] },
  { test: /\.msi$/, platforms: ["windows-x86_64-msi"] },
  { test: /\.app\.tar\.gz$/, platforms: ["darwin-aarch64-app", "darwin-aarch64"] },
];

const platforms = {};
for (const file of readdirSync(folder)) {
  if (!file.endsWith(".sig")) continue;
  const bundle = file.slice(0, -4);
  const kind = KINDS.find((k) => k.test.test(bundle));
  if (!kind) continue;
  const entry = {
    signature: readFileSync(join(folder, file), "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(bundle)}`,
  };
  for (const p of kind.platforms) platforms[p] ??= entry;
}
if (!Object.keys(platforms).length) {
  console.error("no signed update bundles found");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n");
