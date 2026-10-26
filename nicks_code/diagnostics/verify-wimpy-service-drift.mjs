#!/usr/bin/env node
/* verify-wimpy-service-drift.mjs — THE TWO COPIES OF THE SIGN-IN RULES CANNOT DRIFT (Spec Kit 018, 2026-10-09).
 *
 * The Wimpy lunch app is its own service (wimpy-service/) and signs people in with the suite's password through a COPY
 * of the Worker's checkPassword / loginKey / findAccount / session code. A copy that drifts is a second, weaker door to
 * the same password. So:
 *   A · each SHARED-AUTH block (hashing, lookup, lock, session) is IDENTICAL in worker/src/auth.mjs and
 *       wimpy-service/src/auth.mjs — compared character for character after line endings are normalised; a difference
 *       names the block and the first line that differs;
 *   B · behaviour across the two doors, on one mocked database with real PBKDF2 hashes: wrong guesses on the service's
 *       sign-in and on the Worker's main sign-in count toward ONE lock; a success on either settles the tally; a flood
 *       of main-sign-in failures from a network does not close Wimpy for it; a hash made by one verifies in the other.
 *
 *   node nicks_code/diagnostics/verify-wimpy-service-drift.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORKER = path.join(ROOT, 'worker', 'src', 'auth.mjs');
const SERVICE = path.join(ROOT, 'wimpy-service', 'src', 'auth.mjs');

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

const BLOCKS = ['hashing', 'lookup', 'lock', 'session'];
const norm = (s) => String(s).replace(/\r\n/g, '\n');
/** The body of a SHARED-AUTH block: after its BEGIN comment's closing, up to its END marker. null when absent. */
export function sharedBlock(src, name) {
  const re = new RegExp('/\\* SHARED-AUTH:' + name + ' BEGIN[\\s\\S]*?\\*/\\n([\\s\\S]*?)\\n/\\* SHARED-AUTH:' + name + ' END \\*/');
  const m = re.exec(norm(src));
  return m ? m[1] : null;
}

