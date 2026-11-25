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
 * marker with the reason; no Schedulers Data upload → the GWP and scheduler panels say so and paint nothing; a
 * channel with no budget row → "—" and a sentence. Nothing here is ever filled in with a zero.
 *
 * WHAT BUILDS THIS PAGE (the owner's correction, 25 Nov 2026): the two DAILY Upload Station exports. "we are not
 * going to be uploading this master every month, that is the example which we need to get with the current data."
 * The Schedulers Data sheet is an occasional extra that adds exactly three things no daily export carries — the
 * scheduler, the hand-typed GWP, and a sale date for cases that predate this book — and its absence costs those
 * panels and nothing else.
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
/* A TYPED CELL (E3): one value, one type, written ONCE. The screen prints fmt(t, v) and the .xlsx writes v itself
   with the matching number format, so the file and the screen can never drift — and a null formats to the rule
   book's absent marker in both, so no panel needs its own "== null ? absent()" any more. */
function cell(t, v) { return { t: t, v: v }; }
var n = function (v) { return cell('n', v); }, pc = function (v) { return cell('p', v); }, rd = function (v) { return cell('r', v); },
  d2 = function (v) { return cell('d2', v); }, sv = function (v) { return cell('s', v); };
/* a cell the screen draws (a chart, a change chip) with the words the file carries in its place */
function drawn(html, words) { return { html: html, t: 's', v: words }; }
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
  return '<div class="card mt vt-panel' + (o.wide ? ' vt-wide' : '') + '" data-panel="' + esc(o.id) + '"><div class="cardhead"><div><h3>' + esc(o.title) + '</h3>'
    + (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : '') + '</div></div>'
    + (o.body || '') + (o.figures ? foldHtml(o.id, o.figuresLabel, o.figures) : '')
    + (o.notes || []).filter(Boolean).map(function (n) { return '<p class="why">' + n + '</p>'; }).join('') + '</div>';
}
/* CHARTS FIRST, THE FIGURES ONE CLICK AWAY (the owner's layout decision, 2026-11-25: "charts first, like the mockup,
   with each table folded behind a show-the-figures toggle"). A native <details>: it opens and closes with NO
   JavaScript, <summary> is keyboard-reachable and focusable by the browser itself, and it SAYS what it reveals and
   how much of it. The table stays in the DOM — it is never built on click — so the chart's role="img" alternative and
   the paired table both survive, and the suites still read it. The honest states at the top of the page never fold:
   a warning is not detail. The open/closed state is PER PERSON, in S.ui.vtReport like every other view setting. */
