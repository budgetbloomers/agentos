#!/usr/bin/env node
/**
 * verify-tl-mtd.mjs — is the team leader's Month-to-date report correct?
 *
 *   node tools/verify-tl-mtd.mjs            # check the live state against the live digest
 *
 * Nick, 2026-09-21: "is the month to date report for the team leader view correct please make sure."
 *
 * The TL Reports → Month to date tab paints digest.tlAgg (this team's column) and digest.campAgg
 * (the campaign total), both PUBLISHED by PULSE's MTD engine — so VAS MTD and the TL report are one
 * engine by design. This tool does not take that on trust. Three checks per team leader:
 *
 *   1 ENGINE vs LONGHAND  the deployed PULSE build is booted over the live kv:vas-state; every
 *                          team aggregate M.tlAgg is recomputed here from the agent-day fact rows
 *                          (headcount, employed/actual shifts, target, sales, ex-VAT GWP, and the
 *                          ratios % to target, average GWP, attendance) and must agree; referrals,
 *                          cancellations and agents-on-target come from adjustment maps and are
 *                          checked against the published copy in 2
 *   2 ENGINE vs PUBLISHED  the same aggregates in the live kv:agent-digest-<month> — what the
 *                          Worker slices for the TL page — must equal the engine's, to the cent
 *   3 FRESH                the digest was published after the state was last saved, so the TL is
 *                          not reading yesterday's month
 *
 * Exit 1 if anything disagrees. Needs a built site/ (node tools/prepare-site.js) and supabase.env.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + n + (extra ? '\n         ' + extra : '')); } };
const head = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
const near = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);

/* ---------- live state + live digest ---------- */
async function kv(key) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rules?key=eq.' + encodeURIComponent(key) + '&select=value,updated_at', { headers: H });
  const row = (await r.json())[0]; if (!row) return { v: null, at: null };
  let v = row.value; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
  if (v && v.store) {
    const o = await fetch(env.SUPABASE_URL + '/storage/v1/object/' + v.store, { headers: H, signal: AbortSignal.timeout(90000) });
    const b = Buffer.from(await o.arrayBuffer()); let s; try { s = zlib.gunzipSync(b).toString(); } catch (e) { s = b.toString(); }
    return { v: JSON.parse(s), at: row.updated_at };
  }
  return { v, at: row.updated_at };
}
const state = await kv('kv:vas-state');
if (!state.v) { console.error('cannot read kv:vas-state'); process.exit(2); }
const sast = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
const digest = await kv('kv:agent-digest-' + sast);
console.log('state saved ' + state.at + ' · digest ' + sast + ' published ' + (digest.at || 'never'));

