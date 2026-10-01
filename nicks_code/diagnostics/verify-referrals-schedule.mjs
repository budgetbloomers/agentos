#!/usr/bin/env node
/**
 * verify-referrals-schedule.mjs — spec 002-live-month-sync-coaching, contract C3: referrals on a schedule.
 *
 *   node nicks_code/diagnostics/verify-referrals-schedule.mjs
 *
 * No credentials, nothing reaches production: the sync tool runs against a FAKE Supabase + Worker on localhost
 * (CBX_ENV_FILE / CBX_API_BASE test hooks), the engine page has every Worker request intercepted.
 *   A. referralsSlotDue(): 08:00 and 14:00 SAST, every day incl. weekends, once per slot, within the slot's 4 h window
 *   B. tools/tick-local.mjs: a referrals step BEFORE agent-digest, due outside the Mon-Fri working gate
 *   C. tools/sync-referrals.mjs: dry run by default; --apply mints a short-lived session, pulls /api/referrals?fresh=1,
 *      deletes the session in finally (success AND failure), writes the C3 shapes, keeps the last 30 log entries,
 *      logs ok:false + exits non-zero on failure, never prints a secret
 *   D. tools/digest-republish.mjs ingests kv:referrals-latest into the headless engine (never saves state)
 *   E. PULSE adopts kv:referrals-latest on boot / focus / 10-minute poll only when newer than S.refs.at;
 *      a newer manual sync wins; one shared mapping with __hlSyncVAS
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os'; import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;
const TOOL_SYNC = path.join(ROOT, 'tools', 'sync-referrals.mjs');
const SYNC = fs.existsSync(TOOL_SYNC) ? fs.readFileSync(TOOL_SYNC, 'utf8') : '';
const TICK = fs.readFileSync(path.join(ROOT, 'tools', 'tick-local.mjs'), 'utf8');
const DIGEST = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const PULSE = fs.readFileSync(HTML, 'utf8');

/* ---------------------------------------------------------------- A ---- */
console.log('A · SLOT GATING (pure function)');
let referralsSlotDue = null;
if (SYNC) { try { ({ referralsSlotDue } = await import(pathToFileURL(TOOL_SYNC).href)); } catch (e) { console.log('  (import failed: ' + String(e.message).slice(0, 120) + ')'); } }
ok('sync-referrals.mjs exports referralsSlotDue without running anything', typeof referralsSlotDue === 'function');
if (typeof referralsSlotDue === 'function') {
  const sast = (ymd, hm) => Date.parse(ymd + 'T' + hm + ':00Z') - 2 * 3600000;   // a SAST wall-clock time as epoch ms
  const THU = '2026-10-01', SAT = '2026-10-03', SUN = '2026-10-04';
  const due = (ymd, hm, log = []) => referralsSlotDue(sast(ymd, hm), log);
  ok('07:59 SAST: nothing due', due(THU, '07:59') === null);
  ok('08:00 SAST: the 08:00 slot', due(THU, '08:00') === '08:00');
  ok('11:59 SAST: still the 08:00 slot (4 h window)', due(THU, '11:59') === '08:00');
  ok('12:00 SAST: the window has closed', due(THU, '12:00') === null);
  ok('13:59 SAST: nothing due', due(THU, '13:59') === null);
  ok('14:00 SAST: the 14:00 slot', due(THU, '14:00') === '14:00');
  ok('17:59 SAST: still the 14:00 slot', due(THU, '17:59') === '14:00');
  ok('18:00 SAST: closed', due(THU, '18:00') === null);
  ok('23:30 SAST: nothing due', due(THU, '23:30') === null);
  ok('Saturday 08:05 SAST: due — every day, weekends included', due(SAT, '08:05') === '08:00');
  ok('Sunday 14:20 SAST: due', due(SUN, '14:20') === '14:00');
  const at = (ymd, hm) => new Date(sast(ymd, hm)).toISOString();
  const e = (slot, okv, ymd, hm) => ({ at: at(ymd, hm), slot, ok: okv, rows: 10, contacts: 12, total: 15, error: okv ? null : 'HighLevel 503' });
  ok('an ok 08:00 run today: not due again', due(THU, '08:30', [e('08:00', true, THU, '08:02')]) === null);
  ok('…and the 14:00 slot is still due at 14:10', due(THU, '14:10', [e('08:00', true, THU, '08:02')]) === '14:00');
  ok('an ok 08:00 run YESTERDAY does not satisfy today', due(THU, '08:30', [e('08:00', true, '2026-09-30', '08:02')]) === '08:00');
  ok('a FAILED run does not satisfy the slot (it retries)', due(THU, '08:30', [e('08:00', false, THU, '08:02')]) === '08:00');
  ok('a manual run is not the slot', due(THU, '08:30', [e('manual', true, THU, '08:10')]) === '08:00');
  ok('an ok 14:00 entry does not satisfy the 08:00 slot', due(THU, '09:00', [e('14:00', true, '2026-09-30', '14:05')]) === '08:00');
  const many = Array.from({ length: 10 }, (_, i) => e('08:00', false, THU, '08:0' + (i % 10)));
  ok('a slot that keeps failing stops being retried (bounded)', due(THU, '09:30', many) === null, String(due(THU, '09:30', many)));
  ok('garbage in the log is ignored', due(THU, '08:30', [null, 7, { slot: '08:00' }, { at: 'nope', slot: '08:00', ok: true }]) === '08:00');
  ok('a non-array log reads as empty', due(THU, '08:30', undefined) === '08:00');
}

