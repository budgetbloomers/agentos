#!/usr/bin/env node
/**
 * usage-topics.mjs — give every help ask and CM request that has no topic yet its ONE topic (Spec Kit 029, 2026-10-11).
 *
 * Nick: "we also want to monitor … what was the most asked question". The Worker labels each new ask after the answer
 * (worker/src/topics.mjs); this labels everything else — history (backfilled asks), and anything the AI could not
 * label at the time (an outage, the daily allowance). Re-runnable: it only ever touches rows whose topic is NULL.
 *
 *   node tools/usage-topics.mjs                 DRY RUN (the default): how many asks are unlabelled + a sample of the
 *                                               topics they would get (the sample does call the AI) — writes nothing
 *   node tools/usage-topics.mjs --apply         labels them all (PATCH usage_events … topic=is.null)
 *   --limit=N    only the first N unlabelled asks      --sample=N   how many the dry run labels to show (default 5)
 *
 * WHY THE REST API, NOT A WORKER ROUTE (plan.md): the AI binding exists only inside the Worker; a label route there would
 * be a new write surface to scope, rate-limit and mint sessions for, and would need a deploy first. Workers AI's REST
 * endpoint runs the SAME models; labelAsk() is the SAME function the Worker runs (an env.AI shim backed by REST), so the
 * prompt, the pre-labels and the check against the list cannot drift.
 *
 * Credentials (never printed): supabase.env (SUPABASE_URL, SUPABASE_SECRET_KEY); a Cloudflare token — CLOUDFLARE_API_TOKEN,
 * else the wrangler OAuth token (scope ai:write; run `npx wrangler whoami` in worker/ first if it has expired);
 * the account — CLOUDFLARE_ACCOUNT_ID, else the token's only account.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelAsk, askText } from '../worker/src/topics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CF = 'https://api.cloudflare.com/client/v4';
const PAGE = 1000;

/** the models /api/ask uses — read from the Worker's own source, so there is ONE place they are written */
export function workerModels() {
  const src = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
  const get = (name) => { const m = new RegExp('const ' + name + "\\s*=\\s*'([^']+)'").exec(src); return m ? m[1] : null; };
  return [get('DEFAULT_MODEL'), get('FALLBACK_MODEL')].filter(Boolean);
}

/** an env.AI over Workers AI's REST API. A refusal throws (labelAsk then treats it as the AI failing) — never with the token. */
export function restAi({ accountId, token }) {
  return {
    run: async (model, input) => {
      const r = await fetch(CF + '/accounts/' + accountId + '/ai/run/' + model, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) });
      const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
      if (!r.ok || !j || j.success === false) {
        const why = ((j && j.errors) || []).map((e) => (e.code != null ? e.code + ' ' : '') + (e.message || '')).join('; ') || t.slice(0, 120);
        throw new Error('Workers AI REST → ' + r.status + ': ' + why);
      }
      return j.result || {};
    },
  };
}

function rest(url, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const call = async (method, p, body, prefer) => {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + p, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) },
      body: body == null ? undefined : JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) { const e = new Error(method + ' ' + p.split('?')[0] + ' → ' + r.status + ': ' + t.slice(0, 200)); e.status = r.status; throw e; }
    return t ? JSON.parse(t) : null;
  };
  const all = async (p) => {
    const out = [];
    for (let off = 0; ; off += PAGE) { const rows = (await call('GET', p + '&limit=' + PAGE + '&offset=' + off)) || []; out.push(...rows); if (rows.length < PAGE) break; }
    return out;
  };
  return { call, all };
}

/**
 * runLabel({ supabaseUrl, serviceKey, ai, models, apply, limit, sample, log })
 *   → { unlabelled, labelled, failed, byTopic, proposals: [{id, event, topic, text}] }
 */
