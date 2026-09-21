#!/usr/bin/env node
/**
 * verify-cm-assist-e2e.mjs — a team leader asks their campaign manager for help, END TO END, in production.
 *
 *   node nicks_code/diagnostics/verify-cm-assist-e2e.mjs --live
 *
 * Nick, 2026-09-21: "make sure when TLs click ask campaign manager for help it works." verify-cm-live
 * proves the campaign manager's routes; this walks the whole lifecycle the way the two people do:
 *   TL (a real team-leader account under the manager)  → POST /api/portal/cm/request  (the "Raise it" button)
 *   CM (dalwin)                                         → sees it on GET /api/portal/cm/assist, opens the detail,
 *                                                          start (stamps the clock) → evidence → complete (resolution)
 *   TL                                                  → confirm_tl → the request closes (no baseline metric → Resolved)
 * Every step reads the register back and checks the state a human would see. The request is unmistakably a
 * test in its text and is CLOSED by the same run; on any failure the run still tries to close it.
 *
 * Sessions are minted the way verify-cm-live does (random token, sha256 stored, 5 minutes, deleted in finally):
 * nobody's password is in this repo, and the lockout / audit log are never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--live')) { console.log('This test raises and closes ONE labelled test request in production HighLevel. Re-run with --live.'); process.exit(0); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const CM = process.argv.includes('--ryan') ? 'ryan' : 'dalwin';
const TL = (process.argv.find((a) => a.startsWith('--tl=')) || '--tl=cb102').slice(5);   // Dhamendra Budhu, Courtesy
const STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

async function mint(username) {
  const u = (await (await fetch(REST + 'app_users?username=eq.' + username + '&select=id,role,cb,full_name,active', { headers: H })).json())[0];
  if (!u || !u.active) throw new Error('no active account ' + username);
  const token = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(token).digest('hex');
  await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: hash, user_id: u.id, expires_at: new Date(Date.now() + 5 * 60000).toISOString(), user_agent: 'verify-cm-assist-e2e' }]) });
  const call = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'X-Cbx-Client': 'v5', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { j = { raw: await r.text().catch(() => '') }; } return { status: r.status, j }; };
  return { user: u, call, drop: () => fetch(REST + 'app_sessions?token_hash=eq.' + hash, { method: 'DELETE', headers: H }) };
}

/* HighLevel's opportunity search lags a write by a few seconds: read the register until it agrees (≤ 20 s) */
const until = async (who, pred) => { let row = null; for (let i = 0; i < 8; i++) { row = (((await who.call('/api/portal/cm/assist')).j || {}).requests || []).find((r) => r.id === id) || null; if (pred(row)) return row; await new Promise((r) => setTimeout(r, 2500)); } return row; };
let tl, cm, id = null;
try {
  tl = await mint(TL); cm = await mint(CM);
  head('A · WHO IS WHO');
  ok(TL + ' is a team leader with a CB (' + tl.user.full_name + ', ' + tl.user.cb + ')', tl.user.role === 'team_leader' && !!tl.user.cb);
  ok(CM + ' is a campaign manager (' + cm.user.full_name + ')', cm.user.role === 'campaign_manager');

  head('B · THE TEAM LEADER\'S FORM (GET /api/portal/cm/assist as the TL)');
  const form = await tl.call('/api/portal/cm/assist');
  ok('the team leader can load the assistance register (' + form.status + ')', form.status === 200, JSON.stringify(form.j).slice(0, 200));
  const blks = (form.j && form.j.blockages) || [];
  ok('the blockage list travels for the form (' + blks.length + ')', blks.length >= 5);
  ok('the SLA targets travel (P1 ' + (form.j.sla || {}).p1 + ' min)', form.j.sla && form.j.sla.p1 > 0);
  const blk = ['other', 'system', 'dialler', 'leads'].map((k) => blks.find((b) => b.key === k && !b.restricted)).find(Boolean) || blks.find((b) => !b.restricted) || blks[0];
  const before = ((form.j && form.j.requests) || []).filter((r) => !r.closed).length;

  head('C · RAISE IT (POST /api/portal/cm/request as the TL)');
  const raise = await tl.call('/api/portal/cm/request', { blockage: blk.key, priority: 'P4', campaign: 'Courtesy',
    description: 'TEST ' + STAMP + ' — automated check that "Ask your campaign manager" works (verify-cm-assist-e2e). Closed by the same test; please ignore.', affected: 0 });
  ok('the request went through (' + raise.status + ')', raise.status === 200 && raise.j && raise.j.ok && raise.j.id, JSON.stringify(raise.j).slice(0, 200));
  id = raise.j && raise.j.id;
  ok('it is a NEW card, not merged into an existing one', raise.j && !raise.j.merged, JSON.stringify(raise.j));

  head('D · THE CAMPAIGN MANAGER SEES IT (GET /api/portal/cm/assist as ' + CM + ')');
  const list = await cm.call('/api/portal/cm/assist');
  ok('the manager\'s register loads (' + list.status + ')', list.status === 200);
  const row = await until(cm, (r) => r && /new/i.test(r.status || ''));
  ok('the new request is on the manager\'s register', !!row, 'ids: ' + ((list.j && list.j.requests) || []).map((r) => r.id).join(',').slice(0, 200));
  ok('…as New, P4, from ' + tl.user.full_name + ', Courtesy, clock running', row && /new/i.test(row.status || '') && row.priority === 'P4' && row.cb === tl.user.cb && /courtesy/i.test(row.campaign || '') && row.sla && row.sla.state !== 'met', JSON.stringify(row).slice(0, 300));
  const det = await cm.call('/api/portal/cm/detail?id=' + encodeURIComponent(id));
  ok('the detail opens with the team leader\'s words', det.status === 200 && JSON.stringify(det.j).includes('verify-cm-assist-e2e'), JSON.stringify(det.j).slice(0, 200));
  const tlList = await tl.call('/api/portal/cm/assist');
  ok('the team leader sees it on their own page too', ((tlList.j && tlList.j.requests) || []).some((r) => r.id === id));

  head('E · THE MANAGER WORKS IT (POST /api/portal/cm/act)');
  const start = await cm.call('/api/portal/cm/act', { id, action: 'start' });
  ok('start — assistance begins, the clock stops (' + start.status + ')', start.status === 200 && start.j && start.j.ok, JSON.stringify(start.j).slice(0, 200));
  const afterStart = await until(cm, (r) => r && /^(Live|Awaiting evidence)$/.test(r.status || ''));
  ok('…the register shows Live (Assisting stage) with the first-response time stamped inside SLA', afterStart && /^(Live|Awaiting evidence)$/.test(afterStart.status || '') && afterStart.sla && afterStart.sla.state === 'met' && /first assistance/.test(afterStart.sla.label || ''), JSON.stringify(afterStart && { status: afterStart.status, sla: afterStart.sla }));
  const ev = await cm.call('/api/portal/cm/act', { id, action: 'evidence', text: 'Automated test evidence — no real assistance took place.' });
  ok('evidence recorded', ev.status === 200 && ev.j.ok);
  const done = await cm.call('/api/portal/cm/act', { id, action: 'complete', resolution: 'Automated end-to-end test of the raise → assist → confirm path. Nothing was actually done.' });
  ok('complete — resolution recorded, awaiting the team leader\'s confirmation', done.status === 200 && done.j.ok && Array.isArray(done.j.blockers) && done.j.blockers.includes('team leader confirmation') && !done.j.blockers.includes('evidence'), JSON.stringify(done.j));

  head('F · THE TEAM LEADER CONFIRMS, AND IT CLOSES');
  const conf = await tl.call('/api/portal/cm/act', { id, action: 'confirm_tl' });
  ok('confirm_tl accepted from the requesting team leader', conf.status === 200 && conf.j.ok && !(conf.j.blockers || []).includes('team leader confirmation'), JSON.stringify(conf.j));
  /* A blockage with a BASELINE METRIC parks at "Follow-up due" until the manager records the 48-hour
     reading (spec: resolution gates) — the register says so, and the manager's followup closes it. */
  if ((conf.j.blockers || []).some((b) => /follow-up/.test(b))) {
    const parked = await until(cm, (r) => r && r.status === 'Follow-up due');
    ok('a measurable blockage parks at Follow-up due after confirmation (the 48-hour reading is the last gate)', parked && parked.status === 'Follow-up due', JSON.stringify(parked && parked.status));
    const fu = await cm.call('/api/portal/cm/act', { id, action: 'followup' });
    ok('the manager records the follow-up reading (' + fu.status + ')', fu.status === 200 && fu.j.ok && (fu.j.blockers || []).length === 0, JSON.stringify(fu.j));
  }
  /* HighLevel's search lags a stage move by a few seconds — read until it agrees, up to ~15 s */
  const fin = await until(cm, (r) => r && r.closed);
  ok('the request is Closed / Resolved on the manager\'s register', fin && fin.closed, JSON.stringify(fin).slice(0, 300));
  const after = ((await tl.call('/api/portal/cm/assist')).j.requests || []).filter((r) => !r.closed).length;
  ok('the team leader\'s open count is back to where it started (' + before + ')', after === before, before + ' → ' + after);
  const hist = await cm.call('/api/portal/cm/detail?id=' + encodeURIComponent(id));
  const h = JSON.stringify(hist.j);
  ok('the history reads raised → assistance started → evidence → completed → confirmed', /raised/.test(h) && /assistance started/.test(h) && /evidence added/.test(h) && /session completed/.test(h) && /team leader confirmed/.test(h), h.slice(0, 300));

  head('G · GUARDS');
  const self = await cm.call('/api/portal/cm/request', { blockage: blk.key, priority: 'P4', campaign: 'Courtesy', description: 'x' });
  ok('a campaign manager cannot raise a request to themselves (403)', self.status === 403);
  const other = await tl.call('/api/portal/cm/act', { id, action: 'start' });
  ok('a team leader cannot start assistance (that belongs to the manager)', other.status === 403, JSON.stringify(other.j));
} catch (e) {
  fail++; console.log('  FAIL threw: ' + (e && e.message || e));
} finally {
  /* never leave a test card open on the floor */
  if (id && cm && tl) {
    try {
      const st = ((await cm.call('/api/portal/cm/assist')).j.requests || []).find((r) => r.id === id);
      if (st && !st.closed) {
        await cm.call('/api/portal/cm/act', { id, action: 'start' });
        await cm.call('/api/portal/cm/act', { id, action: 'evidence', text: 'test cleanup' });
        await cm.call('/api/portal/cm/act', { id, action: 'complete', resolution: 'test cleanup' });
        await tl.call('/api/portal/cm/act', { id, action: 'confirm_tl' });
        await cm.call('/api/portal/cm/act', { id, action: 'followup' });
        console.log('  (test request closed in cleanup)');
      }
    } catch (e) { console.log('  cleanup failed: ' + (e && e.message || e)); }
  }
  if (tl) await tl.drop(); if (cm) await cm.drop();
  console.log('  (temporary sessions deleted)');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