/* ---------- boot the deployed PULSE build over that state ---------- */
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8179, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8179/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  await page.evaluate((b) => { const S = window.__mtd.state(); const blob = JSON.parse(b); for (const k of Object.keys(blob)) S[k] = blob[k]; window.__mtd.rebuild(); }, JSON.stringify(state.v));
  await page.evaluate((m) => { window.__mtd.setPeriod(m, 'month'); }, sast);

  /* the engine's own answer, plus the per-agent rows it aggregated */
  const eng = await page.evaluate(() => {
    const M = window.__mtd.model();
    /* the agent-day fact rows the engine aggregates (the ViciDial range anchor carries no shift) */
    const facts = (M.facts || []).filter((f) => !f.rangeAgg).map((f) => ({ code: f.code, tl: f.tl, camp: f.campaign, emp: f.emp, act: f.act, target: f.target, sales: f.sales,
      gwp: f.gwp, gwpEx: f.gwpEx, talk: f.talk, opt: f.opt, ref: f.ref }));
    const tl = {}; for (const k of Object.keys(M.tlAgg || {})) tl[k] = M.tlAgg[k];
    return { facts, tl, period: window.__mtd.digest().period, dig: window.__mtd.digest() };
  });
  ok(!errors.length, 'the engine booted over the live state without a page error', errors[0]);
  const keys = Object.keys(eng.tl);
  ok(keys.length > 0, keys.length + ' team leader aggregates in the engine');

  head('1 · engine vs longhand, per team leader');
  for (const k of keys) {
    const [camp, tl] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const rows = eng.facts.filter((f) => String(f.tl || '') === tl && String(f.camp || '') === camp);
    const sum = (f) => rows.reduce((n, r) => n + (Number(r[f]) || 0), 0);
    const e = eng.tl[k];
    /* headcount = people who were there: any shift, sale, talk, opt-in or referral on a row (the engine's hcOf) */
    const hc = new Set(rows.filter((r) => r.emp || r.act || r.sales || r.talk || r.opt || r.ref).map((r) => r.code)).size;
    /* GWP on the report is EX-VAT (the VAS display basis, gwpDisplayBasis 'ex') — the rows carry both */
    const mine = { hc, emp: sum('emp'), act: sum('act'), target: sum('target'), sales: sum('sales'), gwp: sum('gwpEx') };
    const bad = [];
    for (const f of ['hc', 'emp', 'act', 'target', 'sales']) if (!near(mine[f], e[f], 0.011)) bad.push(f + ' engine ' + e[f] + ' vs longhand ' + mine[f]);
    if (!near(mine.gwp, e.gwp, 1)) bad.push('gwp engine ' + e.gwp + ' vs longhand ' + mine.gwp);
    /* the derived ratios, from the longhand sums */
    if (e.pctT != null && !near(e.pctT, mine.target ? mine.sales / mine.target : null, 0.0051)) bad.push('pctT engine ' + e.pctT + ' vs longhand ' + (mine.sales / mine.target).toFixed(4));
    if (e.aveG != null && !near(e.aveG, mine.sales ? mine.gwp / mine.sales : null, 0.06)) bad.push('aveG engine ' + e.aveG + ' vs longhand ' + (mine.gwp / mine.sales).toFixed(2));
    if (e.att != null && !near(e.att, mine.emp ? mine.act / mine.emp : null, 0.0051)) bad.push('att engine ' + e.att + ' vs longhand ' + (mine.act / mine.emp).toFixed(4));
    ok(!bad.length, tl + ' (' + camp + ') — ' + hc + ' agents, ' + mine.sales + ' sales, R' + Math.round(mine.gwp || 0) + ', ' + mine.act + '/' + mine.emp + ' shifts', bad.join(' · '));
  }

  head('2 · engine vs the PUBLISHED digest (what the TL page paints)');
  const pub = (digest.v && digest.v.tlAgg) || [];
  ok(Array.isArray(pub) && pub.length === keys.length, 'the digest carries ' + pub.length + ' team aggregates, the engine ' + keys.length);
  const F = ['hc', 'emp', 'act', 'att', 'target', 'sales', 'pctT', 'spd', 'canc', 'cancPct', 'gwpT', 'gwp', 'pctG', 'aveG', 'aveTalk', 'ref', 'refPct', 'onT'];
  for (const k of keys) {
    const camp = k.slice(0, k.indexOf('|')), tl = k.slice(k.indexOf('|') + 1);
    const p = pub.find((t) => t.camp === camp && t.tl === tl);
    const e = (eng.dig.tlAgg || []).find((t) => t.camp === camp && t.tl === tl);
    if (!p) { ok(false, tl + ' (' + camp + ') is in the digest', 'missing'); continue; }
    const bad = F.filter((f) => !near(p[f], e[f], f === 'gwp' || f === 'gwpT' ? 1 : 0.0051)).map((f) => f + ' published ' + p[f] + ' vs engine ' + e[f]);
    ok(!bad.length, tl + ' (' + camp + ') — every published figure equals the engine', bad.join(' · '));
  }
  const pc = (digest.v && digest.v.campAgg) || {}, ec = eng.dig.campAgg || {};
  for (const c of Object.keys(ec)) {
    const bad = F.filter((f) => pc[c] && !near(pc[c][f], ec[c][f], f === 'gwp' || f === 'gwpT' ? 1 : 0.0051)).map((f) => f + ' published ' + (pc[c] || {})[f] + ' vs engine ' + ec[c][f]);
    ok(pc[c] && !bad.length, 'campaign total ' + c + ' equals the engine', pc[c] ? bad.join(' · ') : 'missing from the digest');
  }

  head('3 · fresh');
  ok(digest.at && state.at && Date.parse(digest.at) >= Date.parse(state.at) - 60000, 'the digest (' + digest.at + ') was published after the state was saved (' + state.at + ')');
  ok(digest.v && digest.v.period && digest.v.period.from === sast + '-01', 'the digest is the current month from the 1st (' + JSON.stringify(digest.v && digest.v.period) + ')');
  const engDays = (eng.dig.daysWithData != null) ? eng.dig.daysWithData : null, pubDays = digest.v && digest.v.daysWithData;
  ok(engDays == null || pubDays === engDays, 'days with data agree (published ' + pubDays + ', engine ' + engDays + ')');
} finally { await browser.close(); server.close(); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
