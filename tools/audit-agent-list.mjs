#!/usr/bin/env node
/**
 * audit-agent-list.mjs — the identity chain, end to end.
 *
 *   node tools/audit-agent-list.mjs
 *
 * The Agent List is the identity base: every cross-source join in the suite
 * resolves through it (non-negotiable 7), and it owns the current month's org
 * (non-negotiable 11). That makes it the one file whose drift is invisible —
 * nothing errors, numbers just quietly attach to the wrong person, the wrong
 * leader or the wrong campaign.
 *
 * This reads every store that claims to know who works here and says where they
 * disagree. It writes NOTHING.
 *
 *   kv:roster-current       the Agent List of record (upload station)
 *   kv:agent-teams          the portal's AUTHORISATION floor (cron-written)
 *   kv:agent-digest         what PULSE published — what Agent Analytics renders
 *   app_users               the accounts: who can actually sign in
 *   cm:assignments          which campaigns each campaign manager holds
 *
 * Exit code is 1 if anything at ERROR severity is found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const REST = env.SUPABASE_URL + '/rest/v1/';

const normCb = (v) => { const d = String(v == null ? '' : v).toUpperCase().replace(/[^0-9]/g, ''); return d ? 'CB' + String(parseInt(d, 10)) : ''; };
const norm = (v) => String(v == null ? '' : v).trim();

const findings = [];
const add = (sev, area, what, detail) => findings.push({ sev, area, what, detail });
const H1 = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
const line = (t) => console.log('  ' + t);

const get = async (q) => (await fetch(REST + q, { headers: H })).json();
async function blob(key) {
  const r = await get(`rules?key=eq.${encodeURIComponent(key)}&select=value,updated_at,updated_by`);
  const row = r && r[0]; if (!row) return null;
  const v = row.value || {};
  let payload = String(v.data || '');
  if (!payload && v.store) payload = (await (await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/' + String(v.store).replace(/^raw\//, ''), { headers: H })).text()) || '';
  return { meta: row, value: v, json: payload ? JSON.parse(payload) : null };
}

const ageH = (t) => (t ? Math.round((Date.now() - Date.parse(t)) / 3600000) : null);

/* ------------------------------------------------------------------ load */
const [digestB, rosterB, teamsB, users, cmRules] = await Promise.all([
  blob('kv:agent-digest'), blob('kv:roster-current'), blob('kv:agent-teams'),
  get('app_users?select=username,full_name,role,cb,team,active&order=role'),
  get('rules?key=eq.' + encodeURIComponent('cm:assignments') + '&select=value'),
]);

const digest = digestB && digestB.json;
if (!digest) { console.error('no published digest — nothing to audit against'); process.exit(1); }
const roster = (rosterB && (rosterB.value.roster || (rosterB.json && rosterB.json.roster))) || null;
const teams = (teamsB && teamsB.value && teamsB.value.teams) || null;

const dAgents = digest.agents || [];
const dNot = digest.notCovered || [];
const accounts = Array.isArray(users) ? users : [];
const agentAcc = accounts.filter((u) => u.role === 'agent');
const tlAcc = accounts.filter((u) => u.role === 'team_leader');

H1('1 · FRESHNESS — how old is each store, and do they describe the same day');
const rows = [
  ['kv:roster-current  (Agent List of record)', rosterB && rosterB.meta.updated_at, rosterB && rosterB.meta.updated_by, roster ? Object.keys(roster).length + ' people' : '—'],
  ['kv:agent-teams     (authorisation floor)', teamsB && teamsB.meta.updated_at, teamsB && teamsB.meta.updated_by, teams ? Object.keys(teams).length + ' people' : '—'],
  ['kv:agent-digest    (what the apps render)', digestB && digestB.meta.updated_at, digestB && digestB.meta.updated_by, dAgents.length + ' reported · ' + dNot.length + ' not covered'],
];
for (const [n, t, by, extra] of rows) {
  const a = ageH(t);
  line(n.padEnd(44) + String(t || '?').slice(0, 16) + '  ' + String(a == null ? '?' : a + 'h old').padEnd(10) + (by || '').padEnd(16) + extra);
}
{
  const a = ageH(rosterB && rosterB.meta.updated_at);
  if (a != null && a > 48)
    add('WARN', 'freshness', 'the Agent List of record is ' + a + ' hours old',
      'kv:roster-current was last written ' + String(rosterB.meta.updated_at).slice(0, 16) + '. Every join in the suite resolves through it; a mover is attributed to their OLD leader until it lands.');
  const rAs = rosterB && rosterB.value && rosterB.value.as_of;
  if (rAs) line('roster as_of (the date the list DESCRIBES): ' + rAs);
}

