// The Manager's web build, which the server serves to browsers and shows in its own windows
// (outputs, stream graphics, setup). It comes from the Manager's releases (OpenPres-M),
// into tauri/manager-web (no dependencies; Node 20+):
//
//   node tauri/scripts/fetch-manager.mjs              the newest stable Manager
//   node tauri/scripts/fetch-manager.mjs --beta       the newest, betas included
//   node tauri/scripts/fetch-manager.mjs --tag v0.7.0 that release
//   node tauri/scripts/fetch-manager.mjs --from ../OpenPres-M/dist   a local build
//   node tauri/scripts/fetch-manager.mjs --source develop            built from OpenPres-M's develop
//
// Before the Manager's first release, it builds from OpenPres-M's develop (git, npm).
// --out <folder> puts it somewhere else than tauri/manager-web.
// It does nothing when tauri/manager-web is already there (--force fetches again).
// GITHUB_TOKEN, when set, avoids GitHub's limit on anonymous requests (CI).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "NathanDSanta/OpenPres-M";
const ASSET = /^OpenPres-Manager-web-.+\.zip$/;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(value("--out") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "manager-web"));

/** The release to take: the asked tag, or the newest (stable, or any with betas). */
export function pickRelease(releases, { tag, beta }) {
  return releases.find((r) => !r.draft && (tag ? r.tag_name === tag : beta || !r.prerelease) && r.assets?.some((a) => ASSET.test(a.name))) ?? null;
}

async function main() {
  if (existsSync(join(out, "index.html")) && !flag("--force")) {
    console.log(`The Manager's web build is already in ${out} (--force fetches it again).`);
    return;
  }
  const from = value("--from");
  rmSync(out, { recursive: true, force: true });
  if (from) {
    if (!existsSync(join(from, "index.html"))) throw new Error(`${from} has no index.html: build the Manager first (npm run build in OpenPres-M)`);
    cpSync(from, out, { recursive: true });
    writeFileSync(join(out, ".version"), `local build from ${resolve(from)}\n`);
    console.log(`Copied the Manager's web build from ${from}.`);
    return;
  }
  const headers = { "User-Agent": "OpenPres-build", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=50`;
  let res = await fetch(url, { headers });
  // A token that doesn't work here: the repository is public, ask without it.
  if (res.status === 401 && headers.Authorization) {
    delete headers.Authorization;
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${REPO}'s releases`);
  const source = value("--source");
  if (source) return build(source);
  const release = pickRelease(await res.json(), { tag: value("--tag"), beta: flag("--beta") });
  if (!release && !value("--tag")) {
    console.warn(`No Manager release with a web build in ${REPO} yet: building it from develop.`);
    return build("develop");
  }
  if (!release) throw new Error(`No Manager release called ${value("--tag")} with a web build in ${REPO}.`);
  const asset = release.assets.find((a) => ASSET.test(a.name));
  const zip = await fetch(asset.browser_download_url, { headers: { "User-Agent": headers["User-Agent"] } });
  if (!zip.ok) throw new Error(`GitHub answered ${zip.status} for ${asset.name}`);
  const tmp = mkdtempSync(join(tmpdir(), "openpres-manager-"));
  const file = join(tmp, asset.name);
  writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
  mkdirSync(out, { recursive: true });
  unzip(file, out);
  rmSync(tmp, { recursive: true, force: true });
  if (!existsSync(join(out, "index.html"))) throw new Error(`${asset.name} has no index.html`);
  writeFileSync(join(out, ".version"), `${release.tag_name}\n`);
  console.log(`The Manager's web build ${release.tag_name} (${asset.name}) is in ${out}.`);
}

/**
 * Unpacks a zip file: unzip on Linux, tar on macOS (bsdtar reads zip files). On Windows,
 * Windows' own tar (System32, also bsdtar), not the first tar on the PATH: Git's bash brings
 * GNU tar, which can't read zip files and takes "C:" for a computer to connect to. Without
 * it, PowerShell's Expand-Archive.
 */
function unzip(file, dir) {
  if (process.platform === "linux") return execFileSync("unzip", ["-q", "-o", file, "-d", dir]);
  if (process.platform !== "win32") return execFileSync("tar", ["-xf", file, "-C", dir]);
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (existsSync(tar)) return execFileSync(tar, ["-xf", file, "-C", dir]);
  const quote = (p) => `'${p.replace(/'/g, "''")}'`;
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(dir)} -Force`]);
}

/** Builds the Manager from a branch or tag of OpenPres-M (git and npm). */
function build(ref) {
  const tmp = mkdtempSync(join(tmpdir(), "openpres-manager-src-"));
  const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  run("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, `https://github.com/${REPO}.git`, tmp]);
  run("npm", ["ci", "--no-audit", "--no-fund"], tmp);
  run("npm", ["run", "build"], tmp);
  cpSync(join(tmp, "dist"), out, { recursive: true });
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: tmp }).toString().trim();
  writeFileSync(join(out, ".version"), `built from ${REPO} ${ref} (${commit})\n`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`Built the Manager's web build from ${ref} (${commit}) into ${out}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`fetch-manager: ${e.message}`);
    process.exit(1);
  });
}
