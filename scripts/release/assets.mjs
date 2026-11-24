// Release files: what each build produces, the names they get on the release page, and how
// installed apps find their update among them (no dependencies; Node 20+).
//
//   node scripts/release/assets.mjs collect <platform> <version> <out folder> [<bundle folder>]
//       Copies a build's installers into <out folder> with their release names, their update
//       signatures into <out folder>/sigs, and writes <out folder>/SHA256SUMS-<platform>.txt.
//
// Names say what a file is, like most desktop apps' releases (OBS, FreeShow, LocalSend):
//   OpenPres-0.5.0-Windows-x64-Setup.exe     OpenPres-0.5.0-macOS-Apple-Silicon.dmg
//   OpenPres-0.5.0-Linux-x64.AppImage        OpenPres-0.5.0-Linux-ARM64.deb
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP = "OpenPres";

/** The builds: Rust target, how the file names say it, and the updater's name for it. */
export const PLATFORMS = {
  "windows-x64": { target: "x86_64-pc-windows-msvc", os: "Windows", arch: "x64", updater: "windows-x86_64", label: "Windows 10/11 (most PCs)" },
  "windows-arm64": { target: "aarch64-pc-windows-msvc", os: "Windows", arch: "ARM64", updater: "windows-aarch64", label: "Windows on ARM (Snapdragon)" },
  "macos-arm64": { target: "aarch64-apple-darwin", os: "macOS", arch: "Apple-Silicon", updater: "darwin-aarch64", label: "Mac with Apple Silicon (M1 and newer)" },
  "macos-x64": { target: "x86_64-apple-darwin", os: "macOS", arch: "Intel", updater: "darwin-x86_64", label: "Mac with an Intel processor" },
  "linux-x64": { target: "x86_64-unknown-linux-gnu", os: "Linux", arch: "x64", updater: "linux-x86_64", label: "Linux (64-bit PC)" },
  "linux-arm64": { target: "aarch64-unknown-linux-gnu", os: "Linux", arch: "ARM64", updater: "linux-aarch64", label: "Linux on ARM (e.g. Raspberry Pi 5)" },
};

/**
 * Tauri's bundle folders -> release files. `installer` is the updater's name for the kind
 * (the "windows-x86_64-msi" key), `main` marks the one updates use by default.
 */
export const KINDS = [
  { folder: "nsis", ext: ".exe", suffix: "-Setup.exe", installer: "nsis", main: true, what: "Installer" },
  { folder: "msi", ext: ".msi", suffix: ".msi", installer: "msi", what: "MSI package (IT deployment)" },
  { folder: "dmg", ext: ".dmg", suffix: ".dmg", what: "Disk image" },
  { folder: "macos", ext: ".app.tar.gz", suffix: ".app.tar.gz", installer: "app", main: true, what: "Update bundle (used by automatic updates)" },
  { folder: "appimage", ext: ".AppImage", suffix: ".AppImage", installer: "appimage", main: true, what: "AppImage (any distribution)" },
  { folder: "deb", ext: ".deb", suffix: ".deb", installer: "deb", what: "Debian, Ubuntu, Mint" },
  { folder: "rpm", ext: ".rpm", suffix: ".rpm", installer: "rpm", what: "Fedora, openSUSE" },
];

/** "OpenPres-0.5.0-Windows-x64-Setup.exe" */
export function assetName(version, platform, kind) {
  const p = PLATFORMS[platform];
  if (!p) throw new Error(`unknown platform ${platform}`);
  return `${APP}-${version}-${p.os}-${p.arch}${kind.suffix}`;
}

/** A release file's name -> { version, platform, kind } (null for other files). */
export function parseAssetName(name) {
  for (const [platform, p] of Object.entries(PLATFORMS)) {
    for (const kind of KINDS) {
      const tail = `-${p.os}-${p.arch}${kind.suffix}`;
      if (name.startsWith(`${APP}-`) && name.endsWith(tail)) {
        const version = name.slice(APP.length + 1, -tail.length);
        if (version) return { version, platform, kind };
      }
    }
  }
  return null;
}

