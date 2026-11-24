// Telegram bot for OpenPres pull requests (docs/TELEGRAM.md).
//
//   node scripts/telegram/bot.mjs
//
// Run by .github/workflows/telegram-bot.yaml every 5 minutes. For about 4 minutes it:
//   - announces every open pull request that hasn't been announced yet (label
//     "telegram-announced"), with a "Merge" button. That includes the "Release vX.Y.Z" one;
//   - answers the buttons and commands from Nathan's chat (the only chat it listens to):
//       Merge button / "/merge 33"   merges #33 (merge commit), if GitHub allows it
//       "/merge all"                 merges every open one, oldest first, but not into main
//       "/prs"                       lists the open pull requests, each with its button
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GH_TOKEN (a token that may merge: see the doc),
// GITHUB_REPOSITORY, RUN_SECONDS (how long to listen, default 240).

const TG = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const GH = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY ?? "NathanDSanta/OpenPres";
const RUN_SECONDS = Number(process.env.RUN_SECONDS ?? 240);
const LABEL = "telegram-announced";

if (!TG || !CHAT || !GH) {
  console.log("Telegram bot not set up: add the secrets TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and TELEGRAM_MERGE_TOKEN (docs/TELEGRAM.md).");
  process.exit(0);
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!json.ok) console.log(`Telegram ${method}: ${json.description}`);
  return json;
}

