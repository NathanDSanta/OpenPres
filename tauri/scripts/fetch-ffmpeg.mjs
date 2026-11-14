#!/usr/bin/env node
// Puts a static ffmpeg build in tauri/binaries/ffmpeg-<target-triple>[.exe], where Tauri's
// `externalBin` picks it up and ships it next to the app (nothing to install for users).
// Runs before `tauri dev` / `tauri build`; does nothing when the file is already there.
//
//   node tauri/scripts/fetch-ffmpeg.mjs [--target <triple>]
//
// Sources (static builds): BtbN/FFmpeg-Builds (Linux, Windows), martin-riedl.de (macOS).
// If the download fails, an ffmpeg found on PATH is copied instead.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "..", "binaries");

function targetTriple() {
  const i = process.argv.indexOf("--target");
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const host = out.split("\n").find((l) => l.startsWith("host:"));
    if (host) return host.slice(5).trim();
  } catch {
    /* rustc not on PATH */
  }
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

const BTBN = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
function source(triple) {
  if (triple.includes("windows")) {
    return { url: `${BTBN}/ffmpeg-master-latest-win64-gpl.zip`, archive: "zip", exe: "ffmpeg.exe" };
  }
  if (triple.includes("apple")) {
    const arch = triple.startsWith("aarch64") ? "arm64" : "amd64";
    return { url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release/ffmpeg.zip`, archive: "zip", exe: "ffmpeg" };
  }
  const arch = triple.startsWith("aarch64") ? "linuxarm64" : "linux64";
  return { url: `${BTBN}/ffmpeg-master-latest-${arch}-gpl.tar.xz`, archive: "tar.xz", exe: "ffmpeg" };
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry === name) {
      return path;
    }
  }
  return null;
}

/** bsdtar (Windows 10+, macOS) reads zip; GNU tar reads .tar.xz. */
function extract(file, archive, dir) {
  if (process.platform === "win32") {
    // Git for Windows puts GNU tar first on PATH, which cannot read "C:\..." paths: use the
    // system's bsdtar, or PowerShell when it is missing.
    const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    if (existsSync(systemTar)) {
      execFileSync(systemTar, ["-xf", file, "-C", dir], { stdio: "inherit" });
    } else {
      execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dir}' -Force`], { stdio: "inherit" });
    }
    return;
  }
  execFileSync("tar", archive === "zip" ? ["-xf", file, "-C", dir] : ["-xJf", file, "-C", dir], { stdio: "inherit" });
}

function fromPath(exe) {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    return execFileSync(finder, [exe.replace(".exe", "")], { encoding: "utf8" }).split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const triple = targetTriple();
  const { url, archive, exe } = source(triple);
  const target = join(binDir, `ffmpeg-${triple}${triple.includes("windows") ? ".exe" : ""}`);
  if (existsSync(target) && statSync(target).size > 1_000_000) {
    return;
  }
  mkdirSync(binDir, { recursive: true });
  const work = join(tmpdir(), `openpres-ffmpeg-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    console.log(`Downloading ffmpeg for ${triple}…\n  ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = join(work, `ffmpeg.${archive}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    extract(file, archive, work);
    const found = findFile(work, exe);
    if (!found) throw new Error(`${exe} not found in the archive`);
    copyFileSync(found, target);
  } catch (err) {
    const local = fromPath(exe);
    if (!local) {
      console.error(`Could not get ffmpeg (${err.message}) and there is none on PATH.`);
      console.error(`Download it yourself and save it as ${target}`);
      process.exit(1);
    }
    console.warn(`Download failed (${err.message}); bundling ${local} instead.`);
    copyFileSync(local, target);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (process.platform !== "win32") chmodSync(target, 0o755);
  console.log(`ffmpeg ready: ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
