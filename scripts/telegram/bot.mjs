// Telegram bot for the OpenPres repositories (docs/TELEGRAM.md): the server (OpenPres), the
// Manager (M), the viewer app (V), the Stream Deck plugin (SD) and the Translation app (T).
//
//   node scripts/telegram/bot.mjs
//
// Run by .github/workflows/telegram-bot.yaml on GitHub's schedule. For about 4 minutes it:
//   - announces every open pull request of every repository that hasn't been announced yet
//     (label "telegram-announced"), with a "Merge" button;
//   - answers the buttons and commands from Nathan's chat (the only chat it listens to):
//       Merge button / "/merge 33"   merges #33 of the server ("/merge M 4": #4 of the Manager)
//       "/merge all"                 merges every open one into develop, oldest first
//       "/prs"                       lists the open pull requests, each with its button
//       "/release" / "/release M"    a stable release: develop goes into main (Y+1)
//       "/hotfix 12" / "/hotfix M 12" merges hotfix pull request #12 into main (Z+1); a beta
//                                    with the fix follows by itself (docs/RELEASING.md)
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GH_TOKEN (a token that may merge in all five
// repositories: see the doc), GITHUB_REPOSITORY (owner/OpenPres), RUN_SECONDS (how long to
// listen, default 240).

const TG = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const GH = process.env.GH_TOKEN;
const OWNER = (process.env.GITHUB_REPOSITORY ?? "NathanDSanta/OpenPres").split("/")[0];
const RUN_SECONDS = Number(process.env.RUN_SECONDS ?? 240);
const LABEL = "telegram-announced";

// Short name → repository and what it's called in messages.
const REPOS = [
  { key: "", repo: "OpenPres", product: "OpenPres Server" },
  { key: "M", repo: "OpenPres-M", product: "OpenPres Manager" },
  { key: "V", repo: "OpenPres-V", product: "OpenPres Viewer" },
  { key: "SD", repo: "OpenPres-SD", product: "the Stream Deck plugin" },
  { key: "T", repo: "OpenPres-T", product: "OpenPres Translation" },
];

if (!TG || !CHAT || !GH) {
  console.log("Telegram bot not set up: add the secrets TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and TELEGRAM_MERGE_TOKEN (docs/TELEGRAM.md).");
  process.exit(0);
}

/** "M", "m", "OpenPres-M", "server", "" → the repository's entry (null: unknown). */
function repoOf(word = "") {
  const w = word.trim().toLowerCase().replace(/^openpres-?/, "");
  if (w === "" || w === "server" || w === "s") return REPOS[0];
  return REPOS.find((r) => r.key.toLowerCase() === w) ?? null;
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!json.ok) console.log(`Telegram ${method}: ${json.description}`);
  return json;
}

