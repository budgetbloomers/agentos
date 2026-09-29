#!/usr/bin/env node
/**
 * verify-help-request-e2e.mjs — an agent asks their team leader for help, END TO END, in
 * production, proving the fix for HighLevel's "Agent OS · Durban" location refusing a SECOND
 * opportunity per contact (400 OPPORTUNITY_NO_DUPLICATE -> Worker 502) once Nick turned ON
 * "Allow Duplicate Opportunity". Modelled on verify-cm-assist-e2e.mjs's sign-in, base URL and
 * cleanup patterns, but this walks the REAL password login (not a minted session) because the
 * regression is specifically "an agent who asked once can never ask again" — proving it means
 * signing in as an agent who has already asked (kv:help-contact:<CB> exists) and asking twice
 * more in the same run.
 *
 *   node nicks_code/diagnostics/verify-help-request-e2e.mjs --live
 *
 * SIGN-IN SAFETY: each account is logged in AT MOST ONCE with the known default password. On
 * any login failure the run stops for that account and reports — it never retries with a
 * different password or a different account. Both created requests are closed in `finally`,
 * whatever else happened, and both sessions are signed out. No password, token or key is ever
 * printed.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--live')) {
  console.log('This test signs in as a real agent and team leader and raises two labelled test help requests in production HighLevel. Re-run with --live.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const PAGES = 'https://chatterbox-agentos.pages.dev/agent/';
const PASSWORD = 'agentos123'; // the standing start password for every agent/TL account (auth.mjs START_PASSWORD) — never logged
const STAMP = new Date().toISOString();

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

/* read-only identity lookups — never a login, so no lockout exposure */
async function row(q) { const r = await fetch(REST + q, { headers: H }); return (await r.json().catch(() => []))[0] || null; }

/* ONE real password login per account, ONE attempt, using X-Cbx-Client:v5 (the Worker's
 * version gate refuses /api/login without it — see index.mjs). Never retried on failure. */
async function signIn(cb) {
  const r = await fetch(API + '/api/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5' },
    body: JSON.stringify({ username: cb, password: PASSWORD }) });
  let j = null; try { j = await r.json(); } catch { j = null; }
  if (r.status !== 200 || !j || !j.token) return { ok: false, status: r.status, error: (j && j.error) || 'no token', j };
  const token = j.token;
  const call = async (p, body) => {
    const rr = await fetch(API + p, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'X-Cbx-Client': 'v5', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    let jj = null; try { jj = await rr.json(); } catch (e) { jj = { raw: await rr.text().catch(() => '') }; }
    return { status: rr.status, j: jj };
  };
  return { ok: true, status: 200, user: j.user, token, call,
    signOut: () => call('/api/logout', {}) };
}

/* a 5-minute session straight into app_sessions (as verify-cm-assist-e2e) — no password, no lockout strike */
async function mint(username) {
  const u = (await (await fetch(REST + 'app_users?username=eq.' + encodeURIComponent(username) + '&select=id,active', { headers: H })).json())[0];
  if (!u || !u.active) throw new Error('no active account ' + username);
  const token = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(token).digest('hex');
  const w = await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: hash, user_id: u.id, expires_at: new Date(Date.now() + 5 * 60000).toISOString(), user_agent: 'verify-help-request-e2e' }]) });
  if (!w.ok) throw new Error('could not mint a session for ' + username + ' (' + w.status + ')');
  const call = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'X-Cbx-Client': 'v5', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, j }; };
  return { call, drop: () => fetch(REST + 'app_sessions?token_hash=eq.' + hash, { method: 'DELETE', headers: H }) };
}

