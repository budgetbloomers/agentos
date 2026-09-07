#!/usr/bin/env node
/**
 * verify-store-freshness.mjs — the server can tell "idle" from "broken".
 *
 *   node nicks_code/diagnostics/verify-store-freshness.mjs
 *
 * Phase 2 of specs/save-reliability-plan.md. Two halves:
 *   A · the sentinel logic (worker/src/health.mjs evaluateFreshness) against
 *       fixtures — including the exact timestamps of the 28–31 Aug incident,
 *       which MUST alert, and a quiet Sunday, which must NOT;
 *   B · the live store_freshness view and the live kv:health-alerts key, which
 *       should both be clean right now — and if they are not, this failing IS
 *       the system working.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { evaluateFreshness } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const T = (iso) => iso + 'T00:00:00Z';
const at = (iso) => Date.parse(iso);

head('A · THE SENTINEL, AGAINST FIXTURES');
{
  /* the incident itself: manifest moving daily, both states frozen on the 27th */
  const a = evaluateFreshness({
    manifestAt: '2026-08-30T09:13:00Z', vasAt: '2026-08-27T17:10:00Z', opsAt: '2026-08-27T16:00:00Z',
    staffLoginRecent: true, now: at('2026-08-30T10:00:00Z'),
  });
  ok(a.some((x) => x.id === 'uploads-not-persisting' && x.severity === 'critical'),
    'the 28–31 Aug shape ALERTS: uploads archived, neither state saved', JSON.stringify(a.map((x) => x.id)));
  ok(a.some((x) => x.id === 'vas-state-stale'), '...and the absolute-staleness backstop fires too');
}
{
  /* an ordinary healthy day: everything moved this morning */
  const a = evaluateFreshness({
    manifestAt: '2026-08-31T05:24:00Z', vasAt: '2026-08-31T05:47:00Z', opsAt: '2026-08-31T05:49:00Z',
    staffLoginRecent: true, now: at('2026-08-31T08:00:00Z'),
  });
  ok(a.length === 0, 'a healthy morning raises nothing', JSON.stringify(a));
}
{
  /* the quiet Sunday: nothing uploaded, nobody signed in — silence is honest */
  const a = evaluateFreshness({
    manifestAt: '2026-08-28T09:00:00Z', vasAt: '2026-08-28T09:30:00Z', opsAt: '2026-08-28T09:40:00Z',
    staffLoginRecent: false, now: at('2026-08-30T08:00:00Z'),
  });
  ok(a.length === 0, 'a quiet weekend with no sign-ins raises NOTHING — activity gates the backstop, so this never cries wolf');
}
{
  /* one app saving, the other frozen: not the both-frozen signature, but the
     stale backstop still names the frozen one once people are signed in */
  const a = evaluateFreshness({
    manifestAt: '2026-08-31T09:00:00Z', vasAt: '2026-08-29T09:00:00Z', opsAt: '2026-08-31T08:58:00Z',
    staffLoginRecent: true, now: at('2026-08-31T10:00:00Z'),
  });
  ok(!a.some((x) => x.id === 'uploads-not-persisting'),
    'one app saving normally means the both-frozen alert stays quiet');
  ok(a.some((x) => x.id === 'vas-state-stale'), '...but the frozen app is still named');
}
{
  /* upload landed and the state followed within the hour — the ordinary upload flow */
  const a = evaluateFreshness({
    manifestAt: '2026-08-31T09:00:00Z', vasAt: '2026-08-31T09:04:00Z', opsAt: '2026-08-31T08:00:00Z',
    staffLoginRecent: true, now: at('2026-08-31T09:30:00Z'),
  });
  ok(!a.some((x) => x.id === 'uploads-not-persisting'), 'a state save within the hour of an upload is healthy');
}
{
  /* alerts carry what a responder needs */
  const a = evaluateFreshness({
    manifestAt: '2026-08-30T09:13:00Z', vasAt: '2026-08-27T17:10:00Z', opsAt: '2026-08-27T16:00:00Z',
    staffLoginRecent: true, now: at('2026-08-30T10:00:00Z'),
  });
  const c = a.find((x) => x.id === 'uploads-not-persisting');
  ok(/verify-live-save/.test(c.message), 'the critical alert tells the responder what to run next', c.message.slice(0, 120));
  ok(!!c.since, 'and stamps when the condition began');
}
{
  /* 2026-09-04: a VAS-only day is not an Ops failure. With app-open stamps the stale checks
     ask "opened since its last save?" per app; without stamps the sign-in rule stands. */
  const base = { manifestAt: '2026-09-04T08:00:00Z', vasAt: '2026-09-04T07:00:00Z', opsAt: '2026-09-02T21:26:00Z',
    staffLoginRecent: true, now: at('2026-09-04T09:00:00Z') };
  const legacy = evaluateFreshness(base);
  ok(legacy.some((x) => x.id === 'cb-config-stale'), 'no stamps: the sign-in rule still names Ops');
  const quiet = evaluateFreshness({ ...base, opened: { vas: '2026-09-04T08:30:00Z' } });
  ok(!quiet.some((x) => x.id === 'cb-config-stale'), 'stamps present, Ops never opened since it saved: no Ops alert');
  ok(!quiet.some((x) => x.id === 'vas-state-stale'), 'PULSE opened and saved this morning: quiet too');
  const used = evaluateFreshness({ ...base, opened: { vas: '2026-09-04T08:30:00Z', ops: '2026-09-03T09:00:00Z' } });
  const o = used.find((x) => x.id === 'cb-config-stale');
  ok(!!o && /opened at 2026-09-03 09:00/.test(o.message), 'Ops opened after its last save and still unsaved 26h on: named, with the open time', o && o.message);
  const stale = evaluateFreshness({ ...base, vasAt: '2026-09-02T07:00:00Z', opened: { vas: '2026-09-03T08:30:00Z' } });
  ok(stale.some((x) => x.id === 'vas-state-stale'), 'the same rule catches a PULSE that was opened and did not save');
}
{
  /* 2026-09-07: saves the dashboards themselves reported as failed */
  const base = { manifestAt: '2026-09-07T08:00:00Z', vasAt: '2026-09-07T07:00:00Z', opsAt: '2026-09-07T07:00:00Z',
    staffLoginRecent: true, now: at('2026-09-07T09:00:00Z'), opened: {} };
  const two = evaluateFreshness({ ...base, saveFailures: [
    { at: '2026-09-07T08:20:00Z', app: 'ops', key: 'cb-audit', status: '409 wipe_blocked' },
    { at: '2026-09-07T08:25:00Z', app: 'ops', key: 'cb-audit', status: '409 wipe_blocked' }] });
  ok(!two.some((x) => x.id === 'saves-failing'), 'two reports in an hour: not yet an alert (a retry may land)');
  const three = evaluateFreshness({ ...base, saveFailures: [
    { at: '2026-09-07T08:20:00Z', app: 'ops', key: 'cb-audit', status: '409 wipe_blocked' },
    { at: '2026-09-07T08:25:00Z', app: 'ops', key: 'cb-audit', status: '409 wipe_blocked' },
    { at: '2026-09-07T08:30:00Z', app: 'ops', key: 'cb-facts-AGENT_LIST', status: '426 outdated' }] });
  const a = three.find((x) => x.id === 'saves-failing');
  ok(!!a && a.severity === 'critical', 'three in an hour is critical');
  ok(!!a && /cb-audit → 409 wipe_blocked ×2/.test(a.message) && /cb-facts-AGENT_LIST → 426/.test(a.message), 'the alert names each key, status and count', a && a.message);
  ok(!!a && a.since === '2026-09-07T08:20:00.000Z', 'since = the oldest report');
}

