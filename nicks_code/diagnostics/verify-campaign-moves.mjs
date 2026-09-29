/* verify-campaign-moves.mjs — campaign moves by effective date (sprint 2026-09-29, item 2; D4).
 *
 * The Worker derives each mover's dated campaign segments from the dated Agent List snapshots
 * (worker/src/moves.mjs → GET /api/campaign-moves); PULSE splits the month on them. Proves:
 *   1 a move takes effect on the FIRST snapshot showing the new campaign; the month opens on the first
 *   2 agents who never changed campaign are not movers
 *   3 Nesting → Courtesy is a graduation, not a move (the month stays whole)
 *   4 an admin override replaces the derived segments; a one-segment override un-moves the agent
 *   5 snapshots are read in pages of 1000 (PostgREST's cap)
 *   6 only an admin can set a move; the dates must sit inside the month
 *
 * Run: node verify-campaign-moves.mjs   (no network, no credentials)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(path.join(HERE, '..', '..', 'worker', 'src', 'moves.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };

const snap = (as_of, employee_code, campaign) => ({ as_of, employee_code, campaign });
const SEPT = [
  snap('2026-09-03', 'CB121', 'Download & Test'), snap('2026-09-08', 'CB121', 'Download & Test'), snap('2026-09-14', 'CB121', 'Courtesy'), snap('2026-09-21', 'CB121', 'Courtesy'),
  snap('2026-09-03', 'CB-150', 'Download & Test'), snap('2026-09-14', 'cb150', 'Courtesy'),
  snap('2026-09-03', 'CB70', 'Cuddle'), snap('2026-09-14', 'CB70', 'Cuddle'),
  snap('2026-09-03', 'CB368', 'Nesting'), snap('2026-09-08', 'CB368', 'Nesting'), snap('2026-09-14', 'CB368', 'Courtesy'),
  snap('2026-09-03', 'CB233', 'Cuddle'), snap('2026-09-14', 'CB233', 'Courtesy'),
];

console.log('\n1–3 · deriving the movers');
{ const a = M.deriveMoves(SEPT, '2026-09');
  ok('CB121 opens the month on Download & Test and moves on 14 Sep', JSON.stringify(a.CB121 && a.CB121.map((s) => [s.from, s.campaign])) === JSON.stringify([['2026-09-01', 'Download & Test'], ['2026-09-14', 'Courtesy']]), JSON.stringify(a.CB121));
  ok('CB spellings normalise (CB-150 / cb150 → CB150)', !!a.CB150 && a.CB150.length === 2, JSON.stringify(Object.keys(a)));
  ok('a Cuddle → Courtesy move is a move', !!a.CB233);
  ok('an agent who stayed on Cuddle is not a mover', !a.CB70);
  ok('Nesting → Courtesy is a graduation, not a move', !a.CB368, JSON.stringify(a.CB368)); }

function fakeDB(rows, overrides) {
  const calls = [], writes = [];
  return { calls, writes,
    select: async (q) => {
      calls.push(q);
      if (q.startsWith('agent_list?')) { const off = +((/offset=(\d+)/.exec(q) || [])[1] || 0); return rows.slice(off, off + 1000); }
      if (q.startsWith('rules?')) return overrides ? [{ value: overrides }] : [];
      return [];
    },
    insert: async (_t, list) => { writes.push(...list); } };
}

console.log('\n4 · an admin override states the true day');
{ const DB = fakeDB(SEPT, { '2026-09': { CB121: [{ from: '2026-09-01', campaign: 'Download & Test' }, { from: '2026-09-11', campaign: 'Courtesy' }], CB150: [{ from: '2026-09-01', campaign: 'Courtesy' }] } });
  const r = await M.campaignMoves(DB, '2026-09');
  ok('the override replaces the derived date (11 Sep, not 14)', r.agents.CB121 && r.agents.CB121[1].from === '2026-09-11' && r.agents.CB121[1].source === 'override', JSON.stringify(r.agents.CB121));
  ok('a one-segment override means "not a mover"', !r.agents.CB150, JSON.stringify(r.agents.CB150));
  ok('the snapshot dates travel', JSON.stringify(r.lists) === JSON.stringify(['2026-09-03', '2026-09-08', '2026-09-14', '2026-09-21'])); }

{ const DB = fakeDB(SEPT, { '2026-09': { CB121: [{ from: '2026-09-16', campaign: 'Courtesy' }, { from: '2026-09-05', campaign: 'Download & Test' }, { from: '2026-09-16', campaign: 'Courtesy' }] } });
  const r = await M.campaignMoves(DB, '2026-09');
  ok('an override is sorted, de-duplicated, and its first segment opens the month', JSON.stringify(r.agents.CB121.map((s) => [s.from, s.campaign]))
    === JSON.stringify([['2026-09-01', 'Download & Test'], ['2026-09-16', 'Courtesy']]), JSON.stringify(r.agents.CB121)); }

console.log('\n5 · snapshots are paged');
{ const many = [];
  for (let i = 0; i < 1500; i++) many.push(snap('2026-09-03', 'CB' + (1000 + i), 'Courtesy'));
  many.push(snap('2026-09-03', 'CB9999', 'Download & Test'), snap('2026-09-14', 'CB9999', 'Courtesy'));
  const DB = fakeDB(many, null);
  const r = await M.campaignMoves(DB, '2026-09');
  ok('rows past the first 1000 are read', !!r.agents.CB9999, Object.keys(r.agents).join(','));
  ok('two pages were asked for', DB.calls.filter((q) => q.startsWith('agent_list?')).length === 2); }

console.log('\n6 · setting a move');
{ const DB = fakeDB([], {});
  const tl = await M.setCampaignMove(DB, { role: 'team_leader', username: 'cb267' }, { month: '2026-09', cb: 'CB121', segments: [] });
  ok('a team leader cannot set a move (403)', tl.status === 403);
  const bad = await M.setCampaignMove(DB, { role: 'admin', username: 'aarav' }, { month: '2026-09', cb: 'CB121', segments: [{ from: '2026-10-02', campaign: 'Courtesy' }] });
  ok('a date outside the month is refused (400)', bad.status === 400, JSON.stringify(bad));
  const good = await M.setCampaignMove(DB, { role: 'admin', username: 'aarav' }, { month: '2026-09', cb: 'cb-121', segments: [{ from: '2026-09-01', campaign: 'Download & Test' }, { from: '2026-09-11', campaign: 'Courtesy' }] });
  ok('an admin sets it', good.status === 200 && DB.writes.length === 1 && DB.writes[0].value['2026-09'].CB121.length === 2, JSON.stringify(good)); }

console.log('\n7 · a campaign manager sees only their campaign\'s days of a mover (portal.mjs bySegment)');
{ const { bySegment } = await import(pathToFileURL(path.join(HERE, '..', '..', 'worker', 'src', 'portal.mjs')).href);
  const row = { code: 'CB121', name: 'Joeline', tl: 'Denise', campaign: 'Courtesy', sales: 64, gwpEx: 5032.84, target: 90, act: 18, emp: 18,
    talk: 90000, calls: 900, qa: 0.9, canc: 3, ref: 2, rankCo: 12, gwp: 5787.77,
    days: [{ d: '2026-09-02', s: 3 }, { d: '2026-09-11', s: 2 }, { d: '2026-09-15', s: 4 }, { d: '2026-09-28', s: 5 }],
    segments: [{ campaign: 'Download & Test', from: '2026-09-01', to: '2026-09-13', sales: 22, gwpEx: 1365.28, target: 40, act: 9, emp: 9, plan: 'EXP_DOWNUP' },
      { campaign: 'Courtesy', from: '2026-09-14', to: '2026-09-28', sales: 42, gwpEx: 3667.56, target: 50, act: 9, emp: 9, plan: 'EXP_COURTESY' }] };
  const out = bySegment([row, { code: 'CB70', campaign: 'Cuddle', sales: 30, talk: 5 }]);
  const dt = out.find((r) => r.campaign === 'Download & Test'), co = out.find((r) => r.code === 'CB121' && r.campaign === 'Courtesy');
  ok('one row per campaign for the mover, the non-mover untouched', out.length === 3 && out[2].code === 'CB70' && out[2].talk === 5);
  ok('each row carries its own campaign\'s figures', dt.sales === 22 && co.sales === 42 && dt.target === 40 && co.target === 50);
  ok('each row carries only its own days', JSON.stringify(dt.days.map((d) => d.d)) === JSON.stringify(['2026-09-02', '2026-09-11'])
    && JSON.stringify(co.days.map((d) => d.d)) === JSON.stringify(['2026-09-15', '2026-09-28']), JSON.stringify([dt.days, co.days]));
  ok('whole-month-only figures never reach the earlier campaign', dt.talk == null && dt.calls == null && dt.qa == null && dt.canc == null && dt.ref == null && dt.rankCo == null, JSON.stringify(dt));
  ok('…and travel once, on the current campaign', co.talk === 90000 && co.calls === 900 && co.qa === 0.9);
  ok('attendance is the segment\'s own', dt.att === 1 && co.att === 1);
  ok('premium incl. VAT follows the segment', Math.abs(dt.gwp - 1570.07) < 0.02, String(dt.gwp)); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