head('A · THE FOUR SHARED BLOCKS ARE IDENTICAL, CHARACTER FOR CHARACTER');
{
  ok(fs.existsSync(WORKER) && fs.existsSync(SERVICE), 'both files exist', [WORKER, SERVICE].filter((f) => !fs.existsSync(f)).join(', '));
  const w = fs.existsSync(WORKER) ? fs.readFileSync(WORKER, 'utf8') : '', s = fs.existsSync(SERVICE) ? fs.readFileSync(SERVICE, 'utf8') : '';
  for (const b of BLOCKS) {
    const bw = sharedBlock(w, b), bs = sharedBlock(s, b);
    ok(bw !== null, 'the Worker carries block "' + b + '"');
    ok(bs !== null, 'the service carries block "' + b + '"');
    if (bw !== null && bs !== null) {
      if (bw === bs) ok(true, 'block "' + b + '" is identical (' + bw.split('\n').length + ' lines)');
      else {
        const lw = bw.split('\n'), ls = bs.split('\n');
        let i = 0; while (i < lw.length && i < ls.length && lw[i] === ls[i]) i++;
        ok(false, 'block "' + b + '" DIFFERS — first difference at block line ' + (i + 1), 'worker: ' + JSON.stringify((lw[i] || '').slice(0, 100)) + ' · service: ' + JSON.stringify((ls[i] || '').slice(0, 100)));
      }
    }
  }
  /* what the service is allowed to have of its own: signinWimpy (one line different: the address), logout, and nothing else */
  const own = norm(s).replace(/\/\* SHARED-AUTH:\w+ BEGIN[\s\S]*?\/\* SHARED-AUTH:\w+ END \*\//g, '');
  ok(/export async function signinWimpy\(DB, req, body, ctx, env\)/.test(own) && /export async function logout\(DB, user\)/.test(own), 'outside the shared blocks the service defines signinWimpy(DB, req, body, ctx, env) and logout');
  ok(!/export async function login\(|changePassword/.test(own), '…and NOT the main sign-in or the password change (those are the Worker\'s alone)');
  ok(/const ip = clientIp\(req, env\)/.test(own) && !/cf-connecting-ip/.test(own), 'the one intentional difference: the client address comes from clientIp(), never a Cloudflare header');
  ok(!/function signinWimpy/.test(norm(w)), 'the Worker no longer carries a Wimpy sign-in at all (Spec Kit 018 removal)');
}

head('B · ONE PASSWORD, ONE LOCK — ACROSS THE TWO DOORS, ON ONE DATABASE');
{
  const worker = await import(pathToFileURL(WORKER).href).catch((e) => ({ __error: String(e.message || e) }));
  const service = await import(pathToFileURL(SERVICE).href).catch((e) => ({ __error: String(e.message || e) }));
  ok(!worker.__error && !service.__error, 'both modules import', (worker.__error || '') + (service.__error || ''));
  if (!worker.__error && !service.__error && typeof service.signinWimpy === 'function' && typeof worker.login === 'function') {
    const PW = 'agent-pass-9101';
    const HASH = await worker.hashPassword(PW);
    ok(await service.verifyPassword(PW, HASH) === true && await worker.verifyPassword(PW, await service.hashPassword(PW)) === true, 'a hash made by either verifies in the other (same PBKDF2 scheme, same hex)');
    /* the same mock the service's signin test and the suite's lockout guard use: append-only auth_log, counters on the account */
    function makeDB() {
      const users = [{ id: 'u-agent', username: 'cb9101', cb: 'CB9101', full_name: 'Sam Agent', role: 'agent', active: true, apps: ['agent', 'wimpy'], password_hash: HASH, failed_attempts: 0, locked_until: null }];
      const st = { users, log: [], sessions: [], seq: 0 };
      const val = (q, k) => { const m = new RegExp('[?&]' + k + '=([^&]+)').exec(q); return m ? decodeURIComponent(m[1]) : null; };
      st.DB = {
        async select(q) {
          if (q.startsWith('app_users?')) { const un = val(q, 'username'), cb = val(q, 'cb'); let rows = users; if (un) rows = rows.filter((u) => 'eq.' + u.username === un); if (cb) rows = rows.filter((u) => cb.startsWith('ilike.') && String(u.cb).toLowerCase() === cb.slice(6).toLowerCase()); return rows.slice(0, 1).map((u) => ({ ...u })); }
          if (q.startsWith('auth_log?')) {
            const since = (val(q, 'at') || 'gte.1970').slice(4); let rows = st.log.filter((r) => r.at >= since);
            const uid = val(q, 'user_id'), ip = val(q, 'ip'), ev = val(q, 'event');
            if (uid) rows = rows.filter((r) => 'eq.' + r.user_id === uid); if (ip) rows = rows.filter((r) => 'eq.' + r.ip === ip);
            if (ev && ev.startsWith('like.')) { const pre = ev.slice(5).replace(/[*%]$/, ''); rows = rows.filter((r) => String(r.event).startsWith(pre)); }
            rows = /[?&]order=at\.desc/.test(q) ? rows.slice().sort((a, b) => (b.at === a.at ? b.seq - a.seq : String(b.at).localeCompare(String(a.at)))) : rows.slice().sort((a, b) => a.seq - b.seq);
            return rows.slice(0, +(val(q, 'limit') || 1e9)).map((r) => ({ event: r.event, at: r.at }));
          }
          return [];
        },
        async insert(table, rows) { if (table === 'auth_log') for (const r of rows) st.log.push({ ...r, at: new Date().toISOString(), seq: ++st.seq }); if (table === 'app_sessions') st.sessions.push(...rows); return rows; },
        async update(q, patch) { const id = val(q, 'id'); for (const u of users) if ('eq.' + u.id === id) Object.assign(u, patch); return null; },
        async del() { return null; },
      };
      st.user = () => users[0];
      return st;
    }
    const pending = []; const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); } }; const settle = () => Promise.all(pending.splice(0));
    const wReq = (ip) => ({ headers: { get: (h) => (h === 'cf-connecting-ip' ? ip : h === 'user-agent' ? 'verify' : '') } });
    const sReq = (ip) => ({ headers: { get: (h) => (h === 'x-wimpy-socket-ip' ? ip : h === 'user-agent' ? 'verify' : '') } });
    /* Spec Kit 025: Wimpy answers to its OWN password (wimpy123 until the person sets one), the main door to the AgentOS one.
       Stability plan (2026-10-26): ONE LOCK, TWO TALLIES — each door counts only its own failures and is settled only by its
       own success; the lock field is still one, honoured and set by both, so it fails closed. */
    const WD = service.WIMPY_DEFAULT_PASSWORD;
    const wimpy = (st, ip, password) => service.signinWimpy(st.DB, sReq(ip), { cb: 'CB9101', password }, ctx, {});
    const main = (st, ip, password) => worker.login(st.DB, wReq(ip), { username: 'CB9101', password }, ctx);
    {
      const st = makeDB();
      for (let i = 0; i < 3; i++) await wimpy(st, '10.0.2.1', 'Wrong-Pass');
      for (let i = 0; i < 2; i++) await main(st, '10.0.2.1', 'Wrong-Pass');
      ok(!st.user().locked_until, 'three wrong on the Wimpy service + two on the main sign-in = NOT locked (two tallies)', 'locked_until=' + st.user().locked_until);
      for (let i = 0; i < 2; i++) await wimpy(st, '10.0.2.1', 'Wrong-Pass');
      ok(!!st.user().locked_until, '…two more wrong on Wimpy = five on that door = locked', 'locked_until=' + st.user().locked_until);
      const w = await wimpy(st, '10.0.2.1', WD), m = await main(st, '10.0.2.1', PW);
      ok(w.status === 423 && m.status === 423, '…and the lock is one field: the right password is then refused on BOTH doors (423)', w.status + ' ' + m.status);
    }
    {
      const st = makeDB();
      const cross = await wimpy(st, '10.0.2.5', PW);
      ok(cross.status === 401, 'the AgentOS password does not open Wimpy (Spec Kit 025: two passwords, one lock)', JSON.stringify(cross));
    }
    {
      const st = makeDB();
      for (let i = 0; i < 4; i++) await main(st, '10.0.3.1', 'Wrong-Pass');
      const good = await wimpy(st, '10.0.3.1', WD); await settle();
      ok(good.ok === true, 'four wrong on the main sign-in, then the right Wimpy password → signed in', JSON.stringify(good).slice(0, 120));
      await main(st, '10.0.3.1', 'Wrong-Pass'); await main(st, '10.0.3.1', 'Wrong-Pass');
      ok(!!st.user().locked_until, '…but a Wimpy success does NOT settle the main door: two more AgentOS typos lock it (the old bypass is closed)', 'locked_until=' + st.user().locked_until);
    }
    {
      const st = makeDB();
      for (let i = 0; i < 4; i++) await main(st, '10.0.3.9', 'Wrong-Pass');
      const mgood = await main(st, '10.0.3.9', PW); await settle();
      ok(mgood.ok === true, 'four wrong on the main sign-in, then the right AgentOS password → signed in');
      await main(st, '10.0.3.9', 'Wrong-Pass'); await main(st, '10.0.3.9', 'Wrong-Pass');
      ok(!st.user().locked_until, '…and a main success still settles the main door (two typos after it do not lock)');
    }
    {
      const st = makeDB();
      for (let i = 0; i < 100; i++) await worker.login(st.DB, wReq('10.9.9.9'), { username: 'CB' + (8000 + i), password: 'wrong-one' }, ctx);
      await settle();
      const more = await main(st, '10.9.9.9', PW);
      ok(more.status === 429, '100 main-sign-in failures from one network in ten minutes → that network is paused on the main door (429)', JSON.stringify(more).slice(0, 120));
      const other = await main(st, '10.9.9.10', PW);
      ok(other.ok === true, '…another network signs in normally');
    }
    {
      const st = makeDB();
      for (let i = 0; i < 105; i++) await worker.login(st.DB, wReq('10.8.8.8'), { username: 'CB' + (7000 + i), password: 'wrong-one' }, ctx);
      await settle();
      const lunch = await wimpy(st, '10.8.8.8', WD);
      ok(lunch.ok === true, '105 main-sign-in failures from one network do not close the Wimpy service for it (its network limit counts Wimpy failures only)', JSON.stringify(lunch).slice(0, 120));
    }
  }
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
