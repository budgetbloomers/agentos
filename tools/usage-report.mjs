#!/usr/bin/env node
/**
 * usage-report.mjs — the AgentOS USAGE report as a PDF: who signs in, how often, which teams
 * have adopted the suite and who has gone quiet.
 *
 *   node tools/usage-report.mjs --export usage.json        # from reports/usage/usage-export.sql output
 *   node tools/usage-report.mjs                            # live, via supabase.env (Nick's PC)
 *   options: --from YYYY-MM-DD  --to YYYY-MM-DD  --out reports/usage/out  --unmask  --html-only
 *
 * TWO INPUTS, ONE SHAPE. The SQL export (run in the Supabase SQL editor, so the secret key never
 * leaves the dashboard) and the live REST pull both end as the same document — users, per-day
 * auth events, per-day saves, live sessions, the roster — and everything below reads only that.
 * The live path aggregates in JS exactly as the SQL does (SAST day = UTC + 2h, no DST).
 *
 * WHAT IT CAN AND CANNOT SEE. Usage is measured from auth_log (login_ok = an AgentOS sign-in;
 * wimpy_signin_ok is the lunch app and is kept apart), kv_write_log (management saves) and
 * app_sessions. Nothing records which page or tab a person opened, and Help Center requests
 * live in HighLevel — the report says so on its last page rather than implying either.
 *
 * Agent names are MASKED by default (non-negotiable 10); --unmask prints them in full.
 * Read-only: never writes to Supabase.
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const flag = (k) => argv.includes('--' + k);
const TZ_MS = 2 * 3600000;                                   // Africa/Johannesburg, no DST
const sastDay = (iso) => new Date(Date.parse(iso) + TZ_MS).toISOString().slice(0, 10);
const sastTime = (iso) => new Date(Date.parse(iso) + TZ_MS).toISOString().slice(11, 19);
const todaySast = () => sastDay(new Date().toISOString());
const normCB = (s) => { const m = String(s || '').match(/^\s*cb[\s-]*0*(\d{1,5})\s*$/i); return m ? 'CB' + m[1] : ''; };

/* ------------------------------------------------------------------ input */
async function fromLive(since) {
  const envFile = path.join(ROOT, 'supabase.env');
  if (!fs.existsSync(envFile)) throw new Error('no supabase.env — run the SQL export instead and pass --export <file>');
  const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const REST = env.SUPABASE_URL + '/rest/v1/';
  const all = async (q) => {                                  // PostgREST caps a page; walk it
    const out = [];
    for (let off = 0; ; off += 1000) {
      const r = await fetch(REST + q + (q.includes('?') ? '&' : '?') + `limit=1000&offset=${off}`, { headers: H });
      if (!r.ok) throw new Error(q.split('?')[0] + ' → ' + r.status + ': ' + (await r.text()).slice(0, 160));
      const page = await r.json(); out.push(...page);
      if (page.length < 1000) return out;
    }
  };
  const sinceIso = new Date(Date.parse(since + 'T00:00:00Z') - TZ_MS).toISOString();
  const users = await all('app_users?select=id,username,full_name,role,team,apps,active,cb,password_is_default,password_changed_at,last_login,created_at&order=username');
  const byId = new Map(users.map((u) => [u.id, u.username]));
  const logs = await all(`auth_log?at=gte.${sinceIso}&select=user_id,username,event,at&order=at.asc`);
  const writes = await all(`kv_write_log?at=gte.${sinceIso}&select=username,key,bytes,at&order=at.asc`);
  const sess = await all(`app_sessions?expires_at=gt.${new Date().toISOString()}&select=user_id,scope,created_at`);
  const opened = await all("rules?key=eq.kv:app-opened&select=value");
  const roster = await all('active_agents?select=cb,agent_name,campaign,tenure,team_leader,username,has_account,list_as_of');
  const logins = new Map();
  for (const a of logs) {
    const username = byId.get(a.user_id) || a.username, day = sastDay(a.at), t = sastTime(a.at), k = username + '|' + a.event + '|' + day;
    const cur = logins.get(k) || { username, event: a.event, day, n: 0, first_at: t, last_at: t };
    cur.n++; if (t < cur.first_at) cur.first_at = t; if (t > cur.last_at) cur.last_at = t; logins.set(k, cur);
  }
  const saves = new Map();
  for (const w of writes) {
    const day = sastDay(w.at), k = w.username + '|' + w.key + '|' + day;
    const cur = saves.get(k) || { username: w.username, key: w.key, day, n: 0, bytes: 0 };
    cur.n++; cur.bytes += w.bytes || 0; saves.set(k, cur);
  }
  const live = new Map();
  for (const s of sess) {
    const username = byId.get(s.user_id) || '?', k = username + '|' + s.scope;
    const cur = live.get(k) || { username, scope: s.scope, n: 0, newest: s.created_at };
    cur.n++; if (s.created_at > cur.newest) cur.newest = s.created_at; live.set(k, cur);
  }
  return { generated_at: new Date().toISOString(), since: sinceIso, users, logins: [...logins.values()], saves: [...saves.values()],
    live_sessions: [...live.values()], app_opened: opened[0] ? opened[0].value : null,
    roster: roster.map((r) => ({ cb: r.cb, name: r.agent_name, campaign: r.campaign, tenure: r.tenure, team_leader: r.team_leader,
      username: r.username, has_account: r.has_account, list_as_of: r.list_as_of })) };
}