{
  /* never-stale plan, Phase 0 (2026-09-07): Ops must follow the uploads, the digest must follow the state */
  const base = { manifestAt: '2026-09-06T10:59:00Z', vasAt: '2026-09-06T10:59:30Z', opsAt: '2026-09-06T11:00:00Z',
    staffLoginRecent: true, now: at('2026-09-07T08:00:00Z'), opened: {}, digestMonth: '2026-09', curMonth: '2026-09', digestAt: '2026-09-06T11:00:00Z' };
  const behind = evaluateFreshness({ ...base, opsFactsAt: '2026-09-02T21:26:00Z' });
  const o = behind.find((x) => x.id === 'ops-behind-uploads');
  ok(!!o && o.severity === 'critical' && /86h behind/.test(o.message), 'Ops fact stores 3.5 days older than the archive: critical, hours named', o && o.message);
  ok(!evaluateFreshness({ ...base, opsFactsAt: '2026-09-06T11:05:00Z' }).some((x) => x.id === 'ops-behind-uploads'), 'Ops that followed within the half hour: quiet');
  ok(!evaluateFreshness({ ...base, opsFactsAt: null }).some((x) => x.id === 'ops-behind-uploads'), 'no Ops reading at all is no opinion, never an alarm');
  const lag = evaluateFreshness({ ...base, opsFactsAt: '2026-09-06T11:05:00Z', vasAt: '2026-09-07T06:56:00Z', digestAt: '2026-09-06T11:00:00Z' });
  ok(lag.some((x) => x.id === 'digest-behind-store'), 'PULSE saved 20h after the last digest publish: the digest is behind');
  ok(!evaluateFreshness({ ...base, opsFactsAt: '2026-09-06T11:05:00Z', vasAt: '2026-09-07T06:56:00Z', digestAt: '2026-09-07T07:10:00Z' }).some((x) => x.id === 'digest-behind-store'), 'digest republished after the save: quiet');
}

head('B · THE LIVE VIEW AND THE LIVE KEY');
{
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
  }
  const pg = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
  const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await c.connect();
  try {
    const rows = (await c.query('select * from store_freshness')).rows;
    ok(rows.length >= 4, 'store_freshness answers with its named checks (' + rows.length + ')');
    for (const r of rows)
      ok(+r.failures === 0, r.check_name,
        r.failures + ' failing — if this is real, the sentinel is doing its job: investigate before silencing');
    const log = (await c.query("select count(*)::int n from kv_write_log")).rows[0];
    console.log('  (kv_write_log holds ' + log.n + ' rows — grows with every acknowledged save)');
  } finally { await c.end(); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
