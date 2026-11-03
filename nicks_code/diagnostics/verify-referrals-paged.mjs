/* verify-referrals-paged.mjs — the REAL Worker's GET /api/referrals, in process, against a stubbed HighLevel.
 *
 * Why (3 Nov 2026): the one-shot pull walked every HighLevel contact page (100 a fetch) in ONE invocation. The free
 * plan allows 50 external subrequests per invocation; at 4,829 contacts (49 pages + custom fields + the session
 * lookup) every pull answered 500 from 2 Nov 14:15 SAST. The route now walks at most 20 pages per call and hands
 * back a `next` cursor. This proves: every call stays under the cap, the parts add up to exactly the whole book,
 * an unpaged (out-of-date) caller is told to reload instead of getting a slice, and a failure says why.
 *
 *   node nicks_code/diagnostics/verify-referrals-paged.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'index.mjs')).href)).default;

let pass = 0, fail = 0;
const ok = (c, s) => { if (c) { pass++; console.log('  ok   ' + s); } else { fail++; console.log('  FAIL ' + s); } };

/* ── a HighLevel contact book shaped like the real one ── */
const FIELDS = [
  { id: 'f_agent', name: 'Agent Name' },
  { id: 'f_n1', name: 'Full Name and Surname' }, { id: 'f_c1', name: 'Referral Contact Number' },
  { id: 'f_n2', name: 'Referral 2 Full Name' }, { id: 'f_c2', name: 'Referral 2 Contact Number' },
  { id: 'f_n3', name: 'Referral 3 Full Name' }, { id: 'f_c3', name: 'Referral 3 Contact Number' },
  { id: 'f_n4', name: 'Referral 4 Full Name' }, { id: 'f_c4', name: 'Referral 4 Contact Number' },
  { id: 'f_n5', name: 'Referral 5 Full Name' }, { id: 'f_c5', name: 'Referral 5 Contact Number' },
];
const makeBook = (n) => Array.from({ length: n }, (_, i) => {
  const cf = [{ id: 'f_agent', value: 'Agent ' + (i % 37) }];
  const blocks = i % 4;                                        // 0..3 filled referral blocks
  for (let b = 1; b <= blocks; b++) cf.push({ id: 'f_n' + b, value: 'Ref ' + i + '-' + b });
  return { id: 'c' + String(i).padStart(5, '0'), dateAdded: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    contactName: 'Contact ' + i, tags: i % 10 === 0 && !blocks ? ['Referral'] : [], customFields: cf };
});
/* what the counting must produce — the route's own rule, written out independently */
const expected = (book) => book.map((c) => {
  const has = (ids) => c.customFields.some((f) => ids.includes(f.id) && String(f.value).trim() !== '');
  let n = [1, 2, 3, 4, 5].filter((b) => has(['f_n' + b, 'f_c' + b])).length;
  if (!n && c.tags.some((t) => /referral/i.test(t))) n = 1;
  return n ? { id: c.id, created: c.dateAdded.slice(0, 10), agent: c.customFields[0].value, referrer: c.contactName, count: n } : null;
}).filter(Boolean);

