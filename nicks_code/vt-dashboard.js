/* VT REPORT — the consolidated Vehicle Tracking dashboard (Spec Kit 072, Phase C, tasks C3–C5).
 *
 * ONE PAGE, the owner's mockup, in the suite's own skin: "VT Report · Campaign Performance Overview" inside the
 * Vehicle Tracking app (/pulse/?app=vt&page=vt_report), first in its NAV group.
 *
 * ENGINE DECIDES, PAGE PAINTS (non-negotiable 16, FR-003). Every figure on this screen is a field of ONE call,
 * VTEngine.dashboard(book, roster, {cycleKey, view, asOf, prev, isDataOnlyDay}) — the counts, the rates, the budgets
 * and their Sales Review cells, the dialing days, the straight-line forecast, the five lead-time buckets, the weeks,
 * the channels, the campaigns and the Panimax roll-up, the breakdown, the insights, the three integrity verdicts and
 * every sentence of explanation. THIS FILE CONTAINS NO ARITHMETIC ON A FIGURE AND NO THRESHOLD: it chooses a shape,
 * a length and a format. If a number is not on the model, the page says so in words rather than working it out.
 *
 * THE FOUR VIEWS (FR-007/008) are the workbook's own and come from the rule book, not from here. The page names the
 * one it is showing in plain words, and a panel whose rule differs from the view (lead time, upcoming fitments) says
 * so on itself.
 *
 * AN ABSENCE IS NOT A NOUGHT (non-negotiable 6). No previous cycle → every change reads the rule book's absent
 * marker with the reason; no Schedulers Data upload → the GWP and scheduler figures read "needs the Schedulers Data
 * upload"; a channel with no budget row → "—" and a sentence. Nothing here is ever filled in with a zero.
 *
 * THEME (FR-004): light/dark is the account's own (--vtc1…--vtc4 and the ink/grid tokens are defined in BOTH theme
 * blocks of index.html). Nothing on this page names a colour; the mockup's dark palette is never hard-coded.
 *
 * Loads like its siblings: <script src="vt-dashboard.js" data-inline> in PULSE → window.VTDash (works from file://,
 * inlined at build by tools/prepare-site.js); require() in the Node suites → module.exports.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTDash = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

var API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
var TAB = 'vt_report';
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var PORTAL_ROLES = ['agent', 'team_leader', 'campaign_manager'];

function E() { return root.VTEngine || (typeof require === 'function' ? require('./vt-engine.js') : null); }
function ST() { return root.VTStation || (typeof require === 'function' ? require('./vt-pages.js') : null); }
function PG() { var s = ST(); return (root.VTPages) || (s && s.Pages) || null; }
function CH() { return root.VTCharts || (typeof require === 'function' ? require('./vt-charts.js') : null); }
function R() { return E().VT_RULES; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function jsq(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
/** ONE formatter for the screen (and, in Phase E, the export) — VTPages' own, so the two pages never disagree */
function fmt(t, v) { var p = PG(); return p && p.fmtCell ? p.fmtCell(t, v) : (v == null ? absent() : String(v)); }
function absent() { var e = E(); return e ? R().reports.absent : '-'; }
var N = function (v) { return fmt('n', v); }, P = function (v) { return fmt('p', v); }, Rn = function (v) { return fmt('r', v); };
function monthOf(key) { return MONTHS[+key.slice(11, 13) - 1] + ' ' + key.slice(6, 10); }
function shortDay(d) { return d ? (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1].slice(0, 3) : absent(); }
function longDay(d) { return d ? (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1].slice(0, 3) + ' ' + d.slice(0, 4) : absent(); }
function sastToday() { return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); }

/* ---------------------------------------------------------------- state ----
 * The same loading machinery as the three VT report pages (vt-pages.js): one job at a time, a repaint when it lands,
 * and nothing shown from an old copy when a read fails. The view state is PER PERSON (S.ui.vtReport), never a shared
 * blob — the "all the data is wrong" incident was a shared UI blob (plan §P). */
var C = { book: null, bookFrom: null, bookAt: null, bookId: 0, rosters: {}, fallback: {}, receipts: null, recErr: false,
  prev: {}, prevPending: {}, status: 'idle', error: null, pending: null, memo: null, ui: {} };
function host() { return root.__mtd && typeof root.__mtd.state === 'function' ? root.__mtd.state() : null; }
function ui() { var S = host(); if (S && S.ui) { S.ui.vtReport = S.ui.vtReport || {}; return S.ui.vtReport; } return C.ui; }
function saveUi() { if (typeof root.saveUI === 'function') { try { root.saveUI(); } catch (e) { /* a view setting only */ } } }
function onTab() { var S = host(); return !S || !S.ui || String(S.ui.tab || '') === TAB; }
function repaint() { if (typeof root.renderPage === 'function' && onTab()) root.renderPage(); }
function isStaff() { var u = root.CBX_USER || null; return !!u && PORTAL_ROLES.indexOf(u.role) < 0; }
function DO() { return typeof root.dataOnlyDay === 'function' ? root.dataOnlyDay : undefined; }
function env() { return { fetch: root.__vtFetch || undefined }; }
function token() { try { return root.sessionStorage && root.sessionStorage.getItem('cbx_token'); } catch (e) { return null; } }
function base() { return root.__vtApiBase || API; }

