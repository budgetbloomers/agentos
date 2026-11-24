#!/usr/bin/env node
/**
 * board.test.mjs — the kitchen board check (2026-11-24), against a STUBBED HighLevel and Supabase.
 *
 *   node test/board.test.mjs   (or npm test)
 *
 *   A · 10:45 lists today's cards still in "New Order"; 12:00 adds "Order Processing"; yesterday's and finished cards
 *       are not counted; each card is named by its CB from today's ledger (or "not known"), never a phone or a name
 *   B · READ-ONLY to HighLevel: every call is a GET; the board is paged past 100 cards; the result is stored once
 *   C · HighLevel down / slow / unconfigured / no such stage → {ok:false, error} written once, never a throw
 *   D · the route: closed without CRON_SECRET, 401 on a wrong bearer, 400 on an unknown slot, the status on the right one
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => pathToFileURL(path.resolve(HERE, '..', 'src', rel)).href;
let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + String(extra).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);

const B = await import(SRC('wimpy-board.mjs'));
const APP = await import(SRC('app.mjs'));
const { checkKitchenBoard, matchCards, BOARD_KEY, sastDayStart } = B;

const NOW = Date.parse('2026-11-25T08:45:00Z');          // Wednesday 10:45 SAST
const at = (hm) => new Date(Date.parse('2026-11-25T' + hm + ':00+02:00')).toISOString();
const STAGES = [{ id: 's-new', name: 'New Order' }, { id: 's-proc', name: 'Order Processing' }, { id: 's-ready', name: 'Ready for Collection' }, { id: 's-done', name: 'Completed' }];
const card = (id, hm, stage, name, extra = {}) => ({ id, name, createdAt: at(hm), pipelineId: 'p-wimpy', pipelineStageId: stage, status: 'open',
  contact: { id: 'c-' + id, name, phone: '+27825550199' }, ...extra });

let H = {}, calls = [], rulesWrites = [], dbFail = false;
function world() {
  H = { mode: 'ok', cards: [
    card('o1', '08:02', 's-new', 'Avesh | 1 × Crispy Stack'),
    card('o2', '08:10', 's-new', 'Nomsa | 2 × Mzansi Brekkie'),
    card('o3', '09:15', 's-new', 'Zed | 1 × Rib Burger'),                    // no ledger row matches → CB not known
    card('o4', '08:30', 's-proc', 'Thabo | 1 × Dagwood'),
    card('o5', '08:31', 's-done', 'Lee | 1 × Cheese Burger'),
    card('o6', '08:32', 's-new', 'Old | 1 × Cheese Burger', { status: 'won' }),
    { ...card('y1', '08:00', 's-new', 'Yesterday | 1 × Cheese Burger'), createdAt: new Date(Date.parse(at('08:00')) - 86400000).toISOString() },
  ], ledger: [
    { cb: 'CB183', placed_at: at('08:01'), owner_user_id: 'u-a' },
    { cb: 'CB47', placed_at: at('08:09'), owner_user_id: 'u-n' },
    { cb: 'CB300', placed_at: at('08:29'), owner_user_id: 'u-t' },
  ], users: [{ id: 'u-a', full_name: 'Avesh Singh' }, { id: 'u-n', full_name: 'Nomsa Mthembu' }, { id: 'u-t', full_name: 'Thabo Mokoena' }] };
  calls = []; rulesWrites = []; dbFail = false;
}
const Jr = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, o = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (o.method || 'GET').toUpperCase();
  if (url.host === 'services.leadconnectorhq.com') {
    calls.push(method + ' ' + url.pathname + url.search);
    if (H.mode === 'down') throw new Error('connect ECONNREFUSED');
    if (H.mode === '500') return new Response('{"message":"Internal error"}', { status: 500 });
    if (H.mode === 'hang') return new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    if (url.pathname === '/opportunities/pipelines') return Jr({ pipelines: [{ id: 'p-other', name: 'Help Center', stages: [{ id: 'x', name: 'New Order' }] },
      { id: 'p-wimpy', name: 'Wimpy Pipeline', stages: H.mode === 'nostage' ? STAGES.filter((s) => s.id !== 's-proc') : STAGES }] });
    if (url.pathname === '/opportunities/search') {
      const page = Number(url.searchParams.get('page') || 1), lim = Number(url.searchParams.get('limit'));
      const all = H.cards.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return Jr({ opportunities: all.slice((page - 1) * lim, page * lim) });
    }
    return Jr({}, 404);
  }
  if (url.host === 'stub.local') {
    const t = url.pathname.replace('/rest/v1/', '');
    if (dbFail) return new Response('db down', { status: 503 });
    if (t === 'rules' && method === 'POST') { rulesWrites.push(JSON.parse(o.body)[0]); return new Response('', { status: 201 }); }
    if (t === 'wimpy_orders') return Jr(H.ledger);
    if (t === 'app_users') return Jr(H.users);
    return Jr([]);
  }
  throw new Error('BLOCKED outbound fetch to ' + url.host);
};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc', WIMPY_HL_API_KEY: 'pit-secret-key', WIMPY_HL_LOCATION_ID: 'loc-123', CRON_SECRET: 'cron-s3cret' };
const DB = (await import(SRC('db.mjs'))).db(ENV);
const fresh = () => { globalThis.__wimpyHlPipe = null; };

head('A · what is still waiting, by CB');
world(); fresh();
const s1 = await checkKitchenBoard(ENV, DB, { slot: '10:45', now: NOW });
ok(s1.ok && s1.count === 3 && s1.day === '2026-11-25' && s1.slot === '10:45', '10:45: three of today\'s cards still in New Order (a won card, a finished one, yesterday\'s and the processing one are not)', JSON.stringify(s1));
ok(JSON.stringify(s1.cards) === JSON.stringify([{ cb: 'CB183', at: '08:02', stage: 'New Order' }, { cb: 'CB47', at: '08:10', stage: 'New Order' }, { cb: null, at: '09:15', stage: 'New Order' }]),
  '…named CB183 08:02, CB47 08:10, and one whose CB is not known (no matching order)', JSON.stringify(s1.cards));
ok(!/555|0199|Avesh|Nomsa|Zed|Crispy|\+27/.test(JSON.stringify(s1)), '…no phone number, no name, no card title in the status');
world(); fresh();
const s2 = await checkKitchenBoard(ENV, DB, { slot: '12:00', now: NOW + 75 * 60000 });
ok(s2.ok && s2.count === 4 && s2.cards.some((c) => c.cb === 'CB300' && c.stage === 'Order Processing') && JSON.stringify(s2.stages) === '["New Order","Order Processing"]', '12:00: New Order AND Order Processing — four, Thabo\'s card as CB300', JSON.stringify(s2.cards));
ok(matchCards([card('z', '08:00', 's-new', 'Avesh | x')], [{ cb: 'cb183', placed_at: at('07:20'), first: 'Avesh' }], () => 'New Order')[0].cb === null, 'a card 40 min after an order is not that order (window −5 / +30 min)');
ok(matchCards([card('a', '08:02', 's-new', 'Avesh | x'), card('b', '08:03', 's-new', 'Avesh | y')], [{ cb: 'CB1', placed_at: at('08:01'), first: 'Avesh' }], () => '').filter((c) => c.cb).length === 1, 'one order names one card, never two');
ok(sastDayStart(NOW) === Date.parse('2026-11-24T22:00:00Z'), 'the day starts 00:00 SAST');

head('B · read-only, paged, stored');
world(); fresh();
await checkKitchenBoard(ENV, DB, { slot: '10:45', now: NOW });
ok(calls.length >= 2 && calls.every((c) => c.startsWith('GET ')), 'every HighLevel call is a GET (' + calls.length + ')', calls.join(' | '));
ok(calls.some((c) => /pipeline_id=p-wimpy/.test(c)) && !calls.some((c) => /p-other/.test(c)), 'only the Wimpy Pipeline is read (found by name — never another pipeline\'s "New Order")');
ok(rulesWrites.length === 1 && rulesWrites[0].key === BOARD_KEY && JSON.parse(rulesWrites[0].value.data).count === 3, 'one status row, kv:wimpy-board-status');
world(); fresh();
for (let i = 0; i < 130; i++) H.cards.push(card('m' + i, '07:' + String(10 + (i % 50)).padStart(2, '0'), i < 5 ? 's-new' : 's-done', 'P' + i + ' | x'));
const s3 = await checkKitchenBoard(ENV, DB, { slot: '10:45', now: NOW });
ok(calls.filter((c) => c.includes('/opportunities/search')).length === 2 && s3.count === 8, 'more than 100 cards today → the second page is read too (the board\'s lazy-load does not hide old cards here)', s3.count + ' ' + calls.length);
const again = await checkKitchenBoard(ENV, DB, { slot: '10:45', now: NOW });
ok(again.count === s3.count && JSON.stringify(again.cards) === JSON.stringify(s3.cards), 'running it twice gives the same answer (idempotent — it only reads)');

head('C · HighLevel down, slow, unconfigured, renamed — one "could not read", never a throw');
for (const [mode, want] of [['down', /could not be reached/], ['500', /500/], ['nostage', /Order Processing/]]) {
  world(); fresh(); H.mode = mode;
  let threw = false, s = null;
  try { s = await checkKitchenBoard(ENV, DB, { slot: '12:00', now: NOW }); } catch (e) { threw = true; }
  ok(!threw && s && s.ok === false && want.test(s.error) && rulesWrites.length === 1 && JSON.parse(rulesWrites[0].value.data).ok === false, 'HighLevel ' + mode + ' → {ok:false} with the reason, stored once', s && s.error);
  ok(!/pit-secret-key|loc-123/.test(JSON.stringify(s)), '…the key and location never in it');
}
{ world(); fresh(); H.mode = 'hang';
  const real = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...a) => real(f, Math.min(ms, 20), ...a);
  let s; try { s = await checkKitchenBoard(ENV, DB, { slot: '10:45', now: NOW }); } finally { globalThis.setTimeout = real; }
  ok(s.ok === false && /did not answer/.test(s.error), 'HighLevel silent → aborted, {ok:false}', s.error); }
{ world(); fresh(); const s = await checkKitchenBoard({ ...ENV, WIMPY_HL_API_KEY: '' }, DB, { slot: '10:45', now: NOW });
  ok(s.ok === false && /not configured/.test(s.error) && calls.length === 0, 'not configured → {ok:false}, no HighLevel call'); }
{ world(); fresh(); dbFail = true; let threw = false, s;
  try { s = await checkKitchenBoard(ENV, DB, { slot: '10:45', now: NOW }); } catch (e) { threw = true; }
  ok(!threw && s.ok && s.count === 3 && s.written === false && s.cards.every((c) => c.cb === null), 'Supabase down → still answers the count (CBs not known), says it was not stored, never throws', JSON.stringify(s)); }

head('D · GET /api/wimpy/cron/board');
const call = (q, bearer, env = ENV) => APP.handle(new Request('http://wimpy.test/api/wimpy/cron/board' + q, { headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} }), env, { waitUntil() {} });
world(); fresh();
ok((await call('?slot=10:45', 'cron-s3cret', { ...ENV, CRON_SECRET: '' })).status === 503, 'no CRON_SECRET → 503, closed');
ok((await call('?slot=10:45', 'wrong')).status === 401 && (await call('?slot=10:45', null)).status === 401, 'a wrong or missing bearer → 401');
ok((await call('?slot=09:00', 'cron-s3cret')).status === 400, 'an unknown slot → 400');
ok(calls.length === 0, '…none of those touched HighLevel');
const r = await call('?slot=10:45', 'cron-s3cret');
const j = await r.json();
ok(r.status === 200 && j.ok && j.slot === '10:45' && typeof j.count === 'number', 'the right bearer → 200 and the status', JSON.stringify(j).slice(0, 160));

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
