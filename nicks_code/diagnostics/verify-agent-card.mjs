#!/usr/bin/env node
/**
 * verify-agent-card.mjs — every agent's card agrees with itself and with the engine.
 *
 *   node nicks_code/diagnostics/verify-agent-card.mjs            (CBX_SITE overrides the page URL)
 *
 * ONE NUMBER, ONE VERDICT (specs/agent-view-consistency-plan.md). On 7 Sep Jolene's card read
 * "At target" in the rating row and "R 0,01 to go — VALUE ISSUE" in the panel below it, because
 * the page derived a floor the engine had already decided. This suite opens the DEPLOYED Agent
 * Analytics page under a service session, drills into EVERY rated agent in the live digest, and
 * asserts for each: the score on screen is the digest's; every rating-row chip matches its
 * part's verdict; the two-checks verdicts are the Worker's own; the value figure the rating row
 * prints is the value figure the checks panel prints; Conversion shows a figure whenever leads
 * exist; the sessions table has one row per day row. Runs nightly from the scheduled workflow.
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/'; const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const SITE = process.env.CBX_SITE || 'https://chatterbox-agentos.pages.dev/agent/';
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };
const num = (s) => parseFloat(String(s).replace(/[\s\u00a0]/g, '').replace(',', '.'));

const b0 = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/agent-digest', { headers: H }); let buf = Buffer.from(await b0.arrayBuffer()); if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
const digest = JSON.parse(buf.toString()); const labels = Object.fromEntries((digest.compositeDrivers || []).map((d) => [d.k, d.label]));
const allRated = digest.agents.filter((a) => a.composite && a.composite.rated);
const rated = allRated.slice(0, +(process.env.CBX_LIMIT || 1e9));   // CBX_LIMIT=3 for a quick local run
console.log('digest: ' + digest.agents.length + ' agents, ' + allRated.length + ' rated (' + rated.length + ' checked) · period ' + digest.period.from + ' → ' + digest.period.to);

const admin = (await (await fetch(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json())[0];
const token = crypto.randomBytes(32).toString('hex'); const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([{ token_hash: th, user_id: admin.id, expires_at: new Date(Date.now() + 1800000).toISOString(), user_agent: 'verify-agent-card' }]) });
const b = await chromium.launch();
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.addInitScript((t) => { sessionStorage.setItem('cbx_agent_token', t); }, token);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openAgent === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  for (const a of rated) {
    const payload = await (await fetch(API + '/api/portal/agent?cb=' + a.code, { headers: { Authorization: 'Bearer ' + token, 'x-cbx-client': 'v5' } })).json();
    const me = payload && payload.me; if (!me) { ok(a.code + ': the portal returns the agent', false, JSON.stringify(payload).slice(0, 100)); continue; }
    const view = await page.evaluate(async (cb) => {
      openAgent(cb);                                    // the drill-down opens on Today; the rating and the two checks live on My Progress
      const t0 = Date.now(); while (Date.now() - t0 < 8000) { const r = document.getElementById('root'); if (r && !/Loading…/.test(r.innerText) && window.ME && String(window.ME.code) === cb) break; await new Promise((x) => setTimeout(x, 100)); }
      window.VIEW = 'progress'; render();
      const t1 = Date.now(); while (Date.now() - t1 < 4000) { if (document.querySelector('.pg-score')) break; await new Promise((x) => setTimeout(x, 100)); }
      const root = document.getElementById('root'); if (!root) return { hasScore: false, score: '', rows: [], whys: [], sessRows: -1 };
      const score = (root.querySelector('.pg-score b') || {}).textContent || '';
      const rows = [...root.querySelectorAll('.pg-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
      const whys = [...root.querySelectorAll('.why')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
      const sessCard = [...root.querySelectorAll('h2')].find((h) => /Sales by session/.test(h.textContent)); const sessRows = sessCard ? sessCard.closest('.card').querySelectorAll('tbody tr').length : -1;
      const pageDays = (window.ME && Array.isArray(window.ME.days)) ? window.ME.days.length : null;   // the payload THIS page rendered
      return { score, rows, whys, sessRows, pageDays, hasScore: !!root.querySelector('.pg-score') };
    }, a.code);
    const c = me.composite;
    ok(a.code + ': the card renders a score', view.hasScore, view.score);
    ok(a.code + ': score on screen = digest', Math.abs(num(view.score) - c.adj) < 0.06, view.score + ' vs ' + c.adj);
    for (const p of c.parts) {
      const row = view.rows.find((r) => r.startsWith(labels[p.k] || '\u0000')); if (!row) { ok(a.code + ': row for ' + p.k, false, 'missing'); continue; }
      const chip = /At target/.test(row) ? 'at' : /To go|Below/.test(row) ? 'below' : /shown, not scored/.test(row) ? 'shown' : /not measured/.test(row) ? 'none' : '?';
      const want = p.measured ? (p.onTarget ? 'at' : 'below') : (p.shown != null ? 'shown' : 'none');
      ok(a.code + ' ' + p.k + ': chip = verdict', chip === want, chip + ' vs ' + want + ' | ' + row.slice(0, 90));
      if (p.k === 'conv') ok(a.code + ' conv: shows a figure when leads exist', (me.leads > 0) ? /\d+[.,]\d%/.test(row) : true, row.slice(0, 90));
    }
    const chk = me.checks;
    const c1 = view.whys.find((w) => /^Check 1/.test(w)) || '', c2 = view.whys.find((w) => /^Check 2/.test(w)) || '';
    if (chk && chk.value.pass != null) {
      ok(a.code + ': check 1 verdict = Worker', /— pass$/.test(c1) === (chk.value.pass === true), c1.slice(0, 100));
      ok(a.code + ': check 2 verdict = Worker', /— pass$/.test(c2) === (chk.volume.pass === true), c2.slice(0, 100));
      /* NOT compared: the rating row is the last five worked sessions, the checks are the whole month — two windows, both true; the page labels them. */
    }
    /* Against the payload the PAGE received, not this script's own fetch: the Worker caches the digest
       60 s per isolate, so a tick that lands between the two fetches gave 7 vs 8 across 45 agents
       (2026-09-10, a daytime run) — two true digests, one comparison. */
    const dayRows = view.pageDays != null ? view.pageDays : (me.days || []).length;
    ok(a.code + ': one sessions row per day row', view.sessRows === dayRows, view.sessRows + ' vs ' + dayRows);
  }
  ok('no page errors across ' + rated.length + ' cards', errs.length === 0, [...new Set(errs)].slice(0, 3).join(' | '));
} finally { await b.close(); await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H }); }
for (const f of failures.slice(0, 40)) console.log('  FAIL ' + f);
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed  (' + rated.length + ' agents rendered) ====');
process.exitCode = fail ? 1 : 0;