function viewKey() { var u = ui(), ks = R().views.list.map(function (v) { return v.k; }); return ks.indexOf(u.view) > -1 ? u.view : R().views.default; }
function latestExtract() {
  var d = null; (C.receipts || []).forEach(function (u) { if (u.state === 'committed' && u.kind !== 'opening_book' && (!d || u.extract_on > d)) d = u.extract_on; });
  if (C.book) for (var cn in C.book.cases) { var l = C.book.cases[cn].lastSeen; if (l && (!d || l > d)) d = l; }
  return d;
}
function cycleKeys() {
  var Pd = E().periods, first = C.book && C.book.openedOn, out = [];
  (C.receipts || []).forEach(function (u) { if (u.state === 'committed' && (!first || u.extract_on < first)) first = u.extract_on; });
  var last = Pd.cycleOf(sastToday()).key, l = latestExtract(); if (l && Pd.cycleOf(l).key > last) last = Pd.cycleOf(l).key;
  for (var k = first ? Pd.cycleOf(first).key : last, i = 0; k <= last && i < 60; i++) { out.push(k); k = Pd.cycleOf(Pd.addDays(Pd.cycleByKey(k).to, 1)).key; }
  return out.reverse();
}
function currentCycle() {
  var Pd = E().periods, u = ui();
  if (u.cycle && /^cycle-\d{4}-\d{2}$/.test(u.cycle)) return Pd.cycleByKey(u.cycle);
  return Pd.cycleOf(latestExtract() || sastToday());
}
function prevKeyOf(cycleKey) { var Pd = E().periods; return Pd.cycleOf(Pd.addDays(Pd.cycleByKey(cycleKey).from, -1)).key; }

/* ---------------------------------------------------------------- loading ---- */
function fetchReceipts() {
  return ST().call(env(), 'GET', '/api/vt/uploads?limit=100').then(function (r) { C.receipts = ST().must(r, 'Reading the VT receipts').uploads || []; C.recErr = false; C.memo = null; })
    .catch(function () { C.receipts = C.receipts || []; C.recErr = true; });
}
function fetchBook(from) {
  return ST().call(env(), 'GET', '/api/vt/book?from=' + encodeURIComponent(from)).then(function (r) {
    C.book = E().bookFromRpc(ST().must(r, 'Reading the Vehicle Tracking book')); C.bookFrom = from; C.bookAt = Date.now(); C.bookId++; C.memo = null; });
}
function fetchRoster(cyc) {
  return ST().call(env(), 'GET', '/api/vt/roster?on=' + cyc.to).then(function (r) { C.rosters[cyc.key] = ST().rosterFromRpc(ST().must(r, 'Reading the Agent List')); C.fallback[cyc.key] = false; })
    .catch(function () { var S = host(); C.rosters[cyc.key] = ST().rosterFromPulse((S && S.roster) || []); C.fallback[cyc.key] = true; })
    .then(function () { C.memo = null; });
}
/* THE PREVIOUS CYCLE (FR-018, Phase B build note): the FROZEN digest key kv:vt-digest-cycle-<prev> when one exists,
   otherwise the engine's own VTEngine.prevCycleFor() over the same book. The page says which it used — and says what
   the published figure's window is, because the frozen digest's floor is the model's "in play" month-to-date set and
   not this page's cycle view. Fields are RENAMED, never recomputed: the figures the frozen key does not carry in the
   same shape (Target Achieved, the per-channel split) travel as null, so their change reads the absent marker. */
function fetchPrev(key) {
  var want = 'vt-digest-' + key, tk = token();
  if (!tk) { C.prev[key] = { source: 'none', why: 'this session has no token, so the frozen digest could not be read' }; return Promise.resolve(); }
  var f = root.__vtFetch || root.fetch;
  return f(base() + '/api/kv?key=' + encodeURIComponent(want), { headers: { Authorization: 'Bearer ' + tk, 'X-Cbx-Client': 'v5' } })
    /* GET /api/kv?key= serves the stored payload as the body itself (text/plain), not wrapped in an envelope */
    .then(function (r) { return r.ok ? r.text() : null; }, function () { return null; })
    .then(function (t) {
      var v = null; try { v = t ? JSON.parse(t) : null; } catch (e) { v = null; }
      var fl = v && v.floor && v.floor.mtd;
      if (!v || v.empty || !fl || fl.sales == null) { C.prev[key] = { source: 'none', why: 'no frozen digest is published for ' + key }; return; }
      C.prev[key] = { source: 'digest', cycle: key, updatedAt: v.updatedAt || null,
        prev: { cycle: key, present: true, counts: { sales: fl.sales, fitted: fl.fitted, cancelled: fl.cancelled, missed: fl.missed, achievement: null, channels: null } } };
    }).catch(function () { C.prev[key] = { source: 'none', why: 'the frozen digest for ' + key + ' could not be read' }; });
}
function ensure() {
  if (C.pending || C.status === 'error') return;
  var job = null, cyc = currentCycle(), pk = prevKeyOf(cyc.key);
  if (!C.receipts) job = fetchReceipts();
  else if (!C.book || C.bookFrom > cyc.from) job = fetchBook(cyc.from);
  else if (!C.rosters[cyc.key]) job = fetchRoster(cyc);
  else if (!C.prev[pk] && !C.prevPending[pk]) { C.prevPending[pk] = 1; job = fetchPrev(pk); }
  if (!job) return;
  C.status = 'loading';
  C.pending = job.then(function () { C.status = 'ready'; C.error = null; }, function (e) { C.status = 'error'; C.error = String((e && e.message) || e); })
    .then(function () { C.pending = null; ensure(); if (!C.pending) repaint(); });
}
function ready() { var cyc = currentCycle(); return !!(C.receipts && C.book && C.bookFrom <= cyc.from && C.rosters[cyc.key]); }
function retry() { C.status = 'idle'; C.error = null; C.prevPending = {}; ensure(); repaint(); }

