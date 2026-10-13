#!/usr/bin/env node
/**
 * verify-cm-numbers.mjs — is every figure on the campaign manager view correct?
 *
 *   node tools/verify-cm-numbers.mjs            # check the live published data
 *
 * Run this after any upload, any digest publish, or any change to the campaign
 * layer. Exit code is 1 if anything disagrees.
 *
 * HOW IT CHECKS. Not by re-reading the Worker's answer — that would only prove it
 * is consistent with itself. It fetches the RAW published digest and recomputes
 * every displayed measure from the agent rows independently, with the arithmetic
 * written out longhand here, then compares against what the Worker actually
 * served. Two implementations, one answer, or it fails.
 *
 * WHAT IT CANNOT CATCH, stated plainly: if the digest itself is wrong, both sides
 * are wrong together. That is what the PERIOD and SANITY sections are for — they
 * check the digest against the world rather than against itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + n + (extra ? '\n         ' + extra : '')); } };
const head = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
/* money and percentages are rounded for display at several points; compare with a
   tolerance that is tighter than anything a human would notice but loose enough
   that a legitimate round-half-up never trips the alarm */
const near = (a, b, tol = 1e-6) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);
const campKey = (v) => String(v == null ? '' : v).trim().toLowerCase();

const token = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

try {
  /* ---- the raw digest, straight from storage ---- */
  const ptr = (await (await fetch(REST + 'rules?key=eq.' + encodeURIComponent('kv:agent-digest') + '&select=value,updated_at,updated_by', { headers: H })).json())[0];
  const digest = JSON.parse(await (await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/' + String(ptr.value.store).replace(/^raw\//, ''), { headers: H })).text());

  /* ---- what the campaign manager is actually served ---- */
  const u = (await (await fetch(REST + 'app_users?username=eq.dalwin&select=id', { headers: H })).json())[0];
  await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: tokenHash, user_id: u.id, expires_at: new Date(Date.now() + 5 * 60000).toISOString(), user_agent: 'verify-cm-numbers' }]) });
  const served = await (await fetch(API + '/api/portal/overview', { headers: { Authorization: 'Bearer ' + token, 'X-Cbx-Client': 'v5' } })).json();
  if (served.scope !== 'campaign') { console.error('not a campaign payload: ' + JSON.stringify(served).slice(0, 200)); process.exit(1); }

  head('1 · THE DIGEST DESCRIBES A MONTH');
  const mo = String(digest.period.from).slice(0, 7);
  ok(/^\d{4}-\d{2}-01$/.test(digest.period.from),
    'the period starts on the 1st — it is a month, not a browsed range (' + digest.period.from + ' to ' + digest.period.to + ')',
    'periodRange() reads the SHARED S.ui blob; a publisher on "yesterday" would put one day here and call it the month.');
  const liveMonth = new Date().toISOString().slice(0, 7);
  ok(mo === liveMonth, 'it is the CURRENT month (' + mo + ')', 'published ' + String(ptr.updated_at).slice(0, 16) + ' by ' + ptr.updated_by);
  ok(digest.workingDays >= digest.diallingDays,
    'planned working days (' + digest.workingDays + ') >= completed dialling days (' + digest.diallingDays + ')',
    'the projection multiplies by workingDays and divides by diallingDays; swapping them is the R2,012-a-day bug.');

  head('2 · EVERY CAMPAIGN FIGURE, RECOMPUTED FROM THE AGENT ROWS');
  const n = (v) => (v == null || isNaN(v) ? 0 : Number(v));
  /* A MOVER IS COUNTED ONCE PER CAMPAIGN (D4, 2026-09-29). A digest row with `segments` is the SUM over
     every campaign the agent worked this month, labelled with the campaign the list names NOW; each
     segment carries that campaign's own sales/gwpEx/target/act/emp. So a campaign's rows are: every
     un-segmented row on that campaign, plus — for each mover — one row made of the segments on that
     campaign. The row-level measures segments do not carry (dials, answered, leads, cancellations, QA,
     compliance fails) stay with the campaign the agent is on NOW, so nothing is counted twice. Rows
     without segments read exactly as before. */
  const SEG_SUMS = ['sales', 'gwpEx', 'target', 'act', 'emp'];
  const campView = (a, key) => {
    if (!Array.isArray(a.segments) || !a.segments.length) return campKey(a.campaign) === key ? a : null;
    const segs = a.segments.filter((s) => campKey(s.campaign) === key);
    if (!segs.length) return null;
    const now = campKey(a.campaign) === key;
    const v = { ...a, campaign: segs[0].campaign };
    for (const k of SEG_SUMS) v[k] = segs.reduce((s, x) => s + n(x[k]), 0);
    if (!now) Object.assign(v, { calls: 0, ans: 0, leads: null, canc: null, qa: null, composite: null });
    return v;
  };
  const rowsFor = (key) => digest.agents.map((a) => campView(a, key)).filter(Boolean);
  /* the 'all' view: one row per PERSON over the in-scope campaigns (a mover whose campaigns are all in
     scope reads as their whole row) */
  const rowsAll = (keys) => digest.agents.map((a) => {
    const parts = keys.map((k) => campView(a, k)).filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    const v = { ...parts.find((p) => p.calls || p.qa != null || p.composite) || parts[0] };
    for (const k of [...SEG_SUMS, 'calls', 'ans']) v[k] = parts.reduce((s, x) => s + n(x[k]), 0);
    return v;
  }).filter(Boolean);
  for (const c of served.cm.campaigns) {
    /* 'all' is a pseudo-campaign the Worker adds for a manager holding more than
       one — it covers every row in scope, not a campaign of that name. */
    const rows = c.key === 'all' ? rowsAll(served.campaigns || []) : rowsFor(c.key);
    /* PEOPLE, NOT ROWS (spec 034): a mover is one digest row per dated segment — right for every sum, wrong for a count */
    const people = (list) => new Set(list.map((a) => String(a.code || '').toUpperCase())).size;
    console.log('  \x1b[1m' + c.label + '\x1b[0m (' + people(rows) + ' agents in the digest, ' + rows.length + ' rows)');
    ok(people(rows) === c.agents, '  agent count = distinct agents in the digest', 'served ' + c.agents + ' vs digest ' + people(rows));

    const sales = rows.reduce((s, a) => s + n(a.sales), 0);
    const gwp = rows.reduce((s, a) => s + n(a.gwpEx), 0);
    const tgtMonth = rows.reduce((s, a) => s + n(a.target), 0);
    const calls = rows.reduce((s, a) => s + n(a.calls), 0);
    const ans = rows.reduce((s, a) => s + n(a.ans), 0);
    const leadRows = rows.filter((a) => a.leads != null);
    const leads = leadRows.reduce((s, a) => s + n(a.leads), 0);
    const canc = rows.reduce((s, a) => s + n(a.canc), 0);
    const act = rows.reduce((s, a) => s + n(a.act), 0);
    const emp = rows.reduce((s, a) => s + n(a.emp), 0);
    const qaRows = rows.filter((a) => a.qa != null);
    const qa = qaRows.length ? qaRows.reduce((s, a) => s + Number(a.qa), 0) / qaRows.length : null;
    const fails = rows.reduce((s, a) => s + n(a.composite && a.composite.r2a && a.composite.r2a.fails), 0);
    const tgtMtd = digest.workingDays ? tgtMonth * Math.min(1, digest.diallingDays / digest.workingDays) : tgtMonth;

    const k = c.kpis;
    ok(k.sales.v === sales, '  Total Sales = Σ agent sales (' + sales + ')', 'served ' + k.sales.v);
    ok(Math.abs(k.gwp.v - Math.round(gwp)) <= 1, '  Total GWP = Σ agent gwpEx (R' + Math.round(gwp).toLocaleString('en-ZA') + ')', 'served R' + k.gwp.v);
    ok(near(k.sales.pct, tgtMtd ? sales / tgtMtd : null, 1e-9), '  % to target = sales / (month target prorated by dialling days)');
    ok(near(k.aveG.v, sales ? gwp / sales : null, 1e-6), '  Average GWP per Sale = GWP / sales');
    ok(near(k.qa.v, qa, 1e-9), '  QA = mean of agent means (' + (qa == null ? '—' : (qa * 100).toFixed(1) + '%') + ')');
    ok(near(k.att.v, emp ? act / emp : null, 1e-9), '  Attendance = actual shifts / employed shifts');
    ok(near(k.canc.rate, (sales + canc) ? canc / (sales + canc) : null, 1e-9), '  Cancellation rate = cancels / (sales + cancels)');
    ok(k.crit.fails === fails, '  Critical failures = Σ compliance exceptions (' + fails + ')', 'served ' + k.crit.fails);
    /* the lead measures — the ones added 2026-08-30 */
    if (leadRows.length && !leads) {
      /* A CAMPAIGN WITH NO UNIQUE LEADS HAS NO CONVERSION (2026-09-14: Download & Test, whose
         agents do not dial the Salesforce lead book). The Worker serves null for the ratio, the
         attempts and the cover — never sales ÷ 0 — and the lead volume itself is the zero. */
      ok(!k.conv || k.conv.v == null, '  Conversion is NOT served when there are no unique leads (' + (k.conv ? 'served ' + k.conv.v : 'null') + ')');
      ok(!k.attempts || k.attempts.v == null, '  Attempts per Lead is not served either');
      ok(k.leads == null || k.leads.v === 0, '  Lead Volume = 0');
    } else if (leadRows.length) {
      /* CONVERSION = SALES ÷ CLOSED LEADS since spec 001-cm-view-signoff (1 Oct 2026): every case closed in the period,
         any status. The unique-lead book stays the denominator of attempts, volume and cover below. */
      const closedRows = rows.filter((a) => a.closed != null);
      const closed = closedRows.reduce((s, a) => s + n(a.closed), 0);
      ok(k.conv && near(k.conv.v, closed ? sales / closed : null, 1e-9),
        '  Conversion = sales / CLOSED LEADS (' + (closed ? (sales / closed * 100).toFixed(2) : '—') + '%)',
        'served ' + (k.conv ? (k.conv.v * 100).toFixed(2) : 'null') + '% — must never be sales per call');
      ok(k.conv && k.conv.closed === closed, '  ...and quotes the denominator it used (' + closed.toLocaleString() + ' closed)');
      ok(k.attempts && near(k.attempts.v, leads ? calls / leads : null, 1e-9), '  Attempts per Lead = dials / unique leads');
      ok(k.leads && k.leads.v === leads, '  Lead Volume = unique leads');
      ok(k.leads && near(k.leads.cover, sales ? leads / sales : null, 1e-9), '  Lead cover = leads / sales');
    } else {
      ok(k.conv === null && k.leads === null && k.attempts === null, '  no lead counts published -> conversion/leads/attempts are NULL, not zero');
    }
    ok(k.contactRate && near(k.contactRate.v, calls ? ans / calls : null, 1e-9), '  Contact Rate = answered / dials');
    ok(k.pitches === null && k.checks === null, '  Pitches and Both-Checks stay null — no source exists for either');

    /* the reconciliation rule the spec makes non-negotiable */
    const tSales = c.teams.reduce((s, t) => s + t.sales, 0);
    const tGwp = c.teams.reduce((s, t) => s + t.gwp, 0);
    ok(tSales === sales, '  RECONCILES: Σ team sales === campaign sales', tSales + ' vs ' + sales);
    ok(Math.abs(tGwp - Math.round(gwp)) <= c.teams.length, '  RECONCILES: Σ team GWP === campaign GWP', tGwp + ' vs ' + Math.round(gwp));
    ok(c.reconciled === true, '  the payload asserts its own reconciliation');

    /* per team leader, independently */
    for (const t of c.teams) {
      /* on the All view two rows can share a leader, so the team must be matched
         on leader AND campaign — the intersection rule, applied to the check too */
      const tCamp = String(t.team || '').split(' · ')[0];
      /* on 'all' the team is one campaign's: its rows are that campaign's views (segments for movers) */
      const tr = (c.key !== 'all' ? rows : rowsFor(campKey(tCamp)))
        .filter((a) => String(a.tl || '').trim() === t.tl);
      const ts = tr.reduce((s, a) => s + n(a.sales), 0);
      const tc = tr.filter((a) => a.closed != null).reduce((s, a) => s + n(a.closed), 0);
      ok(t.agents === people(tr) && t.sales === ts,
        '  ' + t.tl.padEnd(20) + ' ' + people(tr) + ' agents · ' + ts + ' sales', 'served ' + t.agents + ' agents · ' + t.sales + ' sales');
      if (tc) ok(t.conv && near(t.conv.v != null ? t.conv.v : t.conv, ts / tc, 1e-9), '  ' + t.tl.padEnd(20) + ' conversion = its own sales / its own CLOSED leads (spec 001)');
    }
  }

  head('2b · THE SCORED CONVERSION DRIVER MATCHES THE PUBLISHED NUMBERS');
  /* The driver divides PERIOD sales by PERIOD leads. It first shipped dividing the
     five-session window's sales by the month's leads, which read Enoch's 29.9% as
     6.8% and scored him zero for it — the numbers were on the same card and still
     disagreed, because nothing compared them. This does. */
  {
    const scored = digest.agents
      .map((a) => ({ a, p: ((a.composite && a.composite.parts) || []).find((x) => x.k === 'conv') }))
      .filter((x) => x.p && x.p.measured);
    ok(scored.length > 0, 'conversion is scored for ' + scored.length + ' of ' + digest.agents.length + ' agents');
    const wrong = scored.filter(({ a, p }) => {
      if (!a.leads) return true;
      return Math.abs(p.value - (a.sales / a.leads * 100)) > 0.01;
    });
    ok(!wrong.length, "every scored conversion equals that agent's own sales / own unique leads",
      wrong.slice(0, 3).map(({ a, p }) => a.code + ' driver ' + p.value.toFixed(1) + '% vs ' + (a.sales / a.leads * 100).toFixed(1) + '%').join(' · '));
    const unmeasured = digest.agents.filter((a) => {
      const p = ((a.composite && a.composite.parts) || []).find((x) => x.k === 'conv');
      return p && !p.measured;
    });
    ok(unmeasured.every((a) => !a.leads || !((a.tenure || '').trim())|| ['M0'].includes(a.tenure)),
      'the only unscored agents are ones with no lead book or no tenure group (' +
      unmeasured.map((a) => a.code + ' ' + a.tenure).join(', ') + ')');
  }

  head('3 · SANITY — nothing impossible, nothing infinite');
  for (const c of served.cm.campaigns) {
    const k = c.kpis;
    const bad = [];
    const chk = (label, v, lo, hi) => { if (v == null) return; if (!Number.isFinite(v)) bad.push(label + '=' + v); else if (v < lo || v > hi) bad.push(label + '=' + v); };
    chk('qa', k.qa.v, 0, 1); chk('att', k.att.v, 0, 3); chk('cancRate', k.canc.rate, 0, 1);
    chk('contactRate', k.contactRate && k.contactRate.v, 0, 1);
    chk('conv', k.conv && k.conv.v, 0, 5);
    chk('attempts', k.attempts && k.attempts.v, 0, 500);
    ok(!bad.length, c.label + ': every rate is finite and in range', bad.join(', '));
    if (k.conv && k.leads) ok(k.leads.v >= c.kpis.sales.v,
      c.label + ': unique leads (' + k.leads.v.toLocaleString() + ') >= sales (' + k.sales.v.toLocaleString() + ')',
      'more sales than leads means the denominator is not the book those sales came from');
    if (k.contactRate) ok(k.contactRate.contacts <= k.contactRate.dials,
      c.label + ': answered calls <= dials');
  }

  head('4 · FRESHNESS');
  const ageH = (Date.now() - Date.parse(digest.updatedAt)) / 3600000;
  console.log('  digest published ' + String(digest.updatedAt).slice(0, 16) + ' (' + ageH.toFixed(1) + 'h ago) by ' + ptr.updated_by);
  ok(ageH < 26, 'the digest is less than 26 hours old', 'past that the page marks itself stale, which is correct but means nobody has had PULSE open');
  ok(served.cm.freshness && !/live data|real time/i.test(served.cm.freshness.label),
    'freshness never claims "live" or "real time": "' + (served.cm.freshness || {}).label + '"');
} finally {
  await fetch(REST + 'app_sessions?token_hash=eq.' + tokenHash, { method: 'DELETE', headers: H });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