function fromExport(file) {
  let txt = fs.readFileSync(file, 'utf8').trim();
  /* "Download CSV" from the SQL editor wraps the one cell in a header + quotes */
  if (!txt.startsWith('{')) {
    const i = txt.indexOf('{'); txt = txt.slice(i).replace(/"\s*$/, '').replace(/""/g, '"');
  }
  return JSON.parse(txt);
}

/* --------------------------------------------------------------- analysis */
const ROLE_GROUP = (r) => r === 'agent' ? 'agent' : (r === 'team_leader' || r === 'leader') ? 'tl'
  : r === 'campaign_manager' ? 'cm' : 'mgmt';
const GROUP_LABEL = { agent: 'Agents', tl: 'Team leaders', cm: 'Campaign managers', mgmt: 'Management & admin' };
const isWeekday = (d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w >= 1 && w <= 5; };
const daysBetween = (a, b) => { const out = []; for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z'); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const pct = (a, b) => b ? Math.round((a / b) * 100) : null;
const mondayOf = (d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); };

function analyse(doc, from, to) {
  const users = doc.users || [];
  const byName = new Map(users.map((u) => [u.username, u]));
  const days = daysBetween(from, to), weekdays = days.filter(isWeekday);
  const inP = (d) => d >= from && d <= to;
  const last7 = new Set(daysBetween(addDays(to, -6), to)), last14from = addDays(to, -13);

  /* who signed in on which day (AgentOS only; Wimpy apart) */
  const signDays = new Map(), wimpyDays = new Map(), firstHour = new Array(24).fill(0);
  let fails = 0, locks = 0; const failUsers = new Map();
  for (const l of doc.logins || []) {
    if (!inP(l.day)) continue;
    if (l.event === 'login_ok') {
      (signDays.get(l.username) || signDays.set(l.username, new Set()).get(l.username)).add(l.day);
      const h = parseInt(String(l.first_at || '').slice(0, 2), 10); if (h >= 0 && h < 24) firstHour[h]++;
    } else if (l.event === 'wimpy_signin_ok') {
      (wimpyDays.get(l.username) || wimpyDays.set(l.username, new Set()).get(l.username)).add(l.day);
    } else if (String(l.event).startsWith('login_fail')) { fails += l.n; failUsers.set(l.username, (failUsers.get(l.username) || 0) + l.n); }
    else if (l.event === 'locked') locks += l.n;
  }
  const lastSign = (u) => { const s = signDays.get(u); return s && s.size ? [...s].sort().pop() : null; };

  /* agents = the current Agent List, joined to their login */
  const agentUser = new Map();
  for (const u of users) if (u.role === 'agent') agentUser.set(normCB(u.cb || u.username), u);
  const roster = (doc.roster || []).map((r) => {
    const cb = normCB(r.cb) || r.cb, u = (r.username && byName.get(r.username)) || agentUser.get(cb) || null;
    const uname = u ? u.username : r.username;
    const sd = (uname && signDays.get(uname)) || new Set();
    const wdays = [...sd].filter(isWeekday).length;
    const ever = u ? u.last_login : null;
    const last = lastSign(uname) || (ever ? sastDay(ever) : null);
    return { cb, name: r.name, campaign: r.campaign || '—', tenure: r.tenure || '—', tl: r.team_leader || '(no leader)',
      hasAccount: !!(r.has_account || u), active: u ? u.active !== false : false, user: u, days: sd.size, wdays,
      active7: [...sd].some((d) => last7.has(d)), last, neverEver: !!u && !ever && sd.size === 0,
      defaultPw: !!(u && u.password_is_default) };
  });
  const status = (a) => !a.hasAccount ? 'No account' : a.neverEver ? 'Never signed in'
    : a.active7 ? 'Active (7 days)' : (a.last && a.last >= last14from) ? 'Quiet 8–14 days' : 'Dormant 14+ days';
  for (const a of roster) a.status = status(a);

  /* daily active users by group */
  const daily = days.map((d) => {
    const row = { day: d, agent: 0, tl: 0, cm: 0, mgmt: 0, wimpy: 0 };
    for (const [u, set] of signDays) if (set.has(d)) { const usr = byName.get(u); row[ROLE_GROUP(usr ? usr.role : (normCB(u) ? 'agent' : 'admin'))]++; }
    for (const set of wimpyDays.values()) if (set.has(d)) row.wimpy++;
    return row;
  });
  const weeks = new Map();
  for (const r of daily) {
    const wk = mondayOf(r.day), w = weeks.get(wk) || { week: wk, wd: 0, agent: 0, tl: 0, cm: 0, mgmt: 0, uniq: new Set() };
    if (isWeekday(r.day)) { w.wd++; w.agent += r.agent; w.tl += r.tl; w.cm += r.cm; w.mgmt += r.mgmt; }
    weeks.set(wk, w);
  }
  for (const [u, set] of signDays) { const usr = byName.get(u); if (!usr || usr.role !== 'agent') continue;
    for (const d of set) { const w = weeks.get(mondayOf(d)); if (w) w.uniq.add(u); } }

  /* rollups by team leader and by campaign */
  const rollup = (key) => {
    const m = new Map();
    for (const a of roster) {
      const k = a[key], g = m.get(k) || { key: k, n: 0, acct: 0, ever: 0, a7: 0, dormant: 0, noacct: 0, wdays: 0 };
      g.n++; if (a.hasAccount) g.acct++; else g.noacct++; if (a.days > 0) g.ever++; if (a.active7) g.a7++;
      if (a.status === 'Dormant 14+ days' || a.status === 'Never signed in') g.dormant++; g.wdays += a.wdays; m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, p7: pct(g.a7, g.n), pEver: pct(g.ever, g.n),
      rate: g.n && weekdays.length ? Math.round((g.wdays / (g.n * weekdays.length)) * 100) : null }))
      .sort((x, y) => (y.p7 ?? -1) - (x.p7 ?? -1) || y.n - x.n);
  };
  const byTL = rollup('tl'), byCamp = rollup('campaign');

  /* team leaders' own use, joined to their team's numbers */
  const tlUsers = users.filter((u) => ROLE_GROUP(u.role) === 'tl');
  const tlRows = tlUsers.map((u) => {
    const sd = signDays.get(u.username) || new Set(), team = byTL.find((t) => [u.team, u.full_name].filter(Boolean)
      .some((n) => String(n).trim().toLowerCase() === String(t.key).trim().toLowerCase()));
    return { name: u.full_name || u.username, username: u.username, active: u.active !== false, wdays: [...sd].filter(isWeekday).length,
      rate: pct([...sd].filter(isWeekday).length, weekdays.length), last: lastSign(u.username) || (u.last_login ? sastDay(u.last_login) : null),
      team: team || null };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  const leadersWithoutLogin = byTL.filter((t) => t.key !== '(no leader)' && !tlRows.some((r) => r.team === t));

  /* management, campaign managers: sign-ins + saves */
  const savesBy = new Map(), savesKey = new Map();
  for (const s of doc.saves || []) { if (!inP(s.day)) continue;
    savesBy.set(s.username, (savesBy.get(s.username) || 0) + s.n); savesKey.set(s.key, (savesKey.get(s.key) || 0) + s.n); }
  const staff = users.filter((u) => ['cm', 'mgmt'].includes(ROLE_GROUP(u.role))).map((u) => {
    const sd = signDays.get(u.username) || new Set();
    return { name: u.full_name || u.username, username: u.username, role: u.role, apps: (u.apps || []).join(', '), active: u.active !== false,
      days: sd.size, wdays: [...sd].filter(isWeekday).length, last: lastSign(u.username) || (u.last_login ? sastDay(u.last_login) : null),
      saves: savesBy.get(u.username) || 0 };
  }).sort((a, b) => b.days - a.days || b.saves - a.saves);

  /* trend: last 5 weekdays vs the 5 before */
  const wdDaily = daily.filter((r) => isWeekday(r.day));
  const avg = (rows) => rows.length ? rows.reduce((s, r) => s + r.agent, 0) / rows.length : null;
  const recent = avg(wdDaily.slice(-5)), prior = avg(wdDaily.slice(-10, -5));

  const accts = roster.filter((a) => a.hasAccount).length;
  const groups = {};
  for (const u of users) { const g = ROLE_GROUP(u.role); groups[g] = groups[g] || { total: 0, active: 0, signed: 0 };
    groups[g].total++; if (u.active !== false) groups[g].active++; if (signDays.has(u.username)) groups[g].signed++; }
  return {
    from, to, days, weekdays, generatedAt: doc.generated_at, listAsOf: (doc.roster || []).map((r) => r.list_as_of).filter(Boolean).sort().pop() || null,
    roster, byTL, byCamp, tlRows, leadersWithoutLogin, staff, daily, weeks: [...weeks.values()], firstHour, groups,
    savesKey: [...savesKey.entries()].sort((a, b) => b[1] - a[1]),
    totals: { agents: roster.length, accts, ever: roster.filter((a) => a.days > 0).length, a7: roster.filter((a) => a.active7).length,
      noacct: roster.filter((a) => !a.hasAccount).length, never: roster.filter((a) => a.status === 'Never signed in').length,
      dormant: roster.filter((a) => a.status === 'Dormant 14+ days').length, quiet: roster.filter((a) => a.status === 'Quiet 8–14 days').length,
      defaultPw: roster.filter((a) => a.defaultPw).length, fails, locks, failUsers: [...failUsers.entries()].sort((a, b) => b[1] - a[1]),
      wimpyUsers: wimpyDays.size, wimpyDays: daily.reduce((s, r) => s + r.wimpy, 0),
      agentRate: roster.length && weekdays.length ? Math.round(roster.reduce((s, a) => s + a.wdays, 0) / (roster.length * weekdays.length) * 100) : null,
      recent, prior, live: (doc.live_sessions || []).filter((s) => s.scope !== 'wimpy').reduce((s, x) => s + x.n, 0) },
    appOpened: doc.app_opened || null,
  };
}

/* ------------------------------------------------------------------ render */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UNMASK = flag('unmask');
const mask = (n) => { if (!n) return '—'; if (UNMASK) return String(n); return String(n).trim().split(/\s+/).map((p, i) => i === 0 ? p[0] + '.' : p.slice(0, 2) + '•••').join(' '); };
const fmtD = (d) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const fmtLong = (d) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
const P = (v) => v == null ? '—' : v + '%';
const rag = (v, g, a) => v == null ? 'n' : v >= g ? 'g' : v >= a ? 'a' : 'r';
const C = { agent: '#2563eb', tl: '#0d9488', cm: '#d97706', mgmt: '#7c3aed' };

function barChart(daily) {                                       // stacked daily active users
  const W = 720, H = 220, pad = { l: 34, r: 8, t: 10, b: 34 };
  const keys = ['agent', 'tl', 'cm', 'mgmt'], max = Math.max(1, ...daily.map((r) => keys.reduce((s, k) => s + r[k], 0)));
  const step = (W - pad.l - pad.r) / Math.max(1, daily.length), bw = Math.max(2, step * 0.72), y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ticks = [0, Math.round(max / 2), max];
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily active users">`;
  for (const t of ticks) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e7eb"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${t}</text>`;
  daily.forEach((r, i) => {
    let base = 0; const x = pad.l + i * step + (step - bw) / 2;
    for (const k of keys) { if (!r[k]) continue; s += `<rect x="${x.toFixed(1)}" y="${y(base + r[k]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + r[k])).toFixed(1)}" fill="${C[k]}"${isWeekday(r.day) ? '' : ' opacity=".45"'}/>`; base += r[k]; }
    const dt = new Date(r.day + 'T00:00:00Z');
    if (dt.getUTCDay() === 1 || i === 0) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - pad.b + 14}" text-anchor="middle" class="ax">${esc(fmtD(r.day))}</text>`;
  });
  return s + '</svg>';
}
function hBars(rows, valKey, labelFn, max = 100) {
  const H = 18, W = 720, lw = 190;
  let s = `<svg viewBox="0 0 ${W} ${rows.length * (H + 6) + 4}" width="100%">`;
  rows.forEach((r, i) => {
    const v = r[valKey] ?? 0, y = i * (H + 6) + 2, w = ((W - lw - 50) * v) / max, col = { g: '#16a34a', a: '#d97706', r: '#dc2626', n: '#9ca3af' }[rag(r[valKey], 70, 40)];
    s += `<text x="${lw - 8}" y="${y + 13}" text-anchor="end" class="lb">${esc(labelFn(r))}</text><rect x="${lw}" y="${y}" width="${W - lw - 50}" height="${H}" fill="#f3f4f6" rx="3"/>` +
      `<rect x="${lw}" y="${y}" width="${Math.max(0, w).toFixed(1)}" height="${H}" fill="${col}" rx="3"/><text x="${lw + Math.max(0, w) + 6}" y="${y + 13}" class="lb">${P(r[valKey])}</text>`;
  });
  return s + '</svg>';
}
function hourChart(h) {
  const W = 720, H = 120, max = Math.max(1, ...h), bw = (W - 40) / 24;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  h.forEach((v, i) => { const bh = (v / max) * (H - 30); s += `<rect x="${20 + i * bw + 2}" y="${H - 18 - bh}" width="${bw - 4}" height="${bh}" fill="#2563eb" opacity="${v ? 1 : .15}"/>` +
    (i % 3 === 0 ? `<text x="${20 + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle" class="ax">${String(i).padStart(2, '0')}:00</text>` : ''); });
  return s + '</svg>';
}