/* THE one model call. Memoised on the book, the cycle, the view and which previous-cycle source answered, so a
   repaint never recomputes and never computes a second, slightly different, set of figures. */
function model() {
  var cyc = currentCycle(), v = viewKey(), pk = prevKeyOf(cyc.key), src = C.prev[pk] || null;
  var key = C.bookId + '|' + cyc.key + '|' + v + '|' + (src ? src.source : 'pending');
  if (C.memo && C.memo.key === key) return C.memo.D;
  var eng = E(), roster = C.rosters[cyc.key], asOf = latestExtract() || undefined;
  var prev = src && src.prev ? src.prev : eng.prevCycleFor(C.book, roster, cyc.key, { asOf: asOf, isDataOnlyDay: DO() });
  var D = eng.dashboard(C.book, roster, { cycleKey: cyc.key, view: v, asOf: asOf, prev: prev, isDataOnlyDay: DO() });
  D.prevSource = src && src.prev ? 'digest' : 'engine';
  D.prevWhy = src && src.why ? src.why : null;
  D.prevFromEngine = src && src.prev ? null : prev;
  C.memo = { key: key, D: D };
  return D;
}
function adopt(receipt, book, roster) {
  var cyc = E().periods.cycleOf(receipt.extractOn);
  C.book = book; C.bookFrom = cyc.from; C.bookAt = Date.now(); C.bookId++; C.rosters[cyc.key] = roster; C.fallback[cyc.key] = !!receipt.rosterFallback;
  C.receipts = null; C.memo = null; C.status = 'idle';
  if (onTab()) { ensure(); repaint(); }
}

/* ---------------------------------------------------------------- HTML helpers (PULSE's own classes) ---- */
function panel(o) {
  return '<div class="card mt vt-panel" data-panel="' + esc(o.id) + '"><div class="cardhead"><div><h3>' + esc(o.title) + '</h3>'
    + (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : '') + '</div></div>'
    + (o.body || '') + (o.notes || []).filter(Boolean).map(function (n) { return '<p class="why">' + n + '</p>'; }).join('') + '</div>';
}
function warn(title, sub, body, tone) {
  return '<div class="card mt vt-state" data-tone="' + (tone || 'warn') + '" style="border-left:3px solid var(' + (tone === 'crit' ? '--crit' : tone === 'info' ? '--accent' : '--amber') + ')">'
    + '<div class="cardhead"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div></div>'
    + (body ? '<p class="note" style="max-width:none">' + body + '</p>' : '') + '</div>';
}
/** the table every chart is paired with: the required secondary encoding, and the figures in full (SC-006) */
function table(cols, rows, cls) {
  return '<div class="tablewrap"><table class="data vt-table' + (cls ? ' ' + cls : '') + '"><thead><tr>'
    + cols.map(function (c) { return '<th class="' + (c.l ? 'l' : '') + '">' + esc(c.h) + '</th>'; }).join('')
    + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr class="' + (r.cls || '') + '">' + cols.map(function (c, i) {
        var v = r.cells[i];
        return '<td class="' + (c.l ? 'l' : '') + '">' + (v && v.html ? v.html : esc(v == null ? absent() : String(v))) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
}
/** a change against the previous cycle, or the absent marker with the reason (FR-019) */
function deltaHtml(d, t, words) {
  if (!d || d.abs == null) return '<span class="dlt flat vt-absent" title="' + esc(words || '') + '">' + esc(absent()) + ' vs previous cycle</span>';
  var up = d.abs > 0, flat = d.abs === 0;
  var arrow = flat ? '=' : up ? '▲' : '▼';
  return '<span class="dlt ' + (flat ? 'flat' : up ? 'up' : 'down') + '">' + arrow + ' ' + esc(fmt(t, Math.abs(d.abs)))
    + (d.pct == null ? '' : ' (' + esc(P(Math.abs(d.pct))) + ')') + ' vs previous cycle</span>';
}
var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--good)" stroke-width="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--crit)" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';

/* ---------------------------------------------------------------- head + controls (C3) ---- */
function headHtml(D) {
  var cyc = currentCycle();
  var sub = 'Business month ' + monthOf(cyc.key) + ' · ' + shortDay(cyc.from) + ' – ' + longDay(cyc.to)
    + (D ? ' · ' + D.viewLabel + ' · figures to ' + longDay(D.dataThrough) + ' · ' + D.dialingDays.words : '');
  return '<div class="page-head"><h2>VT Report · Campaign Performance Overview</h2><div class="sub vt-period">' + esc(sub) + '</div><div class="spacer"></div></div>';
}
function controlsHtml(D) {
  var opt = function (v, label, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; };
  var html = '<select aria-label="Business month" data-vtr="cycle" onchange="VTDash.set(\'cycle\',this.value)">'
    + cycleKeys().map(function (k) { return opt(k, monthOf(k) + ' (26th–25th)', k === currentCycle().key); }).join('') + '</select>'
    + '<select aria-label="View" data-vtr="view" onchange="VTDash.set(\'view\',this.value)">'
    + R().views.list.map(function (v) { return opt(v.k, v.label, v.k === viewKey()); }).join('') + '</select>';
  return '<div class="filters vt-filters">' + html + '</div>'
    + (D ? '<p class="note vt-viewwords" style="margin:0 0 10px;max-width:none"><b>' + esc(D.viewLabel) + '</b> — ' + esc(D.viewWords) + '. '
      + esc(D.openOutcomesInCycleOnly ? 'Scheduled, Missed and Cancelled are counted in-cycle only, which is what the Sales Review cells do and what makes the outcomes reconcile to total sales.' : 'Every outcome in this view is counted, whenever the sale was dated.')
      + ' Lead time and upcoming fitments cover all bookings whatever this is set to, and say so on their own panels.</p>' : '');
}