H1('2 · THE AUTHORISATION FLOOR vs THE DIGEST');
/* kv:agent-teams is what portal.mjs merges in wherever the digest lacks a tl —
   it decides which agents a team leader may SEE. A disagreement here is an
   access-control fact, not a reporting one. */
if (!teams) add('ERROR', 'authorisation', 'kv:agent-teams is missing', 'portal.mjs falls back to the digest alone, so a stale PULSE tab can empty a team leader\'s roster.');
else {
  let diff = 0, missing = 0;
  for (const a of dAgents) {
    const t = teams[a.code];
    if (t === undefined) { missing++; continue; }
    const tl = typeof t === 'string' ? t : (t && t.tl);
    if (norm(tl) && norm(tl) !== norm(a.tl)) {
      diff++;
      if (diff <= 6) line('  DISAGREE ' + a.code.padEnd(7) + (a.name || '').padEnd(24) + 'floor="' + norm(tl) + '"  digest="' + norm(a.tl) + '"');
    }
  }
  line(`agents in the digest: ${dAgents.length} · absent from the floor: ${missing} · leader disagrees: ${diff}`);
  if (diff) add('ERROR', 'authorisation', diff + ' agent(s) have a different team leader in kv:agent-teams than in the digest',
    'The floor decides who a team leader may SEE; the digest decides whose numbers they read. While they disagree, one of the two is wrong for those people.');
  if (missing) add('WARN', 'authorisation', missing + ' reported agent(s) are absent from kv:agent-teams',
    'They fall back to the digest\'s own tl, which is published by whichever browser had PULSE open.');
}

H1('3 · TEAM LEADERS — the join the campaign manager view depends on');
/* The control table keys a team on the digest's `tl` string and looks the CB up
   in app_users.team. A leader with agents but no account (or a mismatched team
   string) shows up as a row nobody can drill into and no request can join to. */
const dTls = [...new Set(dAgents.map((a) => norm(a.tl)).filter(Boolean))].sort();
const byTeam = {}; for (const u of tlAcc) if (norm(u.team)) byTeam[norm(u.team)] = u;
line('team leaders WITH agents in the digest: ' + dTls.length);
for (const tl of dTls) {
  const u = byTeam[tl];
  const n = dAgents.filter((a) => norm(a.tl) === tl).length;
  if (!u) {
    line('  NO ACCOUNT  ' + tl.padEnd(24) + n + ' agents');
    add('ERROR', 'team leaders', '"' + tl + '" leads ' + n + ' agents but has no team_leader account',
      'They cannot sign in, and the campaign manager\'s control table has no CB to join their assistance requests to — so their row can never show an open request.');
  } else if (!normCb(u.cb)) {
    add('ERROR', 'team leaders', '"' + tl + '" has an account but no CB number',
      'The request↔team join is the CB number; without it that team falls back to name matching.');
  } else line('  ok          ' + tl.padEnd(24) + n + ' agents · ' + u.username + ' · ' + normCb(u.cb));
}
/* A leader missing from the DIGEST is two different situations and they must not
   be reported as one: leading Vehicle Tracking (real people, deliberately not
   reported by the VAS engine) is nothing like leading nobody at all. Only the
   second is a finding — and it is the state provision-agent-logins deactivates. */