/** The files of one build: [{ from, name, sig }] (sig: its update signature, if any). */
export function bundleFiles(bundleDir, platform, version) {
  const out = [];
  for (const kind of KINDS) {
    const dir = join(bundleDir, kind.folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const from = join(dir, file);
      if (!file.endsWith(kind.ext) || !statSync(from).isFile()) continue;
      const sig = existsSync(`${from}.sig`) ? `${from}.sig` : null;
      out.push({ from, name: assetName(version, platform, kind), sig });
    }
  }
  const names = out.map((f) => f.name);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) throw new Error(`two files would be named ${twice}`);
  return out;
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * latest.json's "platforms" from the signatures (named "<release file>.sig"): one key per
 * installer kind ("windows-x86_64-msi") and the plain key ("windows-x86_64") for the main one.
 */
export function updaterPlatforms(sigs, urlOf) {
  const platforms = {};
  for (const [file, signature] of Object.entries(sigs)) {
    if (!file.endsWith(".sig")) continue;
    const asset = file.slice(0, -4);
    const parsed = parseAssetName(asset);
    if (!parsed?.kind.installer) continue;
    const key = PLATFORMS[parsed.platform].updater;
    const entry = { signature: signature.trim(), url: urlOf(asset) };
    platforms[`${key}-${parsed.kind.installer}`] = entry;
    if (parsed.kind.main) platforms[key] = entry;
  }
  return platforms;
}

/** The "Downloads" part of the release notes, from the release's file names. */
export function downloadsTable(names, urlOf) {
  const rows = [];
  const parsed = names.map((name) => ({ name, ...parseAssetName(name) })).filter((f) => f.kind);
  for (const [platform, p] of Object.entries(PLATFORMS)) {
    // In KINDS order (installer first); the macOS update bundle isn't for downloading by hand.
    const files = KINDS.filter((k) => k.folder !== "macos")
      .map((kind) => parsed.find((f) => f.platform === platform && f.kind === kind))
      .filter(Boolean);
    if (!files.length) continue;
    rows.push(`| ${p.label} | ${files.map((f) => `[${f.kind.what}](${urlOf(f.name)})`).join(" · ")} |`);
  }
  const plugin = names.find((n) => n.endsWith(".streamDeckPlugin"));
  if (plugin) rows.push(`| Stream Deck / OpenDeck | [Plugin](${urlOf(plugin)}) (double-click it to install) |`);
  const apk = names.find((n) => n.endsWith("-Android.apk"));
  if (apk) rows.push(`| Android phones and tablets | [Viewer app](${urlOf(apk)}) (watch a screen, hear a bus) |`);
  if (!rows.length) return "";
  const sums = names.includes("SHA256SUMS.txt") ? `\n\nChecksums: [SHA256SUMS.txt](${urlOf("SHA256SUMS.txt")}).` : "";
  return `## Downloads\n\n| Computer | Download |\n|---|---|\n${rows.join("\n")}${sums}\n\nInstalled copies update themselves (Settings → System).`;
}

function collect(platform, version, out, bundleDir) {
  const target = PLATFORMS[platform]?.target;
  if (!target) throw new Error(`unknown platform ${platform}`);
  bundleDir ??= join("tauri", "target", target, "release", "bundle");
  const files = bundleFiles(bundleDir, platform, version);
  if (!files.length) throw new Error(`no installers in ${bundleDir}`);
  mkdirSync(join(out, "sigs"), { recursive: true });
  const sums = [];
  for (const f of files) {
    copyFileSync(f.from, join(out, f.name));
    if (f.sig) copyFileSync(f.sig, join(out, "sigs", `${f.name}.sig`));
    sums.push(`${sha256(join(out, f.name))}  ${f.name}`);
    console.log(`${basename(f.from)} -> ${f.name}${f.sig ? " (+ update signature)" : ""}`);
  }
  writeFileSync(join(out, `SHA256SUMS-${platform}.txt`), sums.join("\n") + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "collect" && args.length >= 3) collect(args[0], args[1], args[2], args[3]);
  else {
    console.error("usage: node scripts/release/assets.mjs collect <platform> <version> <out folder> [<bundle folder>]");
    process.exit(2);
  }
}
