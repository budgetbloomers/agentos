#!/usr/bin/env node
/* verify-vt-station-fixes.mjs — THE STATION'S REVIEW FOLLOW-UPS (Spec Kit 071, plan "Review fixes", done in Phase E).
 *
 * VTStation.ingest (nicks_code/vt-pages.js) in Node over a FICTIONAL file (vt-fixtures.mjs, CB91xx) against a scripted
 * Worker that records every call. Nothing leaves the machine.
 *   F1  a commit version_conflict → the station ABANDONS its own upload id before it begins again, then succeeds
 *   F2  begin answers 409 busy → refused in plain words, and nothing is ever staged into the returned (other) id
 *   F3  every named refusal (bad_date, bad_row, bad_file_name, vt_<step>_failed, the caps…) reads as a sentence
 *   F4  the merge read goes in parts above 15,000 case numbers, united by case number; parts of different revisions → retry
 *   F5  the Agent List in force is older than the newest list (list_as_of ≠ as_of) → a warning on the receipt
 *   F6  no body the station sends carries p_user (the Worker appends the session's own)
 *
 *   node nicks_code/diagnostics/verify-vt-station-fixes.mjs
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { biFile, xlsxBytes } from './vt-fixtures.mjs';
import { ROSTER_RPC, bookRpc } from './vt-digest-fixture.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
const ST = require(path.join(ROOT, 'nicks_code', 'vt-pages.js'));
const XLSX = createRequire(path.join(HERE, 'node_modules', 'x.js'))('xlsx');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + String(d).slice(0, 300) : '')); } };
const head = (t) => console.log('\n' + t);

const FILE = 'BI Active Fitted 101126.xlsx';
const BUF = xlsxBytes(biFile([{ cn: 90900001, seller: 'Alpha Test - Panimax', inst: '2026-11-09' }, { cn: 90900002, seller: 'Golf Hotel', inst: '2026-11-10' }]));
const HASH = 'c'.repeat(64);
const FOUND = { kind: 'vtBiFitted', sheet: 'Export' };
const EMPTY_BOOK = { rev: 7, openedOn: '2026-10-19', openingBookOn: null, cases: [], events: [] };
/* a scripted Worker: answers[path] is a list of answers consumed in order (the last one repeats) */
function worker(answers) {
  const calls = [];
  const fetch = async (u, o = {}) => {
    const url = new URL(u), p = url.pathname, body = o.body ? JSON.parse(o.body) : null;
    calls.push({ method: o.method || 'GET', p, body });
    const list = answers[p] || [{ status: 200, j: {} }];
    const a = list.length > 1 ? list.shift() : list[0];
    const j = typeof a.j === 'function' ? a.j(body) : a.j;
    return { status: a.status, ok: a.status >= 200 && a.status < 300, text: async () => JSON.stringify(j) };
  };
  return { fetch, calls };
}
const base = (extra = {}) => ({
  '/api/vt/uploads': [{ status: 200, j: { uploads: [] } }],
  '/api/vt/roster': [{ status: 200, j: ROSTER_RPC }],
  '/api/vt/book': [{ status: 200, j: EMPTY_BOOK }],
  '/api/vt/upload/begin': [{ status: 200, j: { id: 41 } }],
  '/api/vt/upload/stage': [{ status: 200, j: { ok: true } }],
  '/api/vt/upload/commit': [{ status: 200, j: { rev: 8 } }],
  '/api/vt/upload/abandon': [{ status: 200, j: { ok: true } }], ...extra });
const run = (w) => ST.ingest(FILE, BUF, HASH, 'vtBiFitted', FOUND, { fetch: w.fetch, XLSX, now: Date.parse('2026-11-10T08:00:00Z') });

head('F1 · a commit conflict abandons its own upload before it begins again');
{ const w = worker(base({ '/api/vt/upload/begin': [{ status: 200, j: { id: 41 } }, { status: 200, j: { id: 42 } }],
    '/api/vt/upload/commit': [{ status: 409, j: { error: 'version_conflict' } }, { status: 200, j: { rev: 9 } }] }));
  const res = await run(w);
  const seq = w.calls.filter((c) => /upload\/(begin|commit|abandon)/.test(c.p)).map((c) => c.p.split('/').pop() + (c.body && c.body.p_id ? ':' + c.body.p_id : ''));
  ok(res === true, 'the file is saved on the second attempt', res);
  ok(JSON.stringify(seq) === JSON.stringify(['begin', 'commit:41', 'abandon:41', 'begin', 'commit:42']), 'begin → commit(41) 409 → abandon(41) → begin → commit(42)', seq.join(' → '));
  ok(w.calls.filter((c) => c.p === '/api/vt/book').length === 2, 'the book is re-read before the retry (re-merge)'); }

