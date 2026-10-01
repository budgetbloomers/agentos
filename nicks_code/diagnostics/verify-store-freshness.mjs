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
const { evaluateFreshness, expectedReachFor } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);

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
  /* RETIRED 2026-09-18 (Nick: "stop this red banner"). With no scheduled runner Ops ingests only
     when somebody opens it, and it does so by itself on open — so "Ops is behind the uploads" was
     red every morning and told the VAS reader nothing they could act on. It must never come back. */
  const behind = evaluateFreshness({ ...base, opsFactsAt: '2026-09-02T21:26:00Z' });
  ok(!behind.some((x) => x.id === 'ops-behind-uploads'), 'Ops fact stores 3.5 days older than the archive: NO banner (Ops syncs itself on open)', behind.map((x) => x.id).join(','));
  ok(!behind.some((x) => /ingested the latest uploads|ops-relay/.test(x.message)), 'nothing else says "has not ingested the latest uploads"');
  ok(!evaluateFreshness({ ...base, opsFactsAt: '2026-09-06T11:05:00Z' }).some((x) => x.id === 'ops-behind-uploads'), 'Ops that followed within the half hour: quiet');
  ok(!evaluateFreshness({ ...base, opsFactsAt: null }).some((x) => x.id === 'ops-behind-uploads'), 'no Ops reading at all: quiet');
  const lag = evaluateFreshness({ ...base, opsFactsAt: '2026-09-06T11:05:00Z', vasAt: '2026-09-07T06:56:00Z', digestAt: '2026-09-06T11:00:00Z' });
  ok(lag.some((x) => x.id === 'digest-behind-store'), 'PULSE saved 20h after the last digest publish: the digest is behind');
  ok(!evaluateFreshness({ ...base, opsFactsAt: '2026-09-06T11:05:00Z', vasAt: '2026-09-07T06:56:00Z', digestAt: '2026-09-07T07:10:00Z' }).some((x) => x.id === 'digest-behind-store'), 'digest republished after the save: quiet');
}

{
  /* ROLLOVER GRACE (2026-10-01): September live on the 1st of October is the right answer until October has a day to show */
  const wm = (now, digestMonth) => evaluateFreshness({ manifestAt: null, vasAt: null, opsAt: null, staffLoginRecent: false, opened: {},
    now: at(now), digestMonth, curMonth: '2026-10', digestAt: null }).some((x) => x.id === 'agent-digest-wrong-month');
  ok(!wm('2026-10-01T06:00:00Z', '2026-09'), '1 Oct 08:00, September live: quiet (no October day is due yet)');
  ok(!wm('2026-10-02T09:00:00Z', '2026-09'), '2 Oct 11:00, September live: still quiet (1 Oct is due after 13:00)');
  ok(wm('2026-10-02T12:00:00Z', '2026-09'), '2 Oct 14:00, September live: critical (1 Oct should have landed and published)');
  ok(wm('2026-10-01T06:00:00Z', '2026-08'), '1 Oct, AUGUST live: critical at once (older than the month just closed)');
  ok(!wm('2026-10-01T06:00:00Z', '2026-10'), 'October live: quiet');
}