const rosterTls = {};
for (const a of Object.values(roster || {})) {
  const t = norm(a.tl); if (!t) continue;
  (rosterTls[t] = rosterTls[t] || {})[norm(a.campaign) || '?'] = (rosterTls[t][norm(a.campaign) || '?'] || 0) + 1;
}
const idle = tlAcc.filter((u) => norm(u.team) && !dTls.includes(norm(u.team)));
const offEngine = idle.filter((u) => rosterTls[norm(u.team)]);
const teamless = idle.filter((u) => !rosterTls[norm(u.team)]);
for (const u of offEngine)
  line('  off-engine  ' + norm(u.team).padEnd(24) + JSON.stringify(rosterTls[norm(u.team)]) + ' — real team, not reported by the VAS engine');
for (const u of teamless)
  line('  NO TEAM     ' + norm(u.team).padEnd(24) + 'leads nobody on the Agent List');
if (teamless.length) add('WARN', 'team leaders', teamless.length + ' active team leader account(s) lead NOBODY on the Agent List',
  teamless.map((u) => u.username + ' (' + norm(u.team) + ')').join(', ')
  + ' — `node tools/provision-agent-logins.mjs --apply` would DEACTIVATE these. Their CB numbers survive in specs/team_leader_cbs.json, so a team reforming next month restores them.');
if (offEngine.length) add('INFO', 'team leaders', offEngine.length + ' team leader(s) lead only campaigns the VAS engine does not report',
  offEngine.map((u) => norm(u.team) + ' ' + JSON.stringify(rosterTls[norm(u.team)])).join(', ')
  + ' — correct: Vehicle Tracking runs on a different scheme. They are invisible to a campaign manager by design.');

/* the one fact the provisioning tool cannot derive */
try {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'team_leader_cbs.json'), 'utf8'));
  const blank = Object.entries(map).filter(([, v]) => !String(v).trim()).map(([k]) => k);
  if (blank.length) add('ERROR', 'team leaders', blank.length + ' leader(s) have a BLANK CB in specs/team_leader_cbs.json: ' + blank.join(', '),
    'provision-agent-logins skips them, so they cannot sign in. A CB number is the one fact that tool cannot derive from the Agent List — a human has to type it in.');
} catch (e) { add('WARN', 'team leaders', 'specs/team_leader_cbs.json could not be read', String(e.message)); }
/* the drift the CM bug hunt turned up — now only a warning, since the join is on CB */
const drift = tlAcc.filter((u) => norm(u.team) && norm(u.full_name) && norm(u.team) !== norm(u.full_name));
if (drift.length) add('WARN', 'team leaders', drift.length + ' account(s) where full_name ≠ the Agent List team string',
  drift.map((u) => u.username + ': "' + u.full_name + '" vs "' + u.team + '"').join('; ') + ' — harmless now the join is on CB, but the card and the table will print different names for the same person.');

H1('4 · CB NUMBERS — normalisation, duplicates, orphans');
{
  const seen = {}, malformed = [];
  for (const a of dAgents) {
    const c = normCb(a.code);
    if (!c || c !== a.code) malformed.push(a.code);
    (seen[c] = seen[c] || []).push(a.name);
  }
  const dupes = Object.entries(seen).filter(([, v]) => v.length > 1);
  line('distinct CB codes in the digest: ' + Object.keys(seen).length + ' · malformed: ' + malformed.length + ' · duplicated: ' + dupes.length);
  if (malformed.length) add('ERROR', 'identity', malformed.length + ' digest code(s) are not in canonical CB form', malformed.slice(0, 10).join(', '));
  if (dupes.length) add('ERROR', 'identity', dupes.length + ' CB code(s) appear twice in the digest', dupes.map(([k, v]) => k + ' → ' + v.join(' / ')).join('; '));

  /* accounts pointing at a CB the Agent List no longer reports */
  const live = new Set(dAgents.map((a) => a.code));
  const covered = new Set([...live, ...dNot.map((n) => n.code)]);
  const orphan = agentAcc.filter((u) => normCb(u.cb) && !covered.has(normCb(u.cb)) && u.active);
  line('active agent logins: ' + agentAcc.filter((u) => u.active).length + ' · not on the current Agent List at all: ' + orphan.length);
  if (orphan.length) add('WARN', 'identity', orphan.length + ' active agent login(s) are on no current Agent List row',
    orphan.slice(0, 12).map((u) => normCb(u.cb)).join(', ') + (orphan.length > 12 ? ' …' : '') + ' — likely leavers whose login is still open.');

  /* people on the list with no way to sign in */
  const accCb = new Set(agentAcc.map((u) => normCb(u.cb)).filter(Boolean));
  const noLogin = dAgents.filter((a) => !accCb.has(a.code));
  line('reported agents with NO login: ' + noLogin.length);
  if (noLogin.length) add('WARN', 'identity', noLogin.length + ' reported agent(s) have no login',
    noLogin.slice(0, 12).map((a) => a.code + ' ' + a.name).join('; ') + (noLogin.length > 12 ? ' …' : ''));
}

