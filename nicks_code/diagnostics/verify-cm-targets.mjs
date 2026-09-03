/* CAMPAIGN TARGET SETTINGS — the contract, proved at every layer (Nick, 2026-09-01:
 * a target Dalwin sets "must change on the dashboard as well because this is the new
 * targets that was set by him").
 *
 * The design is ONE precedence chain shared verbatim by the Worker and PULSE:
 *   override exact → override campaign-wide → rule-book exact → rule-book
 *   campaign-wide → the Agent List's own cell
 * and this guard is what keeps "shared verbatim" true — it runs the Worker's
 * effPerDay() as a unit and PULSE's engine in a real browser over the SAME cases
 * and requires the same answers.
 *
 *   1  the Worker's matrix mirror equals the spec's sales_target_matrix (drift)
 *   2  effPerDay walks the chain in order
 *   3  cmSettingsApply: assignment gate, bounds, clear-restores, signed log, stamp
 *   4  cmSettingsBody scopes campaigns to the account and never hides provenance
 *   5  PULSE: the same override moves a real agent's target through the real
 *      engine, the digest carries the stamp it was built with, clearing restores
 *
 * Run:  node verify-cm-targets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const C = await import(pathToFileURL(path.join(AGENTOS, 'worker', 'src', 'campaign.mjs')).href);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* ---- 1 · the mirror never drifts from the spec ---------------------------------- */
