// Builds latest.json, the file installed apps check for updates
// (https://github.com/<repo>/releases/latest/download/latest.json), from a release's
// update signatures (named "<release file>.sig", see assets.mjs):
//   node scripts/release/updater-json.mjs <version> <folder with the .sig files> <repo> <tag> > latest.json
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { updaterPlatforms } from "./assets.mjs";

const [version, folder, repo, tag] = process.argv.slice(2);
const notes = process.env.RELEASE_NOTES ?? "";

const sigs = {};
for (const file of readdirSync(folder)) if (file.endsWith(".sig")) sigs[file] = readFileSync(join(folder, file), "utf8");
const platforms = updaterPlatforms(sigs, (asset) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(asset)}`);
if (!Object.keys(platforms).length) {
  console.error("no signed update bundles found");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n");