function findings(A) {
  const t = A.totals, out = [];
  out.push(`<b>${t.ever} of ${t.agents} agents</b> on the current Agent List (${P(pct(t.ever, t.agents))}) signed in to AgentOS at least once between ${fmtD(A.from)} and ${fmtD(A.to)}; <b>${t.a7}</b> (${P(pct(t.a7, t.agents))}) signed in during the last 7 days.`);
  if (t.agentRate != null) out.push(`On an average weekday, agents signed in on <b>${P(t.agentRate)}</b> of possible agent-days (${A.weekdays.length} weekdays in the period).`);
  if (t.recent != null && t.prior != null) {
    const d = t.recent - t.prior, dir = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down';
    out.push(`Agent daily active users are <b>${dir}</b>: ${t.recent.toFixed(1)} a weekday over the last 5 weekdays vs ${t.prior.toFixed(1)} the 5 before.`);
  }
  const ranked = A.byTL.filter((x) => x.key !== '(no leader)' && x.n >= 3);
  if (ranked.length >= 2) {
    const top = ranked[0], low = ranked[ranked.length - 1];
    out.push(`Strongest team adoption: <b>${esc(top.key)}</b> (${P(top.p7)} active in 7 days). Weakest: <b>${esc(low.key)}</b> (${P(low.p7)}).`);
  }
  const gap = t.noacct + t.never + t.dormant;
  if (gap) out.push(`<b>${gap} agents</b> are not using the system: ${t.noacct} have no account, ${t.never} have an account but have never signed in, ${t.dormant} have not signed in for 14+ days (named on the follow-up page).`);
  const tlLow = A.tlRows.filter((r) => r.rate != null && r.rate < 50 && r.active);
  if (tlLow.length) out.push(`<b>${tlLow.length} team leader${tlLow.length > 1 ? 's' : ''}</b> signed in on fewer than half of weekdays — a team rarely uses the system more than its leader does.`);
  if (A.leadersWithoutLogin.length) out.push(`${A.leadersWithoutLogin.length} leader${A.leadersWithoutLogin.length > 1 ? 's' : ''} on the Agent List ha${A.leadersWithoutLogin.length > 1 ? 've' : 's'} no team-leader login: ${A.leadersWithoutLogin.map((x) => esc(x.key)).join(', ')}.`);
  if (t.defaultPw) out.push(`${t.defaultPw} agent accounts still carry the default password.`);
  return out;
}

