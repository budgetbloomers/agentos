#!/usr/bin/env node
/**
 * verify-qa-sales-sync.mjs — the sales sent to the QA tool (spec 039, 2026-10-28).
 *
 *   node nicks_code/diagnostics/verify-qa-sales-sync.mjs
 *
 * The pure half of tools/qa-sales-sync.mjs over synthetic rows (fake CBs): code format, campaign keys, the per-day
 * rows, and the delta (only changed days go; a day the engine no longer has is zeroed). The engine half is
 * digest-republish --qa-sales, reconciled live on 28 Oct (Cuddle 5,153 · Courtesy 4,472 · Training 62 — VAS to the case).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = await import(pathToFileURL(path.join(ROOT, 'tools', 'qa-sales-sync.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

console.log('\nA · the QA tool\'s formats');
ok('CB123, cb 123 and CB-0123 all become CB-123', ['CB123', 'cb 123', 'CB-0123'].every((v) => S.qaCb(v) === 'CB-123'));
ok('a value with no digits is no CB', S.qaCb('Jolene') === null);
ok('every campaign the Agent List has carried has a QA key', ['Cuddle', 'Courtesy', 'VT', 'Nesting', 'Download & Test', 'Training Gr 17']
  .map(S.campaignKey).join() === 'matrix_cuddle,matrix_courtesy,matrix_tracker,sales_lab,upsell,sales_lab');
ok('an unknown campaign has none (the run fails loudly rather than inventing one)', S.campaignKey('Upsell 2027') === null);

console.log('\nB · the rows');
const eng = [
  { code: 'CB9901', day: '2026-10-20', net: 9, made: 10, campaign: 'Cuddle', name: 'Test Person 01' },
  { code: 'CB9902', day: '2026-10-20', net: 4, made: 4, campaign: 'Courtesy', name: 'Test Person 02' },
  { code: 'CB9903', day: '2026-10-21', net: 2, made: 3, campaign: 'Training Gr 17', name: 'Test Person 03' },
  { code: 'CB9904', day: '2026-10-21', net: 1, made: 1, campaign: 'Mystery', name: 'Test Person 04' }
];
const { rows, unmapped } = S.toQaRows(eng);
ok('one row per agent per day, in the QA tool\'s CB format', rows.length === 3 && rows.every((r) => /^CB-\d+$/.test(r.cb)), J(rows));
ok('sales made and net carried as the engine counted them', rows.find((r) => r.cb === 'CB-9901').sales_made === 10 && rows.find((r) => r.cb === 'CB-9901').sales_net === 9);
ok('the trainee\'s day is filed under sales_lab', rows.find((r) => r.cb === 'CB-9903').campaign_key === 'sales_lab');
ok('an unmapped campaign is reported, never sent', unmapped.has('Mystery') && !rows.some((r) => r.cb === 'CB-9904'));

console.log('\nC · only the days that moved');
const have = [
  { cb: 'CB-9901', sale_date: '2026-10-20', sales_made: 10, sales_net: 9, campaign_key: 'matrix_cuddle', agent_name: 'Test Person 01' },   // unchanged
  { cb: 'CB-9902', sale_date: '2026-10-20', sales_made: 3, sales_net: 3, campaign_key: 'matrix_courtesy', agent_name: 'Test Person 02' },  // grew
  { cb: 'CB-9909', sale_date: '2026-10-19', sales_made: 2, sales_net: 2, campaign_key: 'matrix_cuddle', agent_name: 'Gone' }               // engine no longer has it
];
const send = S.rowsToSend(rows, have);
ok('an unchanged day is not sent', !send.some((r) => r.cb === 'CB-9901'));
ok('a changed day and a new day are sent', send.some((r) => r.cb === 'CB-9902' && r.sales_made === 4) && send.some((r) => r.cb === 'CB-9903'));
ok('a day the engine no longer has is zeroed, never left stale', send.some((r) => r.cb === 'CB-9909' && r.sales_made === 0 && r.sales_net === 0), J(send));
ok('a second run over the same data sends nothing', S.rowsToSend(rows, rows).length === 0);
ok('numbers PostgREST hands back as strings are not "changed" (no resend churn)',
  S.rowsToSend(rows, rows.map((r) => ({ ...r, sales_made: String(r.sales_made), sales_net: String(r.sales_net) }))).length === 0);

console.log('\nD · never wipe what the engine did not look at (silent-failure review, 29 Oct)');
ok('a day before the engine\'s first sales day is never zeroed (its history is shorter than the window)',
  !S.rowsToSend(rows, have, { coveredFrom: '2026-10-20' }).some((r) => r.cb === 'CB-9909'));
ok('a (cb, day) whose campaign had no QA key is held, not zeroed',
  !S.rowsToSend(rows, have, { hold: new Set(['CB-9909|2026-10-19']) }).some((r) => r.cb === 'CB-9909'));
const many = Array.from({ length: 40 }, (_, i) => ({ cb: 'CB-' + (9800 + i), sale_date: '2026-10-20', sales_made: 3, sales_net: 3, campaign_key: 'matrix_cuddle', agent_name: 'T' + i }));
ok('an empty engine run against a full QA table is refused', S.zeroingRefusal?.([], many, S.rowsToSend([], many)) != null);
ok('zeroing most of the table at once is refused', S.zeroingRefusal?.(many.slice(0, 5), many, S.rowsToSend(many.slice(0, 5), many)) != null);
ok('zeroing a handful (a corrected re-upload) is allowed', S.zeroingRefusal?.(many.slice(0, 38), many, S.rowsToSend(many.slice(0, 38), many)) === null);
ok('zeroing one day of a tiny table is allowed (a share means nothing on 3 rows)',
  S.zeroingRefusal?.(many.slice(0, 2), many.slice(0, 3), S.rowsToSend(many.slice(0, 2), many.slice(0, 3))) === null);
ok('a first sync into an empty table is allowed', S.zeroingRefusal?.(many, [], S.rowsToSend(many, [])) === null);

console.log('\nE · one unknown campaign never freezes everyone');
const mixed = S.toQaRows(eng);
ok('the unmapped (cb, day) is named so it can be held', Boolean(mixed.unmappedKeys?.has('CB-9904|2026-10-21')));
ok('every mapped agent-day is still produced', mixed.rows.length === 3);

console.log('\nF · agents QA knows but the Agent List does not (Nick, 29 Oct: "include them")');
const has = (fn) => typeof S[fn] === 'function';
ok('names are keyed the engine\'s way (normName)', has('ownerKey') && S.ownerKey('Jeremiah  Govindsamy - Panimax CB-206') === 'jeremiahgovindsamy');
const people = has('qaPeople') ? S.qaPeople([
  { name: 'Test Off List', cb: 'CB9950', campaign: 'matrix_cuddle' }, { name: 'Test Off List', cb: 'CB-9950', campaign: 'matrix_cuddle' },
  { name: 'Test Off List', cb: 'CB-9950', campaign: 'sales_lab' },
  { name: 'Twin Name', cb: 'CB-9960', campaign: 'matrix_courtesy' }, { name: 'Twin Name', cb: 'CB-9961', campaign: 'matrix_courtesy' },
  { name: 'Only Nesting', cb: 'CB-9970', campaign: 'sales_lab' },
  { name: 'No Campaign', cb: 'CB-9980', campaign: '' },
]) : new Map();
ok('one person per name, CB in the QA format', people.get('testofflist')?.cb === 'CB-9950');
ok('their campaign is the one QA evaluates them on most, nesting only when it is all there is',
  people.get('testofflist')?.campaign_key === 'matrix_cuddle' && people.get('onlynesting')?.campaign_key === 'sales_lab');
ok('a name two CBs share is never guessed', has('qaPeople') && !people.has('twinname'));
ok('a person with no campaign at all is not matched', has('qaPeople') && !people.has('nocampaign'));
const old = has('qaPeople') ? S.qaPeople([
  { name: 'Old Keys', cb: 'CB-9990', campaign: 'cuddle_calls' }, { name: 'Old Keys', cb: 'CB-9990', campaign: 'cuddle_calls' },
  { name: 'Was Vas', cb: 'CB-9991', campaign: 'vas' }, { name: 'Was Vas', cb: 'CB-9991', campaign: 'vas' }, { name: 'Was Vas', cb: 'CB-9991', campaign: 'matrix_courtesy' },
  { name: 'Mover', cb: 'CB-9992', campaign: 'matrix_courtesy', day: '2026-06-01' }, { name: 'Mover', cb: 'CB-9992', campaign: 'matrix_courtesy', day: '2026-06-02' },
  { name: 'Mover', cb: 'CB-9992', campaign: 'matrix_courtesy', day: '2026-06-03' }, { name: 'Mover', cb: 'CB-9992', campaign: 'matrix_cuddle', day: '2026-10-20' },
], { since: '2026-07-01' }) : new Map();
ok('a renamed campaign key is read as the current one (cuddle_calls → matrix_cuddle)', old.get('oldkeys')?.campaign_key === 'matrix_cuddle');
ok('the retired VAS campaign never wins over a live one', old.get('wasvas')?.campaign_key === 'matrix_courtesy');
ok('a mover takes the campaign QA evaluates them on in the window, not their old one', old.get('mover')?.campaign_key === 'matrix_cuddle');
const off = has('offListRows') ? S.offListRows({ 'testofflist|2026-10-20': { net: 5, made: 6 }, 'twinname|2026-10-20': { net: 2, made: 2 }, 'stranger|2026-10-20': { net: 1, made: 1 } }, people)
  : { rows: [], unknown: new Set(), matched: new Set() };
ok('an off-list owner QA knows becomes a row under their QA CB', off.rows.length === 1 && off.rows[0].cb === 'CB-9950' && off.rows[0].sales_net === 5 && off.rows[0].sales_made === 6 && off.rows[0].campaign_key === 'matrix_cuddle', J(off.rows));
ok('owners QA does not know (or cannot tell apart) stay out, and are counted', off.unknown.has('twinname') && off.unknown.has('stranger') && off.matched.has('testofflist'));
const clash = has('offListRows') ? S.offListRows({ 'testofflist|2026-10-20': { net: 5, made: 5 } }, people, new Map([['CB-9950', 'Somebody Else']])) : { rows: [1], clashes: new Set() };
ok('a QA CB the Agent List gives to a DIFFERENT person is never used (no sales onto someone else)', clash.rows.length === 0 && clash.clashes?.has('testofflist'), J(clash));
const same = has('offListRows') ? S.offListRows({ 'testofflist|2026-10-20': { net: 5, made: 5 } }, people, new Map([['CB-9950', 'Test  Off-List']])) : { rows: [] };
ok('the same person under another spelling still merges', same.rows.length === 1);
const merged = has('mergeRows') ? S.mergeRows([{ cb: 'CB-9950', sale_date: '2026-10-20', sales_made: 1, sales_net: 1, campaign_key: 'matrix_cuddle', agent_name: 'Test Off List' }], off.rows) : [];
ok('a CB with sales under both spellings that day is one row, summed', merged.length === 1 && merged[0].sales_made === 7 && merged[0].sales_net === 6, J(merged));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