let agentCb = null, tlUsername = null, tlName = null, agent = null, tl = null;
const ids = [];
try {
  head('A · WHO TO USE (read-only lookups, no login)');
  /* prefer CB162 (has an existing kv:help-contact — proven to have asked before), else CB245 */
  const help162 = await row('rules?key=eq.kv:help-contact:CB162&select=value');
  const help245 = await row('rules?key=eq.kv:help-contact:CB245&select=value');
  agentCb = help162 ? 'CB162' : (help245 ? 'CB245' : null);
  ok('a repeat-asker agent was found (' + (agentCb || 'none') + ')', !!agentCb);
  if (!agentCb) throw new Error('neither CB162 nor CB245 has a kv:help-contact row — cannot prove the regression');

  const au = await row('app_users?cb=eq.' + agentCb + '&select=username,full_name,role,cb,team,active,locked_until');
  ok(agentCb + ' has an active, unlocked agent account (' + (au && au.full_name) + ')',
    au && au.active && au.role === 'agent' && !au.locked_until, JSON.stringify(au));
  if (!au || !au.active) throw new Error(agentCb + ' account is not usable — stopping before any login attempt');

  const tlRow = au.team ? await row('app_users?full_name=eq.' + encodeURIComponent(au.team) + '&role=eq.team_leader&select=username,full_name,role,active,locked_until') : null;
  tlUsername = tlRow && tlRow.username; tlName = tlRow && tlRow.full_name;
  ok('their team leader (' + (au.team || '?') + ') has an active, unlocked account (' + tlUsername + ')',
    tlRow && tlRow.active && !tlRow.locked_until, JSON.stringify(tlRow));

  head('B · SIGN IN AS ' + agentCb + ' (POST /api/login, ONE attempt)');
  agent = await signIn(au.username);
  ok('login succeeded (' + agent.status + ')', agent.ok, agent.ok ? '' : JSON.stringify(agent.error));
  if (!agent.ok) throw new Error(agentCb + ' login failed: ' + JSON.stringify(agent.error) + ' — stopping, not retrying');
  ok('came back as the expected agent (' + agent.user.full_name + ', ' + agent.user.cb + ')', agent.user.role === 'agent' && agent.user.cb === agentCb);

  /* NEVER TOUCH A REAL OPEN REQUEST. With "Allow Duplicate Opportunity" off the Worker adds a new
     ask to the agent's OPEN card (help.mjs reuseCard) — so a test ask would land on a genuine
     request, rename it, and cleanup would CLOSE it. If the agent has one open, stop before asking. */
  const pre = await agent.call('/api/portal/help/mine');
  const realOpen = ((pre.j && pre.j.requests) || []).filter((r) => !r.closed);
  ok('the agent has no real request open that a test ask could land on', pre.status === 200 && !realOpen.length, JSON.stringify(realOpen).slice(0, 200));
  if (pre.status !== 200 || realOpen.length) throw new Error(agentCb + ' has an open request — not asking, so it is never renamed or closed by this test');

  head('C · TWO REQUESTS BACK TO BACK (POST /api/portal/help/request) — the SECOND is the regression check');
  const answers = [];
  for (let i = 1; i <= 2; i++) {
    const note = 'AUTOMATED TEST ' + i + ' of 2 — please ignore, it closes itself (Claude, ' + STAMP + ')';
    const r = await agent.call('/api/portal/help/request', { category: 'Help with the system', note });
    ok('request ' + i + ' of 2 returned 200 {ok:true,id} (' + r.status + ')', r.status === 200 && r.j && r.j.ok === true && !!r.j.id, JSON.stringify(r.j).slice(0, 200));
    if (r.j && r.j.id) { answers.push(r.j); if (!ids.includes(r.j.id)) ids.push(r.j.id); }
  }
  /* either shape is right: duplicates allowed → two cards; one card per agent → the second ask
     joins the first (merged) */
  ok('the second ask is its own card, or joined the first', answers.length === 2
    && (answers[0].id !== answers[1].id || answers[1].merged === true), JSON.stringify(answers));
  /* say which path production took — the first ask reopens a CLOSED card (archive + reopen) or,
     for an agent who never asked, makes a fresh one — and prove the archive when it reopened
     (review, 2026-09-28: the harder path was only opportunistically exercised) */
  const path1 = answers[0] ? (answers[0].reopened ? 'reopened a closed card' : answers[0].merged ? 'joined an open card' : 'fresh card') : '?';
  console.log('  (ask 1: ' + path1 + '; ask 2: ' + (answers[1] ? (answers[1].merged ? 'joined it' : answers[1].reopened ? 'reopened a card' : 'fresh card') : '?') + ')');
  if (answers[0] && answers[0].reopened) {
    const r = await fetch(REST + 'rules?key=like.' + encodeURIComponent('kv:help-arch:' + answers[0].id + ':*') + '&select=key,value&order=key.desc&limit=1', { headers: H });
    const a = ((await r.json().catch(() => [])) || [])[0];
    ok('the closed request it reopened was archived with its topic and close time', !!(a && a.value && a.value.cb === agentCb && a.value.category && a.value.closed_at),
      JSON.stringify(a && a.value));
  }

  head('D · GET /api/portal/help/mine — both ids present');
  const mine = await agent.call('/api/portal/help/mine');
  ok('mine loads (' + mine.status + ')', mine.status === 200);
  const mineRows = (mine.j && mine.j.requests) || [];
  ok('the new requests are on the agent\'s own list', ids.length > 0 && ids.every((id) => mineRows.some((r) => r.id === id)),
    'ids: ' + ids.join(',') + ' | mine: ' + mineRows.map((r) => r.id).join(','));

  /* A MINTED SESSION for the team leader, never their password (2026-09-28): leaders may have
     changed theirs (cb267's is no longer the default), and a failed login is a strike on a real
     person's lockout count. Minted as verify-cm-assist-e2e does: 5 minutes, deleted in finally. */
  head('E · THE TEAM LEADER (' + (tlUsername || '?') + ', minted 5-minute session) — GET /api/portal/help/list');
  if (!tlUsername || !(tlRow && tlRow.active && !tlRow.locked_until)) {
    console.log('  SKIPPED — no usable team-leader account found for ' + agentCb + '\'s team (' + (au.team || '?') + ')');
  } else {
    tl = await mint(tlUsername);
    const card = ids[ids.length - 1];
    /* NICK'S SIX STEPS (sprint 2026-09-29): 1–2 above; 3 the leader is notified (the Help Center icon),
       4 acknowledges (opening it), 5 marks it done, 6 the agent confirms */
    const p1 = await tl.call('/api/portal/help/pulse');
    ok('step 3 — the leader\'s Help Center icon counts the new request (' + (p1.j && p1.j.unread) + ')', p1.status === 200 && (p1.j && p1.j.unread) >= 1, JSON.stringify(p1.j));
    const list = await tl.call('/api/portal/help/list');
    ok('the team leader\'s queue loads (' + list.status + ')', list.status === 200, JSON.stringify(list.j).slice(0, 200));
    const listRows = (list.j && list.j.requests) || [];
    ok('the requests are on the team leader\'s queue, open', ids.length > 0 && ids.every((id) => listRows.some((r) => r.id === id && !r.closed)),
      'ids: ' + ids.join(',') + ' | list: ' + listRows.map((r) => r.id + (r.closed ? '(closed)' : '')).join(','));
    const d = card ? await tl.call('/api/portal/help/detail?id=' + encodeURIComponent(card)) : null;
    const dn = String((d && d.j && (d.j.note || d.j.error)) || '');
    ok('the team leader can read the second ask\'s note', d && d.status === 200 && /AUTOMATED TEST 2 of 2/.test(dn), dn.slice(0, 200));
    ok('step 4 — opening it stamps "seen" (by ' + (d && d.j && d.j.seenBy) + ')', !!(d && d.j && d.j.seenAt), JSON.stringify(d && d.j && { seenAt: d.j.seenAt, seenBy: d.j.seenBy }));
    const p2 = await tl.call('/api/portal/help/pulse');
    ok('…and the icon drops it (' + (p1.j && p1.j.unread) + ' → ' + (p2.j && p2.j.unread) + ')', p2.status === 200 && (p2.j.unread | 0) <= (p1.j.unread | 0) - 1, JSON.stringify(p2.j));
    const stages = (list.j && list.j.stages) || [];
    const waiting = stages.length >= 3 ? stages[stages.length - 2] : null;
    ok('the pipeline has a "waiting on agent" stage (' + (waiting && waiting.name) + ')', !!waiting, JSON.stringify(stages));
    if (waiting && card) {
      const s = await tl.call('/api/portal/help/stage', { id: card, stageId: waiting.id });
      ok('step 5 — the leader marks it done (' + s.status + ')', s.status === 200, JSON.stringify(s.j));
      const m1 = await agent.call('/api/portal/help/mine');
      const row = ((m1.j && m1.j.requests) || []).find((r) => r.id === card) || {};
      ok('the agent sees it waiting for them, seen by their leader', row.awaitingAgent === true && !!row.seenAt, JSON.stringify(row));
      const c = await agent.call('/api/portal/help/confirm', { id: card, helped: true });
      ok('step 6 — the agent confirms "Yes, I was helped" and it closes (' + c.status + ')', c.status === 200 && c.j && c.j.closed === true, JSON.stringify(c.j));
    }
  }
} catch (e) {
  fail++; console.log('  FAIL threw: ' + (e && e.message || e));
} finally {
  head('F · CLEANUP — close both test requests and re-check /mine');
  if (agent && agent.ok) {
    for (const id of ids) {
      try {
        const c = await agent.call('/api/portal/help/close', { id });
        ok('closed ' + id + ' (' + c.status + ')', c.status === 200 && c.j && c.j.ok === true, JSON.stringify(c.j));
      } catch (e) { fail++; console.log('  FAIL closing ' + id + ': ' + (e && e.message || e)); }
    }
    try {
      const recheck = await agent.call('/api/portal/help/mine');
      const rows = (recheck.j && recheck.j.requests) || [];
      const stillOpen = ids.filter((id) => { const r = rows.find((x) => x.id === id); return r && !r.closed; });
      ok('neither test request reads open any more', stillOpen.length === 0, 'still open: ' + JSON.stringify(stillOpen));
    } catch (e) { fail++; console.log('  FAIL re-checking /mine: ' + (e && e.message || e)); }
  } else {
    console.log('  (no created requests to close — agent session never opened)');
  }
  if (agent && agent.ok) { try { await agent.signOut(); console.log('  (agent session signed out)'); } catch (e) { console.log('  agent sign-out failed: ' + (e && e.message || e)); } }
  if (tl) { try { await tl.drop(); console.log('  (team leader test session deleted)'); } catch (e) { console.log('  TL session delete failed: ' + (e && e.message || e)); } }
}