export async function runLabel(opts) {
  const o = opts || {}; const log = o.log || ((s) => console.log(s));
  const db = rest(o.supabaseUrl, o.serviceKey);
  const env = { AI: o.ai };
  const models = o.models && o.models.length ? o.models : workerModels();
  const topics = (await db.call('GET', 'ask_topics?select=topic,label,hint&active=is.true&order=topic.asc')) || [];
  if (!topics.length) throw new Error('ask_topics is empty — apply supabase/migration-062-help-asks-and-topics.sql first');
  let rows = await db.all('usage_events?select=id,event,category,detail&topic=is.null&event=in.(help_ask,cm_request)&order=id.asc');
  if (o.limit > 0) rows = rows.slice(0, o.limit);
  const out = { unlabelled: rows.length, labelled: 0, failed: 0, byTopic: {}, proposals: [] };
  const todo = o.apply ? rows : rows.slice(0, o.sample == null ? 5 : Math.max(0, o.sample));
  for (const r of todo) {
    const d = r.detail || {};
    const slug = await labelAsk(env, askText(r), r.category, topics, { models, restricted: r.event === 'cm_request' && !!d.restricted });
    if (!slug) { out.failed++; continue; }
    out.byTopic[slug] = (out.byTopic[slug] || 0) + 1;
    out.proposals.push({ id: r.id, event: r.event, topic: slug, text: d.restricted ? '(restricted)' : askText(r).slice(0, 80) });
    if (o.apply) {
      const got = await db.call('PATCH', 'usage_events?id=eq.' + encodeURIComponent(r.id) + '&topic=is.null', { topic: slug }, 'return=representation');
      if (Array.isArray(got) && got.length) out.labelled++;
    }
  }
  if (o.apply && out.failed) log('  ' + out.failed + ' could not be labelled now (the AI did not answer) — they stay unlabelled; run this again later');
  return out;
}

/* ---------- CLI ---------- */
function readEnvFile(f) {
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
/* the wrangler OAuth token (wrangler login) — %APPDATA%\xdg.config\.wrangler on Windows, ~/.config or ~/.wrangler elsewhere */
function wranglerToken() {
  const homes = [process.env.XDG_CONFIG_HOME, process.env.APPDATA && path.join(process.env.APPDATA, 'xdg.config'), path.join(os.homedir(), '.config'), os.homedir()].filter(Boolean);
  for (const h of homes) {
    const f = path.join(h, '.wrangler', 'config', 'default.toml');
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    const tok = (/^oauth_token\s*=\s*"([^"]+)"/m.exec(txt) || [])[1];
    const exp = (/^expiration_time\s*=\s*"([^"]+)"/m.exec(txt) || [])[1];
    if (!tok) continue;
    if (exp && Date.parse(exp) < Date.now() + 60000) throw new Error('the wrangler sign-in has expired — run `npx wrangler whoami` in worker/ to refresh it, then run this again');
    return tok;
  }
  return null;
}
async function accountOf(token) {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const r = await fetch(CF + '/accounts?per_page=5', { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => null);
  const accts = (j && j.result) || [];
  if (accts.length !== 1) throw new Error('set CLOUDFLARE_ACCOUNT_ID — the token sees ' + accts.length + ' accounts');
  return accts[0].id;
}
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const num = (name) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? parseInt(a.split('=')[1], 10) : null; };
  const sb = readEnvFile(path.join(ROOT, 'supabase.env'));
  if (!sb.SUPABASE_URL || !sb.SUPABASE_SECRET_KEY) { console.error('supabase.env with SUPABASE_URL and SUPABASE_SECRET_KEY is required'); process.exit(2); }
  const token = process.env.CLOUDFLARE_API_TOKEN || wranglerToken();
  if (!token) { console.error('no Cloudflare token — set CLOUDFLARE_API_TOKEN, or sign in with `npx wrangler login` (in worker/)'); process.exit(2); }
  const models = workerModels();
  const mrow = await rest(sb.SUPABASE_URL, sb.SUPABASE_SECRET_KEY).call('GET', 'rules?key=eq.ai_model&select=value').catch(() => null);
  const override = mrow && mrow[0] && mrow[0].value && mrow[0].value.value;   // the same 'ai_model' rule /api/ask honours
  const ai = restAi({ accountId: await accountOf(token), token });
  console.log((apply ? 'APPLY' : 'DRY RUN (nothing is written — add --apply to write)') + ' · ask topics · ' + new Date().toISOString());
  const r = await runLabel({ supabaseUrl: sb.SUPABASE_URL, serviceKey: sb.SUPABASE_SECRET_KEY, ai, apply,
    models: override ? [override, ...models.filter((m) => m !== override)] : models, limit: num('limit'), sample: num('sample') });
  console.log('\nunlabelled asks: ' + r.unlabelled + (apply ? ' · labelled ' + r.labelled + ' · could not label ' + r.failed : ' · sampled ' + r.proposals.length));
  for (const [t, n] of Object.entries(r.byTopic).sort((a, b) => b[1] - a[1])) console.log('    ' + String(n).padStart(5) + '  ' + t);
  if (!apply) for (const p of r.proposals) console.log('  #' + p.id + ' ' + p.event + ' → ' + p.topic + '  “' + p.text + '”');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => { console.error('usage-topics failed: ' + (e && e.message || e)); process.exit(1); });
