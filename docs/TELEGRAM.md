# Merging pull requests from Telegram

The Telegram bot (@natandsantacbot) sends a message for every new pull request, including
the "Release vX.Y.Z" one, with a **✅ Merge** button. Tapping it merges the pull request
the same way as the button on GitHub (**Create a merge commit**), and the bot replies with
the result.

It only listens to one chat (`TELEGRAM_CHAT_ID`). Messages from anyone else are ignored.

## Using it

| In Telegram | What happens |
|---|---|
| **✅ Merge #33** button | Merges #33. The reply says ✅ merged, or why not (checks still running, conflicts, stacked on another pull request…). |
| `/merge 33` | The same, typed. |
| `/prs` | Lists the open pull requests, each with its button. |
| `/help` | The commands. |

- **Merging the release pull request publishes the release**, just like on GitHub.
- **Branch protection still applies.** GitHub refuses the merge until the required checks
  pass, and the bot says so. Tap again once they're green.
- **Stacked pull requests** (based on another feature branch) are refused. Merge the one
  below first; GitHub then moves the next one onto `develop`.
- **The release pull request is announced again** whenever its version changes
  (`release-pr.yaml` removes the `telegram-announced` label).
- **Drafts aren't announced** until they're marked ready.

## How it works

`.github/workflows/telegram-bot.yaml` runs `scripts/telegram/bot.mjs` every 5 minutes. Each
run listens to Telegram for about 4 minutes, so a tap is usually answered within seconds.
But GitHub often starts scheduled runs late, so sometimes it takes until the next run,
which can be several minutes.

- Announced pull requests get the label `telegram-announced`. Removing the label makes the
  bot announce that pull request again.
- GitHub pauses scheduled workflows in public repositories after 60 days without any
  activity. Re-enable it in Actions → Telegram bot.
- To answer at once, start it by hand: Actions → Telegram bot → Run workflow.

## One-time setup (repository secrets)

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The bot's token from @BotFather. |
| `TELEGRAM_CHAT_ID` | The chat the bot listens to and writes to (Nathan's private chat with the bot). |
| `TELEGRAM_MERGE_TOKEN` | A fine-grained personal access token (below). |

**The merge token:** GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token:

- **Repository access:** only `NathanDSanta/OpenPres`.
- **Permissions:**
  - Contents: read and write
  - Pull requests: read and write
  - Issues: read and write (for the label)
  - Workflows: read and write (needed to merge pull requests that change `.github/workflows`)
- **Expiration:** as long as you like. When it expires, the bot can't merge until you
  replace the secret.

The workflow's own `github.token` isn't used because merges made with it don't start other
workflows. The release pull request wouldn't update, and merging it wouldn't publish
anything.

Until all three secrets are set, the workflow does nothing and still passes.