{
  /* never-stale plan, Phases 1 & 2 (2026-09-07): the runner and the sources */
  const base = { manifestAt: '2026-09-07T08:00:00Z', vasAt: '2026-09-07T08:05:00Z', opsAt: '2026-09-07T08:06:00Z', opsFactsAt: '2026-09-07T08:06:00Z',
    staffLoginRecent: true, opened: {}, digestMonth: '2026-09', curMonth: '2026-09', digestAt: '2026-09-07T08:10:00Z', now: at('2026-09-07T09:00:00Z') };
  /* NO RUNNER IS EXPECTED SINCE 2026-09-16 (GitHub Actions off — Nick will not pay): the two runner alerts are raised only
     when the Worker is told a runner exists (runnerExpected, from GITHUB_RUNNER=on). Without it, silence is not an alert. */
  ok(!evaluateFreshness({ ...base, jobs: null }).some((x) => x.id === 'runner-never-ran'), 'no jobs-status row and no runner expected: quiet');
  ok(evaluateFreshness({ ...base, jobs: null, runnerExpected: true }).some((x) => x.id === 'runner-never-ran'), 'no jobs-status row with a runner expected: runner-never-ran (warning)');
  ok(!evaluateFreshness({ ...base, jobs: undefined }).some((x) => /runner/.test(x.id)), 'unreadable jobs-status: no opinion');
  const fresh = { steps: { 'agent-digest': { ranAt: '2026-09-07T08:50:00Z', ok: true } } };
  ok(!evaluateFreshness({ ...base, jobs: fresh }).some((x) => /runner/.test(x.id)), 'a step 10 min ago: quiet');
  const stale = { steps: { 'agent-digest': { ranAt: '2026-09-07T07:00:00Z', ok: true } } };
  ok(!evaluateFreshness({ ...base, jobs: stale }).some((x) => x.id === 'runner-silent'), 'no step for 2 h on a Monday, no runner expected: quiet');
  ok(evaluateFreshness({ ...base, jobs: stale, runnerExpected: true }).some((x) => x.id === 'runner-silent'), 'the same with a runner expected: runner-silent');
  ok(!evaluateFreshness({ ...base, jobs: stale, runnerExpected: true, now: at('2026-09-06T09:00:00Z') }).some((x) => x.id === 'runner-silent'), 'the same silence on a Sunday: quiet');
  const red = { steps: { 'verify-nightly': { ranAt: '2026-09-06T20:10:00Z', ok: false, note: 'verify-all-tabs 49/50' } } };
  ok(evaluateFreshness({ ...base, jobs: red }).some((x) => x.id === 'verification-failed' && /49\/50/.test(x.message)), 'a red nightly verify is named');
  /* THE HELP CENTER ANSWERS (Nick, 2026-09-21: "always make sure if I ask the team leader for help or ask campaign manager it works") */
  ok(!evaluateFreshness({ ...base, helpCenter: { ok: true, status: 200, help: true, assist: true } }).some((x) => /help-center/.test(x.id)), 'HighLevel answers with both pipelines: quiet');
  ok(evaluateFreshness({ ...base, helpCenter: { ok: false, status: 401, error: 'Invalid JWT' } }).some((x) => x.id === 'help-center-unreachable' && x.severity === 'critical' && /401/.test(x.message)), 'a refused key: help-center-unreachable (critical), status named');
  ok(evaluateFreshness({ ...base, helpCenter: { ok: false, status: 0, error: 'no answer within 10s' } }).some((x) => x.id === 'help-center-unreachable'), 'a timeout: help-center-unreachable');
  ok(evaluateFreshness({ ...base, helpCenter: { ok: true, status: 200, help: true, assist: false } }).some((x) => x.id === 'help-center-pipeline-missing' && x.severity === 'warning' && /Campaign Assistance/.test(x.message)), 'a missing assistance pipeline: warning naming it');
  ok(!evaluateFreshness({ ...base }).some((x) => /help-center/.test(x.id)), 'no probe result (older Worker): no opinion');
  /* THE RELAY SAYS IT RAN, NO STORE MOVED (2026-09-21) */
  const relayed = { steps: { 'ops-relay': { ranAt: '2026-09-07T08:55:00Z', ok: true } } };
  ok(evaluateFreshness({ ...base, jobs: relayed, manifestAt: '2026-09-07T06:00:00Z', opsFactsAt: '2026-09-07T02:00:00Z' }).some((x) => x.id === 'ops-relay-no-store-moved' && x.severity === 'warning'), 'relay ran after the upload, no Ops store saved for 4 h: warning');
  ok(!evaluateFreshness({ ...base, jobs: relayed, manifestAt: '2026-09-07T06:00:00Z', opsFactsAt: '2026-09-07T06:30:00Z' }).some((x) => x.id === 'ops-relay-no-store-moved'), 'a store saved after the upload: quiet');
  ok(!evaluateFreshness({ ...base, jobs: relayed, manifestAt: '2026-09-07T08:30:00Z', opsFactsAt: '2026-09-07T02:00:00Z' }).some((x) => x.id === 'ops-relay-no-store-moved'), 'an upload 30 min ago: too soon to say');
  /* sources: Monday 11:00 SAST → expected through Saturday 5 Sep */
  ok(expectedReachFor(at('2026-09-07T09:00:00Z')) === '2026-09-05', 'Monday before 13:00 expects Saturday (no Sunday data)');
  ok(expectedReachFor(at('2026-09-07T12:00:00Z')) === '2026-09-05', 'Monday after 13:00 still expects Saturday');
  ok(expectedReachFor(at('2026-09-08T12:00:00Z')) === '2026-09-07', 'Tuesday after 13:00 expects Monday');
  ok(expectedReachFor(at('2026-09-08T08:00:00Z')) === '2026-09-05', 'Tuesday before 13:00 expects Saturday');
  const good = evaluateFreshness({ ...base, jobs: fresh, reach: { sales: '2026-09-05', calls: '2026-09-05', attendance: '2026-09-05', qa: '2026-09-05' } });
  ok(!good.some((x) => x.id === 'source-stale'), 'every source through Saturday on Monday morning: quiet');
  ok(!evaluateFreshness({ ...base, jobs: fresh, reach: { sales: '2026-09-05', calls: '2026-09-05', attendance: '2026-09-04', qa: '2026-09-04' } }).some((x) => x.id === 'source-stale'),
    'attendance and QA through Friday on a Monday: on time (no Saturday rows for those sources)');
  ok(expectedReachFor(at('2026-09-07T09:00:00Z'), false) === '2026-09-04', 'a Mon–Fri source is expected through Friday on a Monday');
  const short = evaluateFreshness({ ...base, jobs: fresh, reach: { sales: '2026-09-04', calls: '2026-09-05', attendance: '2026-09-04', qa: '2026-09-02' },
    cadence: [{ source: 'qa', owner: 'Ashton', saturday: false }, { source: 'sales', owner: 'Ashton', saturday: true }] });
  const ss = short.find((x) => x.id === 'source-stale');
  ok(!!ss && ss.severity === 'critical' && /Sales \(BI Active cases\) reaches 2026-09-04, expected 2026-09-05 \(1d short, owner Ashton\)/.test(ss.message) && /QA evaluations reaches 2026-09-02, expected 2026-09-04 \(2d short, owner Ashton\)/.test(ss.message),
    'sales a day short and QA two: critical, each named with its expected day and owner', ss && ss.message);
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