function foldHtml(id, label, html) {
  var on = foldOpen(id), what = esc(label || 'the figures behind this panel');
  return '<details class="vt-fold" data-fold="' + esc(id) + '"' + (on ? ' open' : '')
    + ' ontoggle="VTDash.fold(\'' + jsq(id) + '\',this.open)">'
    + '<summary><span class="s-show">Show the figures</span><span class="s-hide">Hide the figures</span> — ' + what + '</summary>'
    + html + '</details>';
}
function foldOpen(id) { var f = ui().figures; return !!(f && f[id]); }
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
        return '<td class="' + (c.l ? 'l' : '') + '">'
          + (v && v.html ? v.html : v && v.t ? esc(fmt(v.t, v.v)) : esc(v == null ? absent() : String(v))) + '</td>';
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
/** the same change in words, for the .xlsx (a chip cannot travel into a cell) */
function deltaWords(d, t) {
  if (!d || d.abs == null) return absent() + ' vs previous cycle';
  return (d.abs === 0 ? 'no change, ' : d.abs > 0 ? 'up ' : 'down ') + fmt(t, Math.abs(d.abs))
    + (d.pct == null ? '' : ' (' + P(Math.abs(d.pct)) + ')') + ' vs previous cycle';
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
    + R().views.list.map(function (v) { return opt(v.k, v.label, v.k === viewKey()); }).join('') + '</select>'
    /* E3: the whole dashboard as one workbook, built from the model this page is painting right now */
    + (D ? '<button class="btn small" id="vtrExport" onclick="VTDash.exportView()">' + DL + '<span>Export .xlsx</span></button>' : '');
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
  if (!D.gwp.loaded || !D.schedulers.loaded) out.push(warn('Two panels wait on the Schedulers Data sheet', 'every other figure on this page is built from the daily Upload Station exports',
    esc(D.gwp.words) + ' ' + esc(D.schedulers.words) + ' That sheet is an occasional extra, not a monthly chore: load it when you want the scheduler pivots, the hand-typed GWP, or a sale date for cases that predate this book. Nothing on this page is filled in with a zero in its place.', 'info'));
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
/* NO ATTAINMENT COLUMN HERE ON PURPOSE: the model's weeks[] carry sales and target but no per-week attainment
   verdict, and the page may not divide one by the other (FR-003). The two figures sit side by side instead. */
function trendSpec(D) {
  return { sheet: 'Performance Trend', panel: 'trend',
    cols: [{ h: 'Week', l: 1 }, { h: 'Sales' }, { h: 'Fitted' }, { h: 'Scheduled' }, { h: 'Missed' }, { h: 'Cancelled' }, { h: 'Dialing days' }, { h: 'Target' }, { h: 'Note', l: 1 }],
    rows: D.weeks.map(function (w) {
      return { cls: w.preCycle || w.postCycle ? 'subtotal' : '',
        cells: [sv(w.label), n(w.sales), n(w.fitted), n(w.scheduled), n(w.missed), n(w.cancelled), n(w.dialingDays), d2(w.target),
          w.fittedOnly ? 'fitted only — fitted rollovers, not a real week' : w.preCycle ? 'before the cycle: no dialing days, so no target' : w.postCycle ? 'after the cycle end' : ''] };
    }) };
}
function trendHtml(D) {
  var ch = CH(), labels = D.weeks.map(function (w) { return w.label; });
  var body = ch.line({
    title: 'Sales by week against the per-week target', labels: labels, h: 176,
    series: [{ name: 'Sales', values: D.weeks.map(function (w) { return w.sales; }), color: ch.hue(0) },
      { name: 'Target', values: D.weeks.map(function (w) { return w.target; }), color: ch.hue(3), dashed: true }],
    flags: D.weeks.map(function (w) { return !!(w.preCycle || w.postCycle); }),
    flagWords: 'outside the cycle — no dialing days, so no target',
    fmt: function (v) { return fmt('d2', v); },
    emptyWords: 'No week in this view carries a sale yet'
  });
  var sp = trendSpec(D);
  return panel({ id: 'trend', title: 'Performance Trend', sub: 'sales by week against the per-week target · ' + D.viewLabel,
    body: body, figuresLabel: D.weeks.length + ' week' + (D.weeks.length === 1 ? '' : 's') + ', with the dialing days and the target behind each one',
    figures: table(sp.cols, sp.rows),
    notes: [esc(D.weekWords), D.weeks.some(function (w) { return w.fittedOnly; })
      ? esc(R().views.rollover.preCycleWeeksAreFittedOnly) : ''] });
}

/* ---------------------------------------------------------------- 7 · Channel Performance ---- */
function channelSpec(D) {
  var rows = D.channels.map(function (t) {
    return { cells: [sv(t.label + (t.srLabel && t.srLabel !== t.label ? ' (Sales Review: ' + t.srLabel + ')' : '')), n(t.sales), pc(t.share),
      n(t.fitted), pc(t.fitRate), n(t.salesBudget), pc(t.achievement)] };
  });
  var rolls = D.campaignRollups.map(function (t) {
    return { cls: 'subtotal', cells: [sv(t.label + ' (roll-up)'), n(t.sales), pc(null), n(t.fitted), pc(t.fitRate), n(t.salesBudget), pc(null)] };
  });
  return { sheet: 'Channel Performance', panel: 'channels',
    cols: [{ h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Share' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Sales budget' }, { h: 'Achievement' }],
    rows: rows.concat(rolls) };
}
function channelHtml(D) {
  var ch = CH();
  var slices = D.channels.map(function (t, i) { return { label: t.label, value: t.sales, share: t.share, color: ch.hue(i) }; });
  var body = ch.donut({ title: 'Sales by channel', slices: slices, total: D.counts.sales, centreLabel: 'sales in view',
    fmt: N, pct: P, emptyWords: 'No sale in this view carries a channel yet' });
  var sp = channelSpec(D);
  return panel({ id: 'channels', title: 'Channel Performance', sub: 'the view\'s sales split four ways · ' + D.viewLabel,
    body: body, figuresLabel: D.channels.length + ' channels and the Panimax roll-up, with every budget and achievement',
    figures: table(sp.cols, sp.rows),
    notes: [esc(R().channels.dimension.charAt(0).toUpperCase() + R().channels.dimension.slice(1)) + '. A campaign the rule book does not map falls to Other and is named above the panels, never dropped.',
      D.campaignRollups.map(function (t) { return esc(t.words); }).join(' '),
      D.channels.filter(function (t) { return t.salesBudget == null; }).map(function (t) { return esc(t.label + ': ' + t.targetWords); }).join(' ')] });
}

/* ---------------------------------------------------------------- 8 · Campaign Breakdown ---- */
function campaignSpec(D) {
  var tr = D.campaigns.map(function (c) {
    return { cells: [sv(c.name), sv(R().channels.labels[c.channel] + (c.mapped ? '' : ' — not in the channel map')), n(c.sales), pc(c.share),
      n(c.fitted), pc(c.fitRate), n(c.scheduled), n(c.missed), n(c.cancelled)] };
  }).concat(D.campaignRollups.map(function (t) {
    return { cls: 'subtotal', cells: [sv(t.label + ' (roll-up)'), sv(t.members.map(function (m) { return R().channels.labels[m]; }).join(' + ')),
      n(t.sales), pc(null), n(t.fitted), pc(t.fitRate), n(t.scheduled), n(t.missed), n(t.cancelled)] };
  }));
  return { sheet: 'Campaign Breakdown', panel: 'campaigns',
    cols: [{ h: 'Campaign', l: 1 }, { h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Share' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Scheduled' }, { h: 'Missed' }, { h: 'Cancelled' }],
    rows: tr };
}
function campaignHtml(D) {
  var ch = CH();
  var rows = D.campaigns.map(function (c) {
    return { label: c.name + (c.mapped ? '' : ' (unmapped)'), value: c.sales, share: c.share, note: R().channels.labels[c.channel] };
  }).concat(D.campaignRollups.map(function (t) { return { label: t.label, value: t.sales, rollup: true, note: 'roll-up of ' + t.members.map(function (m) { return R().channels.labels[m]; }).join(' + ') }; }));
  var body = ch.hbars({ title: 'Sales by campaign, largest first', rows: rows, fmt: N, pct: P, color: ch.hue(0),
    emptyWords: 'No campaign in this view carries a sale yet' });
  var sp = campaignSpec(D);
  return panel({ id: 'campaigns', title: 'Campaign Breakdown', sub: 'sales by Campaign/Partner, with Panimax as a named roll-up · ' + D.viewLabel,
    body: body, figuresLabel: D.campaigns.length + ' campaign' + (D.campaigns.length === 1 ? '' : 's') + ', every outcome counted',
    figures: table(sp.cols, sp.rows),
    notes: ['Ranked bars, not a ring: two of these campaigns are a couple of records and a ring would hide them. The roll-up is drawn hollow and labelled, and is never added into a total beside its own members.'] });
}

/* ---------------------------------------------------------------- 9 · Cycle Performance (the 5 buckets) ---- */
function bucketSpec(D) {
  var rows = D.buckets.map(function (b) {
    return { cells: [sv(b.label), n(b.count), pc(b.share), d2(b.target), pc(b.attainment), b.words ? b.words : ''] };
  });
  rows.push({ cls: 'subtotal', cells: [sv('Past due'), n(D.bucketsPastDue), pc(null), d2(null), pc(null),
    'an appointment date already behind the as-at — outside the five buckets, which is why they still reconcile'] });
  return { sheet: 'Cycle Performance', panel: 'buckets',
    cols: [{ h: 'Bucket', l: 1 }, { h: 'Open scheduled' }, { h: 'Share' }, { h: 'Target' }, { h: 'Attainment' }, { h: 'Note', l: 1 }], rows: rows };
}
function bucketsHtml(D) {
  var ch = CH();
  var body = ch.meters({ title: 'Open scheduled cases by lead time, against each bucket\'s target', rows: D.buckets.map(function (b) {
    return { label: b.label, value: b.count, target: b.target, note: b.words || (b.share == null ? '' : P(b.share) + ' of the open pipeline') };
  }), fmt: N, emptyWords: 'No open scheduled case in this view carries an appointment date' });
  var sp = bucketSpec(D);
  return panel({ id: 'buckets', title: 'Cycle Performance', sub: 'five lead-time buckets · all bookings, whatever the view is set to',
    body: body, figuresLabel: 'the five buckets, their share, their target and past-due',
    figures: table(sp.cols, sp.rows),
    notes: [esc(D.bucketWords),
      'The targets are the dashboard\'s own share of the channel\'s scheduled target (' + esc(R().dashboardHrsShare.cells.h24) + ' and the four cells beside it) — <b>not</b> the share the agent rating reads on the Month to Date page, which comes from a different workbook. ' + esc(R().dashboardHrsShare.notTheRatingShare),
      esc(R().dashboardHrsShare.structuralZero)] });
}

/* ---------------------------------------------------------------- 10 · Sales vs budget ---- */
function budgetSpec(D) {
  if (!D.budget) return null;
  return { sheet: 'Sales vs budget', panel: 'budget',
    cols: [{ h: 'Measure', l: 1 }, { h: 'Actual' }, { h: 'Budget' }, { h: 'Of budget' }, { h: 'Workbook cell', l: 1 }],
    rows: [
      { cells: [sv('Sales in view'), n(D.counts.sales), n(D.budget.sales.total), pc(D.budget.achievement), sv(D.budget.cells.sales)] },
      { cells: [sv('Forecast at this pace'), d2(D.forecast.sales), n(D.budget.sales.total), pc(D.forecast.salesVsBudget), sv(R().forecast.cells.formula)] },
      { cells: [sv('Fitments in view'), n(D.counts.fitted), n(D.budget.fitments.total), pc(D.budget.fitAchievement), sv(D.budget.cells.fitments)] },
      { cells: [sv('Forecast fitments at this pace'), d2(D.forecast.fitments), n(D.budget.fitments.total), pc(D.forecast.fitmentsVsBudget), sv(R().forecast.cells.formula)] }
    ] };
}
function budgetHtml(D) {
  var ch = CH();
  if (!D.budget) return panel({ id: 'budget', title: 'Sales vs budget', sub: 'no cycle sales budget is on file for ' + monthOf(D.period.key),
    body: ch.empty('No cycle sales budget is on file for ' + monthOf(D.period.key) + ', so there is nothing to measure against.'),
    notes: ['A budget is a rule-book value with its Sales Review cell; the page never invents one.'] });
  var body = ch.meter({ title: 'Sales against the cycle sales budget, with the straight-line forecast',
    label: 'Sales in view', value: D.counts.sales, target: D.budget.sales.total, targetLabel: D.budget.cells.sales,
    marker: { value: D.forecast.sales, label: 'forecast' }, fmt: N, h: 112 });
  var sp = budgetSpec(D);
  return panel({ id: 'budget', title: 'Sales vs budget', sub: 'actual and the straight-line forecast on the cycle sales budget · ' + (D.budget.fallback ? 'budget from ' + monthOf(D.budget.cycle) : monthOf(D.budget.cycle)),
    body: body, figuresLabel: 'sales and fitments, actual, forecast and budget, with the workbook cell',
    figures: table(sp.cols, sp.rows),
    notes: ['<b>There is no spend figure in any Vehicle Tracking source</b>, so this panel is sales against the sales budget — never a cost, never a margin, and nothing here is implied to be money spent.',
      esc(D.budget.words), esc(D.forecast.words), esc(D.dialingDays.words)] });
}

/* ---------------------------------------------------------------- 11 · Forecast vs Actual ---- */
function forecastSpec(D) {
  var rows = D.channels.map(function (t) {
    return { cells: [sv(t.label), n(t.sales), d2(t.forecastSales), n(t.salesBudget), n(t.fitted), d2(t.forecastFitments), n(t.fitmentBudget)] };
  });
  rows.push({ cls: 'subtotal', cells: [sv('Total'), n(D.counts.sales), d2(D.forecast.sales), n(D.budget ? D.budget.sales.total : null),
    n(D.counts.fitted), d2(D.forecast.fitments), n(D.budget ? D.budget.fitments.total : null)] });
  return { sheet: 'Forecast vs Actual', panel: 'forecast',
    cols: [{ h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Forecast sales' }, { h: 'Sales budget' }, { h: 'Fitments' }, { h: 'Forecast fitments' }, { h: 'Fitments budget' }],
    rows: rows };
}
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
  /* two charts, side by side where there is room (this panel is full width): one axis each, never two scales on one
     chart — sales and fitments are different measures and a dual axis is the one chart the dataviz rules forbid. */
  var body = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px">'
    + '<div><div class="sub" style="margin:2px 0 4px">Sales</div>'
    + ch.grouped({ title: 'Sales: actual and forecast against budget, by channel', groups: grp('sales'), names: ['Actual', 'Forecast'], refName: 'budget', fmt: function (v) { return fmt('d2', v); }, h: 164 })
    + '</div><div><div class="sub" style="margin:2px 0 4px">Fitments</div>'
    + ch.grouped({ title: 'Fitments: actual and forecast against budget, by channel', groups: grp('fitments'), names: ['Actual', 'Forecast'], refName: 'budget', fmt: function (v) { return fmt('d2', v); }, h: 164 })
    + '</div></div>';
  var sp = forecastSpec(D);
  return panel({ id: 'forecast', title: 'Forecast vs Actual', sub: 'per channel, sales and fitments · ' + D.viewLabel,
    body: body, wide: 1, figuresLabel: D.channels.length + ' channels, sales and fitments against their budgets',
    figures: table(sp.cols, sp.rows),
    notes: ['The forecast is a <b>' + esc(R().forecast.label) + '</b>: ' + esc(R().forecast.formula) + '. It is not applied to missed, cancelled, scheduled or the lead-time buckets.',
      esc(D.dialingDays.words)] });
}

/* ---------------------------------------------------------------- 12 · Detailed Breakdown ---- */
/** the outcome mix as a shape for the screen, and as words for the file — one row, one set of four counts */
function mixOf(r) {
  var ch = CH();
  return drawn(ch.segbar({ parts: [{ label: 'Fitted', value: r.fitted, color: ch.hue(0) }, { label: 'Scheduled', value: r.scheduled, color: ch.hue(2) },
    { label: 'Missed', value: r.missed, color: ch.hue(3) }, { label: 'Cancelled', value: r.cancelled, color: ch.hue(1) }], fmt: N, width: 110,
    emptyWords: 'no outcome in this row yet' }),
  'Fitted ' + N(r.fitted) + ' · Scheduled ' + N(r.scheduled) + ' · Missed ' + N(r.missed) + ' · Cancelled ' + N(r.cancelled));
}
function breakdownSpec(D) {
  var row = function (r, cls) {
    return { cls: cls || '', cells: [sv(r.label), n(r.sales), n(r.fitted), n(r.cancelled), n(r.missed), n(r.salesBudget), pc(r.achievement),
      drawn(deltaHtml(r.delta, 'n', D.prevCycle.words), deltaWords(r.delta, 'n')), mixOf(r)] };
  };
  var rows = D.breakdown.map(function (r) { return row(r); });
  rows.push(row(D.breakdownTotals, 'subtotal'));
  return { sheet: 'Detailed Breakdown', panel: 'breakdown',
    cols: [{ h: 'Channel', l: 1 }, { h: 'Sales' }, { h: 'Fitments' }, { h: 'Cancellations' }, { h: 'Missed' }, { h: 'Target' }, { h: 'Achievement' }, { h: 'Change', l: 1 }, { h: 'Outcome mix', l: 1 }],
    rows: rows };
}
function breakdownHtml(D) {
  var sp = breakdownSpec(D);
  /* the outcome mix per channel, above the fold: the same four counts as shapes, each bar hoverable and every figure
     spelled out in the table behind the toggle. A shape, not a second claim (the bar carries no numbers). */
  var strip = '<div class="vt-mix">' + D.breakdown.concat([D.breakdownTotals]).map(function (r) {
    return '<div class="r"><span class="l">' + esc(r.label) + '</span>' + mixOf(r).html + '<span class="v">' + esc(N(r.sales)) + ' sales</span></div>';
  }).join('') + '</div>';
  return panel({ id: 'breakdown', title: 'Detailed Breakdown', wide: 1, sub: 'per channel, with the totals row · ' + D.viewLabel,
    body: strip, figuresLabel: N(D.breakdown.length) + ' channels and the total, with each one\'s target, achievement and change',
    figures: table(sp.cols, sp.rows),
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

/* ---------------------------------------------------------------- 14 · Fitted GWP (FR-044) ---- */
function gwpSpec(D) {
  var g = D.gwp;
  if (!g.loaded) return null;
  return { sheet: 'Fitted GWP', panel: 'gwp',
    cols: [{ h: 'Measure', l: 1 }, { h: 'GWP' }, { h: 'What it is', l: 1 }, { h: 'Workbook source', l: 1 }],
    rows: [
      { cells: [sv('Fitted GWP'), rd(g.fitted), sv('Σ GWP where the engine\'s status is fitted'), sv('Exco Summary K7')] },
      { cells: [sv('Total GWP in view'), rd(g.total), sv('Σ GWP over every sale in this view'), sv('Exco Summary K8')] },
      { cells: [sv('GWP on cancelled and missed'), rd(g.lost), sv('Σ GWP where the status is cancelled or missed'), sv('Exco Summary L18:L22')] },
      { cells: [sv('Open GWP'), rd(g.open), sv('Σ GWP still open to action'), sv('Exco Summary L18:L22')] }
    ] };
}
function gwpHtml(D) {
  var g = D.gwp;
  if (!g.loaded) return panel({ id: 'gwp', title: 'Fitted GWP', sub: 'needs the Schedulers Data upload',
    body: CH().empty(g.words), notes: ['GWP lives in one place only: ' + esc(g.source) + '. Nothing is painted here until that sheet lands, and no figure is guessed.'] });
  var tile = function (k, lab, v, sub) {
    return '<div class="vt-kpi" data-gwp="' + esc(k) + '"><div class="lab">' + esc(lab) + '</div><div class="val">' + esc(Rn(v)) + '</div>'
      + '<div class="sub">' + esc(sub) + '</div></div>';
  };
  var body = '<div class="vt-kpis">'
    + tile('fitted', 'Fitted GWP', g.fitted, 'the GWP of the sales that are fitted, in this view')
    + tile('total', 'Total GWP in view', g.total, 'every sale in this view, fitted or not')
    + tile('lost', 'GWP on cancelled and missed', g.lost, 'sold and not fitted — the leakage in rand')
    + tile('open', 'Open GWP', g.open, 'still to be fitted or rebooked') + '</div>';
  var sp = gwpSpec(D);
  return panel({ id: 'gwp', title: 'Fitted GWP', sub: 'the Schedulers Data figure, in rand · ' + D.viewLabel,
    body: body, figuresLabel: 'four measures, each with the workbook cell it answers',
    figures: table(sp.cols, sp.rows),
    notes: [esc(g.words), 'GWP is hand-typed in the sheet and is a different measure from the engine\'s fitted <b>value</b> (the BI Charge Amount × VAT). Both are shown in the suite, each named; neither is adjusted to match the other.'] });
}

/* ---------------------------------------------------------------- 15 · the four scheduler pivots (FR-045/046) ---- */
function pivotKey() { var u = ui(), ks = R().reports.schedulerPivots.scopes; return ks.indexOf(u.pivot) > -1 ? u.pivot : ks[ks.length - 1]; }
/* ONE scope on screen (the chips), ALL FOUR in the .xlsx — the workbook has four Pivot sheets and the file mirrors it */
function pivotSpec(D, scope) {
  if (!D.schedulers.loaded) return null;
  var rows = D.schedulerPivot(scope), avg = rows.all;
  var row = function (r, cls) {
    return { cls: cls || '', cells: [sv(r.name + (r.matched ? '' : ' (not on the Agent List)')), sv(r.cb), n(r.sales),
      n(r.fitted), pc(r.pct.fitted), n(r.scheduled), pc(r.pct.scheduled), n(r.cancelled), pc(r.pct.cancelled), n(r.missed), pc(r.pct.missed)] };
  };
  var tr = rows.map(function (r) { return row(r); }); tr.push(row(avg, 'subtotal'));
  return { sheet: 'Pivot - ' + rows.label, panel: 'pivots', scope: scope, label: rows.label,
    cols: [{ h: 'Scheduler', l: 1 }, { h: 'CB', l: 1 }, { h: 'Sales' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Scheduled' }, { h: 'Scheduled %' },
      { h: 'Cancelled' }, { h: 'Cancelled %' }, { h: 'Missed' }, { h: 'Missed %' }],
    rows: tr };
}
function pivotSpecs(D) {
  return R().reports.schedulerPivots.scopes.map(function (k) { return pivotSpec(D, k); }).filter(Boolean);
}
function pivotsHtml(D) {
  var ch = CH(), S = D.schedulers, scope = pivotKey();
  var chips = R().reports.schedulerPivots.scopes.map(function (k) {
    var lab = k === 'all' ? 'All campaigns' : R().channels.labels[k] || k;
    return '<button class="chip' + (k === scope ? ' on' : '') + '" data-pivot="' + esc(k) + '" aria-pressed="' + (k === scope ? 'true' : 'false')
      + '" onclick="VTDash.set(\'pivot\',\'' + jsq(k) + '\')">' + esc(lab) + '</button>';
  }).join('');
  var head = '<div class="filters vt-filters" style="margin-top:0">' + chips + '</div>';
  /* NO SCOPE CHIPS WHILE THERE IS NOTHING TO SWITCH (the "controls that do nothing" rule): without the Schedulers
     Data sheet every scope would paint the same sentence, so the chips are not drawn at all and the panel says why. */
  if (!S.loaded) return panel({ id: 'pivots', title: 'Scheduler pivots', sub: 'needs the Schedulers Data upload',
    body: ch.empty(S.words), notes: ['No daily export names the scheduler, so these four pivots paint nothing — never a zero — until the sheet lands. The four scope chips appear with it; there is nothing to switch between until then.'] });
  var rows = D.schedulerPivot(scope), avg = rows.all;
  var body = head + ch.grouped({ title: 'Fitted share by scheduler, ' + rows.label + ', against the scope\'s own average',
    groups: rows.map(function (r) { return { label: r.name, bars: [{ name: 'Fitted %', value: r.pct.fitted, color: ch.hue(0) }], ref: avg.pct.fitted }; }),
    names: ['Fitted %'], refName: 'scope average', fmt: P, h: 176,
    emptyWords: 'No scheduler carries a sale in ' + rows.label + ' yet' });
  var sp = pivotSpec(D, scope);
  return panel({ id: 'pivots', title: 'Scheduler pivots',
    sub: rows.label + ' · all data, as the workbook\'s pivots are — not the view · ' + N(rows.length) + ' schedulers against a headcount budget of ' + N(S.headcountBudget),
    body: body, figuresLabel: N(rows.length) + ' schedulers in ' + rows.label + ', four outcomes and four percentages each',
    figures: table(sp.cols, sp.rows),
    notes: [esc(rows.words), 'The dashed rule on every bar is the scope\'s own average (' + esc(avg.pct.fitted == null ? absent() : P(avg.pct.fitted))
      + ' fitted over ' + esc(N(avg.sales)) + ' sales), <b>not a target</b>. The headcount budget (' + esc(S.headcountCell || absent())
      + ') is the only scheduler figure any source budgets.', esc(S.words)] });
}

/* ---------------------------------------------------------------- 16 · Agent & Scheduler Summary (FR-047) ---- */
function personDim() { var u = ui(), ds = R().reports.personDimensions.map(function (p) { return p.k; }); return ds.indexOf(u.pdim) > -1 ? u.pdim : 'scheduler'; }
function personFilters() { var u = ui(); return { from: u.pfrom || null, to: u.pto || null, channel: u.pchan || null, campaign: u.pcamp || null }; }
/* the chosen dimension under the chosen filters — the file carries exactly what the five controls are set to, and
   the sheet's own provenance line says so (FR-047) */
function personSpec(D) {
  var dim = personDim(), f = personFilters();
  if (dim !== 'agent' && !D.schedulers.loaded) return null;
  var P2 = D.persons(dim, f);
  var ranked = P2.rows.slice().sort(function (a, b) { return b.sales - a.sales || (a.name < b.name ? -1 : 1); });
  var row = function (r, cls) {
    return { cls: cls || '', cells: [sv(r.name + (r.matched === false ? ' (not on the Agent List)' : '')), sv(r.cb), n(r.sales),
      n(r.fitted), pc(r.pct.fitted), n(r.scheduled), n(r.cancelled), n(r.missed), rd(r.gwpFitted), rd(r.gwpLost)] };
  };
  var tr = ranked.map(function (r) { return row(r); }); tr.push(row(P2.all, 'subtotal'));
  return { sheet: 'Agent & Scheduler Summary', panel: 'persons', words: P2.words,
    cols: [{ h: P2.label, l: 1 }, { h: 'CB', l: 1 }, { h: 'Sales' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Scheduled' }, { h: 'Cancelled' },
      { h: 'Missed' }, { h: 'Fitted GWP' }, { h: 'GWP lost' }],
    rows: tr };
}
function personsHtml(D) {
  var ch = CH(), u = ui(), dim = personDim();
  var f = { from: u.pfrom || null, to: u.pto || null, channel: u.pchan || null, campaign: u.pcamp || null };
  var opt = function (v, label, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; };
  var head = '<div class="filters vt-filters" style="margin-top:0">'
    + '<select aria-label="Person dimension" data-vtr="pdim" onchange="VTDash.set(\'pdim\',this.value)">'
    + R().reports.personDimensions.map(function (p) { return opt(p.k, p.label, p.k === dim); }).join('') + '</select>'
    + '<input type="date" aria-label="Sales dated from" data-vtr="pfrom" value="' + esc(f.from || '') + '" onchange="VTDash.set(\'pfrom\',this.value)">'
    + '<input type="date" aria-label="Sales dated to" data-vtr="pto" value="' + esc(f.to || '') + '" onchange="VTDash.set(\'pto\',this.value)">'
    + '<select aria-label="Channel" data-vtr="pchan" onchange="VTDash.set(\'pchan\',this.value)">' + opt('', 'All channels', !f.channel)
    + R().channels.keys.map(function (k) { return opt(k, R().channels.labels[k], k === f.channel); }).join('') + '</select>'
    + '<select aria-label="Campaign" data-vtr="pcamp" onchange="VTDash.set(\'pcamp\',this.value)">' + opt('', 'All campaigns', !f.campaign)
    + D.campaigns.map(function (c) { return opt(c.name, c.name, c.name === f.campaign); }).join('') + '</select>'
    + (f.from || f.to || f.channel || f.campaign ? '<button class="btn small" onclick="VTDash.clearPersons()">Clear filters</button>' : '') + '</div>';
  var P2 = D.persons(dim, f), needs = dim !== 'agent' && !D.schedulers.loaded;
  var says = '<p class="note" style="margin:0 0 8px;max-width:none"><b>' + esc(P2.label) + '</b> — ' + esc(P2.words) + '</p>';
  if (needs) return panel({ id: 'persons', title: 'Agent & Scheduler Summary', wide: 1, sub: 'needs the Schedulers Data upload for this dimension',
    body: head + says + ch.empty(D.schedulers.words), notes: ['The Agent dimension works off the daily exports alone; the scheduler and the referring agent exist only in the Schedulers Data sheet.'] });
  /* ORDER AND LENGTH ONLY: the chart shows the busiest rows (a chart of 74 referrers reads as nothing), the table
     below carries every row. Sorting and truncating a list is a display choice; no figure is computed here. */
  var ranked = P2.rows.slice().sort(function (a, b) { return b.sales - a.sales || (a.name < b.name ? -1 : 1); });
  var top = ranked.slice(0, 10);
  var body = head + says + ch.hbars({ title: P2.label + ': sales, busiest first', fmt: N, pct: P, color: ch.hue(0),
    rows: top.map(function (r) { return { label: r.name, value: r.sales, note: (r.pct.fitted == null ? absent() : P(r.pct.fitted)) + ' fitted' }; }),
    emptyWords: 'No ' + P2.label.toLowerCase() + ' carries a sale under these filters' })
    + (ranked.length > top.length ? '<p class="why" style="margin:6px 0 0">The bars are the ' + esc(N(top.length)) + ' busiest of '
      + esc(N(ranked.length)) + ' — the figures below carry every one.</p>' : '');
  var sp = personSpec(D);
  return panel({ id: 'persons', title: 'Agent & Scheduler Summary',
    sub: P2.label + ' · ' + D.viewLabel + ' · ' + (f.from || f.to || f.channel || f.campaign ? 'filtered' : 'no filter set'),
    body: body, figuresLabel: N(ranked.length) + ' ' + P2.label.toLowerCase() + ' rows and the total',
    figures: table(sp.cols, sp.rows),
    notes: ['The dimension and the four filters are the workbook\'s own controls (Agent & Scheduler Summary C4 / C5 / E5 / H5 / K5), and the line above says which of them are active — the workbook\'s "active filter" message.',
      'A person not on the Agent List is counted under the name as the source spells it and said to be unmatched, never dropped and never guessed.'] });
}

/* ---------------------------------------------------------------- 17 · Upcoming Scheduled Fitments (FR-048) ---- */
function upcomingSpec(D) {
  var U = D.upcoming;
  if (!U.from) return null;
  var tr = U.dates.map(function (d) { return { cells: [sv(longDay(d.d)), n(d.count), pc(d.share)] }; });
  tr.push({ cls: 'subtotal', cells: [sv(U.tail.label), n(U.tail.count), pc(U.tail.share)] });
  tr.push({ cls: 'total', cells: [sv('Scheduled pipeline'), n(U.total), pc(1)] });
  return { sheet: 'Upcoming Fitments', panel: 'upcoming',
    cols: [{ h: 'Date to fit', l: 1 }, { h: 'Bookings' }, { h: 'Share of pipeline' }], rows: tr };
}
function upcomingHtml(D) {
  var ch = CH(), U = D.upcoming;
  if (!U.from) return panel({ id: 'upcoming', title: 'Upcoming Scheduled Fitments', sub: 'no open scheduled case carries an appointment date',
    body: ch.empty('No booking in the book carries a date to fit, so there is nothing ahead to list.'), notes: [esc(U.words)] });
  var rows = U.dates.map(function (d) { return { label: longDay(d.d), value: d.count, share: d.share, note: P(d.share) + ' of the pipeline' }; });
  var body = ch.hbars({ title: 'Bookings by the date they are due to fit, from ' + longDay(U.from), rows: rows, fmt: N, pct: P, color: ch.hue(2),
    emptyWords: 'No booking falls inside the horizon' });
  var sp = upcomingSpec(D);
  return panel({ id: 'upcoming', title: 'Upcoming Scheduled Fitments', sub: 'from the earliest booking, ' + longDay(U.from) + ' · all bookings, whatever the view is set to',
    body: body, figuresLabel: N(U.dates.length) + ' dates, the folded tail and the whole pipeline',
    figures: table(sp.cols, sp.rows),
    notes: [esc(U.words), 'The dates run forward from the earliest booking for ' + esc(N(U.dates.length)) + ' days; everything past that is folded into <b>' + esc(U.tail.label) + '</b> so the share column still adds to the whole pipeline.'] });
}

/* ---------------------------------------------------------------- 18 · Rollover follow-up (FR-049) ---- */
function rolloverSpec(D) {
  var RO = D.rollover;
  if (!RO.totals.sales) return null;
  var row = function (r, cls) {
    return { cls: cls || '', cells: [sv(r.label), n(r.sales), n(r.fitted), pc(r.fittedPct), n(r.scheduled),
      n(r.cancelled), n(r.missed), n(r.open), pc(r.openPct), rd(r.gwpOpen)] };
  };
  var tr = RO.rows.map(function (r) { return row(r); }); tr.push(row(RO.totals, 'subtotal'));
  return { sheet: 'Rollover Follow-up', panel: 'rollover',
    cols: [{ h: 'Channel', l: 1 }, { h: 'Rollover sales' }, { h: 'Fitted' }, { h: 'Fitted %' }, { h: 'Scheduled' }, { h: 'Cancelled to rebook' },
      { h: 'Missed to rebook' }, { h: 'Open to action' }, { h: 'Open %' }, { h: 'Open GWP' }], rows: tr };
}
function rolloverHtml(D) {
  var ch = CH(), RO = D.rollover;
  if (!RO.totals.sales) return panel({ id: 'rollover', title: 'Rollover follow-up', sub: 'no sale is dated before this business month',
    body: ch.empty('Every sale in the book is dated inside this business month, so there is no rollover position to work.'), notes: [esc(RO.words)] });
  var body = ch.hbars({ title: 'Open to action per channel — the pre-cycle sales still to be fitted or rebooked',
    rows: RO.rows.filter(function (r) { return r.sales > 0; }).map(function (r) {
      return { label: r.label, value: r.open, note: 'of ' + N(r.sales) + ' rollover sales' + (r.gwpOpen == null ? '' : ', ' + Rn(r.gwpOpen) + ' open') };
    }), fmt: N, color: ch.hue(1), emptyWords: 'No channel carries an open rollover' });
  var sp = rolloverSpec(D);
  return panel({ id: 'rollover', title: 'Rollover follow-up',
    sub: N(RO.totals.open) + ' of ' + N(RO.totals.sales) + ' rollover sales are open to action · always the pre-cycle position, whatever the view is set to',
    body: body, figuresLabel: 'four channels and the total, with open GWP',
    figures: table(sp.cols, sp.rows),
    notes: [esc(RO.words), D.gwp.loaded ? '' : 'Open GWP reads ' + esc(absent()) + ' until the Schedulers Data sheet lands: GWP comes from that sheet and from nothing else.'] });
}

/* ---------------------------------------------------------------- 19 · Where the sources disagree (FR-014/015) ---- */
/* E2 · the same six counts as FIGURES, with the carried-forward 071 accounting as its own named rows, so the panel
   can be read as a table and leave in the .xlsx exactly as it reads on screen. The share column is the engine's own
   where it carries one and the absent marker where no share is defined — never a percentage of nothing. */
function disagreeSpec(D) {
  var g = D.disagree, dirs = Object.keys(g.resultVsEngine.byDirection).sort();
  var rows = [
    { cells: [sv('Result disagrees with the status'), n(g.resultVsEngine.total), pc(g.resultVsEngine.share),
      sv(dirs.length ? 'by direction: ' + dirs.map(function (k) { return k + ' ' + N(g.resultVsEngine.byDirection[k]); }).join(', ')
        : 'not one row disagrees'), sv('this cycle (new in 072)')] },
    { cells: [sv('Schedulers not matched to a CB'), n(g.unmatchedSchedulers), pc(null), sv('counted under the name the sheet types, never guessed away'), sv('this cycle (new in 072)')] },
    { cells: [sv('Sellers not matched to a CB'), n(g.unmatchedSellers), pc(null), sv('they count in every total; only the person row is missing'), sv('this cycle (new in 072)')] },
    { cells: [sv('Campaigns not in the channel map'), n(g.unmappedCampaigns), pc(null),
      sv(g.unmappedNames.length ? 'as the source spells them: ' + g.unmappedNames.join(', ') : 'every campaign in this view is mapped'), sv('this cycle (new in 072)')] },
    { cells: [sv('Sales with no sale date'), n(g.noSaleDay), pc(null), sv('already open when this book started, so no month owns it; a new sale is dated by its own daily upload'), sv('this cycle (new in 072)')] },
    { cells: [sv('Sales with no GWP'), n(g.gwpMissing), pc(null),
      sv(D.gwp.loaded ? 'a row the sheet leaves blank in column E; nothing is filled in for it' : 'not countable until the Schedulers Data sheet lands'), sv('this cycle (new in 072)')] },
    { cls: 'subtotal', cells: [sv('Hand credits carried forward'), n(g.carried.handCredits), pc(null), sv(g.carried.words), sv('spec 071 floor guide, measured by verify-vt-oracle')] },
    { cls: 'subtotal', cells: [sv('Lead sources relabelled, carried forward'), n(null), sv(g.carried.leadSourceRelabelledShare), sv(g.carried.words), sv('spec 071 floor guide, measured by verify-vt-oracle')] }
  ];
  return { sheet: 'Sources Disagree', panel: 'disagree',
    cols: [{ h: 'Disagreement', l: 1 }, { h: 'Cases' }, { h: 'Share of sales in view' }, { h: 'What it means', l: 1 }, { h: 'Measured by', l: 1 }],
    rows: rows };
}
function disagreeHtml(D) {
  var g = D.disagree, dirs = Object.keys(g.resultVsEngine.byDirection).sort();
  var item = function (lab, v, words) {
    return '<div class="it ' + (v ? 'check' : 'ok') + '" data-dis="' + esc(lab.toLowerCase().replace(/[^a-z]+/g, '-')) + '">'
      + (v ? ICON_CHECK : ICON_OK) + '<div><div class="v">' + esc(v == null ? absent() : N(v)) + ' · ' + esc(lab) + '</div>'
      + '<div class="sub">' + words + '</div></div></div>';
  };
  var items = [
    item('Result disagrees with the status', g.resultVsEngine.total,
      'The hand-typed <b>Result</b> column against the status the daily exports decided' + (g.resultVsEngine.share == null ? '' : ' — ' + esc(P(g.resultVsEngine.share)) + ' of the sales in view')
      + '. ' + (dirs.length ? 'By direction: ' + dirs.map(function (k) { return '<b>' + esc(k) + '</b> ' + esc(N(g.resultVsEngine.byDirection[k])); }).join(', ') + '.' : 'Not one row disagrees.')),
    item('Schedulers not matched to a CB', g.unmatchedSchedulers, 'Counted under the name the sheet types, listed above the panels, never guessed away.'),
    item('Sellers not matched to a CB', g.unmatchedSellers, 'They count in every total; only the person row is missing until the Agent List carries them.'),
    item('Campaigns not in the channel map', g.unmappedCampaigns, g.unmappedNames.length ? 'As the source spells them: <b>' + g.unmappedNames.map(esc).join('</b>, <b>') + '</b>. They count under Other.' : 'Every campaign in this view is mapped.'),
    item('Sales with no sale date', g.noSaleDay, 'A case that was already open when this book started. No daily export carries the day a sale was made, so no business month owns it. Every sale from the first daily upload onward is dated by that upload; the Schedulers Data sheet is what dates this history.'),
    item('Sales with no GWP', g.gwpMissing, D.gwp.loaded ? 'A row the sheet leaves blank in column E. Nothing is filled in for it.' : 'GWP needs the Schedulers Data upload, so this is not yet countable and reads ' + esc(absent()) + '.')
  ].join('');
  var sp = disagreeSpec(D);
  return panel({ id: 'disagree', title: 'Where the sources disagree', sub: 'counts and shares, never a hidden adjustment · ' + D.viewLabel,
    body: '<div class="vt-chk">' + items + '</div>',
    figuresLabel: 'the six counts and the two figures carried forward from spec 071',
    figures: table(sp.cols, sp.rows),
    notes: [esc(g.words),
      '<b>Carried forward from spec 071</b> (the floor guide\'s own wording, not restarted here): ' + esc(g.carried.words)
      + ' That is ' + esc(N(g.carried.handCredits)) + ' hand credits and about ' + esc(g.carried.leadSourceRelabelledShare) + ' of rows relabelled, measured by verify-vt-oracle.mjs.',
      'Nothing in this panel changes a figure anywhere on the page. The Result column is read, compared and counted — never applied (the daily exports are the system of record for status).'] });
}

/* ---------------------------------------------------------------- 20 · the three integrity checks (E1) ---- */
/* E1 · the verdicts as FIGURES as well as words: both sides, the difference and the workbook cell, so a CHECK can be
   read, exported and taken to the source without re-deriving anything. The verdict stays an engine field. */
function integritySpec(D) {
  return { sheet: 'Integrity Checks', panel: 'integrity',
    cols: [{ h: 'Check', l: 1 }, { h: 'Verdict', l: 1 }, { h: 'Computed' }, { h: 'Expected' }, { h: 'Difference' }, { h: 'Formula', l: 1 }, { h: 'Workbook cell', l: 1 }],
    rows: D.integrity.map(function (c) {
      return { cls: c.ok ? '' : 'subtotal',
        cells: [sv(c.label), sv(c.verdict), n(c.got), n(c.expected), n(c.diff), sv(c.formula), sv(c.cell)] };
    }) };
}
function integrityHtml(D) {
  var items = D.integrity.map(function (c) {
    return '<div class="it ' + (c.ok ? 'ok' : 'check') + '" data-check="' + esc(c.k) + '">' + (c.ok ? ICON_OK : ICON_CHECK)
      + '<div><div class="v">' + esc(c.verdict) + ' · ' + esc(c.label) + '</div>'
      + '<div class="sub">' + esc(c.words) + '</div>'
      + '<div class="sub">' + esc(N(c.got)) + ' against ' + esc(N(c.expected)) + (c.diff ? ', a difference of ' + esc(N(Math.abs(c.diff))) : '')
      + ' — ' + esc(c.formula) + ' (' + esc(c.cell) + ')</div></div></div>';
  }).join('');
  var sp = integritySpec(D);
  return panel({ id: 'integrity', title: 'Integrity checks', sub: 'the workbook\'s own checks, computed by the engine · ' + D.viewLabel,
    body: '<div class="vt-chk">' + items + '</div>',
    figuresLabel: 'the three checks, both sides, the difference and the workbook cell',
    figures: table(sp.cols, sp.rows),
    notes: ['Each check carries an icon and the word OK or CHECK, so the verdict is never colour alone. A check that disagrees prints both sides and the difference and <b>never blocks this page</b> — the figures are still the figures.'] });
}

/* ---------------------------------------------------------------- E3 · the .xlsx export ----
 * ONE WORKBOOK OF THE WHOLE DASHBOARD, BUILT FROM THE MODEL AND NEVER FROM THE SCREEN (FR-055..057). Every sheet
 * below is the SAME spec object the panel paints, so the file and the page cannot disagree — and because a spec is
 * read off `D`, the fold changes nothing: a folded table exports identically to an open one (the <details> is only
 * ever a CSS state over a table that is always in the DOM — see VTDash.fold).
 *
 * The shape mirrors the owner's own workbook where it sensibly can: an Exco-style summary first, then the trend, the
 * channel and campaign splits, the cycle buckets, budget and forecast, the detailed breakdown, the insights, GWP,
 * his FOUR Pivot sheets (the screen shows one scope at a time; the file carries all four), the Agent & Scheduler
 * Summary, upcoming fitments, the rollover follow-up, the disagreements and the integrity checks.
 *
 * EVERY SHEET SAYS WHAT IT IS: three preamble rows carry the panel, the view, the business month and the as-at date
 * before the column headers, and the first sheet is a header sheet with the rule-book version. There is no customer
 * field anywhere on the model, so there is none here (FR-057).
 */
var XFMT = { p: '0.0%', d2: '0.00', r: '"R "#,##0.00', n: '#,##0' };   /* presentation, the same four as vt-pages.js */
var PREAMBLE = 3;                                                      /* title row, provenance row, blank row */

function kpiSpec(D) {
  return { sheet: 'Exco Summary', panel: 'kpis',
    cols: [{ h: 'Measure', l: 1 }, { h: 'Value' }, { h: 'Share of sales' }, { h: 'Budget' }, { h: 'Change vs previous cycle', l: 1 }, { h: 'What it says', l: 1 }, { h: 'Sales Review cell', l: 1 }],
    rows: D.kpis.map(function (k) {
      return { cells: [sv(k.label), k.k === 'targetAchieved' ? pc(k.value) : n(k.value), pc(k.pct == null ? null : k.pct), pc(k.budget == null ? null : k.budget),
        sv(deltaWords(k.delta, k.k === 'targetAchieved' ? 'p' : 'n')), sv(k.words), sv(k.cell)] };
    }) };
}
function insightSpec(D) {
  if (!D.insights.length) return null;
  return { sheet: 'Key Insights', panel: 'insights',
    cols: [{ h: 'Insight', l: 1 }, { h: 'Sentence', l: 1 }, { h: 'Workbook cell', l: 1 }],
    rows: D.insights.map(function (i) { return { cells: [sv(i.id), sv(i.text), sv(i.cell)] }; }) };
}
/** the header sheet: what this file is, where it came from and what an empty-looking cell means (FR-056) */
function headerSpec(D) {
  var cyc = D.period;
  var rows = [
    ['Report', 'VT Report · Campaign Performance Overview'],
    ['View', D.viewLabel], ['What the view counts', D.viewWords],
    ['Business month', monthOf(cyc.key) + ' (26th–25th)'], ['Cycle', cyc.from + ' to ' + cyc.to],
    ['Figures to (as at)', D.dataThrough || absent()], ['Dialing days', D.dialingDays.words],
    ['Previous cycle', D.prevCycle.words + (D.prevSource === 'digest' ? ' Taken from the frozen digest that month published.' : ' Recomputed by the engine from the same case book.')],
    ['Cycle budget', D.budget ? D.budget.words : 'No cycle sales budget is on file for this business month.'],
    ['GWP source', D.gwp.loaded ? D.gwp.source : D.gwp.words],
    ['Rule book version', D.rulesVersion],
    ['Absent marker', absent() + ' — a figure that is not measured. It is never a zero.'],
    ['Built by', 'VTEngine.dashboard() over the Vehicle Tracking case book; the page and this file compute nothing.'],
    ['Customer data', 'None. No Vehicle Tracking source carries a customer field and neither does this file.'],
    ['Generated', sastToday() + ' (SAST)']
  ];
  return { sheet: 'About this export', panel: 'about', header: true,
    cols: [{ h: 'Field', l: 1 }, { h: 'Value', l: 1 }],
    rows: rows.map(function (r) { return { cells: [sv(r[0]), sv(r[1])] }; }) };
}

/** every sheet of the workbook, in the owner's reading order. A panel with nothing honest to say is left out. */
function sheetSpecs(D) {
  return [headerSpec(D), kpiSpec(D), trendSpec(D), channelSpec(D), campaignSpec(D), bucketSpec(D), budgetSpec(D),
    forecastSpec(D), breakdownSpec(D), insightSpec(D), gwpSpec(D)]
    .concat(pivotSpecs(D), [personSpec(D), upcomingSpec(D), rolloverSpec(D), disagreeSpec(D), integritySpec(D)])
    .filter(Boolean);
}
function exportCell(v) {
  if (v == null) return '';
  if (v.t) return v.t === 's' ? fmt('s', v.v) : (typeof v.v === 'number' && isFinite(v.v) ? v.v : absent());
  if (v.html) return absent();                      /* a shape with no words behind it: never a made-up figure */
  return String(v);
}
function sheetName(sp, used) {
  var base = String(sp.sheet).replace(/[:\\\/?*\[\]]/g, '-').slice(0, 31), nm = base, i = 1;
  while (used[nm]) nm = (base.slice(0, 27) + ' ~' + (i++)).slice(0, 31);
  used[nm] = 1; return nm;
}
/** the workbook of a model: pure, no DOM, no clock beyond the generated-at line on the header sheet */
function workbookFrom(D) {
  if (!D) return null;
  var used = {}, prov = 'View: ' + D.viewLabel + ' · Business month: ' + monthOf(D.period.key) + ' · Figures to: ' + (D.dataThrough || absent());
  var sheets = sheetSpecs(D).map(function (sp) {
    var width = sp.cols.length;
    var pad = function (a) { while (a.length < width) a.push(''); return a; };
    var aoa = [pad(['VT Report — ' + sp.sheet]), pad([prov]), pad([])]
      .concat([sp.cols.map(function (c) { return c.h; })])
      .concat(sp.rows.map(function (r) { return sp.cols.map(function (c, i) { return exportCell(r.cells[i]); }); }));
    return { name: sheetName(sp, used), panel: sp.panel, cols: sp.cols, aoa: aoa };
  });
  var name = ('VT Report - ' + D.viewLabel + ' - ' + monthOf(D.period.key) + ' to ' + shortDay(D.dataThrough))
    .replace(/[\\\/:*?"<>|]+/g, '-') + '.xlsx';
  return { sheets: sheets, name: name, view: D.view, cycle: D.period.key, dataThrough: D.dataThrough, rulesVersion: D.rulesVersion, preamble: PREAMBLE };
}
function workbookFor() { return ready() ? workbookFrom(model()) : null; }
function exportView() {
  var X = root.XLSX, wb = workbookFor(), say = typeof root.toast === 'function' ? root.toast : function () {};
  if (!wb) { say('Nothing to export yet'); return null; }
  if (!X || !X.writeFile) { say('Spreadsheet library not loaded - refresh and retry'); return null; }
  var book = X.utils.book_new(), specs = sheetSpecs(model());
  wb.sheets.forEach(function (s, si) {
    var ws = X.utils.aoa_to_sheet(s.aoa), sp = specs[si];
    /* THE NUMBER FORMAT TRAVELS WITH THE CELL, not with the column: one KPI column holds a count beside a
       percentage, so a per-column format would print one of them wrongly. */
    if (sp) sp.rows.forEach(function (r, ri) {
      sp.cols.forEach(function (c, ci) {
        var v = r.cells[ci], z = v && v.t ? XFMT[v.t] : null;
        var a = X.utils.encode_cell({ r: PREAMBLE + 1 + ri, c: ci });
        if (z && ws[a] && ws[a].t === 'n') ws[a].z = z;
      });
    });
    X.utils.book_append_sheet(book, ws, s.name);
  });
  root.__vtDashExport = { name: wb.name, view: wb.view, cycle: wb.cycle, dataThrough: wb.dataThrough, preamble: PREAMBLE,
    sheets: wb.sheets.map(function (s) { return { name: s.name, panel: s.panel, aoa: s.aoa }; }) };
  X.writeFile(book, wb.name);
  say('VT Report exported (.xlsx) — ' + wb.sheets.length + ' sheets');
  return root.__vtDashExport;
}
var DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg>';

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
    + 'Load the day\'s <b>BI Active Fitted</b> and <b>Scheduled &amp; Missed</b> exports in the Upload Station and this page fills in. The <b>Schedulers Data</b> sheet is an optional extra for the scheduler pivots and the hand-typed GWP; it is not needed every month.'
    + (typeof root.tabAllowed !== 'function' || root.tabAllowed('data') ? '<p style="margin:12px 0 0"><button class="btn small primary" onclick="go(\'data\')">Open the Upload Station</button></p>' : '') + '</div></div>';
  var D = model();
  /* "no figures yet" is NO SALE IN THIS VIEW AT ALL — read off the model (no sale, so no week), never a screen of
     zeros. dataThrough is the cycle end once any case exists, so it cannot answer this question. */
  if (!D.counts.sales && !D.weeks.length) {
    var prev = cycleKeys().filter(function (k) { return k < currentCycle().key; })[0];
    /* WHY THERE IS NOTHING TO PAINT, in the owner's own terms. A case already open when VT reporting started carries
       no sale day at all (saleDayOf: first_seen is not later than openedOn), so it belongs to no business month. That
       is history, not a fault — it is named and explained here instead of being left as a blank screen. No daily
       export carries the day a sale was made (measured 25 Nov: Fitment Date is later on 1,078/1,078 rows, Contract
       Create Date by a median of 4 days, Account Create Date runs back years for an existing customer), so this
       history can be dated only by the Schedulers Data sheet. */
    var undated = D.disagree && D.disagree.noSaleDay ? D.disagree.noSaleDay : 0;
    return headHtml(null) + controlsHtml(null) + '<div class="card vt-empty"><div class="empty"><div class="big">No ' + esc(monthOf(currentCycle().key)) + ' figures yet</div>'
      + 'No Vehicle Tracking sale falls in this business month yet. Nothing is shown as a zero in its place.'
      + (undated ? '<p style="margin:10px 0 0">' + esc(N(undated)) + ' case' + (undated === 1 ? '' : 's') + ' in the book carry no sale date: they were already open when Vehicle Tracking reporting started'
        + (C.book.openedOn ? ' on <b>' + esc(shortDay(C.book.openedOn)) + '</b>' : '') + ', so they sit outside every business month. No daily export carries the day a sale was made, so they cannot be dated from one. '
        + '<b>Every sale from the next daily upload onward is dated by that upload</b> and appears here. To date this history as well, load the <b>Schedulers Data</b> sheet.</p>' : '')
      + (prev ? '<p style="margin:12px 0 0"><button class="btn small" onclick="VTDash.set(\'cycle\',\'' + jsq(prev) + '\')">' + esc(monthOf(prev)) + ' (final)</button></p>' : '') + '</div></div>';
  }
  /* TWO COLUMNS WHERE THERE IS ROOM, ONE ON A PHONE (the owner's layout decision): the panels sit in a grid that
     folds to a single column under ~460 px, and a panel whose chart or table is genuinely wide takes the full width
     (.vt-wide). The honest states and the KPI row stay above it, full width and never folded. */
  return headHtml(D) + controlsHtml(D) + statesHtml(D) + kpisHtml(D)
    + '<div class="vt-grid">'
    + trendHtml(D) + channelHtml(D) + campaignHtml(D) + bucketsHtml(D)
    + budgetHtml(D) + forecastHtml(D) + breakdownHtml(D) + insightsHtml(D)
    + gwpHtml(D) + pivotsHtml(D) + personsHtml(D) + upcomingHtml(D) + rolloverHtml(D)
    + disagreeHtml(D) + integrityHtml(D) + '</div>'
    + '<p class="why" style="margin:12px 0 0">Every figure on this page is a field of <b>VTEngine.dashboard()</b> over the Vehicle Tracking case book — rule book ' + esc(D.rulesVersion)
    + '. The page chooses shapes and formats and computes nothing. GWP comes from the Schedulers Data sheet (' + esc(R().reports.gwp.source) + ') and is not the engine\'s BI fitted value; both are different measures and neither is adjusted to match the other.</p>';
}
/** after the real paint: the line chart's crosshair (the rest of the kit needs no JavaScript) */
/* THE PANELS PACK INSTEAD OF LEAVING HOLES (25 Nov 2026, the owner: "look at the gaps").
   A grid row is as tall as its tallest card, so a short panel beside a tall one left the rest of the row as raw
   background - measured on the live page, 1 121px of it across 15 panels at 1800px, 942px at 1600px. Stretching the
   cards to fill the row only moves the hole INSIDE the card, so each panel is measured and given a span over the
   grid's 8px rows: the next panel in that column then rises into the space, in the page's own order.
   SAFE BY CONSTRUCTION: the 8px rows only exist while this code has added .vt-masonry, so if it never runs (an old
   browser, a thrown error) the grid is exactly what it was - ragged, but never clipped. One column: nothing to do. */
var MROW = 8, MGAP = 14, mObs = null;
function masonry() {
  var d = root.document, grid = d && d.querySelector('#view .vt-grid');
  if (!grid || !root.getComputedStyle) return 0;
  var kids = [].slice.call(grid.children);
  if (!kids.length) return 0;
  var one = root.getComputedStyle(grid).gridTemplateColumns.split(' ').length < 2;
  grid.classList.remove('vt-masonry');
  kids.forEach(function (c) { c.style.gridRowEnd = ''; });
  if (one) return 0;                                  /* a phone: one column, nothing can leave a hole */
  var hs = kids.map(function (c) { return c.getBoundingClientRect().height; });
  grid.classList.add('vt-masonry');
  kids.forEach(function (c, i) { c.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((hs[i] + MGAP) / (MROW + MGAP))); });
  /* a panel that changes height on its own - a fold opening, a font landing - re-packs the column it sits in */
  if (root.ResizeObserver) {
    if (mObs) mObs.disconnect();
    var t = null;
    mObs = new root.ResizeObserver(function () { if (t) root.clearTimeout(t); t = root.setTimeout(function () { masonry(); }, 60); });
    kids.forEach(function (c) { mObs.observe(c); });
  }
  return kids.length;
}
function wire() { var ch = CH(); var n = ch && ch.wire ? ch.wire(root.document) : 0; try { masonry(); } catch (e) {} return n; }

/* ---------------------------------------------------------------- actions ---- */
var SETTINGS = ['cycle', 'view', 'pivot', 'pdim', 'pfrom', 'pto', 'pchan', 'pcamp'];
function set(k, v) {
  var u = ui();
  if (SETTINGS.indexOf(k) > -1) { u[k] = v == null ? '' : String(v); C.memo = null; saveUi(); repaint(); }
}
function clear() { var u = ui(); u.view = ''; C.memo = null; saveUi(); repaint(); }
function clearPersons() { var u = ui(); u.pfrom = ''; u.pto = ''; u.pchan = ''; u.pcamp = ''; saveUi(); repaint(); }
/* the fold state alone: saved for this person, and NEVER a repaint — <details> has already opened or closed itself,
   and re-rendering the page under the click would throw the reader's place away. */
function fold(id, open) {
  var u = ui(); u.figures = u.figures || {};
  if (open) u.figures[String(id)] = 1; else delete u.figures[String(id)];
  saveUi();
  /* a fold changes the panel's height, so the column it sits in must re-pack NOW. The ResizeObserver in masonry()
     would get there too, but only after its debounce - long enough for the panel below to sit over the one above. */
  try { masonry(); } catch (e) {}
}

return { TAB: TAB, render: render, wire: wire, masonry: masonry, set: set, clear: clear, clearPersons: clearPersons, fold: fold, retry: retry, adopt: adopt,
  exportView: exportView, workbookFor: workbookFor, workbookFrom: workbookFrom, sheetSpecs: sheetSpecs, PREAMBLE: PREAMBLE, XFMT: XFMT,
  state: function () { return { status: C.status, error: C.error, ready: ready(), cycle: currentCycle().key, view: viewKey(),
    model: ready() ? model() : null, book: C.book, receipts: C.receipts, prev: C.prev, fallback: C.fallback }; },
  _reset: function () { C.book = null; C.bookFrom = null; C.bookId++; C.rosters = {}; C.fallback = {}; C.receipts = null; C.recErr = false;
    C.prev = {}; C.prevPending = {}; C.status = 'idle'; C.error = null; C.pending = null; C.memo = null; C.ui = {}; } };
});
