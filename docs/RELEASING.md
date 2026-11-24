# Releases and branches

OpenPres releases itself: merging pull requests is the only thing to do. Installed apps
find new versions on GitHub Releases and offer to update.

## Branches

| Branch | What it holds | Changes arrive by |
|---|---|---|
| `main` | What's released. Every merge into it publishes a release. | The release pull request (from `develop`), or a hotfix pull request |
| `develop` | The next release, being put together. | Feature and fix pull requests |
| `feature/<name>` | One new feature. | Pull request into `develop`, titled `feat: …` |
| `fix/<name>` | One small, non-breaking fix (also `perf/…`, `refactor/…`, `docs/…`, `chore/…`, `ci/…`). | Pull request into `develop`, titled `fix: …` (`perf: …`, …) |
| `hotfix/<name>` | An urgent fix for the released version, branched from `main`. | Pull request into `main`, titled `fix: …` |

`main` and `develop` are protected: nothing goes into them except through a pull request
whose checks pass (for everyone, admins included).

Each change is its own pull request, even when several are asked for at once.

## Versions

The pull request titles decide the next version ([Conventional Commits](https://www.conventionalcommits.org)):

| Title | Kind of release | Example |
|---|---|---|
| `feat!: …` (or `BREAKING CHANGE` in the description) | Big release: breaking change | 1.4.2 → 2.0.0 (before 1.0: 0.4.2 → 0.5.0) |
| `feat: …` | New features | 0.4.2 → 0.5.0 |
| `fix: …`, `perf: …` | Patch: small, non-breaking | 0.4.2 → 0.4.3 |
| `docs:`, `ci:`, `chore:`, `refactor:`, `test:`, `build:`, `style:` | None on their own | — |

The "Pull request rules" check reminds of the title and branch rules.

Releases are tagged (`vX.Y.Z`); the version is written into the app when it's built for the
release, so the files in the repository don't change with each release.

## How a release happens

1. Feature and fix pull requests are merged into `develop`. After each one, the bot opens
   (or updates) a pull request **"Release vX.Y.Z"** from `develop` into `main`, listing
   everything in it, the version it will get and when it will be released. After each
   merge into `develop`, test builds are in the "Build Tauri App" run's artifacts.
2. When it's time (below), the bot merges that pull request and starts the "Release"
   workflow. It tags the release, builds it for Windows, macOS and Linux, and publishes it
   on GitHub Releases with `latest.json`. Installed apps then offer the update.
3. Merging the pull request yourself (with **Create a merge commit**) releases right away.

### When releases happen

Changes are released in small batches instead of one release per pull request:

| What's waiting in `develop` | Released |
|---|---|
| 3 new features (`feat:`) | as a feature release (0.4.0 → 0.5.0), with any fixes waiting |
| Only fixes (`fix:`, `perf:`): 3 of them, or one that has waited 3 days | as a patch release (0.4.0 → 0.4.1) |
| Anything that has waited 2 weeks | anyway |
| A breaking change (`feat!:`) | only when someone merges the pull request |

- The bot checks after each merge into `develop`, when `develop`'s checks finish, and every
  morning. It only releases when every check on `develop` passed.
- **Label the release pull request `hold`** to stop it from releasing by itself (for
  example before a big service). Remove the label to let it go again.
- The numbers can be changed with repository variables (Settings → Secrets and variables →
  Actions → Variables): `RELEASE_FEATURES`, `RELEASE_FIXES`, `RELEASE_FIX_DAYS`,
  `RELEASE_MAX_DAYS`.

### What a release contains

Every release has installers for each system, named for what they are:

| File | For |
|---|---|
| `OpenPres-X.Y.Z-Windows-x64-Setup.exe` | Windows 10/11 (most PCs). Recommended. |
| `OpenPres-X.Y.Z-Windows-x64.msi` | Windows, for IT deployment (MSI) |
| `OpenPres-X.Y.Z-Windows-ARM64-Setup.exe` / `.msi` | Windows on ARM (Snapdragon laptops) |
| `OpenPres-X.Y.Z-macOS-Apple-Silicon.dmg` | Macs with Apple Silicon (M1 and newer) |
| `OpenPres-X.Y.Z-macOS-Intel.dmg` | Macs with an Intel processor |
| `OpenPres-X.Y.Z-Linux-x64.AppImage` / `.deb` / `.rpm` | Linux PCs: any distribution / Debian, Ubuntu, Mint / Fedora, openSUSE |
| `OpenPres-X.Y.Z-Linux-ARM64.AppImage` / `.deb` / `.rpm` | Linux on ARM (Raspberry Pi 5…) |
| `OpenPres-X.Y.Z-StreamDeck-Plugin.streamDeckPlugin` | the Stream Deck / OpenDeck plugin |
| `OpenPres-X.Y.Z-macOS-*.app.tar.gz` | used by automatic updates on macOS |
| `SHA256SUMS.txt` | checksums of all of them |
| `latest.json` | where installed apps find the update |

The release notes start with a table of these downloads. Windows x64, macOS Apple Silicon
and Linux x64 must build for a release to be published. The others (ARM64 and Intel Mac)
are extras: if one fails to build, the release goes out without it. Names come from
`scripts/release/assets.mjs`; the builds are in `.github/workflows/package.yaml` (shared
by releases and test builds).

Pull requests can also be merged from Telegram: the bot announces each one (the release
pull request too) with a **Merge** button. See [TELEGRAM.md](TELEGRAM.md).

### Hotfixes

For an urgent fix to the released version: branch `hotfix/<name>` from `main`, open the pull
request into `main` titled `fix: …`. Merging it publishes a patch release right away
(nothing else from `develop` goes with it). The bot then opens a pull request bringing the
hotfix into `develop`; merge it too.

## One-time setup (repository settings)

These can only be changed by the repository owner, in the repository's **Settings**:

1. **Let the bot open pull requests**: Settings → Actions → General → Workflow
   permissions: choose **Read and write permissions** and tick **Allow GitHub Actions to
   create and approve pull requests**.
2. **Signing key for updates**: Settings → Secrets and variables → Actions → New
   repository secret, named `TAURI_SIGNING_PRIVATE_KEY`, with the contents of the private
   key file. (If the key has a password, also add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.)
   Installed apps only accept updates signed with it: keep a copy of the key somewhere safe.
   Losing it means users have to install the next version by hand.

A new key pair is made with `npx tauri signer generate -w openpres-updater.key`; its public
key goes in `tauri/tauri.conf.json` (`plugins.updater.pubkey`).

## If something fails

- A failed build leaves a draft release and its tag. Re-run the failed jobs of the
  "Release" run (Actions tab), or build it again with today's workflow: Actions →
  **Release** → Run workflow, with the tag (e.g. `v0.4.0`). The draft's files are replaced
  and it's published when every main build is in.
- The release pull request can be refreshed by hand: Actions → "Release pull request" →
  Run workflow (on `develop`).