head('F2 · busy: words, and never stage into the other upload');
{ const w = worker(base({ '/api/vt/upload/begin': [{ status: 409, j: { error: 'busy', id: 99, since: '2026-11-10T07:58:00Z' } }] }));
  const res = await run(w);
  ok(res === false, 'refused (nothing saved)');
  ok(!w.calls.some((c) => /upload\/(stage|commit|abandon)/.test(c.p)), 'no stage, commit or abandon touched upload 99', w.calls.map((c) => c.p).join(','));
  ok(/another station or tab/.test(ST.wordsFor({ status: 409, j: { error: 'busy', id: 99 } })), 'busy reads: "being loaded by another station or tab right now … try again in a few minutes"'); }

head('F3 · every refusal in plain words');
for (const code of ['bad_date', 'bad_row', 'bad_file_name', 'bad_extract_on', 'bad_cycle_key', 'duplicate_case', 'duplicate_event', 'too_many_uploads', 'upload_too_large', 'commit_too_large', 'batch_too_large', 'not_owner', 'stage_incomplete']) {
  const s = ST.wordsFor({ status: 409, j: { error: code, detail: 'x' } });
  ok(s && s !== code && !/_/.test(s) && /\.$/.test(s.trim()), code + ' → "' + s.slice(0, 70) + '…"');
}
for (const step of ['begin', 'stage', 'commit', 'abandon', 'book', 'roster']) {
  const s = ST.wordsFor({ status: 502, j: { error: 'vt_' + step + '_failed' } });
  ok(/^The server could not .+ just now\. Nothing was saved/.test(s) && !/vt_/.test(s), 'vt_' + step + '_failed → "' + s + '"');
}
ok(/Too much was sent/.test(ST.wordsFor({ status: 413, j: { error: 'Body too large' } })) || /Body too large/.test(ST.wordsFor({ status: 413, j: { error: 'Body too large' } })), '413 reads in words');
{ const w = worker(base({ '/api/vt/upload/commit': [{ status: 409, j: { error: 'bad_row', detail: 'vt_cases_status_check' } }] }));
  const res = await run(w);
  ok(res === false && w.calls.some((c) => c.p === '/api/vt/upload/abandon' && c.body.p_id === 41), 'a refused commit is abandoned, not retried as a conflict'); }

head('F4 · the merge read in parts above 15,000 case numbers');
{ const cns = Array.from({ length: 31000 }, (_, i) => 80000000 + i);
  const B = bookRpc('2026-10-26');
  const w = worker({ '/api/vt/book': [{ status: 200, j: (b) => ({ ...B, cases: b.p_also.length ? [[String(b.p_also[0]), 'scheduled', '2026-11-09', '2026-11-09', 'first_seen', '2026-11-09', '2026-11-09', '2026-11-12', null, ['MXV'], 100, 'revx', 'x', null, 'unmatched', null, null, 'RevX']].concat(B.cases) : B.cases }) }] });
  const book = await ST.readBook({ fetch: w.fetch }, '2026-10-26', cns);
  const parts = w.calls.filter((c) => c.p === '/api/vt/book').map((c) => c.body.p_also.length);
  ok(ST.ALSO_CHUNK === 15000 && JSON.stringify(parts) === '[15000,15000,1000]', 'three reads of ≤ 15,000 case numbers', parts.join(','));
  ok(book && book.cases['80000000'] && book.cases['80015000'] && book.cases['80030000'], 'the parts are united by case number');
  ok(book && book.events.length === B.events.length, 'events the parts share are kept once', book && book.events.length + ' vs ' + B.events.length);
  let n = 0; const w2 = worker({ '/api/vt/book': [{ status: 200, j: () => ({ ...B, rev: ++n }) }] });
  ok(await ST.readBook({ fetch: w2.fetch }, '2026-10-26', cns) === null, 'parts of different revisions → null (the book moved: the caller re-reads)'); }

head('F5 · a newer Agent List without VT rows is said on the receipt');
{ const w = worker(base({ '/api/vt/roster': [{ status: 200, j: { ...ROSTER_RPC, as_of: '2026-11-02', list_as_of: '2026-11-09' } }] }));
  await run(w);
  const cm = w.calls.find((c) => c.p === '/api/vt/upload/commit');
  ok(cm && cm.body.p_warnings.some((x) => /newest Agent List \(2026-11-09\) has no Vehicle Tracking rows/.test(x) && /2026-11-02/.test(x)), 'the receipt warns: the newest list (9 Nov) has no VT rows, the VT list of 2 Nov was used', cm && JSON.stringify(cm.body.p_warnings));
  const w2 = worker(base()); await run(w2);
  ok(!w2.calls.find((c) => c.p === '/api/vt/upload/commit').body.p_warnings.some((x) => /newest Agent List/.test(x)), 'the same date → no warning'); }

head('F6 · the station never sends p_user');
{ const w = worker(base({ '/api/vt/upload/commit': [{ status: 409, j: { error: 'version_conflict' } }, { status: 200, j: { rev: 9 } }] }));
  await run(w);
  const bodies = w.calls.filter((c) => c.body).map((c) => JSON.stringify(c.body));
  ok(bodies.length >= 6 && bodies.every((b) => !/p_user/.test(b)), 'no begin / stage / commit / abandon / book body carries p_user (' + bodies.length + ' bodies)'); }

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