const SPEC = JSON.parse(fs.readFileSync(path.join(AGENTOS, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const specTm = SPEC.reference_data.sales_target_matrix;
{
  const a = C.SALES_TARGET_MATRIX_DEFAULTS;
  const drift = [...new Set([...Object.keys(a), ...Object.keys(specTm)])]
    .filter((k) => !k.startsWith('_'))                     // the spec annotates itself (_source); values only
    .filter((k) => a[k] !== specTm[k]);
  ok('Worker matrix mirror equals the spec sales_target_matrix', !drift.length, drift.join(','));
}

/* ---- 2 · the chain, in order ----------------------------------------------------- */
{
  const ctx = (m) => ({ targets: { matrix: m } });
  ok('rule-book exact when nothing is set', C.effPerDay(ctx({}), 'Courtesy', 'Exp', 1) === 5);
  ok('rule-book campaign-wide when the tenure is unknown', C.effPerDay(ctx({}), 'Nesting', 'M9', 1) === 2);
  ok('the LIST cell only when the rule book is silent', C.effPerDay(ctx({}), 'VT', 'Exp', 6) === 6);
  ok('override exact beats everything', C.effPerDay(ctx({ 'Courtesy|Exp': 9 }), 'Courtesy', 'Exp', 1) === 9);
  ok('override campaign-wide beats the rule book EXACT row', C.effPerDay(ctx({ 'Courtesy|*': 7 }), 'Courtesy', 'Exp', 1) === 7,
    'a campaign-wide dial means ALL of that campaign');
  ok('…but an exact override still beats the campaign-wide one', C.effPerDay(ctx({ 'Courtesy|*': 7, 'Courtesy|Exp': 9 }), 'Courtesy', 'Exp', 1) === 9);
  const sla = C.slaFor({ sla: { qa_target: 90 }, targets: { sla: { courtesy: { qa_target: 85 } } } }, 'courtesy');
  ok('per-campaign quality dial overlays the global row', sla.qa_target === 85);
}

/* ---- 3 · apply: gates, bounds, signatures ---------------------------------------- */
{
  const writes = [];
  const DB = { insert: async (t, rows) => { writes.push(rows[0]); return null; },
    select: async () => [] };
  const ctx = { assign: { dalwin: { campaigns: ['courtesy', 'cuddle', 'nesting'] } }, sla: C.CM_SLA_DEFAULTS,
    targets: { matrix: {}, gwpMonth: {}, sla: {}, stamp: '', log: [] } };
  const dalwin = { role: 'campaign_manager', username: 'dalwin' };

  let r = await C.cmSettingsApply(DB, dalwin, ctx, { kind: 'matrix', key: 'VT|Exp', value: 4 });
  ok('a campaign the account does not run is refused', r.status === 403, JSON.stringify(r.body));
  r = await C.cmSettingsApply(DB, dalwin, ctx, { kind: 'matrix', key: 'Courtesy|Exp', value: 400 });
  ok('a fat-fingered value is refused with the range, never stored', r.status === 400 && !writes.length, JSON.stringify(r.body));
  r = await C.cmSettingsApply(DB, dalwin, ctx, { kind: 'matrix', key: 'Courtesy|Exp', value: 6 });
  ok('an assigned campaign saves', r.status === 200 && r.body.saved, JSON.stringify(r.body));
  const saved = writes[0] && writes[0].value;
  ok('…the value lands in cm:targets with a stamp', saved && saved.matrix['Courtesy|Exp'] === 6 && !!saved.stamp);
  ok('…and the change is SIGNED: who, what, old → new', saved && saved.log.length === 1
    && saved.log[0].by === 'dalwin' && saved.log[0].old === null && saved.log[0].new === 6, JSON.stringify(saved && saved.log));

  ctx.targets = saved;                                     // as the next request would see it
  r = await C.cmSettingsApply(DB, dalwin, ctx, { kind: 'matrix', key: 'Courtesy|Exp', value: null });
  const cleared = writes[writes.length - 1].value;
  ok('clearing removes the override entirely (the rule book is restored, not overwritten)',
    r.status === 200 && !('Courtesy|Exp' in cleared.matrix), JSON.stringify(cleared.matrix));
  ok('…and the clear is logged too', cleared.log.length === 2 && cleared.log[1].new === null);

  r = await C.cmSettingsApply(DB, { role: 'admin', username: 'nicholas' }, ctx, { kind: 'gwpMonth', key: 'vt', value: 50000 });
  ok('admin may touch a campaign no manager runs', r.status === 200 && r.body.saved, JSON.stringify(r.body));
  r = await C.cmSettingsApply(DB, dalwin, ctx, { kind: 'sla', key: 'courtesy:qa_target', value: 30 });
  ok('quality dials are bounds-checked as well', r.status === 400, JSON.stringify(r.body));
  r = await C.cmSettingsApply(DB, dalwin, ctx, { kind: 'nonsense', key: 'courtesy:x', value: 1 });
  ok('an unknown kind is refused', r.status === 400);
}

/* ---- 4 · the settings body: scope + provenance ----------------------------------- */
{
  const ctx = { assign: { dalwin: { campaigns: ['courtesy'] } }, sla: C.CM_SLA_DEFAULTS,
    targets: { matrix: { 'Courtesy|Exp': 6 }, gwpMonth: {}, sla: {}, stamp: '2026-09-01T10:00:00Z', log: [] } };
  const b = C.cmSettingsBody({ cmTargetsStamp: '' }, { role: 'campaign_manager', username: 'dalwin' }, ctx).body;
  ok('a manager sees only their campaigns', b.campaigns.length === 1 && b.campaigns[0].key === 'courtesy',
    JSON.stringify(b.campaigns.map((c) => c.key)));
  const row = b.campaigns[0].rows.find((r) => r.k === 'Courtesy|Exp');
  ok('an overridden row shows BOTH numbers — set 6 beside rule book 5', row && row.set === 6 && row.base === 5 && row.eff === 6,
    JSON.stringify(row));
  ok('a digest built on older targets is called out (pendingDigest)', b.pendingDigest === true);
  const all = C.cmSettingsBody({ cmTargetsStamp: ctx.targets.stamp }, { role: 'admin', username: 'nicholas' }, ctx).body;
  ok('admin sees every campaign, and a caught-up digest is not pending',
    all.campaigns.length >= 3 && all.pendingDigest === false, JSON.stringify({ n: all.campaigns.length, p: all.pendingDigest }));
}

/* ---- 5 · PULSE runs the same chain through the real engine ------------------------ */
console.log('\n== PULSE — the override moves a real target through the real engine ==');
{
  const HTML = path.join(AGENTOS, 'nicks_code', 'index.html');
  const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
    '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
    '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
  const srv = http.createServer((q, s) => {
    const u = q.url.split('?')[0];
    const p = SIDE[u] || (u === '/' ? HTML : null);
    if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(p).pipe(s);
  });
  await new Promise((r) => srv.listen(8264, '127.0.0.1', r));
  const b = await chromium.launch();
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await page.goto('http://127.0.0.1:8264/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.ingest, null, { timeout: 30000 });

  const out = await page.evaluate(async () => {
    const S = window.__mtd.state();
    /* one Courtesy Exp agent, one worked day, via the real ingest */
    S.roster.push({ code: 'CB901', name: 'Probe Agent', campaign: 'Courtesy', tenure: 'Exp', tl: 'Probe TL', target: 3, start: '' });
    const vh = ['call_date', 'user', 'full_name', 'status', 'lead_id', 'length_in_sec', 'campaign_id'].join('\t');
    const vr = ['2026-09-02 09:15:00', 'CB901', 'Probe Agent', 'SALE', 'L1', '200', 'PROBE'].join('\t');
    await window.__mtd.ingest('probe-vici.txt', vh + '\n' + vr);
    window.__mtd.setPeriod('2026-09', 'month');

    const tOf = () => { const f = (window.__mtd.model().facts || []).find((x) => x.code === 'CB901' && x.date === '2026-09-02'); return f ? f.target : null; };
    const book = tOf();                                    // rule book: Courtesy|Exp = 5 × 1 shift

    S.cmTargets = { matrix: { 'Courtesy|Exp': 9 }, stamp: 'probe-stamp' };
    window.__mtd.rebuild();
    const exact = tOf();

    S.cmTargets = { matrix: { 'Courtesy|*': 7 }, stamp: 'probe-stamp-2' };
    window.__mtd.rebuild();
    const star = tOf();                                    // campaign-wide beats the book's exact row

    const digest = (typeof agentDigestPayload === 'function') ? agentDigestPayload() : null;
    const stamp = digest && digest.cmTargetsStamp;

    S.cmTargets = null;
    window.__mtd.rebuild();
    const restored = tOf();

    /* clean the probe out */
    S.roster = S.roster.filter((a) => a.code !== 'CB901');
    delete S.calls['2026-09-02'];
    S.files = S.files.filter((f) => !/^probe-/.test(f.name));
    window.__mtd.rebuild();
    return { book, exact, star, stamp, restored };
  });

  ok('the rule book prices a Courtesy Exp shift at 5', out.book === 5, String(out.book));
  ok('an exact override moves it — 9', out.exact === 9, String(out.exact));
  ok('a campaign-wide override beats the book exact row — 7 (same chain as the Worker)', out.star === 7, String(out.star));
  ok('the digest says which targets it was built with', out.stamp === 'probe-stamp-2', String(out.stamp));
  ok('clearing restores the rule book exactly', out.restored === 5, String(out.restored));
  ok('PULSE: no page errors', !errs.length, errs.join(' | '));
  await b.close(); srv.close();
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
