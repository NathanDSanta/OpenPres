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

`scripts/telegram/bot.mjs` runs on Nathan's Linux machine as a systemd user service. It listens
to Telegram all the time, so taps and commands are answered within seconds, while that
machine is on and online. Every hour it exits and the service starts it again, pulling the
newest `develop` first, so changes to the bot reach it by themselves once they're merged.
(It used to run on GitHub Actions' schedule, which GitHub often started hours late.)

- Announced pull requests get the label `telegram-announced`. Removing the label makes the
  bot announce that pull request again.
- **Only one copy may listen at a time.** Telegram gives each message to one listener, so a
  second copy (another machine, or a test run with the real token) takes messages away from
  it.
- To test changes: `node <harness> scripts/telegram/bot.mjs <scenario>` with fake GitHub and
  Telegram APIs (the pull requests describe how each change was checked).

## Setup (once, on the machine)

Needs Node.js 18 or newer (`sudo pacman -S nodejs` on Arch) and git.

1. **The code:**
   ```bash
   git clone https://github.com/NathanDSanta/OpenPres.git ~/openpres-bot
   ```
2. **The settings,** in a file only you can read:
   ```bash
   mkdir -p ~/.config/openpres-bot
   cat > ~/.config/openpres-bot/env <<'END'
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   GH_TOKEN=...
   END
   chmod 600 ~/.config/openpres-bot/env
   ```

   | Setting | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | The bot's token from @BotFather. |
   | `TELEGRAM_CHAT_ID` | The chat the bot listens to and writes to (Nathan's private chat with the bot). |
   | `GH_TOKEN` | A fine-grained personal access token (below). |
   | `RUN_SECONDS` | Optional: how long each run listens before the service restarts it (default 3600). |

3. **The service,** `~/.config/systemd/user/openpres-bot.service`:
   ```ini
   [Unit]
   Description=OpenPres Telegram bot
   Wants=network-online.target
   After=network-online.target

   [Service]
   EnvironmentFile=%h/.config/openpres-bot/env
   WorkingDirectory=%h/openpres-bot
   ExecStartPre=-/usr/bin/git pull --ff-only
   ExecStart=/usr/bin/env node scripts/telegram/bot.mjs
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```
4. **Start it,** and keep it running after logging out and across reboots:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now openpres-bot
   loginctl enable-linger $USER
   ```
   `journalctl --user -u openpres-bot -f` shows what it does. Send `/prs` to check it answers.

**The GitHub token:** GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens (edit the existing merge token, or generate a new one):

- **Repository access:** `NathanDSanta/OpenPres`, `OpenPres-M`, `OpenPres-V`, `OpenPres-SD`
  and `OpenPres-T`.
- **Permissions:**
  - Contents: read and write
  - Pull requests: read and write
  - Issues: read and write (for the label)
  - Actions: read (develop's checks, before `/release`)
  - Workflows: read and write (needed to merge pull requests that change `.github/workflows`)
- **Expiration:** as long as you like. When it expires, the bot can't merge until you put a
  new one in the settings file and run `systemctl --user restart openpres-bot`.

Merges are made as you (with your token), so they start the other workflows as usual: merging
into `main` publishes the release.

The repository secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_MERGE_TOKEN`
aren't used any more and can be deleted.
