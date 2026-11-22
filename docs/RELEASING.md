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
   everything in it and the version it will get. After each merge into `develop`, test
   builds are in the "Build Tauri App" run's artifacts.
2. Merging that pull request (with **Create a merge commit**) publishes the release: the
   "Release" workflow tags it, builds it for Windows, macOS and Linux, and publishes it on
   GitHub Releases with `latest.json`. Installed apps then offer the update.

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

- A failed build leaves a draft release and its tag: re-run the failed jobs of the
  "Release" run (Actions tab). Publishing happens only when every build is in.
- The release pull request can be refreshed by hand: Actions → "Release pull request" →
  Run workflow (on `develop`).
