/**
 * WHAT IS ASKED MOST — one topic per ask, picked by the AI AgentOS already uses (Spec Kit 029, 2026-10-11).
 *
 * Nick: "we also want to monitor, how many agents ask their team leader for help, how many team leaders asked their cm
 * for help, what was the most asked question". Decided with him: rewordings of the same question are grouped into
 * topics by Workers AI; the topics are a curated list he owns (ask_topics, migration-062) — rename or merge there.
 *
 * THE AI CHOOSES A LABEL, NEVER A FIGURE (constitution I): it is shown the active list and must answer with one name on
 * it; any other answer is "other". Every count is SQL over the labels.
 *
 * NEVER IN THE WAY (028's rule, FR-003): labelling runs in the SAME ctx.waitUntil as the ask's usage row, after the row is
 * written and after the response has gone. AI missing, failing, timing out or out of its daily allowance → the topic
 * stays NULL ("Not labelled yet") and tools/usage-topics.mjs labels it later. Subrequests (FREE plan, 50): the topic list
 * read (once per isolate per 10 minutes) + one PATCH. env.AI is a binding to a Cloudflare service, not a fetch.
 *
 * The same labelAsk() runs in tools/usage-topics.mjs with an env.AI backed by Workers AI's REST API, so the prompt and
 * the checking can never drift between the live label and the catch-up run.
 */
import { CM_BLOCKAGES_DEFAULTS } from './campaign.mjs';

export const TOPIC_CACHE_MS = 600000;          // the active list, per isolate
export const LABEL_TIMEOUT_MS = 8000;          // per model attempt (waitUntil allows 30 s)
export const ASK_EVENTS = ['help_ask', 'cm_request'];
const MAX_QUESTION = 600;
const DAILY_ALLOWANCE = /4006|neurons|daily free allocation/i;
/* an obvious test: "test", "testing", "Hi \n\nTest", "TEST from the system check", "AUTOMATED TEST … please ignore" */
const TEST_RE = /^\s*(?:(?:hi|hello|hey)\b[\s,.!]*)?(?:automated\s+)?test(?:ing)?\b/i;
const IGNORE_RE = /\bplease ignore\b/i;

const letters = (s) => (String(s || '').match(/\p{L}/gu) || []).length;
const has = (topics, slug) => (topics || []).some((t) => t.topic === slug);

/** the ask's own words: a help ask's note, a CM request's text */
export function askText(row) {
  const d = (row && row.detail) || {};
  return String(d.note != null ? d.note : d.text != null ? d.text : '').trim();
}

/** a CM blockage key → its label (the live cm:blockages table when loaded, else the rule book's defaults) */
function categoryLabel(category) {
  const c = String(category || '');
  const live = globalThis.__cmCtx && Array.isArray(globalThis.__cmCtx.blockages) ? globalThis.__cmCtx.blockages : null;
  const b = (live || CM_BLOCKAGES_DEFAULTS).find((x) => x && x.key === c);
  return b ? b.label : c;
}

/** the labels that need no AI: restricted → personal · empty / < 3 letters → other · an obvious test → test. null = ask the AI */
export function preLabel({ text, restricted } = {}, topics) {
  const pick = (slug) => (has(topics, slug) ? slug : (has(topics, 'other') ? 'other' : slug));
  if (restricted) return pick('personal');
  const t = String(text || '').trim();
  if (letters(t) < 3) return pick('other');
  if (TEST_RE.test(t) || IGNORE_RE.test(t)) return pick('test');
  return null;
}

