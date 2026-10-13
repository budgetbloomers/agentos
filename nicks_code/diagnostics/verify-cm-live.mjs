#!/usr/bin/env node
/**
 * verify-cm-live.mjs — the campaign manager view, END TO END against production.
 *
 *   node nicks_code/diagnostics/verify-cm-live.mjs --live
 *
 * WHY THIS EXISTS SEPARATELY FROM verify-campaign-manager.mjs. That suite stubs
 * HighLevel and Supabase, so it proves the RULES (the clock, the gates, the
 * merge) but never touches the two things that can only fail in production: the
 * live Worker's routing/lockdown, and the real HighLevel pipeline — which the
 * Worker creates on first use, a path that by definition runs exactly once.
 *
 * HOW IT SIGNS IN. It mints a SHORT-LIVED session row for the campaign manager
 * the same way login() does (random token, sha256 stored, raw token used as the
 * Bearer) — because nobody's password is in this repo and it must not be. The
 * session is 5 minutes and is DELETED in a finally block, so a crash mid-run
 * still cleans up. It never touches the password, the lockout or the audit log.
 *
 * IT WRITES ONE THING TO HIGHLEVEL, ON PURPOSE: the "Campaign Assistance"
 * pipeline, if it does not exist yet. That is the designed first-use behaviour
 * (the Coaching Actions precedent) and is the single most important thing this
 * test proves. It creates no opportunities and no contacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--live')) {
  console.log('This test signs in against PRODUCTION and may create the HighLevel pipeline.\nRe-run with --live to confirm.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const WHO = process.argv.includes('--ryan') ? 'ryan' : 'dalwin';

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? '  → ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = crypto.randomBytes(32).toString('hex');
let tokenHash = null;

const call = async (p, body) => {
  const r = await fetch(API + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, json: j || {} };
};

try {
  const users = await (await fetch(REST + `app_users?username=eq.${WHO}&select=id,username,full_name,role,cb,theme,apps`, { headers: H })).json();
  const u = users[0];
  if (!u) { console.error('no such account: ' + WHO); process.exit(1); }
  console.log(`Signing in as ${u.username} — ${u.full_name} · ${u.role} · cb=${u.cb || '(none)'}`);

  tokenHash = sha(token);
  const ins = await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: tokenHash, user_id: u.id,
      expires_at: new Date(Date.now() + 5 * 60000).toISOString(), user_agent: 'verify-cm-live' }]) });
  if (!ins.ok) { console.error('could not mint a session: ' + ins.status + ' ' + (await ins.text()).slice(0, 200)); process.exit(1); }

  head('A · the session resolves to a campaign manager');
  let r = await call('/api/portal/me');
  ok(r.status === 200, 'GET /api/portal/me answers', r.status + ' ' + JSON.stringify(r.json).slice(0, 120));
  ok(r.json.user && r.json.user.role === 'campaign_manager', 'role is campaign_manager');
  ok(r.json.user && r.json.user.cb === (u.cb || ''), 'the CB number travels: ' + (r.json.user && r.json.user.cb || '(none)'));

  head('B · the campaign view loads (the whole page payload)');
  r = await call('/api/portal/overview');
  ok(r.status === 200, 'GET /api/portal/overview answers 200', r.status + ' ' + JSON.stringify(r.json).slice(0, 200));
  const D = r.json;
  ok(D.scope === 'campaign', 'scope is campaign, not team or agent');
  ok(D.cm && Array.isArray(D.cm.campaigns) && D.cm.campaigns.length > 0,
    'carries the campaigns: ' + (D.cm ? D.cm.campaigns.map((c) => c.label).join(', ') : 'none'));
  ok(D.cm && D.cm.campaigns.every((c) => c.reconciled), 'EVERY campaign reconciles (total ≡ Σ teams)');
  ok(D.cm && D.cm.freshness && !/live data|real time/i.test(D.cm.freshness.label),
    'freshness never says "live"/"real time": "' + (D.cm && D.cm.freshness.label) + '"');

  /* the sales half, printed so a human can sanity-check the numbers */
  for (const c of (D.cm ? D.cm.campaigns : [])) {
    const k = c.kpis;
    console.log(`       ${c.label}: ${c.teamLeaders} TLs · ${c.agents} agents · ${k.sales.v}/${k.sales.target} sales`
      + ` · R${k.gwp.v.toLocaleString('en-ZA')} GWP` + (k.gwp.projected ? ` (proj R${k.gwp.projected.toLocaleString('en-ZA')})` : '')
      + ` · QA ${k.qa.v == null ? '—' : (k.qa.v * 100).toFixed(1) + '%'}`);
    for (const t of c.teams) console.log(`         ${t.team.padEnd(24)} [${t.rag}] ${t.state}`);
  }
  const anyTeam = (D.cm ? D.cm.campaigns : []).some((c) => c.teams.length > 0);
  ok(anyTeam, 'at least one team leader row is built');
  /* Conversion, contact rate, attempts and lead volume all READ since the digest
     began publishing the lead denominator (2026-08-30). Only pitches and
     both-checks have no source at all, and those must stay null rather than
     drifting to a zero that would read as "nobody pitched". */
  const cs = (D.cm ? D.cm.campaigns : []);
  ok(cs.every((c) => c.kpis.pitches === null && c.kpis.checks === null),
    'pitches and both-checks stay null — no source exists for either');
  ok(cs.every((c) => c.kpis.conv && c.kpis.conv.leads > 0),
    'conversion reads, on a real unique-lead denominator',
    cs.map((c) => c.label + ' ' + (c.kpis.conv ? (c.kpis.conv.v * 100).toFixed(1) + '%' : 'null')).join(' · '));
  ok(cs.every((c) => c.kpis.contactRate && c.kpis.attempts && c.kpis.leads),
    'contact rate, attempts per lead and lead volume all read');

  head('C · the assistance register, against LIVE HighLevel');
  r = await call('/api/portal/cm/assist');
  ok(r.status === 200, 'GET /api/portal/cm/assist answers 200', r.status + ' ' + JSON.stringify(r.json).slice(0, 250));
  if (r.status === 200) {
    const A = r.json;
    ok(Array.isArray(A.stages) && A.stages.length === 6,
      'the pipeline exists with its six stages: ' + (A.stages || []).map((s) => s.name).join(' → '));
    ok(Array.isArray(A.requests), 'a request list came back (' + (A.requests || []).length + ' rows)');
    ok(A.kpis && typeof A.kpis.received === 'number', 'the assistance KPIs are computed');
    ok(Array.isArray(A.blockages) && A.blockages.length === 11,
      'the eleven blockages travel for the team leader form (' + (A.blockages || []).length + ')');
    ok(A.sla && A.sla.p1 === 15 && A.sla.p2 === 30 && A.sla.p3 === 240 && A.sla.p4 === 1440,
      'the SLA targets come from cm:sla: P1 ' + (A.sla && A.sla.p1) + ' / P2 ' + (A.sla && A.sla.p2)
      + ' / P3 ' + (A.sla && A.sla.p3) + ' / P4 ' + (A.sla && A.sla.p4) + ' min');
    ok(!A.truncated, 'the scan was not truncated');
  }

  head('D · the end-of-day pack');
  r = await call('/api/portal/cm/eod');
  ok(r.status === 200 && typeof r.json.markdown === 'string' && r.json.markdown.length > 80,
    'GET /api/portal/cm/eod builds a pack (' + (r.json.markdown ? r.json.markdown.length : 0) + ' chars)',
    r.status + ' ' + JSON.stringify(r.json).slice(0, 160));
  if (r.json.markdown) console.log('       ' + r.json.markdown.split('\n').slice(0, 4).join('\n       '));

  /* THE LOCKDOWN IS FOR PORTAL-ONLY ACCOUNTS (portalOnly(): a portal role with NO management app).
     Dalwin and Ryan were given VAS/Ops on 30 Aug (campaign_manager sees every VAS page but the Upload
     Station), so for them the management routes are OPEN by design; only /api/kv (the whole state
     blob) and /api/ask stay shut to that role. A campaign manager with no management app is still
     locked down in full — the check branches on the account's apps, never on the name. */
  const mgmt = ['ops', 'vas'].some((a) => (u.apps || []).includes(a));
  head('E · the lockdown ' + (mgmt ? 'is relaxed for a manager who also holds ' + (u.apps || []).join('/') : 'still holds for this role'));
  for (const shut of ['/api/kv', '/api/ask']) {
    const x = await call(shut);
    ok(x.status === 403 || x.status === 404 || x.status === 405, shut + ' is refused (' + x.status + ')');
  }
  for (const route of ['/api/bi', '/api/coaching', '/api/referrals', '/api/agent-link']) {
    const x = await call(route);
    if (mgmt) ok(x.status !== 403 && x.status !== 404, route + ' answers a manager who holds VAS/Ops (' + x.status + ')');
    else ok(x.status === 403 || x.status === 404 || x.status === 405, route + ' is refused (' + x.status + ')');
  }
  const hub = await call('/api/portal/hub/kpi');
  ok(hub.status === 403, '/api/portal/hub/kpi is a TEAM LEADER tool — refused (' + hub.status + ')');
  const raise = await call('/api/portal/cm/request', { blockage: 'dialler', description: 'x', priority: 'P3' });
  ok(raise.status === 403, 'a campaign manager cannot raise a request to themselves (' + raise.status + ')');
  const th = await call('/api/theme', { theme: u.theme || 'light' });   // writes back the value already on the account
  if (mgmt) ok(th.status === 200, '/api/theme answers a manager who uses the management apps (' + th.status + ')');
  else ok(th.status === 403, '/api/theme is refused for a portal-only role (' + th.status + ') — the agent app has no dark palette');

  head('F · a request the manager should NOT be able to touch');
  const bogus = await call('/api/portal/cm/act', { id: 'not-a-real-opportunity', action: 'start' });
  ok(bogus.status >= 400, 'acting on an unknown request id fails cleanly (' + bogus.status + ')');

  /* THE COACHING HUB TAB (spec 033-cm-coaching-hub-tab, 2026-10-13): the tab embeds the live Hub app, so two things
     outside this Worker must hold — the Hub must not refuse to be framed, and the deployed Pages CSP must allow
     framing exactly that origin. Both are read from the live responses, not from the repo. The theme check turns
     green once the Hub repo's feat/agentos-theme is deployed on Vercel. */
  head('H · the Coaching Hub tab: the Hub can be framed, the Pages CSP allows it, the Hub carries the theme');
  const HUB = 'https://coaching-hub-psi.vercel.app/';
  const hh = await fetch(HUB, { method: 'HEAD' }).catch(() => null);
  ok(!!hh && hh.ok, 'the Hub answers (' + (hh ? hh.status : 'unreachable') + ')');
  if (hh) {
    const xfo = hh.headers.get('x-frame-options'), hcsp = hh.headers.get('content-security-policy') || '';
    ok(!xfo, 'the Hub sends no X-Frame-Options' + (xfo ? ' — it sends ' + xfo + ': the tab will show words + Retry' : ''));
    ok(!/frame-ancestors/.test(hcsp), 'the Hub sends no frame-ancestors' + (/frame-ancestors/.test(hcsp) ? ' — ' + hcsp.slice(0, 120) : ''));
  }
  const pg = await fetch('https://chatterbox-agentos.pages.dev/agent/', { method: 'GET' }).catch(() => null);
  const pcsp = (pg && pg.headers.get('content-security-policy')) || '';
  ok(/frame-src https:\/\/coaching-hub-psi\.vercel\.app(;|$)/.test(pcsp), 'the deployed /agent/ CSP frames the Hub origin only' + (pcsp ? '' : ' (no CSP header read)'));
  ok(/frame-ancestors 'self'/.test(pcsp) && /connect-src 'self' /.test(pcsp), 'frame-ancestors and connect-src are as before');
  const html = hh ? await (await fetch(HUB).catch(() => ({ text: async () => '' }))).text() : '';
  const cssPath = (html.match(/href="(\/assets\/[^"]+\.css)"/) || [])[1];
  const css = cssPath ? await (await fetch(HUB.replace(/\/$/, '') + cssPath).catch(() => ({ text: async () => '' }))).text() : '';
  ok(/\[data-theme=agentos\]/.test(css), 'the Hub stylesheet carries the AgentOS theme (?theme=agentos)' + (/\[data-theme=agentos\]/.test(css) ? '' : ' — NOT YET: deploy the Hub repo branch feat/agentos-theme'));
} finally {
  if (tokenHash) {
    const del = await fetch(REST + 'app_sessions?token_hash=eq.' + tokenHash, { method: 'DELETE', headers: H });
    console.log('\n(temporary session ' + (del.ok ? 'deleted' : 'DELETE FAILED — remove it by hand: ' + tokenHash) + ')');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