/* ---------------------------------------------------------------- the honest states ---- */
function statesHtml(D) {
  var out = [], cyc = currentCycle();
  if (C.fallback[cyc.key]) out.push(warn('Agent List read from this page', 'the server roster could not be reached',
    'Sellers and schedulers resolve against PULSE\'s own roster rows until the Worker answers, so a name may show as unmatched that is on the list. Refresh to try again.'));
  if (C.recErr) out.push(warn('Upload receipts could not be read', '', 'Missing-day warnings are not checked on this screen until the receipts load again.'));
  var gaps = E().uploadGaps(C.receipts, { period: { from: D.period.from, asOf: D.period.asOf } }, DO());
  if (gaps.length) out.push(warn('A day\'s upload is missing', gaps.length + ' working day' + (gaps.length === 1 ? '' : 's') + ' in this business month',
    gaps.map(function (g) { return '<b>' + esc(shortDay(g.date)) + '</b>: no ' + esc(g.missing.join(' or ')); }).join(' · ')
    + '. Every figure on this page still counts what did arrive; load the missing day\'s files in the Upload Station.'));
  if (!D.gwp.loaded || !D.schedulers.loaded) out.push(warn('Needs the Schedulers Data upload', 'the scheduler, the GWP and the true sale date come from that sheet and from nothing else',
    esc(D.gwp.words) + ' ' + esc(D.schedulers.words) + ' Nothing on this page is filled in with a zero in its place.', 'info'));
  if (!D.prevCycle.present) out.push(warn('No previous cycle to compare with', D.prevCycle.cycle ? monthOf(D.prevCycle.cycle) : '',
    esc(D.prevCycle.words) + (D.prevWhy ? ' (' + esc(D.prevWhy) + ')' : ''), 'info'));
  if (D.unmapped.length) out.push(warn('Campaigns not in the channel map (' + D.unmapped.length + ')', 'they are counted under Other and named here, never dropped',
    '<b>' + D.unmapped.map(esc).join('</b>, <b>') + '</b>. Add the campaign to the rule book\'s channel map (specs/vt_engine_rules.json and the inlined VT_RULES together) and it moves to its own channel on the next paint.'));
  if (D.unmatched.sellers.length) out.push(warn('Sellers not on the Agent List (' + D.unmatched.sellers.length + ')', 'they count in every total, never as a person row',
    (isStaff() ? 'As Salesforce spells them: <b>' + D.unmatched.sellers.map(esc).join('</b>, <b>') + '</b>. ' : '') + 'Add or correct them on the Agent List and they resolve on the next upload.'));
  if (D.schedulers.loaded && D.unmatched.schedulers.length) out.push(warn('Schedulers not on the Agent List (' + D.unmatched.schedulers.length + ')', 'counted as typed, never guessed away',
    (isStaff() ? 'As the sheet spells them: <b>' + D.unmatched.schedulers.map(esc).join('</b>, <b>') + '</b>. ' : '') + 'Their figures still count in every scheduler total.'));
  return out.join('');
}

/* ---------------------------------------------------------------- 1–5 · the KPI cards ---- */
function kpisHtml(D) {
  var ch = CH(), weekLabels = D.weeks.map(function (w) { return w.label; });
  var series = { sales: 'sales', fitted: 'fitted', cancelled: 'cancelled', missed: 'missed' };
  var cards = D.kpis.map(function (k) {
    if (k.k === 'targetAchieved') {
      return '<div class="vt-kpi" data-kpi="' + esc(k.k) + '"><div class="lab">' + esc(k.label) + '</div>'
        + ch.ring({ value: k.value, centre: k.value == null ? absent() : P(k.value), centreLabel: 'of budget', title: k.label, text: k.words, desc: k.words })
        + '<div class="sub">' + esc(k.words) + (k.cell ? ' — ' + esc(k.cell) : '') + '</div>'
        + deltaHtml(k.delta, 'p', D.prevCycle.words) + '</div>';
    }
    var vals = D.weeks.map(function (w) { return w[series[k.k]]; });
    return '<div class="vt-kpi" data-kpi="' + esc(k.k) + '"><div class="lab">' + esc(k.label) + '</div>'
      + '<div class="val">' + esc(N(k.value)) + '</div>'
      + '<div class="sub">' + esc(k.words) + '</div>'
      + deltaHtml(k.delta, 'n', D.prevCycle.words)
      + '<div class="spk">' + ch.spark({ values: vals, label: k.label + ' by week: ' + weekLabels.map(function (l, i) { return l + ' ' + N(vals[i]); }).join(', '),
        emptyWords: 'only one week of figures so far, so there is no trend to draw yet' }) + '</div></div>';
  }).join('');
  return '<div class="vt-kpis" data-panel="kpis">' + cards + '</div>'
    + '<p class="why" style="margin:8px 0 0">Each card\'s change is against ' + esc(D.prevCycle.present ? monthOf(D.prevCycle.cycle || prevKeyOf(D.period.key)) : 'the previous cycle')
    + ', taken from ' + (D.prevSource === 'digest' ? 'the frozen <b>' + esc('kv:vt-digest-' + (D.prevCycle.cycle || '')) + '</b> that month published'
      + ' — a published month-to-date figure, which is a wider window than this page\'s ' + esc(D.viewLabel).toLowerCase() + ', so Target Achieved and the per-channel changes read ' + esc(absent()) + ' rather than compare two different definitions'
      : 'this page\'s own engine recomputation of that cycle from the same case book (no frozen digest answered)') + '. '
    + esc(D.prevCycle.words) + ' The sparkline is the model\'s own weeks, nothing smoothed.</p>';
}