function recommendations(A) {
  const t = A.totals, r = [];
  if (t.noacct) r.push(`Provision the <b>${t.noacct}</b> agents with no account — check the Agent List publish log (agent_sync_logs) for why they were not created.`);
  if (t.never) r.push(`Have each team leader walk the <b>${t.never}</b> never-signed-in agents through their first sign-in (CB number + default password) at the next huddle.`);
  if (t.dormant) r.push(`Follow up the <b>${t.dormant}</b> dormant agents by name with their team leader this week; the list is on the follow-up page.`);
  const tlLow = A.tlRows.filter((x) => x.rate != null && x.rate < 50 && x.active);
  if (tlLow.length) r.push(`Set a daily sign-in expectation for team leaders (${tlLow.map((x) => esc(x.name)).join(', ')} are under 50% of weekdays): open the Team Results view at the start of every shift.`);
  const low = A.byTL.filter((x) => x.key !== '(no leader)' && x.n >= 3 && (x.p7 ?? 0) < 40);
  if (low.length) r.push(`Target the lowest-adoption teams first (${low.map((x) => esc(x.key)).join(', ')}): a 10-minute floor demo of the Agent View, the Help Center and their own score.`);
  if (t.defaultPw) r.push(`Prompt the ${t.defaultPw} agents still on the default password to change it — it is both a security gap and a sign the account has barely been used.`);
  r.push('Re-run this report weekly and track the "active in 7 days" figure per team as the adoption KPI.');
  return r;
}

