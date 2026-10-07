/* THE LIST UPDATES ITSELF, IN BOTH APPS, WITH NOBODY HELPING.
 *
 * Nick, 2026-08-28: "make sure the list auto updates."
 *
 * The server side is proven elsewhere (verify-roster-of-record, verify-roster-changes).
 * The link this suite exists for is ADOPTION: when the roster of record changes, does the
 * app actually TAKE it — new team leaders in, old ones gone — without a human doing
 * anything? Until today VAS only ever PUBLISHED a list. It never read one, so a list
 * dropped into the Ops station reached it only if the raw file happened to relay across
 * and be re-ingested. That is the path that failed on the morning of the 28th and left the
 * two dashboards on different lists for hours.
 *
 * This drives the REAL VAS app in a browser against a stubbed Worker, and checks the thing
 * that matters on screen: the roster, the team leaders, and that the old ones are gone.
 *
 * Run: node verify-roster-autoupdate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* the roster the stubbed Worker is serving, swapped between assertions */
const mk = (tl, codes) => codes.map((c, i) => ({ code: c, name: 'Agent ' + i, tl,
  campaign: i % 2 ? 'Cuddle' : 'Courtesy', tenure: i % 2 ? 'Exp' : 'M1',
  callx: 'Agent ' + i, sf: 'Agent ' + i, target: 3, start: '2026-01-01' }));
let served = { fingerprint: 'list:one', as_of: '2026-08-20', source: 'vas', n: 3,
  roster: mk('Renolan Pillay', ['CB100', 'CB101', 'CB102']) };
let posted = [];
let postFail = 0;                                      // spec 010: the next N publishes get an error status, not an answer

const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
const srv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const J = (o) => { s.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); s.end(JSON.stringify(o)); };
  if (u.pathname === '/api/roster') {
    if (q.method === 'POST') { let b = ''; q.on('data', c => b += c); return q.on('end', () => { posted.push(b.length);
      if (postFail > 0) { postFail--; s.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return s.end('{"error":"supabase POST rpc/publish_agent_list → 500"}'); }
      J({ accepted: true }); }); }
    return J(served);
  }
  if (u.pathname === '/api/me') return J({ user: { username: 'nick', role: 'admin' } });
  if (u.pathname === '/api/upload-manifest') return J({ files: [] });
  if (u.pathname === '/api/kv') { s.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return s.end('{}'); }
  const p = SIDE[u.pathname] || (u.pathname === '/' ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => srv.listen(8244, '127.0.0.1', r));

const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 130)));
await page.addInitScript(() => {
  sessionStorage.setItem('cbx_token', 'test-token');
  const of = window.fetch;
  window.fetch = (u, o) => of(String(u).replace('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev', 'http://127.0.0.1:8244'), o);
});
await page.goto('http://127.0.0.1:8244/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(() => {
  window.__vasHydrated = true;
  /* The app ships with a demo roster for a first run. This suite is about ADOPTION, so it
     starts from an empty one — otherwise the assertions measure the demo data. */
  window.__mtd.state().roster = [];
});

const rosterNow = () => page.evaluate(() => {
  const S = window.__mtd.state();
  return { n: (S.roster || []).length, fp: S.rosterFp || null,
    leaders: [...new Set((S.roster || []).map(a => a.tl).filter(Boolean))].sort(),
    codes: (S.roster || []).map(a => a.code).sort() };
});
const adopt = () => page.evaluate(() => window.adoptRosterFromRecord());

console.log('  driving the real VAS app against a stubbed Worker\n');

/* 1 — the first adoption: an empty app takes the published list */
await adopt();
let r = await rosterNow();
ok('an app with no list adopts the published one', r.n === 3, JSON.stringify(r));
ok('...with its team leader', r.leaders.join(',') === 'Renolan Pillay', r.leaders.join(','));
ok('...and remembers which list it is on', r.fp === 'list:one', String(r.fp));

/* 2 — nothing changed: adopting again must be silent, not churn */
const before = r;
await adopt();
r = await rosterNow();
ok('adopting an unchanged list changes nothing', r.fp === before.fp && r.n === before.n, JSON.stringify(r));

/* 3 — THE CASE THAT KEPT FAILING: Ops publishes a new list, VAS must take it */
served = { fingerprint: 'list:two', as_of: '2026-08-28', source: 'ops', n: 4,
  roster: mk('Fabian Chetty', ['CB100', 'CB101', 'CB103', 'CB104']) };
await adopt();
r = await rosterNow();
ok('a list published by OPS is adopted here automatically', r.fp === 'list:two', String(r.fp));
ok('...the NEW team leader is in', r.leaders.includes('Fabian Chetty'), r.leaders.join(','));
ok('...the OLD team leader is gone', !r.leaders.includes('Renolan Pillay'), r.leaders.join(','));
ok('...the NEW agents are on the roster', r.codes.includes('CB103') && r.codes.includes('CB104'), r.codes.join(','));
ok('...and the agent who left is gone', !r.codes.includes('CB102'), r.codes.join(','));