/* ---------------------------------------------------------------- 6 · Performance Trend ---- */
function trendHtml(D) {
  var ch = CH(), labels = D.weeks.map(function (w) { return w.label; });
  var body = ch.line({
    title: 'Sales by week against the per-week target', labels: labels, h: 260,
    series: [{ name: 'Sales', values: D.weeks.map(function (w) { return w.sales; }), color: ch.hue(0) },
      { name: 'Target', values: D.weeks.map(function (w) { return w.target; }), color: ch.hue(3), dashed: true }],
    flags: D.weeks.map(function (w) { return !!(w.preCycle || w.postCycle); }),
    flagWords: 'outside the cycle — no dialing days, so no target',
    fmt: function (v) { return fmt('d2', v); },
    emptyWords: 'No week in this view carries a sale yet'
  });
  /* NO ATTAINMENT COLUMN HERE ON PURPOSE: the model's weeks[] carry sales and target but no per-week attainment
     verdict, and the page may not divide one by the other (FR-003). The two figures sit side by side instead. */
  var rows = D.weeks.map(function (w) {
    return { cls: w.preCycle || w.postCycle ? 'subtotal' : '',
      cells: [w.label, N(w.sales), N(w.fitted), N(w.scheduled), N(w.missed), N(w.cancelled),
        w.dialingDays == null ? absent() : N(w.dialingDays), w.target == null ? absent() : fmt('d2', w.target),
        w.fittedOnly ? 'fitted only — fitted rollovers, not a real week' : w.preCycle ? 'before the cycle: no dialing days, so no target' : w.postCycle ? 'after the cycle end' : ''] };
  });
  return panel({ id: 'trend', title: 'Performance Trend', sub: 'sales by week against the per-week target · ' + D.viewLabel,
    body: body + table([{ h: 'Week', l: 1 }, { h: 'Sales' }, { h: 'Fitted' }, { h: 'Scheduled' }, { h: 'Missed' }, { h: 'Cancelled' }, { h: 'Dialing days' }, { h: 'Target' }, { h: 'Note', l: 1 }], rows),
    notes: [esc(D.weekWords), D.weeks.some(function (w) { return w.fittedOnly; })
      ? esc(R().views.rollover.preCycleWeeksAreFittedOnly) : ''] });
}

/* ---------------------------------------------------------------- 7 · Channel Performance ---- */
function channelHtml(D) {
  var ch = CH();
  var slices = D.channels.map(function (t, i) { return { label: t.label, value: t.sales, share: t.share, color: ch.hue(i) }; });
  var body = ch.donut({ title: 'Sales by channel', slices: slices, total: D.counts.sales, centreLabel: 'sales in view',
    fmt: N, pct: P, emptyWords: 'No sale in this view carries a channel yet' });
  var rows = D.channels.map(function (t) {
    return { cells: [t.label + (t.srLabel && t.srLabel !== t.label ? ' (Sales Review: ' + t.srLabel + ')' : ''), N(t.sales), t.share == null ? absent() : P(t.share),
      N(t.fitted), t.fitRate == null ? absent() : P(t.fitRate), t.salesBudget == null ? absent() : N(t.salesBudget), t.achievement == null ? absent() : P(t.achievement)] };
  });
  var rolls = D.campaignRollups.map(function (t) {
    return { cls: 'subtotal', cells: [t.label + ' (roll-up)', N(t.sales), absent(), N(t.fitted), t.fitRate == null ? absent() : P(t.fitRate),
      t.salesBudget == null ? absent() : N(t.salesBudget), absent()] };
  });
  return panel({ id: 'channels', title: 'Channel Performance', sub: 'the view\'s sales split four ways · ' + D.viewLabel,
    body: body + table([{ h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Share' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Sales budget' }, { h: 'Achievement' }], rows.concat(rolls)),
    notes: [esc(R().channels.dimension.charAt(0).toUpperCase() + R().channels.dimension.slice(1)) + '. A campaign the rule book does not map falls to Other and is named above the panels, never dropped.',
      D.campaignRollups.map(function (t) { return esc(t.words); }).join(' '),
      D.channels.filter(function (t) { return t.salesBudget == null; }).map(function (t) { return esc(t.label + ': ' + t.targetWords); }).join(' ')] });
}