function render(A) {
  const t = A.totals;
  const tile = (v, l, sub, cls = '') => `<div class="tile ${cls}"><div class="v">${v}</div><div class="l">${l}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const statusOrder = ['No account', 'Never signed in', 'Dormant 14+ days', 'Quiet 8–14 days'];
  const follow = A.roster.filter((a) => statusOrder.includes(a.status))
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || String(a.tl).localeCompare(b.tl) || String(a.cb).localeCompare(b.cb));
  const statusCls = { 'No account': 'r', 'Never signed in': 'r', 'Dormant 14+ days': 'a', 'Quiet 8–14 days': 'a' };
  const teamTable = (rows, head) => `<table><thead><tr><th>${head}</th><th class="n">Agents</th><th class="n">With login</th><th class="n">Signed in (period)</th><th class="n">Active 7 days</th><th class="n">Weekday sign-in rate</th><th class="n">Not using</th></tr></thead><tbody>` +
    rows.map((g) => `<tr><td>${esc(g.key)}</td><td class="n">${g.n}</td><td class="n">${g.acct}</td><td class="n">${g.ever} <span class="m">(${P(g.pEver)})</span></td>` +
      `<td class="n"><span class="pill ${rag(g.p7, 70, 40)}">${P(g.p7)}</span></td><td class="n">${P(g.rate)}</td><td class="n">${g.dormant + g.noacct}</td></tr>`).join('') + '</tbody></table>';
  const opened = A.appOpened ? Object.entries(A.appOpened).map(([k, v]) => `${esc(k)}: ${esc(String(v).slice(0, 16).replace('T', ' '))} UTC`).join(' · ') : '—';
  const g = A.groups;

  return `<!doctype html><html><head><meta charset="utf-8"><title>AgentOS Usage Report</title><style>
  @page{size:A4;margin:14mm 13mm 16mm}
  *{box-sizing:border-box} body{font:10.5px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111827;margin:0}
  h1{font-size:24px;margin:0 0 2px} h2{font-size:15px;margin:0 0 8px;padding-bottom:4px;border-bottom:2px solid #111827}
  h3{font-size:12px;margin:14px 0 6px} .sub{color:#6b7280;font-size:11px} .m{color:#6b7280}
  section{page-break-before:always} section.first{page-break-before:auto}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
  .tile{border:1px solid #e5e7eb;border-radius:8px;padding:10px} .tile .v{font-size:22px;font-weight:700} .tile .l{font-weight:600}
  .tile .s{color:#6b7280;font-size:9.5px} .tile.r{border-color:#fca5a5;background:#fef2f2} .tile.g{border-color:#86efac;background:#f0fdf4} .tile.a{border-color:#fcd34d;background:#fffbeb}
  table{width:100%;border-collapse:collapse;margin:4px 0 10px;page-break-inside:auto} tr{page-break-inside:avoid}
  th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;color:#374151;border-bottom:1px solid #9ca3af;padding:4px 5px}
  td{border-bottom:1px solid #e5e7eb;padding:3.5px 5px} .n{text-align:right;white-space:nowrap}
  .pill{display:inline-block;padding:1px 7px;border-radius:9px;font-weight:600;font-size:9.5px}
  .pill.g{background:#dcfce7;color:#166534} .pill.a{background:#fef3c7;color:#92400e} .pill.r{background:#fee2e2;color:#991b1b} .pill.n{background:#f3f4f6;color:#6b7280}
  ul{margin:4px 0 10px;padding-left:18px} li{margin:3px 0}
  .box{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:10px 0} .box.key{background:#f9fafb}
  .legend span{display:inline-block;margin-right:12px} .legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
  svg .ax{font-size:9px;fill:#6b7280} svg .lb{font-size:10px;fill:#111827}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  td:first-child{white-space:nowrap}
  </style></head><body>

  <section class="first">
    <div class="sub">The Chatterbox · AgentOS</div>
    <h1>Usage report</h1>
    <div class="sub">${esc(fmtLong(A.from))} – ${esc(fmtLong(A.to))} · ${A.weekdays.length} weekdays · data pulled ${esc(String(A.generatedAt || '').slice(0, 16).replace('T', ' '))} UTC${A.listAsOf ? ' · Agent List as of ' + esc(fmtLong(String(A.listAsOf).slice(0, 10))) : ''} · Internal${UNMASK ? ' · agent names UNMASKED' : ' · agent names masked'}</div>
    <div class="tiles">
      ${tile(t.agents, 'Agents on the list', `${t.accts} with a login`)}
      ${tile(P(pct(t.ever, t.agents)), 'Signed in at least once', `${t.ever} agents in the period`, rag(pct(t.ever, t.agents), 80, 50))}
      ${tile(P(pct(t.a7, t.agents)), 'Active in last 7 days', `${t.a7} agents`, rag(pct(t.a7, t.agents), 70, 40))}
      ${tile(P(t.agentRate), 'Weekday sign-in rate', 'agent-days signed in ÷ possible', rag(t.agentRate, 60, 30))}
      ${tile(t.noacct + t.never + t.dormant, 'Agents not using it', `${t.noacct} no login · ${t.never} never · ${t.dormant} dormant`, (t.noacct + t.never + t.dormant) ? 'r' : 'g')}
      ${tile(`${(g.tl || {}).signed || 0}/${(g.tl || {}).total || 0}`, 'Team leaders signed in', 'at least once in the period')}
      ${tile(`${((g.cm || {}).signed || 0) + ((g.mgmt || {}).signed || 0)}/${((g.cm || {}).total || 0) + ((g.mgmt || {}).total || 0)}`, 'Managers & admins signed in', 'at least once in the period')}
      ${tile(t.live, 'Live sessions now', 'unexpired AgentOS sessions')}
    </div>
    <div class="box key"><h3 style="margin-top:0">Key findings</h3><ul>${findings(A).map((f) => `<li>${f}</li>`).join('')}</ul></div>
    <div class="box"><h3 style="margin-top:0">Recommended actions</h3><ol style="margin:4px 0;padding-left:18px">${recommendations(A).map((f) => `<li>${f}</li>`).join('')}</ol></div>
  </section>

  <section>
    <h2>Daily activity</h2>
    <div class="sub">Distinct people who signed in to AgentOS each day (SAST). Weekends are faded. Wimpy lunch sign-ins are excluded.</div>
    <div class="legend" style="margin:8px 0">${['agent', 'tl', 'cm', 'mgmt'].map((k) => `<span><i style="background:${C[k]}"></i>${GROUP_LABEL[k]}</span>`).join('')}</div>
    ${barChart(A.daily)}
    <h3>By week (weekday averages)</h3>
    <table><thead><tr><th>Week of</th><th class="n">Weekdays</th><th class="n">Agents / day</th><th class="n">Team leaders / day</th><th class="n">Campaign mgrs / day</th><th class="n">Management / day</th><th class="n">Distinct agents in week</th><th class="n">% of list</th></tr></thead><tbody>
    ${A.weeks.map((w) => `<tr><td>${esc(fmtD(w.week))}</td><td class="n">${w.wd}</td>${['agent', 'tl', 'cm', 'mgmt'].map((k) => `<td class="n">${w.wd ? (w[k] / w.wd).toFixed(1) : '—'}</td>`).join('')}<td class="n">${w.uniq.size}</td><td class="n">${P(pct(w.uniq.size, t.agents))}</td></tr>`).join('')}
    </tbody></table>
    <h3>Time of first sign-in (all users, SAST)</h3>
    ${hourChart(A.firstHour)}
  </section>

  <section>
    <h2>Adoption by team leader</h2>
    <div class="sub">Agents grouped by the leader on the current Agent List. "Active 7 days" = signed in at least once in the 7 days to ${esc(fmtD(A.to))}. "Not using" = no login, never signed in, or dormant 14+ days.</div>
    <h3>Active in the last 7 days</h3>
    ${hBars(A.byTL.filter((x) => x.n > 0), 'p7', (r) => `${r.key} (${r.n})`)}
    ${teamTable(A.byTL, 'Team leader')}
    <h3>By campaign</h3>
    ${teamTable(A.byCamp, 'Campaign')}
  </section>

  <section>
    <h2>Leaders and managers</h2>
    <h3>Team leaders' own use</h3>
    <table><thead><tr><th>Team leader</th><th>Login</th><th class="n">Weekdays signed in</th><th class="n">Rate</th><th>Last sign-in</th><th class="n">Team size</th><th class="n">Team active 7 days</th></tr></thead><tbody>
    ${A.tlRows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.username)}${r.active ? '' : ' <span class="pill n">disabled</span>'}</td><td class="n">${r.wdays} / ${A.weekdays.length}</td><td class="n"><span class="pill ${rag(r.rate, 70, 40)}">${P(r.rate)}</span></td><td>${esc(fmtD(r.last))}</td><td class="n">${r.team ? r.team.n : '—'}</td><td class="n">${r.team ? P(r.team.p7) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="m">No team-leader accounts.</td></tr>'}
    </tbody></table>
    ${A.leadersWithoutLogin.length ? `<div class="m">Leaders on the Agent List with no matching team-leader login: ${A.leadersWithoutLogin.map((x) => esc(x.key) + ' (' + x.n + ' agents)').join(', ')}.</div>` : ''}
    <h3>Campaign managers, management and admin</h3>
    <table><thead><tr><th>Name</th><th>Role</th><th>Apps</th><th class="n">Days signed in</th><th class="n">Weekdays</th><th>Last sign-in</th><th class="n">Data saves</th></tr></thead><tbody>
    ${A.staff.map((r) => `<tr><td>${esc(r.name)}${r.active ? '' : ' <span class="pill n">disabled</span>'}</td><td>${esc(r.role)}</td><td>${esc(r.apps)}</td><td class="n">${r.days}</td><td class="n">${r.wdays}</td><td>${esc(fmtD(r.last))}</td><td class="n">${r.saves}</td></tr>`).join('') || '<tr><td colspan="7" class="m">None.</td></tr>'}
    </tbody></table>
    <h3>Data saves by store (management apps)</h3>
    <table><thead><tr><th>Store</th><th class="n">Acknowledged saves in period</th></tr></thead><tbody>
    ${A.savesKey.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n">${n}</td></tr>`).join('') || '<tr><td colspan="2" class="m">No saves recorded in the period.</td></tr>'}
    </tbody></table>
  </section>

  <section>
    <h2>Agents to follow up</h2>
    <div class="sub">Every agent on the current Agent List who is not actively using AgentOS, grouped by reason, then team leader. ${follow.length} agents. ${UNMASK ? '' : 'Names are masked; the CB number identifies the agent.'}</div>
    <table><thead><tr><th>Status</th><th>CB</th><th>Agent</th><th>Team leader</th><th>Campaign</th><th>Tenure</th><th>Last sign-in</th></tr></thead><tbody>
    ${follow.map((a) => `<tr><td><span class="pill ${statusCls[a.status]}">${esc(a.status)}</span></td><td>${esc(a.cb)}</td><td>${esc(mask(a.name))}</td><td>${esc(a.tl)}</td><td>${esc(a.campaign)}</td><td>${esc(a.tenure)}</td><td>${esc(fmtD(a.last))}</td></tr>`).join('') || '<tr><td colspan="7" class="m">Every agent on the list signed in during the last 7 days.</td></tr>'}
    </tbody></table>
  </section>

  <section>
    <h2>Account health and other apps</h2>
    <div class="cols">
      <div class="box"><h3 style="margin-top:0">Sign-in problems (period)</h3><ul>
        <li><b>${t.fails}</b> failed sign-ins, <b>${t.locks}</b> attempts refused while locked out.</li>
        ${t.failUsers.slice(0, 8).map(([u, n]) => `<li>${esc(normCB(u) ? u : u)} — ${n} failed</li>`).join('')}
      </ul></div>
      <div class="box"><h3 style="margin-top:0">Passwords</h3><ul>
        <li><b>${t.defaultPw}</b> agent accounts still on the default password.</li>
        <li><b>${t.never}</b> agent accounts have never been signed in to.</li></ul></div>
      <div class="box"><h3 style="margin-top:0">Wimpy lunch app</h3><ul>
        <li><b>${t.wimpyUsers}</b> ${t.wimpyUsers === 1 ? 'person' : 'people'} signed in to Wimpy in the period (${t.wimpyDays} person-day${t.wimpyDays === 1 ? '' : 's'}).</li>
        <li>Counted separately: a Wimpy sign-in reaches only the lunch app.</li></ul></div>
      <div class="box"><h3 style="margin-top:0">Last app opens recorded</h3><div>${opened}</div></div>
    </div>
    <h3>Status of every agent on the list</h3>
    <table><thead><tr><th>Status</th><th class="n">Agents</th><th class="n">Share</th></tr></thead><tbody>
    ${['Active (7 days)', 'Quiet 8–14 days', 'Dormant 14+ days', 'Never signed in', 'No account'].map((s) => { const n = A.roster.filter((a) => a.status === s).length; return `<tr><td>${s}</td><td class="n">${n}</td><td class="n">${P(pct(n, t.agents))}</td></tr>`; }).join('')}
    </tbody></table>
    <h3>How this report is measured</h3><ul>
      <li><b>Sign-in</b> = a successful AgentOS login (auth_log <code>login_ok</code>), one per person per SAST day however many times they signed in. A long-lived session that never re-logs in counts only on the day it started, so active use can be slightly higher than shown.</li>
      <li><b>Agents</b> = the current Agent List (active_agents), joined to their login by CB number. Agents who left are not counted.</li>
      <li><b>Weekday sign-in rate</b> = agent-days with a sign-in ÷ (agents × weekdays in the period). Saturdays are not counted as working days.</li>
      <li><b>Not measured:</b> which pages or tabs people open (AgentOS does not log page views), time spent in the app, and Help Center requests (those live in HighLevel, not in this database).</li>
    </ul>
  </section>
  </body></html>`;
}

/* -------------------------------------------------------------------- main */
function findChrome() {
  const c = [process.env.CHROME, '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
  /* Playwright's headless shell first: full Chromium under --headless=new can sit forever in a
     container after printing; the shell exits cleanly */
  if (fs.existsSync('/opt/pw-browsers')) for (const d of fs.readdirSync('/opt/pw-browsers'))
    c.unshift(`/opt/pw-browsers/${d}/chrome-headless-shell-linux64/chrome-headless-shell`), c.push(`/opt/pw-browsers/${d}/chrome-linux64/chrome`);
  return c.find((p) => p && fs.existsSync(p)) || null;
}

const exportFile = opt('export');
const to = opt('to') || todaySast();
const defFrom = (() => { const d = new Date(to + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1, 1); return d.toISOString().slice(0, 10); })();
let doc, from = opt('from');
if (exportFile) { doc = fromExport(exportFile); from = from || (doc.since ? sastDay(doc.since) : defFrom); }
else { from = from || defFrom; doc = await fromLive(from); }
if (doc.since && from < sastDay(doc.since)) { console.warn(`--from ${from} is before the export's window (${sastDay(doc.since)}); using ${sastDay(doc.since)}`); from = sastDay(doc.since); }

const A = analyse(doc, from, to);
const outDir = path.resolve(opt('out') || path.join(ROOT, 'reports', 'usage', 'out'));
fs.mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, `agentos-usage-${from}-to-${to}`);
fs.writeFileSync(base + '.html', render(A));
console.log(`${A.totals.agents} agents · ${A.totals.ever} signed in · ${A.totals.a7} active 7d · ${A.totals.noacct + A.totals.never + A.totals.dormant} not using`);
if (flag('html-only')) { console.log('wrote ' + base + '.html'); process.exit(0); }
const chrome = findChrome();
if (!chrome) { console.log('no Chrome/Edge found — open ' + base + '.html and Print → Save as PDF (or set CHROME=<path>)'); process.exit(0); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-pdf-'));
execFileSync(chrome, [...(/headless-shell/.test(chrome) ? [] : ['--headless=new']), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-pdf-header-footer', `--user-data-dir=${prof}`,
  `--print-to-pdf=${base}.pdf`, 'file://' + base + '.html'], { stdio: 'ignore', timeout: 120000 });
fs.rmSync(prof, { recursive: true, force: true });
console.log('wrote ' + base + '.pdf');