/** the strict prompt: one topic from the active list, or Other */
export function buildPrompt(text, category, topics) {
  const list = (topics || []).map((t) => '- ' + t.label + (t.hint ? ': ' + t.hint : '')).join('\n');
  const system = 'You sort the questions call-centre agents ask their team leader, and team leaders ask their campaign manager, '
    + 'into ONE topic from a fixed list. Reply with exactly one topic name copied from the list and nothing else — no '
    + 'explanation, no punctuation. If no topic fits, reply Other.\n\nTOPICS:\n' + list;
  const user = 'Category chosen by the person asking: ' + (categoryLabel(category) || 'none') + '\nQuestion: '
    + String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION) + '\n\nTopic:';
  return { system, user };
}

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/^\s*topic\s*:\s*/i, '').replace(/["'`*]/g, '').replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ').trim();
/** the AI's answer → a slug on the list, else other (never a topic that is not on the list) */
export function validateTopic(answer, topics) {
  const a = norm(String(answer || '').split(/\r?\n/)[0]);
  const hit = a && (topics || []).find((t) => norm(t.label) === a || t.topic === a);
  if (hit) return hit.topic;
  return 'other';
}

const timeout = (p, ms) => new Promise((resolve, reject) => {
  const tm = setTimeout(() => reject(new Error('Workers AI did not answer within ' + ms + ' ms')), ms);
  Promise.resolve(p).then((v) => { clearTimeout(tm); resolve(v); }, (e) => { clearTimeout(tm); reject(e); });
});

/**
 * labelAsk(env, text, category, topics, {models, timeoutMs, restricted}) → a slug, or null when the AI could not answer.
 * Same models as /api/ask (index.mjs DEFAULT_MODEL → FALLBACK_MODEL), the fallback only when the first one fails — and
 * not when the failure is the daily allowance (both share it).
 */
export async function labelAsk(env, text, category, topics, opts = {}) {
  try {
    const pre = preLabel({ text, restricted: opts.restricted }, topics);
    if (pre) return pre;
    if (!env || !env.AI || typeof env.AI.run !== 'function' || !(topics || []).length) return null;
    const { system, user } = buildPrompt(text, category, topics);
    const models = (opts.models && opts.models.length ? opts.models : []).filter(Boolean);
    const ms = Number(opts.timeoutMs) || LABEL_TIMEOUT_MS;
    for (const model of models) {
      try {
        const ai = await timeout(env.AI.run(model, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 12, temperature: 0 }), ms);
        return validateTopic(ai && (ai.response != null ? ai.response : ai.result), topics);
      } catch (e) {
        if (DAILY_ALLOWANCE.test(String(e && (e.message || e)))) return null;
      }
    }
    return null;
  } catch (e) { return null; }
}

/** the active topics, one read per isolate per 10 minutes. A failed read → null (no label), never a stale guess. */
export async function activeTopics(DB, now = Date.now()) {
  const c = globalThis.__askTopics;
  if (c && now - c.t < TOPIC_CACHE_MS && c.list) return c.list;
  try {
    const rows = await DB.select('ask_topics?select=topic,label,hint&active=is.true&order=topic.asc');
    if (!Array.isArray(rows) || !rows.length) return null;
    const list = rows.map((r) => ({ topic: r.topic, label: r.label, hint: r.hint || null }));
    globalThis.__askTopics = { t: now, list };
    return list;
  } catch (e) { return null; }
}
export function resetTopicCache() { globalThis.__askTopics = null; }

/**
 * askLabeller(env, DB, {models}) → ({ id, row }) => Promise<void>. Called by usage.mjs inside the ask's waitUntil, after
 * the usage row was written: label it, then PATCH that row's topic — by id, else by its source_key (a row the insert
 * found already there) — only while the topic is still NULL. Never rejects. No AI binding → nothing at all.
 */
export function askLabeller(env, DB, opts = {}) {
  return async ({ id, row } = {}) => {
    try {
      if (!env || !env.AI || !row || !ASK_EVENTS.includes(row.event)) return;
      const filter = id != null ? 'id=eq.' + encodeURIComponent(id)
        : row.source_key ? 'source_key=eq.' + encodeURIComponent(row.source_key) : null;
      if (!filter) return;
      const topics = await activeTopics(DB);
      if (!topics) return;
      const d = row.detail || {};
      const slug = await labelAsk(env, askText(row), row.category, topics, { ...opts, restricted: row.event === 'cm_request' && !!d.restricted });
      if (!slug) return;
      await DB.update('usage_events?' + filter + '&topic=is.null', { topic: slug });
    } catch (e) { /* telemetry: never in the way */ }
  };
}
