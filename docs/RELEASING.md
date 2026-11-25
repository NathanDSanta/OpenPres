# Releasing

The same in every OpenPres repository: the server (OpenPres), the Manager (OpenPres-M), the
viewer app (OpenPres-V), the Stream Deck plugin (OpenPres-SD) and the Translation app
(OpenPres-T). Each one releases on its own, with its own version.

## Branches and pull requests

- `develop`: where work goes. Name a branch `feature/…`, `fix/…`, `perf/…`, `refactor/…`,
  `docs/…`, `chore/…` or `ci/…`, open the pull request into `develop`, and give it a title that
  says what kind of change it is: `feat: …`, `fix: …`, `perf: …`, `docs: …`, `ci: …`,
  `chore: …`. "Pull request rules" checks both.
- `main`: the stable releases. Only `develop` (through `/release`) and `hotfix/…` branches go
  into it.
- Merge with **Create a merge commit**.

## Betas: by themselves

Every pull request merged into `develop` goes into the next beta. A beta is published when
there's enough waiting and develop's checks are green (`beta.yaml`):

- 3 new features, or
- 3 fixes (with no features waiting), or a fix that has waited 3 days, or
- anything that has waited 14 days.

The numbers can be changed with the repository variables `RELEASE_FEATURES`, `RELEASE_FIXES`,
`RELEASE_FIX_DAYS` and `RELEASE_MAX_DAYS`. To publish one now, run the **Beta** workflow by
hand with "now".

A beta is named after the stable it builds on: **0.7.0.3 beta** is the third beta since 0.7.0
(tag `v0.7.0.3-beta`, a pre-release on GitHub). Servers follow betas only when the admin joins
the beta program (Settings → System); the Manager, the plugin and the apps follow their
server.

## Stable releases: only when asked

On Telegram, to the OpenPres bot:

| Command | What it does |
|---|---|
| `/release` | The server: `develop` goes into `main`, released as X.**Y+1**.0. |
| `/release M` | The same for the Manager (`V`, `SD`, `T` for the others). |
| `/hotfix 12` | Merges hotfix pull request #12 (a `hotfix/…` branch into `main`), released as X.Y.**Z+1**. Then `main` goes back into `develop` and a beta follows straight away (X.Y.Z+1.1), so the beta program has the fix too. |
| `/hotfix M 12` | The same in the Manager's repository. |

No pull request into `main` exists until you ask: the bot opens it and merges it, and the push
to `main` starts the release.

A major release (X+1.0.0) happens only when Nathan asks for one: run the **Release** workflow by
hand on `main` with "major".

## Versions in each program

| | Stable | Beta |
|---|---|---|
| What people see | 0.7.0 | 0.7.0.3 beta |
| Tag | `v0.7.0` | `v0.7.0.3-beta` |
| Desktop apps (X.Y.Z only) | 0.7.0 | 0.7.1-3: after 0.7.0, before the hotfix 0.7.1 |
| Android versionCode | 70000 | 70003 |
| Stream Deck plugin | 0.7.0.0 | 0.7.0.3 |

They all sort the same way: 0.7.0 < 0.7.0.3 beta < 0.7.1 < 0.7.1.1 beta < 0.8.0.

## This repository's builds

The server for every computer (`package.yaml`): Windows, macOS and Linux, x64 and ARM. Each
build takes the newest Manager's web build (with betas, for a beta; `tauri/scripts/fetch-manager.mjs`),
which the server serves to browsers and shows in its own windows. The installers are signed
for updates with the `TAURI_SIGNING_PRIVATE_KEY` secret, and every release publishes
`latest.json`, where installed servers look for updates, and replaces it on the "beta-feed"
release, where servers in the beta program look. Test builds of any branch: the **Build
Tauri App** workflow (by hand, or after each merge into `develop`).

## Files

- `scripts/release/lib.mjs`, `plan.mjs`: versions and notes (`node --test scripts/release/lib.test.mjs`).
- `.github/workflows/beta.yaml`: decides when a beta is due.
- `.github/workflows/release.yaml`: builds and publishes stable releases and betas; the build
  job is the only part that differs between repositories.
- `.github/workflows/pr-rules.yaml`: titles and branches.
- Here also: `package.yaml` and `build.yaml` (the installers), `scripts/release/assets.mjs` (file
  names and the downloads table), `set-version.mjs` and `updater-json.mjs` (latest.json).
