#!/usr/bin/env node
/**
 * verify-wimpy-board.mjs — the Wimpy kitchen-board alert on the AgentOS health banner (2026-11-24).
 *
 *   node nicks_code/diagnostics/verify-wimpy-board.mjs
 *
 * On 24 Nov 15 Wimpy cards sat in "New Order" all day and 21 never left "Order Processing"; nobody was told. The Wimpy
 * service reads its board (wimpy-service/src/wimpy-board.mjs, tested in wimpy-service/test/board.test.mjs); this suite
 * proves the Worker half, offline:
 *   B1  wimpyBoardSlotDue — 10:45 and 12:00 SAST, Monday to Friday, during the hour after each, until recorded
 *   B2  evaluateWimpyBoard — ONE alert: the CB numbers and times; "could not read the kitchen board" when HighLevel
 *       failed or the check never ran; cleared when the board is clean, at the day's turn, and silent without the secret
 *   B3  runHealthChecks — asks the Wimpy service ONCE when a slot is due (Bearer WIMPY_CRON_SECRET), writes the alert into
 *       kv:health-alerts (the banner the recipients already get), asks nothing when not due, survives the service down
 *   B4  the slots agree with the service's, and the alert never carries a phone number
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const health = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);
const board = await import(pathToFileURL(path.join(ROOT, 'wimpy-service', 'src', 'wimpy-board.mjs')).href);
const { wimpyBoardSlotDue, evaluateWimpyBoard, WIMPY_BOARD_SLOTS, WIMPY_BOARD_KEY } = health;
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);
const S = (s) => Date.parse('2026-11-25T' + s + ':00+02:00');          // a Wednesday, SAST
const SAT = (s) => Date.parse('2026-11-28T' + s + ':00+02:00');
const st = (slot, extra = {}) => ({ v: 1, day: '2026-11-25', slot, at: '2026-11-25T08:50:00Z', ok: true, stages: slot === '10:45' ? ['New Order'] : ['New Order', 'Order Processing'], count: 0, cards: [], ...extra });

head('B1 · which slot is due');
ok(wimpyBoardSlotDue(S('10:40'), null) === null, '10:40 — nothing (ordering closes 10:30, the first check is 10:45)');
ok(wimpyBoardSlotDue(S('10:50'), null) === '10:45', '10:50 — the 10:45 check is due');
ok(wimpyBoardSlotDue(S('10:50'), st('10:45')) === null, '…and not again once recorded');
ok(wimpyBoardSlotDue(S('11:40'), { ...st('10:45'), day: '2026-11-24' }) === '10:45', 'yesterday\'s record does not count for today');
ok(wimpyBoardSlotDue(S('11:50'), null) === null, '11:50 — the 10:45 hour is over; nothing until 12:00');
ok(wimpyBoardSlotDue(S('12:00'), st('10:45')) === '12:00', '12:00 — the 12:00 check is due');
ok(wimpyBoardSlotDue(S('12:30'), st('12:00')) === null && wimpyBoardSlotDue(S('13:10'), null) === null, '…recorded, or past its hour → nothing');
ok(wimpyBoardSlotDue(SAT('10:50'), null) === null && wimpyBoardSlotDue(SAT('12:00'), null) === null, 'Saturday — nothing (ordering is Monday to Friday)');

head('B2 · one alert, the right words, cleared when clean');
const cards = [{ cb: 'CB183', at: '08:02', stage: 'New Order' }, { cb: 'CB47', at: '08:10', stage: 'New Order' }, { cb: null, at: '09:15', stage: 'New Order' }];
{ const a = evaluateWimpyBoard(st('10:45', { count: 3, cards }), S('10:50'), true);
  ok(a && a.id === 'wimpy-board' && /10:45 SAST check: 3 of today's order cards are still in New Order/.test(a.message) && /CB183 \(08:02, New Order\)/.test(a.message) && /CB47 \(08:10/.test(a.message) && /CB not known \(09:15/.test(a.message),
    '10:45 with 3 waiting → ONE alert naming the count, the times and the CB numbers', a && a.message); }
ok(evaluateWimpyBoard(st('10:45', { count: 0 }), S('10:50'), true) === null, 'a clean board → no alert (it clears)');
{ const a = evaluateWimpyBoard(st('10:45', { count: 3, cards }), S('12:05'), true);
  ok(a && /10:45 SAST/.test(a.message), '12:05, the 12:00 check not answered yet → the 10:45 alert stays (no flicker)'); }
ok(evaluateWimpyBoard(st('12:00', { count: 0 }), S('12:10'), true) === null, '12:00 clean after a 10:45 alert → cleared');
{ const a = evaluateWimpyBoard(st('12:00', { count: 1, cards: [{ cb: 'CB300', at: '08:30', stage: 'Order Processing' }] }), S('12:10'), true);
  ok(a && /New Order or Order Processing/.test(a.message) && /CB300 \(08:30, Order Processing\)/.test(a.message) && /a card/.test(a.message) === false && /1 of today's order card is/.test(a.message), '12:00 with one in Order Processing → named, singular', a && a.message); }
{ const a = evaluateWimpyBoard(st('10:45', { ok: false, error: 'HighLevel answered 503: down' }), S('10:50'), true);
  ok(a && a.id === 'wimpy-board' && /^Could not read the Wimpy kitchen board for the 10:45 SAST check/.test(a.message), 'HighLevel failed → ONE "Could not read the Wimpy kitchen board" alert', a && a.message); }
{ const a = evaluateWimpyBoard(null, S('11:50'), true);
  ok(a && /^Could not read the Wimpy kitchen board: the 10:45 SAST check did not run/.test(a.message), 'the 10:45 check never recorded by 11:45 → "did not run"', a && a.message); }
ok(evaluateWimpyBoard(null, S('10:50'), true) === null, 'within the hour and not run yet → no opinion');
ok(evaluateWimpyBoard(st('10:45', { count: 3, cards }), S('10:50') + 86400000, true) === null, 'the next morning before 10:45 → yesterday\'s alert is gone');
ok(evaluateWimpyBoard(st('10:45', { count: 3, cards }), S('10:50'), false) === null, 'no WIMPY_CRON_SECRET on the Worker → no opinion at all');
ok(evaluateWimpyBoard({ ...st('10:45', { count: 3, cards }), day: '2026-11-28' }, SAT('11:00'), true) === null, 'Saturday → nothing');
{ const many = Array.from({ length: 40 }, (_, i) => ({ cb: 'CB' + i, at: '08:' + String(i).padStart(2, '0'), stage: 'New Order' }));
  const a = evaluateWimpyBoard(st('10:45', { count: 55, cards: many, truncated: true }), S('10:50'), true);
  ok(/and 15 more/.test(a.message) && /more cards than were read/.test(a.message), '55 waiting, 40 listed → "and 15 more", and a truncated read says so'); }
ok(evaluateFreshnessHas(), 'evaluateFreshness carries the board alert alongside the others');
function evaluateFreshnessHas() {
  const al = health.evaluateFreshness({ now: S('10:50'), wimpyBoard: st('10:45', { count: 3, cards }), wimpyBoardExpected: true });
  return al.filter((x) => x.id === 'wimpy-board').length === 1;
}

head('B3 · runHealthChecks: ask once when due, write the banner, survive the service down');
const store = {}; const inserts = [];
const DB = {
  select: async (q) => {
    if (q.startsWith('rules?key=in.')) return Object.entries(store).filter(([k]) => decodeURIComponent(q).includes(k)).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    const m = /^rules\?key=eq\.([^&]+)/.exec(q); if (m) { const k = decodeURIComponent(m[1]); return store[k] ? [{ key: k, value: store[k] }] : []; }
    return [];
  },
  rpc: async (fn) => (fn === 'db_health' ? { db_bytes: 1e9, wal_bytes: 1e6, dead_heavy: [] } : null),
  insert: async (table, rows) => { for (const r of rows) { store[r.key] = r.value; inserts.push(r.key); } },
  storageGet: async () => '',
};
const realFetch = globalThis.fetch, realNow = Date.now;
let wimpyCalls = [], wimpyMode = 'ok';
globalThis.fetch = async (input, o = {}) => {
  const u = String(typeof input === 'string' ? input : input.url);
  if (u.startsWith('https://wimpy.example/')) {
    wimpyCalls.push({ u, auth: (o.headers || {}).Authorization });
    if (wimpyMode === 'down') throw new Error('connect ECONNREFUSED');
    const slot = new URL(u).searchParams.get('slot');
    const s = st(slot, { count: 2, cards: cards.slice(0, 2) });
    store[WIMPY_BOARD_KEY] = { data: JSON.stringify(s) };                // the service stores it, as checkKitchenBoard does
    return new Response(JSON.stringify(s), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};
const opts = { env: { WIMPY_CRON_SECRET: 'cron-s3cret' }, wimpyUrl: 'https://wimpy.example' };
const alertsNow = () => JSON.parse((store['kv:health-alerts'] || { data: '{}' }).data).alerts || [];
try {
  Date.now = () => S('09:30');
  await health.runHealthChecks(DB, opts);
  ok(wimpyCalls.length === 0, '09:30 — the Wimpy service is not asked');
  Date.now = () => S('10:50');
  await health.runHealthChecks(DB, opts);
  ok(wimpyCalls.length === 1 && /\/api\/wimpy\/cron\/board\?slot=10%3A45$/.test(wimpyCalls[0].u) && wimpyCalls[0].auth === 'Bearer cron-s3cret', '10:50 — asked ONCE for the 10:45 slot, with the bearer', JSON.stringify(wimpyCalls));
  const a = alertsNow().filter((x) => x.id === 'wimpy-board');
  ok(a.length === 1 && /CB183/.test(a[0].message) && /CB47/.test(a[0].message), '…and the alert is in kv:health-alerts at once (the banner the recipients already get)', JSON.stringify(a));
  Date.now = () => S('11:00');
  const before = JSON.stringify(alertsNow().find((x) => x.id === 'wimpy-board'));
  await health.runHealthChecks(DB, opts);
  ok(wimpyCalls.length === 1, '11:00 — recorded, not asked again');
  ok(JSON.stringify(alertsNow().find((x) => x.id === 'wimpy-board')) === before, '…and the alert is word-for-word the same (since + message stable — the banner write-on-change sees no change from it)');
  Date.now = () => S('12:00'); wimpyMode = 'down';
  await health.runHealthChecks(DB, opts);
  ok(wimpyCalls.length === 2, '12:00 — asked for the 12:00 slot');
  ok(alertsNow().filter((x) => x.id === 'wimpy-board').length === 1 && /10:45 SAST/.test(alertsNow().find((x) => x.id === 'wimpy-board').message), 'the service down → nothing thrown, the 10:45 alert stands (one alert, no storm)');
  for (const t of ['12:10', '12:20', '12:30', '12:40', '12:50']) { Date.now = () => S(t); await health.runHealthChecks(DB, opts); }
  ok(wimpyCalls.length === 7, 'retried once per tick within the 12:00 hour (six asks), never more', wimpyCalls.length);
  Date.now = () => S('13:00');
  await health.runHealthChecks(DB, opts);
  const b = alertsNow().filter((x) => x.id === 'wimpy-board');
  ok(wimpyCalls.length === 7 && b.length === 1 && /12:00 SAST check did not run/.test(b[0].message), '13:00 — not asked; ONE "could not read … did not run" alert', JSON.stringify(b));
  Date.now = () => S('10:50'); wimpyCalls = [];
  await health.runHealthChecks(DB, { env: {}, wimpyUrl: 'https://wimpy.example' });
  ok(wimpyCalls.length === 0, 'without WIMPY_CRON_SECRET the Worker never calls the service');
} finally { globalThis.fetch = realFetch; Date.now = realNow; }

head('B4 · the two sides agree; no phone number');
ok(JSON.stringify(WIMPY_BOARD_SLOTS.map(([l]) => l)) === JSON.stringify(Object.keys(board.BOARD_SLOTS)), 'the Worker\'s slots are the service\'s: ' + Object.keys(board.BOARD_SLOTS).join(', '));
ok(WIMPY_BOARD_KEY === board.BOARD_KEY, 'one key: ' + board.BOARD_KEY);
ok(WIMPY_BOARD_SLOTS.every(([l, m]) => Number(l.slice(0, 2)) * 60 + Number(l.slice(3)) === m), 'each slot\'s minute matches its label');
{ const a = evaluateWimpyBoard(st('10:45', { count: 1, cards: [{ cb: 'CB1', at: '08:00', stage: 'New Order', phone: '0825550199' }] }), S('10:50'), true);
  ok(!/0825550199|555/.test(a.message), 'a stray field on a card never reaches the message'); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