async function gh(r, path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${r.repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${GH}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "openpres-telegram-bot" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

// The branches pull requests go into: develop, main (stable releases and hotfixes) and gh-pages
// (the website). Any other base is another pull request's branch: a stacked one.
const MERGE_INTO = /^(main|develop|gh-pages|[a-z0-9-]+\/develop)$/;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
/** "#33" for the server, "M#4" for the others. */
const label = (r, n) => `${r.key}#${n}`;
const button = (r, n) => ({ inline_keyboard: [[{ text: `✅ Merge ${label(r, n)}`, callback_data: r.key ? `merge:${r.repo}:${n}` : `merge:${n}` }]] });
const say = (text, extra = {}) => tg("sendMessage", { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

function describe(r, pr) {
  const where = pr.base.ref === "main" && pr.head.ref === "develop" ? "develop → main (merging it publishes a stable release)" : `${pr.head.ref} → ${pr.base.ref}`;
  return `<b>${label(r, pr.number)}</b> ${esc(pr.title)}\n${esc(where)}${r.key ? ` (${r.repo})` : ""}${pr.draft ? " · draft" : ""}\n${pr.html_url}`;
}

async function openPulls(r) {
  const { ok, json } = await gh(r, "/pulls?state=open&per_page=100");
  return ok && Array.isArray(json) ? json : [];
}

// New pull requests → one message each, with the button. The label marks them as announced.
async function announce() {
  for (const r of REPOS) {
    for (const pr of await openPulls(r)) {
      if (pr.draft || pr.labels.some((l) => l.name === LABEL)) continue;
      const sent = await say(`🆕 New pull request\n${describe(r, pr)}`, { reply_markup: button(r, pr.number) });
      if (!sent.ok) continue;
      const res = await gh(r, `/issues/${pr.number}/labels`, { method: "POST", body: { labels: [LABEL] } });
      if (!res.ok) console.log(`Couldn't label ${r.repo}#${pr.number}: ${res.json.message}`);
    }
  }
}

async function merge(r, n, { title } = {}) {
  const { ok, json: pr } = await gh(r, `/pulls/${n}`);
  const name = label(r, n);
  if (!ok) return `❌ ${name}: no such pull request${r.key ? ` in ${r.repo}` : ""}.`;
  if (pr.merged) return `ℹ️ ${name} was already merged.`;
  if (pr.state !== "open") return `ℹ️ ${name} is closed.`;
  if (pr.draft) return `❌ ${name} is a draft. Mark it ready for review first.`;
  if (!MERGE_INTO.test(pr.base.ref))
    return `❌ ${name} is stacked on <code>${esc(pr.base.ref)}</code>. Merge that pull request first; GitHub then moves ${name} onto the branch it went into.`;
  const res = await gh(r, `/pulls/${n}/merge`, { method: "PUT", body: { merge_method: "merge", sha: pr.head.sha, ...(title ? { commit_title: title } : {}) } });
  if (res.ok) return `✅ Merged ${name} into ${esc(pr.base.ref)}: ${esc(pr.title)}${pr.base.ref === "main" ? `\n🚀 ${esc(r.product)}'s release is being built now.` : ""}`;
  let why = res.json.message ?? `HTTP ${res.status}`;
  if (res.status === 405 && pr.mergeable === false) why = "it has conflicts with its base branch";
  else if (res.status === 409) why = "it changed while merging; try again";
  else if (/status check|expected/i.test(why)) why = `the required checks haven't passed yet (${why})`;
  return `❌ Couldn't merge ${name}: ${esc(why)}.\n${pr.html_url}`;
}

// "/merge all": every open pull request into develop (or gh-pages), oldest first. Not the ones
// into main: those are releases and hotfixes (/release, /hotfix). Only a fresh message counts:
// one the bot gets to later must not merge what was opened in the meantime.
const FRESH_SECONDS = 10 * 60;

async function mergeAll(sentAt) {
  const age = Date.now() / 1000 - sentAt;
  if (age > FRESH_SECONDS) return `ℹ️ That /merge all is from ${Math.round(age / 60)} minutes ago, so I left it. Send it again to merge what's open now.`;
  const lines = [];
  const left = [];
  for (const r of REPOS) {
    const open = (await openPulls(r)).filter((pr) => !pr.draft).sort((a, b) => a.number - b.number);
    for (const pr of open) {
      if (pr.base.ref === "main") left.push(label(r, pr.number));
      else lines.push(await merge(r, pr.number));
    }
  }
  if (left.length) lines.push(`Left alone (into main: use /release or /hotfix): ${left.join(", ")}.`);
  if (!lines.length) return "ℹ️ No open pull requests.";
  const text = lines.join("\n");
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

async function listPulls() {
  let any = false;
  for (const r of REPOS) {
    for (const pr of await openPulls(r)) {
      any = true;
      await say(describe(r, pr), { reply_markup: button(r, pr.number) });
    }
  }
  if (!any) await say("No open pull requests.");
}

/** The newest stable version (vX.Y.Z tags), or the stable the newest beta builds on. */
async function newestStable(r) {
  const { json } = await gh(r, "/tags?per_page=100");
  const versions = (Array.isArray(json) ? json : [])
    .map((t) => /^v(\d+)\.(\d+)\.(\d+)(?:\.\d+-beta)?$/.exec(t.name))
    .filter(Boolean)
    .map((m) => m.slice(1, 4).map(Number));
  versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  return versions[0] ?? null;
}

// "/release": develop goes into main through a pull request opened and merged right away;
// release.yaml then builds and publishes X.Y+1.0 from main.
async function release(r) {
  const cmp = await gh(r, "/compare/main...develop");
  if (!cmp.ok) return `❌ ${esc(r.product)}: couldn't compare develop with main (${esc(cmp.json.message ?? cmp.status)}).`;
  if (!cmp.json.ahead_by) return `ℹ️ ${esc(r.product)}: develop has nothing that main doesn't, so there's nothing to release.`;
  // develop's checks have to be green.
  const sha = cmp.json.commits?.at(-1)?.sha;
  const runs = sha ? await gh(r, `/actions/runs?head_sha=${sha}&per_page=50`) : { json: {} };
  const checks = (runs.json.workflow_runs ?? []).filter((w) => w.name === "Checks");
  if (checks.some((w) => w.status !== "completed")) return `⏳ ${esc(r.product)}: develop's checks are still running. Send /release${r.key ? ` ${r.key}` : ""} again when they're done.`;
  const failed = checks.filter((w) => w.conclusion !== "success");
  if (failed.length) return `❌ ${esc(r.product)}: develop's checks failed, so it isn't released.\n${failed[0].html_url}`;
  const stable = await newestStable(r);
  const next = stable ? `${stable[0]}.${stable[1] + 1}.0` : null;
  const title = next ? `Release v${next}` : "Release";
  let pr = (await gh(r, "/pulls?state=open&base=main&head=" + encodeURIComponent(`${OWNER}:develop`))).json?.[0];
  if (!pr) {
    const opened = await gh(r, "/pulls", { method: "POST", body: { title, head: "develop", base: "main", body: "Asked for on Telegram with /release. Merging it publishes the stable release (docs/RELEASING.md)." } });
    if (!opened.ok) return `❌ ${esc(r.product)}: couldn't open the release pull request (${esc(opened.json.message ?? opened.status)}).`;
    pr = opened.json;
  }
  const merged = await merge(r, pr.number, { title });
  if (!merged.startsWith("✅")) return merged;
  return `🚀 ${esc(r.product)}${next ? ` ${next}` : ""}: develop went into main (${label(r, pr.number)}). The release is being built and is out in about 15 minutes.\nhttps://github.com/${OWNER}/${r.repo}/actions/workflows/release.yaml`;
}

// "/hotfix N": hotfix pull request N goes into main; release.yaml publishes X.Y.Z+1, brings it
// into develop and publishes a beta with it.
async function hotfix(r, n) {
  const { ok, json: pr } = await gh(r, `/pulls/${n}`);
  if (!ok) return `❌ ${label(r, n)}: no such pull request${r.key ? ` in ${r.repo}` : ""}.`;
  if (pr.state === "open" && (pr.base.ref !== "main" || !pr.head.ref.startsWith("hotfix/")))
    return `❌ ${label(r, n)} isn't a hotfix: a hotfix is a <code>hotfix/…</code> branch into main (this one is ${esc(pr.head.ref)} → ${esc(pr.base.ref)}).`;
  const merged = await merge(r, n);
  if (!merged.startsWith("✅")) return merged;
  return `🩹 ${esc(r.product)}: hotfix ${label(r, n)} is in main. The fixed release is being built, then the fix goes into develop and a beta with it follows.`;
}

const HELP = [
  "Commands (add M, V, SD or T for the Manager, the viewer app, the Stream Deck plugin or the Translation app; nothing = the server):",
  "/prs: the open pull requests, each with a Merge button",
  "/merge 33, /merge M 4: merge a pull request",
  "/merge all: merge every open pull request into develop, oldest first",
  "/release, /release M: a stable release (develop into main, version X.Y+1.0)",
  "/hotfix 12, /hotfix M 12: merge hotfix pull request #12 into main (X.Y.Z+1); a beta with the fix follows",
].join("\n");

async function handle(update) {
  const q = update.callback_query;
  const msg = update.message;
  const chat = q?.message?.chat?.id ?? msg?.chat?.id;
  if (String(chat) !== String(CHAT)) return; // only Nathan's chat
  if (q) {
    const m = /^merge:(?:([\w-]+):)?(\d+)$/.exec(q.data ?? "");
    const r = m ? repoOf(m[1] ?? "") : null;
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: r ? `Merging ${label(r, m[2])}…` : "" });
    if (!r) return;
    const result = await merge(r, Number(m[2]));
    if (result.startsWith("✅") || result.startsWith("ℹ️")) await tg("editMessageReplyMarkup", { chat_id: CHAT, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    await say(result, { reply_to_message_id: q.message.message_id });
    return;
  }
  const reply = (text) => say(text, { reply_to_message_id: msg.message_id });
  const text = (msg?.text ?? "").trim().replace(/^\/(\w+)@\w+/, "/$1");
  const unknown = (word) => reply(`❌ I don't know "${esc(word)}": use M, V, SD or T (or nothing for the server).`);
  let m;
  if (/^\/?merge\s+all$/i.test(text)) await reply(await mergeAll(msg.date));
  else if ((m = /^\/merge(?:\s+([\w-]+))?\s+#?(\d+)$/i.exec(text))) {
    const r = repoOf(m[1] ?? "");
    await (r ? reply(await merge(r, Number(m[2]))) : unknown(m[1]));
  } else if ((m = /^\/release(?:\s+([\w-]+))?$/i.exec(text))) {
    const r = repoOf(m[1] ?? "");
    await (r ? reply(await release(r)) : unknown(m[1]));
  } else if ((m = /^\/hotfix(?:\s+([\w-]+))?\s+#?(\d+)$/i.exec(text))) {
    const r = repoOf(m[1] ?? "");
    await (r ? reply(await hotfix(r, Number(m[2]))) : unknown(m[1]));
  } else if (/^\/hotfix/i.test(text)) await reply("Which pull request? /hotfix 12, or /hotfix M 12 for the Manager's #12.");
  else if (/^\/prs$/i.test(text)) await listPulls();
  else if (/^\/(start|help)/i.test(text)) await say(HELP);
}

// Make the label once in each repository (it's fine if it already exists).
for (const r of REPOS) await gh(r, "/labels", { method: "POST", body: { name: LABEL, color: "2aabee", description: "Sent to Telegram by the bot" } });

const end = Date.now() + RUN_SECONDS * 1000;
let offset;
let nextAnnounce = 0;
while (Date.now() < end) {
  if (Date.now() >= nextAnnounce) {
    await announce();
    nextAnnounce = Date.now() + 60_000;
  }
  const wait = Math.max(1, Math.min(50, Math.floor((end - Date.now()) / 1000) - 5));
  const res = await tg("getUpdates", { offset, timeout: wait, allowed_updates: ["message", "callback_query"] });
  for (const update of res.result ?? []) {
    offset = update.update_id + 1; // Telegram forgets updates below the next offset
    try {
      await handle(update);
    } catch (e) {
      console.log(`Update ${update.update_id}: ${e.message}`);
    }
  }
  if (!res.ok) await new Promise((r) => setTimeout(r, 5000));
}
// Confirm the last updates, so the next run doesn't see them again.
if (offset) await tg("getUpdates", { offset, timeout: 0, limit: 1 });