/* 4 — a degenerate payload must never flatten the floor */
const healthy = await rosterNow();
served = { fingerprint: 'list:empty', as_of: '2026-08-29', source: 'ops', n: 0, roster: [] };
await adopt();
r = await rosterNow();
ok('an empty published roster is refused', r.n === healthy.n && r.fp === healthy.fp, JSON.stringify(r));
served = { fingerprint: 'list:junk', as_of: '2026-08-29', source: 'ops', n: 2,
  roster: [{ code: '', name: '' }, { code: 'CB999' }] };
await adopt();
r = await rosterNow();
ok('rows with no code or name are refused too', r.n === healthy.n && r.fp === healthy.fp, JSON.stringify(r));

/* 5 — the app must not publish back what it just adopted (no ping-pong) */
const postsBefore = posted.length;
served = { fingerprint: 'list:three', as_of: '2026-08-30', source: 'ops', n: 3,
  roster: mk('Nikita Baijnath', ['CB100', 'CB101', 'CB103']) };
await adopt();
await page.waitForTimeout(4000);                       // longer than the publish delay
r = await rosterNow();
ok('a third list is adopted', r.fp === 'list:three' && r.leaders.join(',') === 'Nikita Baijnath', JSON.stringify(r));
ok('adopting does NOT publish the list straight back', posted.length === postsBefore,
  (posted.length - postsBefore) + ' unexpected publishes');

/* 6 — it is wired to run by itself, not only when called */
const wiring = await page.evaluate(() => ({
  fn: typeof window.adoptRosterFromRecord,
  onFocus: (() => { let hit = 0; const real = window.adoptRosterFromRecord;
    window.adoptRosterFromRecord = () => { hit++; return Promise.resolve(); };
    window.dispatchEvent(new Event('focus'));
    window.adoptRosterFromRecord = real; return hit; })(),
}));
ok('adoption is a real function on the page', wiring.fn === 'function', String(wiring.fn));
ok('...and runs when the tab is focused, with nobody asking', wiring.onFocus > 0, String(wiring.onFocus));

/* 7 — THE OTHER DIRECTION MUST STILL WORK. Suppressing the publish-back is only safe if a
   genuine hand upload still publishes; silence both and the list stops travelling at all. */
{
  const postsBefore = posted.length;
  await page.evaluate(() => {
    /* the shape a real Agent List upload hands to the ingest */
    const rows = [
      { 'Employee Code': 'CB300', 'Agent Name': 'Hand One', 'Sales Force': 'Hand One',
        'Team Leader': 'Hand Uploaded Leader', 'Campaign': 'Courtesy', 'Tenure': 'M1', 'Target': 3 },
      { 'Employee Code': 'CB301', 'Agent Name': 'Hand Two', 'Sales Force': 'Hand Two',
        'Team Leader': 'Hand Uploaded Leader', 'Campaign': 'Cuddle', 'Tenure': 'Exp', 'Target': 8 },
    ];
    INGEST.roster(rows, 'Matrix - Agent List.xlsx', null);
  });
  await page.waitForTimeout(4000);                     // longer than the publish delay
  const r7 = await rosterNow();
  ok('a hand-uploaded list replaces the adopted one', r7.leaders.includes('Hand Uploaded Leader'), r7.leaders.join(','));
  ok('...and clears the "came from the record" marker', r7.fp === null, String(r7.fp));
  ok('...and IS published to the other station', posted.length > postsBefore,
    'no publish fired — the list would stop travelling');
}

/* 8 — A PUBLISH THAT GETS NO ANSWER IS TRIED AGAIN (spec 010, 2026-10-07). Ashton's 7 Oct upload got an error status
   once, was reported as "no reply" in his tab only, and four minutes later the re-sync put the 6 Oct list back. */
{
  const hand = (leader) => page.evaluate((tl) => {
    INGEST.roster([
      { 'Employee Code': 'CB310', 'Agent Name': 'Retry One', 'Sales Force': 'Retry One', 'Team Leader': tl, 'Campaign': 'Courtesy', 'Tenure': 'M1', 'Target': 3 },
      { 'Employee Code': 'CB311', 'Agent Name': 'Retry Two', 'Sales Force': 'Retry Two', 'Team Leader': tl, 'Campaign': 'Cuddle', 'Tenure': 'Exp', 'Target': 8 },
    ], 'Matrix - Agent List.xlsx', null);
  }, leader);
  const refusedNow = () => page.evaluate(() => window.__mtd.state().rosterRefused || null);
  await page.evaluate(() => { window.__listRetryMs = [300, 300]; window.__mtd.state().rosterRefused = null; });

  postFail = 1; let p0 = posted.length;
  await hand('Retry Leader A');
  await page.waitForTimeout(4600);                     // the 3 s publish delay + one short retry
  ok('a publish that gets an error status once is TRIED AGAIN', posted.length - p0 === 2, (posted.length - p0) + ' attempt(s)');
  ok('...and when the retry is answered, no "NOT published" notice is left', (await refusedNow()) === null, JSON.stringify(await refusedNow()));

  postFail = 3; p0 = posted.length;
  await hand('Retry Leader B');
  await page.waitForTimeout(5200);
  const ref = await refusedNow();
  ok('three unanswered attempts, then it stops', posted.length - p0 === 3, (posted.length - p0) + ' attempt(s)');
  ok('...and the notice says it tried three times', !!ref && /3 attempts/.test(String(ref.detail || '')), JSON.stringify(ref));
  postFail = 0;
}

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