H1('5 · CAMPAIGNS — the canonical set the campaign manager scopes on');
{
  const camps = {};
  for (const a of dAgents) camps[norm(a.campaign) || '(blank)'] = (camps[norm(a.campaign) || '(blank)'] || 0) + 1;
  for (const [k, v] of Object.entries(camps).sort((x, y) => y[1] - x[1])) line(String(v).padStart(4) + '  ' + k);
  const blank = dAgents.filter((a) => !norm(a.campaign));
  if (blank.length) add('ERROR', 'campaigns', blank.length + ' reported agent(s) have no campaign',
    'A campaign manager scopes on this field — an agent with none is invisible to every manager and counted by none.');
  const assign = (cmRules && cmRules[0] && cmRules[0].value) || {};
  const held = new Set(Object.values(assign).flatMap((a) => (a && a.campaigns) || []).map((c) => String(c).toLowerCase()));
  const unheld = Object.keys(camps).filter((c) => c !== '(blank)' && !held.has(c.toLowerCase()));
  line('campaigns held by a campaign manager: ' + [...held].join(', '));
  if (unheld.length) add('WARN', 'campaigns', 'no campaign manager holds: ' + unheld.join(', '),
    'Those agents appear on nobody\'s Campaign Command.');
  const ghost = [...held].filter((c) => !Object.keys(camps).some((k) => k.toLowerCase() === c));
  if (ghost.length) add('WARN', 'campaigns', 'cm:assignments names campaign(s) the Agent List does not report: ' + ghost.join(', '), '');
}

H1('6 · NOT COVERED — people the engine deliberately does not report');
{
  const why = {};
  for (const n of dNot) why[n.why || '?'] = (why[n.why || '?'] || 0) + 1;
  line(dNot.length + ' on the roster but not reported: ' + JSON.stringify(why));
  const noFig = dNot.filter((n) => Object.keys(n).some((k) => !['code', 'name', 'why', 'campaign', 'tl'].includes(k)));
  if (noFig.length) add('ERROR', 'privacy', noFig.length + ' notCovered row(s) carry fields beyond code/name/why/campaign/tl',
    'No FIGURES may travel for these people: ' + JSON.stringify(noFig[0]));
  else line('no figures travel for them — payload shape is clean');
}

/* ------------------------------------------------------------------ report */
H1('FINDINGS');
const order = { ERROR: 0, WARN: 1, INFO: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
if (!findings.length) console.log('  none — every store agrees.');
for (const f of findings) {
  const c = f.sev === 'ERROR' ? '\x1b[31m' : f.sev === 'WARN' ? '\x1b[33m' : '\x1b[36m';
  console.log(`  ${c}${f.sev}\x1b[0m [${f.area}] ${f.what}`);
  if (f.detail) console.log('        ' + f.detail);
}
const errs = findings.filter((f) => f.sev === 'ERROR').length;
console.log(`\n${findings.length} finding(s): ${errs} error, ${findings.filter((f) => f.sev === 'WARN').length} warning, ${findings.filter((f) => f.sev === 'INFO').length} info`);
process.exit(errs ? 1 : 0);