/* ---------------------------------------------------------------- 8 · Campaign Breakdown ---- */
function campaignHtml(D) {
  var ch = CH();
  var rows = D.campaigns.map(function (c) {
    return { label: c.name + (c.mapped ? '' : ' (unmapped)'), value: c.sales, share: c.share, note: R().channels.labels[c.channel] };
  }).concat(D.campaignRollups.map(function (t) { return { label: t.label, value: t.sales, rollup: true, note: 'roll-up of ' + t.members.map(function (m) { return R().channels.labels[m]; }).join(' + ') }; }));
  var body = ch.hbars({ title: 'Sales by campaign, largest first', rows: rows, fmt: N, pct: P, color: ch.hue(0),
    emptyWords: 'No campaign in this view carries a sale yet' });
  var tr = D.campaigns.map(function (c) {
    return { cells: [c.name, R().channels.labels[c.channel] + (c.mapped ? '' : ' — not in the channel map'), N(c.sales), c.share == null ? absent() : P(c.share),
      N(c.fitted), c.fitRate == null ? absent() : P(c.fitRate), N(c.scheduled), N(c.missed), N(c.cancelled)] };
  }).concat(D.campaignRollups.map(function (t) {
    return { cls: 'subtotal', cells: [t.label + ' (roll-up)', t.members.map(function (m) { return R().channels.labels[m]; }).join(' + '), N(t.sales), absent(),
      N(t.fitted), t.fitRate == null ? absent() : P(t.fitRate), N(t.scheduled), N(t.missed), N(t.cancelled)] };
  }));
  return panel({ id: 'campaigns', title: 'Campaign Breakdown', sub: 'sales by Campaign/Partner, with Panimax as a named roll-up · ' + D.viewLabel,
    body: body + table([{ h: 'Campaign', l: 1 }, { h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Share' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Scheduled' }, { h: 'Missed' }, { h: 'Cancelled' }], tr),
    notes: ['Ranked bars, not a ring: two of these campaigns are a couple of records and a ring would hide them. The roll-up is drawn hollow and labelled, and is never added into a total beside its own members.'] });
}

/* ---------------------------------------------------------------- 9 · Cycle Performance (the 5 buckets) ---- */
function bucketsHtml(D) {
  var ch = CH();
  var body = ch.meters({ title: 'Open scheduled cases by lead time, against each bucket\'s target', rows: D.buckets.map(function (b) {
    return { label: b.label, value: b.count, target: b.target, note: b.words || (b.share == null ? '' : P(b.share) + ' of the open pipeline') };
  }), fmt: N, emptyWords: 'No open scheduled case in this view carries an appointment date' });
  var rows = D.buckets.map(function (b) {
    return { cells: [b.label, N(b.count), b.share == null ? absent() : P(b.share), b.target == null ? absent() : fmt('d2', b.target),
      b.attainment == null ? absent() : P(b.attainment), b.words ? b.words : ''] };
  });
  rows.push({ cls: 'subtotal', cells: ['Past due', N(D.bucketsPastDue), absent(), absent(), absent(), 'an appointment date already behind the as-at — outside the five buckets, which is why they still reconcile'] });
  return panel({ id: 'buckets', title: 'Cycle Performance', sub: 'five lead-time buckets · all bookings, whatever the view is set to',
    body: body + table([{ h: 'Bucket', l: 1 }, { h: 'Open scheduled' }, { h: 'Share' }, { h: 'Target' }, { h: 'Attainment' }, { h: 'Note', l: 1 }], rows),
    notes: [esc(D.bucketWords),
      'The targets are the dashboard\'s own share of the channel\'s scheduled target (' + esc(R().dashboardHrsShare.cells.h24) + ' and the four cells beside it) — <b>not</b> the share the agent rating reads on the Month to Date page, which comes from a different workbook. ' + esc(R().dashboardHrsShare.notTheRatingShare),
      esc(R().dashboardHrsShare.structuralZero)] });
}

/* ---------------------------------------------------------------- 10 · Sales vs budget ---- */
function budgetHtml(D) {
  var ch = CH();
  if (!D.budget) return panel({ id: 'budget', title: 'Sales vs budget', sub: 'no cycle sales budget is on file for ' + monthOf(D.period.key),
    body: ch.empty('No cycle sales budget is on file for ' + monthOf(D.period.key) + ', so there is nothing to measure against.'),
    notes: ['A budget is a rule-book value with its Sales Review cell; the page never invents one.'] });
  var body = ch.meter({ title: 'Sales against the cycle sales budget, with the straight-line forecast',
    label: 'Sales in view', value: D.counts.sales, target: D.budget.sales.total, targetLabel: D.budget.cells.sales,
    marker: { value: D.forecast.sales, label: 'forecast' }, fmt: N, h: 128 });
  var rows = [
    { cells: ['Sales in view', N(D.counts.sales), N(D.budget.sales.total), P(D.budget.achievement), D.budget.cells.sales] },
    { cells: ['Forecast at this pace', D.forecast.sales == null ? absent() : fmt('d2', D.forecast.sales), N(D.budget.sales.total),
      D.forecast.salesVsBudget == null ? absent() : P(D.forecast.salesVsBudget), R().forecast.cells.formula] },
    { cells: ['Fitments in view', N(D.counts.fitted), N(D.budget.fitments.total), P(D.budget.fitAchievement), D.budget.cells.fitments] },
    { cells: ['Forecast fitments at this pace', D.forecast.fitments == null ? absent() : fmt('d2', D.forecast.fitments), N(D.budget.fitments.total),
      D.forecast.fitmentsVsBudget == null ? absent() : P(D.forecast.fitmentsVsBudget), R().forecast.cells.formula] }
  ];
  return panel({ id: 'budget', title: 'Sales vs budget', sub: 'actual and the straight-line forecast on the cycle sales budget · ' + (D.budget.fallback ? 'budget from ' + monthOf(D.budget.cycle) : monthOf(D.budget.cycle)),
    body: body + table([{ h: 'Measure', l: 1 }, { h: 'Actual' }, { h: 'Budget' }, { h: 'Of budget' }, { h: 'Workbook cell', l: 1 }], rows),
    notes: ['<b>There is no spend figure in any Vehicle Tracking source</b>, so this panel is sales against the sales budget — never a cost, never a margin, and nothing here is implied to be money spent.',
      esc(D.budget.words), esc(D.forecast.words), esc(D.dialingDays.words)] });
}

