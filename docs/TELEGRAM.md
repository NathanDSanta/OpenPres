# Pull requests and releases from Telegram

The Telegram bot (@natandsantacbot) looks after the five OpenPres repositories: the server
(OpenPres), the Manager (**M**, OpenPres-M), the viewer app (**V**, OpenPres-V), the Stream
Deck plugin (**SD**, OpenPres-SD) and the Translation app (**T**, OpenPres-T). It sends a
message for every new pull request with a **✅ Merge** button, and makes stable releases when
asked (docs/RELEASING.md).

It only listens to one chat (`TELEGRAM_CHAT_ID`). Messages from anyone else are ignored.

## Using it

Add **M**, **V**, **SD** or **T** to a command for that program; nothing means the server.

| In Telegram | What happens |
|---|---|
| **✅ Merge #33** / **✅ Merge M#4** button | Merges that pull request (**Create a merge commit**). The reply says ✅ merged, or why not (conflicts, stacked on another pull request…). |
| `/merge 33`, `/merge M 4` | The same, typed. |
| `/merge all` | Merges every open pull request into `develop` in every repository, oldest first, and replies with how each went. Not drafts, and not the ones into `main` (those are `/release` and `/hotfix`). Only works if the bot gets the message within 10 minutes, so a late one doesn't merge pull requests opened since you sent it. |
| `/release`, `/release M` | A **stable release**: `develop` goes into `main` through a pull request the bot opens and merges at once, and X.**Y+1**.0 is built and published. Refused while develop's checks run or after they fail, and when develop has nothing new. |
| `/hotfix 12`, `/hotfix M 12` | Merges **hotfix** pull request #12 (a `hotfix/…` branch into `main`): X.Y.**Z+1** is published, then the fix goes into `develop` and a beta with it follows (X.Y.Z+1.1 beta). |
| `/prs` | Lists the open pull requests of every repository, each with its button. |
| `/help` | The commands. |

- **Betas need nothing from you:** they're published from `develop` by themselves
  (docs/RELEASING.md). Major releases (X+1) only when Nathan asks for one.
- **No pull request into `main` exists until you ask** with `/release`.
- **It merges into** `develop`, `main` and `gh-pages` (the website).
- **Stacked pull requests** (based on another feature branch) are refused. Merge the one
  below first; GitHub then moves the next one onto the branch that one went into.
- **Drafts aren't announced** until they're marked ready.

## How it works

`.github/workflows/telegram-bot.yaml` (in OpenPres) runs `scripts/telegram/bot.mjs` on GitHub's
schedule. Each run listens to Telegram for about 4 minutes. GitHub starts scheduled runs late,
often by hours, so an answer can take that long. To answer at once, start it by hand:
Actions → Telegram bot → Run workflow.

- Announced pull requests get the label `telegram-announced`. Removing the label makes the
  bot announce that pull request again.
- GitHub pauses scheduled workflows in public repositories after 60 days without any
  activity. Re-enable it in Actions → Telegram bot.
- To test changes: `node <harness> scripts/telegram/bot.mjs <scenario>` with fake GitHub and
  Telegram APIs (the pull requests describe how each change was checked).

## One-time setup (secrets of the OpenPres repository)

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The bot's token from @BotFather. |
| `TELEGRAM_CHAT_ID` | The chat the bot listens to and writes to (Nathan's private chat with the bot). |
| `TELEGRAM_MERGE_TOKEN` | A fine-grained personal access token (below). |

**The merge token:** GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens (edit the existing one, or generate a new one):

- **Repository access:** `NathanDSanta/OpenPres`, `OpenPres-M`, `OpenPres-V`, `OpenPres-SD`
  and `OpenPres-T`.
- **Permissions:**
  - Contents: read and write
  - Pull requests: read and write
  - Issues: read and write (for the label)
  - Actions: read (develop's checks, before `/release`)
  - Workflows: read and write (needed to merge pull requests that change `.github/workflows`)
- **Expiration:** as long as you like. When it expires, the bot can't merge until you
  replace the secret.

The workflow's own `github.token` isn't used: it only reaches the OpenPres repository, and
merges made with it don't start other workflows, so merging into `main` wouldn't publish
anything.

Until all three secrets are set, the workflow does nothing and still passes.