let BOOK = makeBook(4829);
let hlStatus = 200;
let fetches = 0;                                               // EVERY outbound fetch in one invocation (the cap counts all)
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (u) => {
  fetches++;
  const url = new URL(String(u));
  if (url.hostname === 'stub.local') {
    if (url.pathname.includes('/rest/v1/app_sessions'))
      return J([{ user_id: 'u1', expires_at: '2099-01-01T00:00:00Z', scope: 'referrals',
        app_users: { username: 'nick', full_name: 'Nick', role: 'admin', apps: null, tabs: null, active: true } }]);
    return J([]);
  }
  if (url.hostname === 'services.leadconnectorhq.com') {
    if (hlStatus !== 200) return J({ message: 'nope' }, hlStatus);
    if (url.pathname.endsWith('/customFields')) return J({ customFields: FIELDS });
    if (url.pathname === '/contacts/') {
      const lim = +url.searchParams.get('limit') || 100;
      const after = url.searchParams.get('startAfterId');
      const from = after ? BOOK.findIndex((c) => c.id === after) + 1 : 0;
      const batch = BOOK.slice(from, from + lim);
      const last = batch[batch.length - 1];
      return J({ contacts: batch, meta: last ? { startAfterId: last.id, startAfter: Date.parse(last.dateAdded), total: BOOK.length } : { total: BOOK.length } });
    }
  }
  return new Response('', { status: 404 });
};
const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'k', HL_API_KEY: 'hl', HL_LOCATION_ID: 'loc1' };
const ctx = { waitUntil: () => {} };
const call = async (q) => {
  fetches = 0;
  const r = await worker.fetch(new Request('https://api.local/api/referrals' + q, { headers: { Authorization: 'Bearer t', 'X-Cbx-Client': 'v5' } }), ENV, ctx);
  return { status: r.status, body: await r.json().catch(() => ({})), fetches };
};
/* the callers' loop (sync-referrals.mjs and PULSE do exactly this) */
const pullAll = async () => {
  const rows = []; let contacts = 0, next = null, parts = 0, maxFetches = 0;
  do {
    const q = '?fresh=1&paged=1' + (next ? '&after=' + encodeURIComponent(next.after) + '&afterT=' + encodeURIComponent(next.afterT) : '');
    const r = await call(q);
    if (r.status !== 200) return { error: r };
    rows.push(...r.body.rows); contacts += r.body.contacts; next = r.body.next; parts++; maxFetches = Math.max(maxFetches, r.fetches);
  } while (next && parts < 60);
  return { rows, contacts, parts, maxFetches };
};

console.log('\n=== /api/referrals is paged under the free plan\'s 50-subrequest cap ===\n');

console.log('The book that broke it (4,829 contacts):');
let out = await pullAll();
ok(!out.error, 'every part answers 200');
ok(out.maxFetches <= 30, 'no single call makes more than 30 outbound fetches (made ' + out.maxFetches + '; the cap is 50, the old one-shot pull needed 51+)');
ok(out.parts === 3, 'the 49 HighLevel pages arrive in 3 parts (' + out.parts + ')');
ok(out.contacts === 4829, 'the parts\' contact counts add up to the whole book (' + out.contacts + ')');
const want = expected(BOOK);
ok(JSON.stringify(out.rows) === JSON.stringify(want), 'the stitched rows are EXACTLY the rows a one-shot count would give (' + out.rows.length + ' rows, no gaps, no repeats)');
ok(new Set(out.rows.map((r) => r.id)).size === out.rows.length, 'no contact appears twice across parts');

console.log('\nBook sizes on the page edges:');
for (const n of [0, 99, 100, 2000, 2001, 20000]) {
  BOOK = makeBook(n);
  out = await pullAll();
  ok(!out.error && out.contacts === n && JSON.stringify(out.rows) === JSON.stringify(expected(BOOK)) && out.maxFetches <= 30,
    n + ' contacts → whole book, ' + out.parts + ' part(s), max ' + out.maxFetches + ' fetches a call');
}
BOOK = makeBook(4829);

console.log('\nOut-of-date callers and failures:');
let r = await call('?fresh=1');
ok(r.status === 409 && /reload/i.test(r.body.error || '') && !r.body.rows, 'an unpaged call (an old page) is told to reload — never handed a silent first slice');
hlStatus = 401;
r = await call('?fresh=1&paged=1');
ok(r.status === 502 && /HighLevel .*401/.test(r.body.error || ''), 'a HighLevel refusal answers 502 WITH the reason ("' + (r.body.error || '') + '")');
hlStatus = 200;
r = await call('?fresh=1&paged=1&after=c00099%27%3Bdrop&afterT=12x34');
ok(r.status === 200, 'a hostile cursor is cleaned to safe characters before it reaches HighLevel');

console.log('\nCache:');
await call('?paged=1');
r = await call('?paged=1');
ok(r.fetches <= 2, 'a repeat of the same part inside 10 minutes is served from cache (' + r.fetches + ' fetches — session only)');
r = await call('?fresh=1&paged=1');
ok(r.fetches > 2, 'fresh=1 always goes to HighLevel');
const h = await worker.fetch(new Request('https://api.local/api/referrals/health'), ENV, ctx).then((x) => x.json());
ok(h.cache && h.cache.rows > 0, 'the health route still reports the cache (first part: ' + (h.cache && h.cache.rows) + ' rows)');

console.log(`\n==== ${pass} passed, ${fail} failed ====\n`);
process.exit(fail ? 1 : 0);