/* ---------------------------------------------------------------- 11 · Forecast vs Actual ---- */
function forecastHtml(D) {
  var ch = CH();
  var grp = function (kind) {
    return D.channels.map(function (t) {
      return { label: t.label,
        bars: [{ name: 'Actual', value: kind === 'sales' ? t.sales : t.fitted, color: ch.hue(0) },
          { name: 'Forecast', value: kind === 'sales' ? t.forecastSales : t.forecastFitments, color: ch.hue(2), hollow: true }],
        ref: kind === 'sales' ? t.salesBudget : t.fitmentBudget };
    });
  };
  var body = '<div class="sub" style="margin:2px 0 4px">Sales</div>'
    + ch.grouped({ title: 'Sales: actual and forecast against budget, by channel', groups: grp('sales'), names: ['Actual', 'Forecast'], refName: 'budget', fmt: function (v) { return fmt('d2', v); }, h: 230 })
    + '<div class="sub" style="margin:12px 0 4px">Fitments</div>'
    + ch.grouped({ title: 'Fitments: actual and forecast against budget, by channel', groups: grp('fitments'), names: ['Actual', 'Forecast'], refName: 'budget', fmt: function (v) { return fmt('d2', v); }, h: 230 });
  var rows = D.channels.map(function (t) {
    return { cells: [t.label, N(t.sales), t.forecastSales == null ? absent() : fmt('d2', t.forecastSales), t.salesBudget == null ? absent() : N(t.salesBudget),
      N(t.fitted), t.forecastFitments == null ? absent() : fmt('d2', t.forecastFitments), t.fitmentBudget == null ? absent() : N(t.fitmentBudget)] };
  });
  rows.push({ cls: 'subtotal', cells: ['Total', N(D.counts.sales), D.forecast.sales == null ? absent() : fmt('d2', D.forecast.sales),
    D.budget ? N(D.budget.sales.total) : absent(), N(D.counts.fitted), D.forecast.fitments == null ? absent() : fmt('d2', D.forecast.fitments),
    D.budget ? N(D.budget.fitments.total) : absent()] });
  return panel({ id: 'forecast', title: 'Forecast vs Actual', sub: 'per channel, sales and fitments · ' + D.viewLabel,
    body: body + table([{ h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Forecast sales' }, { h: 'Sales budget' }, { h: 'Fitments' }, { h: 'Forecast fitments' }, { h: 'Fitments budget' }], rows),
    notes: ['The forecast is a <b>' + esc(R().forecast.label) + '</b>: ' + esc(R().forecast.formula) + '. It is not applied to missed, cancelled, scheduled or the lead-time buckets.',
      esc(D.dialingDays.words)] });
}

/* ---------------------------------------------------------------- 12 · Detailed Breakdown ---- */
function breakdownHtml(D) {
  var ch = CH();
  var mix = function (r) {
    return { html: ch.segbar({ parts: [{ label: 'Fitted', value: r.fitted, color: ch.hue(0) }, { label: 'Scheduled', value: r.scheduled, color: ch.hue(2) },
      { label: 'Missed', value: r.missed, color: ch.hue(3) }, { label: 'Cancelled', value: r.cancelled, color: ch.hue(1) }], fmt: N, width: 110,
      emptyWords: 'no outcome in this row yet' }) };
  };
  var row = function (r, cls) {
    return { cls: cls || '', cells: [r.label, N(r.sales), N(r.fitted), N(r.cancelled), N(r.missed), r.salesBudget == null ? absent() : N(r.salesBudget),
      r.achievement == null ? absent() : P(r.achievement), { html: deltaHtml(r.delta, 'n', D.prevCycle.words) }, mix(r)] };
  };
  var rows = D.breakdown.map(function (r) { return row(r); });
  rows.push(row(D.breakdownTotals, 'subtotal'));
  return panel({ id: 'breakdown', title: 'Detailed Breakdown', sub: 'per channel, with the totals row · ' + D.viewLabel,
    body: table([{ h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Fitments' }, { h: 'Cancellations' }, { h: 'Missed' }, { h: 'Target' }, { h: 'Achievement' }, { h: 'Change', l: 1 }, { h: 'Outcome mix', l: 1 }], rows),
    notes: ['Totals are the engine\'s own: ' + esc(D.breakdownTotals.words) + ' — never a mean of the rows on screen.',
      'Cancelled is <b>derived</b>: no upload carries a cancellation, so a Scheduled or Missed sale in neither file of a day with both files in counts as cancelled from that day, and a contract the BI file shows deactivated counts as cancelled too. A cancelled sale stays in Sales and is not fitted.',
      'The outcome-mix bar carries no numbers of its own — the row\'s cells are the figures.'] });
}

/* ---------------------------------------------------------------- 13 · Key Insights ---- */
function insightsHtml(D) {
  if (!D.insights.length) return panel({ id: 'insights', title: 'Key Insights',
    sub: 'computed from the figures on this page', body: CH().empty('No insight has enough figures behind it in this view yet — a template with no data is left out rather than padded.') });
  return panel({ id: 'insights', title: 'Key Insights', sub: 'computed from the figures on this page, never hand-written · ' + D.viewLabel,
    body: '<ul class="vt-ins">' + D.insights.map(function (i) {
      return '<li data-insight="' + esc(i.id) + '">' + esc(i.text) + ' <span class="vt-absent">(' + esc(i.cell) + ')</span></li>';
    }).join('') + '</ul>',
    notes: ['Each sentence is a rule-book template filled from this page\'s own model and names the workbook cell it answers. A template whose figures are absent is omitted, never padded with a zero.'] });
}

/* ---------------------------------------------------------------- the three integrity checks ---- */
function integrityHtml(D) {
  var items = D.integrity.map(function (c) {
    return '<div class="it ' + (c.ok ? 'ok' : 'check') + '" data-check="' + esc(c.k) + '">' + (c.ok ? ICON_OK : ICON_CHECK)
      + '<div><div class="v">' + esc(c.verdict) + ' · ' + esc(c.label) + '</div>'
      + '<div class="sub">' + esc(c.words) + '</div>'
      + '<div class="sub">' + esc(N(c.got)) + ' against ' + esc(N(c.expected)) + (c.diff ? ', a difference of ' + esc(N(Math.abs(c.diff))) : '')
      + ' — ' + esc(c.formula) + ' (' + esc(c.cell) + ')</div></div></div>';
  }).join('');
  return panel({ id: 'integrity', title: 'Integrity checks', sub: 'the workbook\'s own checks, computed by the engine · ' + D.viewLabel,
    body: '<div class="vt-chk">' + items + '</div>',
    notes: ['Each check carries an icon and the word OK or CHECK, so the verdict is never colour alone. A check that disagrees prints both sides and the difference and <b>never blocks this page</b> — the figures are still the figures.'] });
}

/* ---------------------------------------------------------------- render ---- */
function render() {
  var eng = E(), st = ST(), ch = CH();
  if (!eng || !st || !ch) return '<div class="card"><div class="empty"><div class="big">The VT Report did not load</div>Refresh the page.</div></div>';
  ensure();
  if (C.status === 'error') return headHtml(null) + warn('The Vehicle Tracking book could not be read', C.error || '',
    'Nothing on this page is shown from an old copy. <button class="btn small primary" onclick="VTDash.retry()">Retry</button>', 'crit');
  if (!ready()) return headHtml(null) + '<div class="card vt-loading"><div class="empty"><div class="big">Reading the Vehicle Tracking book…</div>The case book and the Agent List for this business month are loading.</div></div>';
  var committed = C.receipts.filter(function (u) { return u.state === 'committed'; }).length;
  if (!Object.keys(C.book.cases).length && !committed) return headHtml(null) + '<div class="card vt-empty"><div class="empty"><div class="big">No Vehicle Tracking uploads yet</div>'
    + 'Load the day\'s <b>BI Active Fitted</b> and <b>Scheduled &amp; Missed</b> exports in the Upload Station, and the <b>Schedulers Data</b> sheet for the scheduler, the GWP and the true sale date. This report builds itself from them.'
    + (typeof root.tabAllowed !== 'function' || root.tabAllowed('data') ? '<p style="margin:12px 0 0"><button class="btn small primary" onclick="go(\'data\')">Open the Upload Station</button></p>' : '') + '</div></div>';
  var D = model();
  /* "no figures yet" is NO SALE IN THIS VIEW AT ALL — read off the model (no sale, so no week), never a screen of
     zeros. dataThrough is the cycle end once any case exists, so it cannot answer this question. */
  if (!D.counts.sales && !D.weeks.length) {
    var prev = cycleKeys().filter(function (k) { return k < currentCycle().key; })[0];
    return headHtml(null) + controlsHtml(null) + '<div class="card vt-empty"><div class="empty"><div class="big">No ' + esc(monthOf(currentCycle().key)) + ' figures yet</div>'
      + 'No Vehicle Tracking sale falls in this business month yet. Nothing is shown as a zero in its place.'
      + (prev ? '<p style="margin:12px 0 0"><button class="btn small" onclick="VTDash.set(\'cycle\',\'' + jsq(prev) + '\')">' + esc(monthOf(prev)) + ' (final)</button></p>' : '') + '</div></div>';
  }
  return headHtml(D) + controlsHtml(D) + statesHtml(D) + kpisHtml(D)
    + trendHtml(D) + channelHtml(D) + campaignHtml(D) + bucketsHtml(D)
    + budgetHtml(D) + forecastHtml(D) + breakdownHtml(D) + insightsHtml(D) + integrityHtml(D)
    + '<p class="why" style="margin:12px 0 0">Every figure on this page is a field of <b>VTEngine.dashboard()</b> over the Vehicle Tracking case book — rule book ' + esc(D.rulesVersion)
    + '. The page chooses shapes and formats and computes nothing. GWP comes from the Schedulers Data sheet (' + esc(R().reports.gwp.source) + ') and is not the engine\'s BI fitted value; both are different measures and neither is adjusted to match the other.</p>';
}
/** after the real paint: the line chart's crosshair (the rest of the kit needs no JavaScript) */
function wire() { var ch = CH(); return ch && ch.wire ? ch.wire(root.document) : 0; }

/* ---------------------------------------------------------------- actions ---- */
function set(k, v) {
  var u = ui();
  if (k === 'cycle' || k === 'view') { u[k] = v == null ? '' : String(v); C.memo = null; saveUi(); repaint(); }
}
function clear() { var u = ui(); u.view = ''; C.memo = null; saveUi(); repaint(); }

return { TAB: TAB, render: render, wire: wire, set: set, clear: clear, retry: retry, adopt: adopt,
  state: function () { return { status: C.status, error: C.error, ready: ready(), cycle: currentCycle().key, view: viewKey(),
    model: ready() ? model() : null, book: C.book, receipts: C.receipts, prev: C.prev, fallback: C.fallback }; },
  _reset: function () { C.book = null; C.bookFrom = null; C.bookId++; C.rosters = {}; C.fallback = {}; C.receipts = null; C.recErr = false;
    C.prev = {}; C.prevPending = {}; C.status = 'idle'; C.error = null; C.pending = null; C.memo = null; C.ui = {}; } };
});