/* ---------------------------------------------------------------- B ---- */
console.log('\nB · tools/tick-local.mjs');
ok('the tick imports the slot rule from sync-referrals.mjs (one definition)', /referralsSlotDue/.test(TICK) && /sync-referrals\.mjs/.test(TICK));
const iRef = TICK.indexOf("run('referrals'"), iDig = TICK.indexOf("run('agent-digest'");
ok('a referrals step exists and runs BEFORE agent-digest', iRef > 0 && iDig > 0 && iRef < iDig);
ok('the referrals step runs sync-referrals.mjs --apply with the slot', /sync-referrals\.mjs',\s*'--apply',\s*'--slot='/.test(TICK));
ok('the referrals step is stamped in kv:jobs-status', /stamp\('referrals'/.test(TICK));
ok('the tick is due when a slot is due, whatever the working gate says', /const due = FORCE \|\| full \|\| !!slot/.test(TICK) && /const full = /.test(TICK));
ok('outside working hours only referrals + agent-digest run (rake/relay/lake/nba are for a full tick)',
  /if \(full\) \{[^}]*run\('rake'/.test(TICK.replace(/\n/g, ' ')) && /if \(full\) \{[^}]*run\('ops-relay'/.test(TICK.replace(/\n/g, ' ')) && !/if \(full\) \{[^}]*run\('agent-digest'/.test(TICK.replace(/\n/g, ' ')));
ok('a failed referrals step never stops the digest', /run\('referrals'[\s\S]{0,400}run\('agent-digest'/.test(TICK) && !/referrals[^\n]*process\.exitCode/.test(TICK));
ok('the sync log is read before deciding (kv:referrals-sync-log)', /kv:referrals-sync-log/.test(TICK));
ok('the existing gate is intact (Mon-Fri 06:00-20:00 SAST)', /getUTCDay\(\) >= 1 && sast\.getUTCDay\(\) <= 5 && sast\.getUTCHours\(\) >= 6 && sast\.getUTCHours\(\) < 20/.test(TICK));

/* ---------------------------------------------------------------- C ---- */
console.log('\nC · tools/sync-referrals.mjs');
ok('the tool exists', !!SYNC);
if (SYNC) {
  const mainBody = SYNC.slice(SYNC.indexOf('async function main'));
  ok('dry run is the default; --apply writes', /includes\('--apply'\)/.test(SYNC) && /dry run/i.test(SYNC));
  ok('the session is deleted in a finally block (dropSession: DELETE by token hash)', /finally\s*\{\s*await dropSession\(\)/.test(mainBody) && /app_sessions\?token_hash=eq\./.test(mainBody) && /method: 'DELETE'/.test(mainBody));
  ok('the session lives at most 10 minutes', /10 \* 60000|600000|600 \* 1000/.test(SYNC));
  ok('it asks the Worker for a fresh pull', /\/api\/referrals\?fresh=1/.test(SYNC));
  ok('it sends the client header the Worker expects', /'x-cbx-client':\s*'v5'/.test(SYNC));
  ok('Storage raw/kv/referrals-latest + the rules pointer + the sync log are written', /raw\/kv\/referrals-latest/.test(SYNC) && /kv:referrals-latest/.test(SYNC) && /kv:referrals-sync-log/.test(SYNC));
  ok('the log keeps the last 30 entries', /LOG_KEEP = 30/.test(SYNC) && /slice\(-LOG_KEEP\)/.test(SYNC));
  ok('by:\'tick\' and the slot travel with the data', /by:\s*'tick'/.test(SYNC) && /slot/.test(SYNC));
  ok('no secret is ever printed (no console call mentions the token or the service key)', !/console\.(log|error|warn)\([^)]*(token|SECRET_KEY|Authorization)/i.test(SYNC));
  ok('every fetch goes through one helper with AbortSignal.timeout(60000) (Worker and Supabase alike)', /AbortSignal\.timeout\(/.test(SYNC) && /60000/.test(SYNC) && (SYNC.match(/\bfetch\(/g) || []).length === 1, String((SYNC.match(/\bfetch\(/g) || []).length));
  ok('SIGINT and SIGTERM delete the minted session and exit', /\['SIGINT', 'SIGTERM'\]/.test(SYNC) && /process\.on\(sig, \(\) => \{ dropSession\(\)\.finally\(\(\) => process\.exit/.test(SYNC));
  ok('stale sync-referrals sessions are swept at start (user_agent + expires_at)', /user_agent=eq\.sync-referrals/.test(SYNC) && /expires_at=lt\./.test(SYNC));
  ok('a non-2xx session DELETE says "could not be deleted"', /DELETE/.test(SYNC) && /could not be deleted/.test(SYNC) && /\.ok\b/.test(SYNC));
  ok("the session is minted with scope:'referrals'", /scope:\s*'referrals'/.test(SYNC));
  ok('the test hooks are honoured ONLY when CBX_TEST=1', /CBX_TEST === '1'/.test(SYNC) && /CBX_TEST === '1'\s*&&\s*process\.env\.CBX_ENV_FILE|CBX_TEST === '1' \? process\.env\.CBX_ENV_FILE/.test(SYNC) && /CBX_TEST === '1'\s*&&\s*process\.env\.CBX_API_BASE|CBX_TEST === '1' \? process\.env\.CBX_API_BASE/.test(SYNC));
  ok('main is guarded so the module can be imported', /import\.meta\.url/.test(SYNC) && /process\.argv\[1\]/.test(SYNC));

  /* --- run it for real against a fake Supabase + Worker --- */
  const hits = []; let apiMode = 'ok'; let deleteFail = false; let logReadFail = false; const sweeps = []; let sessionRow = null; let deleted = null; const writes = {};
  const PRIOR = Array.from({ length: 35 }, (_, i) => ({ at: '2026-09-' + String(1 + (i % 28)).padStart(2, '0') + 'T06:00:00.000Z', slot: '08:00', ok: true, rows: 1, contacts: 1, total: 1, error: null }));
  const ROWS = [{ id: 'c1', created: '2026-10-01', agent: 'Ref One', referrer: 'A', count: 2 }, { id: 'c2', created: '2026-10-01', agent: 'Ref Two', referrer: 'B', count: 3 }, { id: 'c3', created: '2026-09-30', agent: '', referrer: 'C', count: 1 }];
  const fake = http.createServer((q, s) => {
    let body = ''; q.on('data', (c) => { body += c; }); q.on('end', () => {
      const u = q.url; hits.push(q.method + ' ' + u.split('?')[0]);
      const send = (code, o) => { s.writeHead(code, { 'Content-Type': 'application/json' }); s.end(typeof o === 'string' ? o : J(o)); };
      if (q.method === 'GET' && u.startsWith('/rest/v1/app_users')) return send(200, [{ id: 'admin-1', username: 'root' }]);
      if (q.method === 'POST' && u.startsWith('/rest/v1/app_sessions')) { sessionRow = JSON.parse(body)[0]; return send(201, ''); }
      if (q.method === 'DELETE' && u.startsWith('/rest/v1/app_sessions') && /user_agent=eq\.sync-referrals/.test(u)) { sweeps.push(u); return send(204, ''); }
      if (q.method === 'DELETE' && u.startsWith('/rest/v1/app_sessions')) { if (deleteFail) { deleted = decodeURIComponent(u.split('token_hash=eq.')[1] || ''); return send(500, { error: 'boom' }); } deleted = decodeURIComponent(u.split('token_hash=eq.')[1] || ''); return send(204, ''); }
      if (q.method === 'GET' && u.startsWith('/rest/v1/rules') && /referrals-sync-log/.test(u)) { if (logReadFail) return send(500, { error: 'db down' }); } if (q.method === 'GET' && u.startsWith('/rest/v1/rules') && /referrals-sync-log/.test(u)) return send(200, [{ value: { data: J({ entries: PRIOR }) } }]);
      if (q.method === 'POST' && u.startsWith('/rest/v1/rules')) { for (const r of JSON.parse(body)) writes[r.key] = r.value; return send(201, ''); }
      if (q.method === 'PUT' && u.startsWith('/storage/v1/object/raw/kv/referrals-latest')) { writes.__storage = body; return send(200, {}); }
      if (q.method === 'GET' && u.startsWith('/api/referrals')) {
        const tk = String(q.headers.authorization || '').replace(/^Bearer /, '');
        const known = sessionRow && crypto.createHash('sha256').update(tk).digest('hex') === sessionRow.token_hash;
        if (!known) return send(401, { error: 'unauthorised' });
        writes.__apiUrl = u; writes.__token = tk; writes.__client = q.headers['x-cbx-client'];
        if (apiMode === 'hang') return;   // never answers
        if (apiMode === 'down') return send(503, { error: 'HighLevel is not configured' });
        if (apiMode === 'empty') return send(200, { rows: [], contacts: 0, pulled_at: new Date().toISOString() });
        return send(200, { rows: ROWS, contacts: 40, pulled_at: new Date().toISOString() });
      }
      send(404, { error: 'unexpected ' + q.method + ' ' + u });
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + fake.address().port;
  const envFile = path.join(os.tmpdir(), 'cbx-verify-refs-' + process.pid + '.env');
  fs.writeFileSync(envFile, 'SUPABASE_URL=' + base + '\nSUPABASE_SECRET_KEY=fake-service-key-123\n');
  const reset = () => { deleteFail = false; logReadFail = false; sweeps.length = 0; hits.length = 0; sessionRow = null; deleted = null; for (const k of Object.keys(writes)) delete writes[k]; };
  /* async, NOT spawnSync: the fake servers live in THIS process and must keep answering while the tool runs */
  const runTool = (args, extraEnv) => new Promise((resolve) => {
    const c = spawn(process.execPath, [TOOL_SYNC, ...args], { cwd: ROOT, env: { ...process.env, CBX_TEST: '1', CBX_ENV_FILE: envFile, CBX_API_BASE: base, ...(extraEnv || {}) } });
    let so = '', se = ''; c.stdout.on('data', (d) => { so += d; }); c.stderr.on('data', (d) => { se += d; });
    const kill = setTimeout(() => c.kill(), 60000);
    c.on('close', (code) => { clearTimeout(kill); resolve({ status: code, stdout: so, stderr: se }); });
  });
  try {
    reset(); let r = await runTool(['--slot=08:00']);
    ok('dry run (no --apply): exit 0 and not one request leaves the machine', r.status === 0 && hits.length === 0, 'status ' + r.status + ' hits ' + hits.join(','));

    reset(); apiMode = 'ok'; r = await runTool(['--slot=08:00', '--apply']);
    const out = String(r.stdout) + String(r.stderr);
    ok('--apply: exits 0', r.status === 0, out.slice(0, 300));
    ok('a session was minted for an admin and lives <= 10 minutes', sessionRow && sessionRow.user_id === 'admin-1' && Date.parse(sessionRow.expires_at) - Date.now() <= 10 * 60000 + 5000 && Date.parse(sessionRow.expires_at) > Date.now(), J(sessionRow));
    ok('the Worker was called with ?fresh=1 and the v5 client header', /fresh=1/.test(writes.__apiUrl || '') && writes.__client === 'v5', J([writes.__apiUrl, writes.__client]));
    ok('the session was DELETED (the minted token\'s hash)', !!sessionRow && deleted === sessionRow.token_hash, J([deleted, sessionRow && sessionRow.token_hash]));
    const stored = writes.__storage ? JSON.parse(writes.__storage) : null;
    ok('Storage raw/kv/referrals-latest = {rows, contacts, pulled_at, slot, by:tick}', stored && Array.isArray(stored.rows) && stored.rows.length === 3 && stored.contacts === 40 && /^\d{4}-\d\d-\d\dT/.test(stored.pulled_at) && stored.slot === '08:00' && stored.by === 'tick', J(stored && Object.keys(stored)));
    ok('the rows keep {id,created,agent,referrer,count}', stored && J(Object.keys(stored.rows[0]).sort()) === J(['agent', 'count', 'created', 'id', 'referrer']));
    const ptr = writes['kv:referrals-latest'];
    ok('the rules pointer names the Storage object', ptr && ptr.store === 'raw/kv/referrals-latest' && !!ptr.updated_at, J(ptr));
    const log = writes['kv:referrals-sync-log'] ? JSON.parse(writes['kv:referrals-sync-log'].data) : null;
    ok('the sync log is {data: JSON({entries})} capped at the last 30', log && Array.isArray(log.entries) && log.entries.length === 30, String(log && log.entries && log.entries.length));
    const last = log && log.entries[log.entries.length - 1];
    ok('the new entry: {at, slot, ok:true, rows, contacts, total, error:null}', last && last.slot === '08:00' && last.ok === true && last.rows === 3 && last.contacts === 40 && last.total === 6 && last.error === null && /^\d{4}-/.test(last.at), J(last));
    ok('nothing secret reached the output', !out.includes(writes.__token || 'NOTOKEN') && !out.includes('fake-service-key-123'));

    reset(); apiMode = 'down'; r = await runTool(['--slot=14:00', '--apply']);
    const out2 = String(r.stdout) + String(r.stderr);
    ok('Worker/HighLevel down: exits NON-ZERO', r.status !== 0, 'status ' + r.status);
    ok('the session is still deleted after a failure', !!sessionRow && deleted === sessionRow.token_hash);
    ok('no referrals-latest is written on failure (the last good copy stands)', !writes.__storage && !writes['kv:referrals-latest']);
    const log2 = writes['kv:referrals-sync-log'] ? JSON.parse(writes['kv:referrals-sync-log'].data) : null;
    const last2 = log2 && log2.entries[log2.entries.length - 1];
    ok('the failure is logged: ok:false, slot, the error text, no token', last2 && last2.ok === false && last2.slot === '14:00' && /503/.test(String(last2.error)) && !JSON.stringify(last2).includes(writes.__token || 'NOTOKEN'), J(last2));
    ok('the failure output carries no secret', !out2.includes(writes.__token || 'NOTOKEN') && !out2.includes('fake-service-key-123'));

    reset(); apiMode = 'ok'; r = await runTool(['--slot=08:00', '--apply']);
    ok('stale sync-referrals sessions were swept first', sweeps.length === 1 && /expires_at=lt\./.test(sweeps[0]), J(sweeps));
    ok("the minted session carries scope 'referrals'", sessionRow && sessionRow.scope === 'referrals', J(sessionRow));

    reset(); apiMode = 'ok'; deleteFail = true; r = await runTool(['--slot=08:00', '--apply']);
    ok('a failing session DELETE is reported ("could not be deleted"), never silent', /could not be deleted/.test(String(r.stdout) + String(r.stderr)), String(r.stderr).slice(0, 200));

    reset(); apiMode = 'hang'; r = await runTool(['--slot=14:00', '--apply'], { CBX_TIMEOUT_MS: '600' });
    const logH = writes['kv:referrals-sync-log'] ? JSON.parse(writes['kv:referrals-sync-log'].data) : null; const lastH = logH && logH.entries[logH.entries.length - 1];
    ok('a HUNG Worker call times out: non-zero exit, ok:false logged, session deleted', r.status !== 0 && lastH && lastH.ok === false && !!sessionRow && deleted === sessionRow.token_hash, J([r.status, lastH, deleted]));

    reset(); apiMode = 'ok'; logReadFail = true; r = await runTool(['--slot=08:00', '--apply']);
    ok('a FAILED log read never overwrites the log: no write, non-zero exit, error reported', r.status !== 0 && !writes['kv:referrals-sync-log'] && /sync log/i.test(String(r.stdout) + String(r.stderr)), J([r.status, Object.keys(writes)]));

    reset(); apiMode = 'empty'; r = await runTool(['--slot=manual', '--apply']);
    ok('HighLevel returning no rows is a failure, not an empty "latest"', r.status !== 0 && !writes.__storage && deleted === (sessionRow && sessionRow.token_hash));
  } finally { fake.close(); try { fs.unlinkSync(envFile); } catch {} }
}

/* ---------------------------------------------------------------- D ---- */
console.log('\nD · tools/digest-republish.mjs ingests kv:referrals-latest');
{
  const blk = (DIGEST.match(/\/\*REFERRALS-INGEST-BEGIN\*\/([\s\S]*?)\/\*REFERRALS-INGEST-END\*\//) || [])[1] || '';
  ok('a REFERRALS-INGEST block exists', !!blk);
  ok('it reads kv:referrals-latest (pointer, then Storage)', /kv:referrals-latest/.test(blk) && /storage\/v1\/object/.test(blk));
  ok('it feeds the headless engine through the shared adoption (newer-only), then rebuilds', /refsAdoptRecord/.test(blk) && /__mtd\.rebuild\(\)/.test(blk));
  ok('it NEVER saves state', !/\bsave\(|__cloudPush|vas-state['"`]\s*,\s*\{\s*method:\s*'(PUT|POST)/.test(blk) && !/method:\s*'(PUT|POST)'/.test(blk));
  ok('a failed read is a warning, not a stop', /catch \(e\)/.test(blk) && /console\.warn/.test(blk));
  ok('it runs before the digest is built (before the campaign moves block)', DIGEST.indexOf('REFERRALS-INGEST-BEGIN') > 0 && DIGEST.indexOf('REFERRALS-INGEST-BEGIN') < DIGEST.indexOf('const buildFor'));
}

/* ---------------------------------------------------------------- E ---- */
console.log('\nE · PULSE adopts kv:referrals-latest');
{
  const srcBlock = PULSE.slice(PULSE.indexOf('function referralRecsFromRows'), PULSE.indexOf('/* Sync WATCHDOG'));
  const hl = PULSE.slice(PULSE.indexOf('window.__hlSyncVAS=function'), PULSE.indexOf('/* Sync WATCHDOG'));
  ok('ONE shared mapping: referralRecsFromRows is used by __hlSyncVAS AND the adoption', /referralRecsFromRows\(d\.rows\)/.test(hl) && /referralRecsFromRows\(rec\.rows\)/.test(srcBlock) && (srcBlock.match(/function referralRecsFromRows/g) || []).length === 1);
  ok('the adoption names the slot in the file label', /'HighLevel API \(scheduled '\+/.test(srcBlock));
  ok('adoption polls: boot (hydrated + roster), window focus, every 10 minutes', /600000/.test(srcBlock) && /addEventListener\('focus'/.test(srcBlock) && /__vasHydrated/.test(srcBlock) && /S_?\.roster/.test(srcBlock));
  ok('it reads GET /api/kv?key=referrals-latest with the session', /api\/kv\?key=referrals-latest/.test(srcBlock) && /Authorization/.test(srcBlock));

  const server = http.createServer((q, s) => { const p = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') }[q.url.split('?')[0]];
    if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
  await new Promise((r) => server.listen(8303, '127.0.0.1', r));
  const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    const errs = []; page.on('pageerror', (x) => errs.push(String(x.message).slice(0, 160)));
    let kvReply = { status: 404, body: '' }; const kvHits = [];
    await page.route(/chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/, (route) => {
      const u = route.request().url();
      if (/\/api\/kv\?key=referrals-latest/.test(u)) { kvHits.push({ auth: route.request().headers().authorization }); return route.fulfill({ status: kvReply.status, contentType: 'text/plain', body: kvReply.body }); }
      route.abort();
    });
    await page.goto('http://127.0.0.1:8303/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mtd && window.__mtd.state() && typeof window.refsAdoptRecord === 'function', null, { timeout: 30000 }).catch(() => {});
    const has = await page.evaluate(() => typeof window.refsAdoptRecord === 'function' && typeof window.refsRecordNewer === 'function' && typeof window.referralRecsFromRows === 'function' && typeof window.__refsAdoptLatest === 'function');
    ok('PULSE exposes referralRecsFromRows / refsRecordNewer / refsAdoptRecord / __refsAdoptLatest', has);
    if (has) {
      await page.evaluate(() => {
        const S = window.__mtd.state(); S.roster = []; S.files = []; S.refs = null; S.att = {}; S.sales = {}; S.calls = {};
        for (const [code, nm, tl] of [['CB901', 'Thandi Mokoena', 'Leader Alpha'], ['CB902', 'Pieter Vanwyk', 'Leader Beta']]) S.roster.push({ code, name: nm, sf: nm, tl, campaign: 'Courtesy', tenure: 'M1', callx: '', target: 5, start: '2026-01-01' });
        window.__saves = 0; window.__kicks = 0;
        window.save = function () { window.__saves++; }; window.kickAgentDigest = function () { window.__kicks++; };
      });
      const rec = (iso, extra = {}) => ({ rows: [{ id: 'a', created: '2026-10-01', agent: 'Thandi Mokoena', referrer: 'x', count: 2 }, { id: 'b', created: '2026-10-01', agent: 'Pieter Vanwyk', referrer: 'y', count: 3 }], contacts: 9, pulled_at: iso, slot: '08:00', by: 'tick', ...extra });

      const newer = await page.evaluate(() => ({
        none: refsRecordNewer(null, '2026-10-01T08:00:00.000Z'),
        sameMinute: refsRecordNewer({ at: '2026-10-01 08:00' }, '2026-10-01T08:00:40.000Z'),
        nextMinute: refsRecordNewer({ at: '2026-10-01 08:00' }, '2026-10-01T08:01:00.000Z'),
        stamped: refsRecordNewer({ at: '2026-10-01 08:00', pulledAt: '2026-10-01T09:00:00.000Z' }, '2026-10-01T09:00:00.000Z'),
        stampedNewer: refsRecordNewer({ at: '2026-10-01 08:00', pulledAt: '2026-10-01T09:00:00.000Z' }, '2026-10-01T09:00:01.000Z'),
        bad: refsRecordNewer(null, 'not a date'), missing: refsRecordNewer(null, '') }));
      ok('refsRecordNewer: nothing stored -> newer', newer.none === true);
      ok('refsRecordNewer: a pull inside the minute S.refs.at names is NOT newer (the manual sync wins ties)', newer.sameMinute === false);
      ok('refsRecordNewer: a pull after that minute is newer', newer.nextMinute === true);
      ok('refsRecordNewer: the adopted pull\'s own stamp is not re-adopted; a later one is', newer.stamped === false && newer.stampedNewer === true);
      ok('refsRecordNewer: an unreadable pulled_at is never newer', newer.bad === false && newer.missing === false);

      const a1 = await page.evaluate((r) => { const x = refsAdoptRecord(r); const S = window.__mtd.state(); return { x, by: S.refs && S.refs.by, f: S.refs && S.refs.f, pulledAt: S.refs && S.refs.pulledAt, files: S.files.filter((f) => f.type === 'referrals').length, total: S.refs && S.refs.total }; }, rec('2026-10-01T08:05:00.000Z'));
      ok('refsAdoptRecord ingests the rows through the Agent List (CB901 2, CB902 3)', a1.x && a1.x.adopted === true && a1.by && a1.by.CB901 === 2 && a1.by.CB902 === 3 && a1.total === 5, J(a1));
      ok('…labelled "HighLevel API (scheduled 08:00)" and stamped with pulled_at', a1.f === 'HighLevel API (scheduled 08:00)' && a1.pulledAt === '2026-10-01T08:05:00.000Z', J([a1.f, a1.pulledAt]));
      ok('…one referrals entry in the file registry', a1.files === 1);
      const a2 = await page.evaluate((r) => refsAdoptRecord(r), rec('2026-10-01T08:05:00.000Z'));
      ok('the same pull is not adopted twice', a2.adopted === false);
      const a3 = await page.evaluate((r) => refsAdoptRecord(r), rec('2026-10-01T07:00:00.000Z', { slot: '14:00' }));
      ok('an OLDER pull never replaces a newer snapshot', a3.adopted === false);
      const a4 = await page.evaluate((r) => { const S = window.__mtd.state(); S.refs.at = '2026-10-01 12:00'; S.refs.pulledAt = ''; S.refs.by = { CB901: 99 };
        const x = refsAdoptRecord(r); return { x, v: S.refs.by.CB901 }; }, rec('2026-10-01T11:30:00.000Z'));
      ok('a MANUAL sync that is newer wins (S.refs.at 12:00 beats a 11:30 pull)', a4.x.adopted === false && a4.v === 99, J(a4));
      const a5 = await page.evaluate((r) => { const x = refsAdoptRecord(r); const S = window.__mtd.state(); return { x, v: S.refs.by.CB901, files: S.files.filter((f) => f.type === 'referrals').length }; }, rec('2026-10-01T12:30:00.000Z', { slot: '14:00' }));
      ok('a later scheduled pull replaces it, and the registry does not pile up', a5.x.adopted === true && a5.v === 2 && a5.files === 1, J(a5));
      const a6 = await page.evaluate(() => [refsAdoptRecord(null), refsAdoptRecord({}), refsAdoptRecord({ rows: [], pulled_at: '2030-01-01T00:00:00Z' }), refsAdoptRecord({ rows: 'x', pulled_at: '2030-01-01T00:00:00Z' })].map((x) => x.adopted));
      ok('null / empty / malformed records are refused', J(a6) === '[false,false,false,false]', J(a6));
      const a7 = await page.evaluate((r) => { const S = window.__mtd.state(); const keep = S.roster; const keepRefs = S.refs; S.roster = []; S.refs = null; const x = refsAdoptRecord(r); const stored = S.refs; S.roster = keep; S.refs = keepRefs; return { x, stored }; }, rec('2031-01-01T00:00:00.000Z'));
      ok('without an Agent List nothing is stored (the ingest defers)', a7.x.adopted === false && a7.stored === null, J(a7));

      /* the poll: GET /api/kv?key=referrals-latest with the session */
      await page.evaluate(() => { const S = window.__mtd.state(); S.refs = null; S.files = []; sessionStorage.setItem('cbx_token', 'tk-harness'); window.__vasHydrated = false; window.__saves = 0; window.__kicks = 0; });
      kvHits.length = 0; kvReply = { status: 200, body: J(rec('2026-10-01T14:05:00.000Z', { slot: '14:00' })) };
      await page.evaluate(() => window.__refsAdoptLatest());
      ok('not hydrated yet: the poll does not even ask', kvHits.length === 0);
      await page.evaluate(() => { window.__vasHydrated = true; });
      const p1 = await page.evaluate(async () => { await window.__refsAdoptLatest(); const S = window.__mtd.state(); return { by: S.refs && S.refs.by, f: S.refs && S.refs.f, saves: window.__saves, kicks: window.__kicks }; });
      ok('hydrated + roster: it GETs the key with the session token', kvHits.length === 1 && kvHits[0].auth === 'Bearer tk-harness', J(kvHits));
      ok('a newer pull is adopted, saved (compare-and-set path) and the digest is kicked', p1.by && p1.by.CB901 === 2 && p1.f === 'HighLevel API (scheduled 14:00)' && p1.saves === 1 && p1.kicks === 1, J(p1));
      const p2 = await page.evaluate(async () => { await window.__refsAdoptLatest(); return { saves: window.__saves, kicks: window.__kicks }; });
      ok('polling again with nothing newer saves and kicks nothing', p2.saves === 1 && p2.kicks === 1, J(p2));
      kvReply = { status: 404, body: '' };
      const p3 = await page.evaluate(async () => { await window.__refsAdoptLatest(); return { saves: window.__saves }; });
      ok('a 404 (no scheduled pull yet) is silent', p3.saves === 1);
      kvReply = { status: 200, body: 'not json' };
      const p4 = await page.evaluate(async () => { await window.__refsAdoptLatest(); return { saves: window.__saves }; });
      ok('an unreadable body is ignored', p4.saves === 1);
    }
    ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  } finally { await b.close(); server.close(); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