/* ---- G · real browser check (Playwright), only if cheap and only once the API side is known
   to work — reuses the SAME already-verified credential, so this is a second SUCCESSFUL login,
   never a retry after a failure, and never a third help request. */
if (agent && agent.ok) {
  head('G · REAL BROWSER — the "Ask … for help" button renders on My Progress');
  try {
    const { chromium } = await import('playwright');
    const br = await chromium.launch();
    const pg = await br.newPage();
    await pg.goto(PAGES, { waitUntil: 'domcontentloaded' });
    await pg.fill('#cb', agentCb);
    await pg.fill('#pw', PASSWORD);
    await pg.click('#go');
    /* wait for the agent's OWN data (ME), not just the sign-in — My Progress renders its buttons
       only once the portal payload has landed; the old fixed 1.5 s wait read an empty page */
    await pg.waitForFunction(() => window.U && window.U.role === 'agent' && window.ME, null, { timeout: 30000 }).catch(() => {});
    await pg.evaluate(() => { VIEW = 'progress'; render(); });
    const btnText = await pg.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /ask .* for help|ask .* to help with/i.test(x.textContent || ''));
      return b ? b.textContent.trim() : null;
    }, null, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => null);
    ok('the "Ask … for help" button renders on My Progress (no request sent)', !!btnText, btnText || 'not found');
    await br.close();
  } catch (e) {
    console.log('  browser check skipped/failed (non-fatal): ' + (e && e.message || e));
  }
} else {
  console.log('\nG · REAL BROWSER — skipped, no verified agent login to reuse');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