async function gh(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${GH}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "openpres-telegram-bot" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

// The branches pull requests go into: main (releases), develop, the long-lived
// <component>/develop ones (the Stream Deck plugin, the Android app) and gh-pages (the
// website). Any other base is another pull request's branch: a stacked one.
const MERGE_INTO = /^(main|develop|gh-pages|[a-z0-9-]+\/develop)$/;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const button = (n) => ({ inline_keyboard: [[{ text: `✅ Merge #${n}`, callback_data: `merge:${n}` }]] });
const say = (text, extra = {}) => tg("sendMessage", { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

function describe(pr) {
  const release = pr.base.ref === "main" && pr.head.ref === "develop";
  const where = release ? "develop → main (merging it publishes the release)" : `${pr.head.ref} → ${pr.base.ref}`;
  return `<b>#${pr.number}</b> ${esc(pr.title)}\n${esc(where)}${pr.draft ? " · draft" : ""}\n${pr.html_url}`;
}

async function openPulls() {
  const { ok, json } = await gh("/pulls?state=open&per_page=100");
  return ok ? json : [];
}

// New pull requests → one message each, with the button. The label marks them as announced
// (release-pr.yaml takes it off when the release's version changes, so it's announced again).
async function announce() {
  for (const pr of await openPulls()) {
    if (pr.draft || pr.labels.some((l) => l.name === LABEL)) continue;
    const sent = await say(`🆕 New pull request\n${describe(pr)}`, { reply_markup: button(pr.number) });
    if (!sent.ok) continue;
    let r = await gh(`/issues/${pr.number}/labels`, { method: "POST", body: { labels: [LABEL] } });
    if (!r.ok) console.log(`Couldn't label #${pr.number}: ${r.json.message}`);
  }
}

async function merge(n) {
  const { ok, json: pr } = await gh(`/pulls/${n}`);
  if (!ok) return `❌ #${n}: no such pull request.`;
  if (pr.merged) return `ℹ️ #${n} was already merged.`;
  if (pr.state !== "open") return `ℹ️ #${n} is closed.`;
  if (pr.draft) return `❌ #${n} is a draft. Mark it ready for review first.`;
  if (!MERGE_INTO.test(pr.base.ref))
    return `❌ #${n} is stacked on <code>${esc(pr.base.ref)}</code>. Merge that pull request first; GitHub then moves #${n} onto the branch it went into.`;
  const r = await gh(`/pulls/${n}/merge`, { method: "PUT", body: { merge_method: "merge", sha: pr.head.sha } });
  if (r.ok) return `✅ Merged #${n} into ${esc(pr.base.ref)}: ${esc(pr.title)}${pr.base.ref === "main" ? "\nThe release is being published now." : ""}`;
  let why = r.json.message ?? `HTTP ${r.status}`;
  if (r.status === 405 && pr.mergeable === false) why = "it has conflicts with its base branch";
  else if (r.status === 409) why = "it changed while merging; tap again";
  else if (/status check|expected/i.test(why)) why = `the required checks haven't passed yet (${why})`;
  return `❌ Couldn't merge #${n}: ${esc(why)}.\n${pr.html_url}`;
}

// "/merge all": every open pull request, oldest first, except drafts and the ones into main
// (merging those publishes a release, so they get their own tap). Only a fresh message
// counts: one the bot gets to later must not merge what was opened in the meantime.
const MERGE_ALL_FRESH_SECONDS = 10 * 60;

async function mergeAll(sentAt) {
  const age = Date.now() / 1000 - sentAt;
  if (age > MERGE_ALL_FRESH_SECONDS)
    return `ℹ️ That /merge all is from ${Math.round(age / 60)} minutes ago, so I left it. Send it again to merge what's open now.`;
  const open = (await openPulls()).filter((pr) => !pr.draft).sort((a, b) => a.number - b.number);
  const lines = [];
  for (const pr of open.filter((pr) => pr.base.ref !== "main")) lines.push(await merge(pr.number));
  const releases = open.filter((pr) => pr.base.ref === "main");
  if (releases.length) lines.push(`Left for you to tap: ${releases.map((pr) => `#${pr.number} ${esc(pr.title)}`).join(", ")} (merging into main publishes a release).`);
  if (!lines.length) return "ℹ️ No open pull requests.";
  let text = lines.join("\n");
  if (text.length > 4000) text = `${text.slice(0, 3990)}…`;
  return text;
}

async function listPulls() {
  const prs = await openPulls();
  if (!prs.length) return say("No open pull requests.");
  for (const pr of prs) await say(describe(pr), { reply_markup: button(pr.number) });
}

const HELP = "Commands:\n/prs: the open pull requests, each with a Merge button\n/merge 33: merge #33\n/merge all: merge every open pull request, oldest first (not the release one)";

async function handle(update) {
  const q = update.callback_query;
  const msg = update.message;
  const chat = q?.message?.chat?.id ?? msg?.chat?.id;
  if (String(chat) !== String(CHAT)) return; // only Nathan's chat
  if (q) {
    const m = /^merge:(\d+)$/.exec(q.data ?? "");
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: m ? `Merging #${m[1]}…` : "" });
    if (!m) return;
    const result = await merge(Number(m[1]));
    if (result.startsWith("✅") || result.startsWith("ℹ️")) await tg("editMessageReplyMarkup", { chat_id: CHAT, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    await say(result, { reply_to_message_id: q.message.message_id });
    return;
  }
  const text = (msg?.text ?? "").trim();
  let m;
  if (/^\/?merge(?:@\w+)?\s+all$/i.test(text)) await say(await mergeAll(msg.date), { reply_to_message_id: msg.message_id });
  else if ((m = /^\/merge(?:@\w+)?\s+#?(\d+)$/i.exec(text))) await say(await merge(Number(m[1])), { reply_to_message_id: msg.message_id });
  else if (/^\/prs(?:@\w+)?$/i.test(text)) await listPulls();
  else if (/^\/(start|help)/i.test(text)) await say(HELP);
}

// Make the label once (it's fine if it already exists).
await gh("/labels", { method: "POST", body: { name: LABEL, color: "2aabee", description: "Sent to Telegram by the bot" } });

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
    try { await handle(update); } catch (e) { console.log(`Update ${update.update_id}: ${e.message}`); }
  }
  if (!res.ok) await new Promise((r) => setTimeout(r, 5000));
}
// Confirm the last updates, so the next run doesn't see them again.
if (offset) await tg("getUpdates", { offset, timeout: 0, limit: 1 });
