/* VT SHEETS — the master VT report's own sheets, painted (Spec Kit 073, specs/073-vt-workbook-parity/).
 *
 * The owner, 26 Nov 2026: "make the data analytics like how it is in the excel dashboard". The VT Report gains the
 * workbook's tabs — Exco Summary · Agent & Scheduler Summary · Sales Review · Pivots — beside the chart Dashboard.
 * Each tab is laid out in its sheet's own section order, with the sheet's own row and column labels, and its tables
 * OPEN the way Excel shows them.
 *
 * THE PAGE PAINTS. Every figure is a field of VTWorkbook (nicks_code/vt-workbook.js, proved cell for cell against the
 * workbook by verify-vt-workbook-oracle.mjs). This file chooses shapes and formats and computes nothing. ONE SOURCE:
 * `sections()` feeds both the page and the .xlsx export, so a figure on screen and in the file cannot disagree.
 *
 *   VTSheets.TABS                 the tab list (Dashboard first, unchanged)
 *   VTSheets.render(tab, X)       the tab's HTML; X is the page context vt-dashboard.js hands over
 *   VTSheets.specs(X)             the three sheets for the export, as stacked blocks
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTSheets = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

function W() { return root.VTWorkbook || (typeof require === 'function' ? require('./vt-workbook.js') : null); }
var TABS = [
  { k: 'dashboard', label: 'Dashboard' },
  { k: 'exco', label: 'Exco Summary', sheet: 'Exco Summary' },
  { k: 'people', label: 'Agent & Scheduler Summary', sheet: 'Agent & Scheduler Summary' },
  { k: 'review', label: 'Sales Review', sheet: 'Sales Review' },
  { k: 'pivots', label: 'Pivots' }
];
var SHORT_CAMP = { 'Tracking Empire': 'Tracking Emp.', 'Referral Agent': 'Referral Ag.', 'Black Birch Projects': 'Black Birch' };

/* ---------------------------------------------------------------- cells ---- */
function c(t, v) { return { t: t, v: v }; }
var n = function (v) { return c('n', v); }, p = function (v) { return c('p', v); }, r = function (v) { return c('r', v); };
var s = function (v) { return c('s', v); };
/* a count where the workbook keeps a fraction (a 5 % budget of 2 066 is 103.3): two decimals only when it has them */
var q = function (v) { return c(v != null && Math.round(v) !== v ? 'd2' : 'n', v); };
var DASH = { t: 's', v: '-' };

/* ================================================================ sections, one source for page + export ==== */
function excoSections(X) {
  var M = W().exco(X.D), ld = M.gwpLoaded;
  var gw = function (v) { return ld ? r(v) : s(null); };
  var chCols = [{ h: 'Channel', l: 1 }, { h: 'Share of Sales' }, { h: 'Total Sales' }, { h: 'Fitted' }, { h: 'Scheduled' }, { h: 'Cancelled' },
    { h: 'Missed' }, { h: 'Fitted %' }, { h: 'Cancelled %' }, { h: 'Missed %' }, { h: 'Fitted GWP' }];
  var chRow = function (x, tot) {
    return { cls: tot ? 'subtotal' : '', cells: [s(x.label), p(x.share), n(x.sales), n(x.fitted), n(x.scheduled), n(x.cancelled), n(x.missed),
      p(x.fitRate), p(x.canRate), p(x.missRate), gw(x.gwpFitted)] };
  };
  var cpCols = [{ h: 'Campaign', l: 1 }, { h: 'Channel', l: 1 }].concat(chCols.slice(2));
  var cpRow = function (x, tot) {
    return { cls: tot ? 'subtotal' : '', cells: [s(tot ? 'Total' : x.name), s(tot ? '' : x.channel), n(x.sales), n(x.fitted), n(x.scheduled),
      n(x.cancelled), n(x.missed), p(x.fitRate), p(x.canRate), p(x.missRate), gw(x.gwpFitted)] };
  };
  var roCols = [{ h: 'Channel', l: 1 }, { h: 'Rollover Sales' }, { h: 'Fitted (counts in cycle)' }, { h: 'Scheduled' }, { h: 'Cancelled (rebook)' },
    { h: 'Missed (rebook)' }, { h: 'Open to Action' }, { h: 'Fitted %' }, { h: 'Open %' }, { h: 'Fitted GWP' }, { h: 'Open GWP' }];
  var roRow = function (x, tot) {
    return { cls: tot ? 'subtotal' : '', cells: [s(x.label), n(x.sales), n(x.fitted), n(x.scheduled), n(x.cancelled), n(x.missed), n(x.open),
      p(x.fitRate), p(x.openRate), gw(x.gwpFitted), gw(x.gwpOpen)] };
  };
  var wkCols = [{ h: 'Week Commencing', l: 1 }, { h: 'Fitted' }, { h: 'Scheduled' }, { h: 'Cancelled' }, { h: 'Missed' }, { h: 'Total Sales' }, { h: 'Fitted %' }];
  var ltCols = [{ h: 'Lead Time', l: 1 }, { h: 'Scheduled' }, { h: '% of Pipeline' }];
  var upCols = [{ h: 'Date Scheduled', l: 1 }, { h: 'Fitments Booked' }, { h: '% of Pipeline' }];
  var gwNote = ld ? '' : 'Fitted GWP comes from the Schedulers Data sheet and from nothing else; it is not on file, so the GWP columns read "—" — never a zero.';
  return {
    sheet: 'Exco Summary', strip: M.strip, gwpLoaded: ld, notesAll: M.notes,
    sub: 'Sales-to-Fitment Pipeline · View: ' + M.viewLabel,
    sections: [
      { id: 'exco-channels', title: 'Performance by Channel', cols: chCols, cell: 'Exco Summary B17:L22',
        rows: M.channels.map(function (x) { return chRow(x); }).concat([chRow(M.channelTotal, true)]), notes: [gwNote] },
      { id: 'exco-campaigns', title: 'Performance by Campaign', cols: cpCols, cell: 'Exco Summary B25:L33',
        rows: M.campaigns.map(function (x) { return cpRow(x); }).concat([cpRow(M.campaignTotal, true)]) },
      { id: 'exco-rollover', title: 'Rollover Follow-up (sales dated before ' + X.longDay(M.rollover.from) + ')', cols: roCols, cell: 'Exco Summary B35:L42',
        rows: M.rollover.rows.map(function (x) { return roRow(x); }).concat([roRow(M.rollover.total, true)]), notes: [M.rollover.words] },
      { id: 'exco-weeks', title: 'Weekly Sales Outcomes (last 14 weeks, ' + M.viewLabel + ')', cols: wkCols, cell: 'Exco Summary B65:H81',
        rows: M.weeks.map(function (w) { return { cells: [s(X.longDay(w.from)), n(w.fitted), n(w.scheduled), n(w.cancelled), n(w.missed), n(w.sales), p(w.fitRate)] }; })
          .concat([{ cls: 'subtotal', cells: [s('Total'), n(M.weekTotal.fitted), n(M.weekTotal.scheduled), n(M.weekTotal.cancelled), n(M.weekTotal.missed),
            n(M.weekTotal.sales), p(M.weekTotal.fitRate)] }]),
        notes: ['Monday weeks; the last is the week of the newest sale on file.'] },
      { id: 'exco-leadtime', title: 'Pipeline by Lead Time (all bookings)', cols: ltCols, cell: 'Exco Summary J65:L73', half: true,
        rows: M.leadTime.rows.map(function (x) { return { cells: [s(x.label), n(x.count), p(x.share)] }; })
          .concat([{ cls: 'subtotal', cells: [s('Total'), n(M.leadTime.total), p(M.leadTime.total ? 1 : null)] }]),
        notes: ['Every Scheduled booking, whatever the view. Not captured = Scheduled minus the five buckets.'] },
      { id: 'exco-upcoming', title: 'Upcoming Scheduled Fitments (all bookings)', cols: upCols, cell: 'Exco Summary B83:D102', half: true,
        rows: M.upcoming.rows.map(function (x) { return { cells: [s(X.longDay(x.date)), n(x.count), p(x.share)] }; })
          .concat([{ cells: [s('Later dates / not shown'), n(M.upcoming.later), p(M.upcoming.laterShare)] },
            { cls: 'subtotal', cells: [s('Total Scheduled'), n(M.upcoming.total), p(M.upcoming.total ? 1 : null)] }]),
        notes: ['Sixteen days from the earliest booked appointment.'] }
    ]
  };
}

function personCols(dimK, label, camps) {
  var cols = [{ h: label, l: 1 }, { h: 'Total Sales' }, { h: 'Fitted' }, { h: 'Scheduled' }, { h: 'Cancelled' }, { h: 'Missed' },
    { h: 'Fitted %' }, { h: 'Cancelled %' }, { h: 'Missed %' }, { h: 'Fitted GWP' }, { h: 'Lost GWP' },
    { h: 'Rollover Sales' }, { h: 'Rollover Fitted (counted)' }, { h: 'Rollover Scheduled' }, { h: 'Rollover Canc. / Missed' }];
  return dimK === 'referrer' ? cols.concat([{ h: 'GWP / Fitted' }])
    : cols.concat(camps.map(function (cn) { return { h: SHORT_CAMP[cn] || cn }; }));
}
function personRow(x, dimK, ld, tot) {
  var gw = function (v) { return ld ? r(v) : s(null); };
  var cells = [s(x.name), n(x.sales), n(x.fitted), n(x.scheduled), n(x.cancelled), n(x.missed), p(x.fitRate), p(x.canRate), p(x.missRate),
    gw(x.gwpFitted), gw(x.gwpLost), n(x.roll.sales), n(x.roll.fitted), n(x.roll.scheduled), n(x.roll.canMiss)];
  cells = dimK === 'referrer' ? cells.concat([gw(x.gwpPerFitted)]) : cells.concat(x.byCampaign.map(function (b) { return n(b.sales); }));
  return { cls: tot ? 'subtotal' : '', cells: cells };
}
function peopleSections(X) {
  var M = W().people(X.D, X.filters), ld = M.gwpLoaded;
  var noSched = !X.D.schedulers || !X.D.schedulers.loaded;
  var secs = M.summaries.map(function (T) {
    var need = T.k !== 'agent' && noSched;
    return { id: 'people-' + T.k, title: T.label === 'Referring Agent' ? 'Referring Agent Summary' : T.label + ' Summary',
      sub: T.words, cols: personCols(T.k, T.label, M.campaigns), cell: T.cell,
      empty: need ? (T.k === 'scheduler' ? 'No daily export names the scheduler' : 'No daily export names the referring agent')
        + ', so this table needs the Schedulers Data sheet. Nothing is shown as a zero in its place.' : null,
      rows: [personRow(T.total, T.k, ld, true)].concat(T.rows.map(function (x) { return personRow(x, T.k, ld); })) };
  });
  var lead = M.schedulerLead, BK = lead.all.rows;
  var leadSec = { id: 'people-lead', title: 'Scheduler Pipeline by Lead Time (all Scheduled bookings)', sub: lead.words, cell: lead.cell,
    cols: [{ h: 'Scheduler', l: 1 }].concat(BK.map(function (b) { return { h: b.label }; }), [{ h: 'Total Scheduled' }]),
    empty: noSched ? 'No daily export names the scheduler, so this table needs the Schedulers Data sheet.' : null,
    rows: [{ cls: 'subtotal', cells: [s('All schedulers')].concat(lead.all.rows.map(function (b) { return n(b.count); }), [n(lead.all.total)]) }]
      .concat(lead.rows.map(function (l) { return { cells: [s(l.name)].concat(l.rows.map(function (b) { return n(b.count); }), [n(l.total)]) }; })) };
  /* the sheet's order: Scheduler Summary, Scheduler Pipeline by Lead Time, Agent Summary, Referring Agent Summary */
  return { sheet: 'Agent & Scheduler Summary', strip: M.strip, gwpLoaded: ld, campaigns: M.campaigns,
    sub: 'Agent, Referring Agent & Scheduler Summary · View: ' + M.viewLabel,
    sections: [secs[0], leadSec, secs[1], secs[2]] };
}
function drillSection(X) {
  var t = X.drill.type, M = W().drill(X.D, t, X.drill.name, X.filters), ld = !!(X.D.gwp && X.D.gwp.loaded);
  var res = { fitted: 'Fitted', scheduled: 'Scheduled', cancelled: 'Cancelled', missed: 'Missed' };
  return { id: 'people-drill', title: 'Drill-down: sales detail for one person', cell: M.cell, model: M,
    cols: [{ h: 'Agent', l: 1 }, { h: 'Sale Date', l: 1 }, { h: 'Case Number', l: 1 }, { h: 'Cycle Tag', l: 1 }, { h: 'Referring Agent', l: 1 },
      { h: 'Scheduler', l: 1 }, { h: 'Campaign', l: 1 }, { h: 'Result', l: 1 }, { h: 'GWP' }],
    rows: M.rows.map(function (x) {
      return { cells: [s(x.agent), s(X.longDay(x.soldOn)), s(x.caseNumber), s(x.cycleTag), s(x.referrer), s(x.scheduler), s(x.campaign),
        s(res[x.result] || x.result), ld ? r(x.gwp) : s(null)] };
    }) };
}
function reviewSections(X) {
  var M = W().review(X.Dc);
  var detail = [];
  M.groups.forEach(function (g) {
    g.rows.forEach(function (x) {
      var pk = g.kind === 'p';
      var val = function (v) { return pk ? p(v) : q(v); };
      var label = x.total ? g.kpi : ' ' + x.label;
      detail.push({ cls: x.total ? 'subtotal' : '', cells: [s(label), val(x.budget), val(x.actual), p(x.pctTgt),
        x.deficitWords ? s(x.deficit == null ? null : x.deficit + ' ' + x.deficitWords) : val(x.deficit),
        x.forecastDash ? DASH : (x.forecast == null ? s(null) : val(x.forecast)), x.allData == null ? s(null) : val(x.allData)] });
    });
  });
  return { sheet: 'Sales Review', review: M,
    sub: 'VT Scheduling · Sales Review · ' + X.monthOf(M.period.key) + ' · column C is always the cycle view (current + fitted rollovers); G is all data',
    sections: [
      { id: 'review-vsbudget', title: 'Sales & Fitments vs Budget — cycle view', cell: 'Sales Review A27:G34',
        cols: [{ h: 'Channel', l: 1 }, { h: 'Sales Budget' }, { h: 'Sales Actual' }, { h: 'Sales Forecast' }, { h: 'Fitments Budget' },
          { h: 'Fitments Actual' }, { h: 'Fitments Forecast' }],
        rows: M.vsBudget.map(function (x) {
          return { cls: x.channel === 'total' ? 'subtotal' : '', cells: [s(x.label), q(x.salesBudget), n(x.salesActual), q(x.salesForecast),
            q(x.fitBudget), n(x.fitActual), q(x.fitForecast)] };
        }), notes: ['Forecast = actual ÷ elapsed dialing days × the cycle\'s dialing days: a straight-line pace, not a prediction.', M.budgetWords] },
      { id: 'review-mix', title: 'Outcome Mix — cycle view', cell: 'Sales Review A36:G43',
        cols: [{ h: 'Channel', l: 1 }, { h: 'Fitted' }, { h: 'Scheduled' }, { h: 'Missed' }, { h: 'Cancelled' }, { h: 'Total Sales' }, { h: 'Fitment %' }],
        rows: M.outcomeMix.map(function (x) {
          return { cls: x.channel === 'total' ? 'subtotal' : '', cells: [s(x.label), n(x.fitted), n(x.scheduled), n(x.missed), n(x.cancelled), n(x.sales), p(x.fitRate)] };
        }) },
      { id: 'review-detail', title: 'Detailed Table — Budget vs Cycle View vs Forecast · VT Scheduling, all campaign totals', cell: 'Sales Review A45:G122',
        cols: [{ h: 'KPI', l: 1 }, { h: 'Budget Targets' }, { h: 'Cycle view (current + fitted rollovers)' }, { h: '% Tgt' }, { h: 'Deficit / Surplus' },
          { h: 'Forecast' }, { h: 'All data' }],
        rows: detail,
        notes: ['Deficit / Surplus = actual − budget (Dialing Days shows the days left). % Tgt and Deficit are blank where either side is blank — Other carries no budget.',
          'Forecast is a straight-line pace for counts; Fitment Rate\'s is forecast fitments ÷ forecast sales; Missed, Cancelled, Cancelled %, Scheduled and the lead-time rows show "-", as the sheet does.',
          'Panimax = Referrals + Predictive, budgets included, and is never counted twice: Total = Digital + Other + Panimax.'] }
    ]
  };
}

/* ================================================================ painting ==== */
function stripHtml(X, strip, review) {
  if (review) {
    var t = function (x) {
      var whole = x.value == null || Math.round(x.value) === x.value;      /* 2 975,5 keeps its half; 3 160 has none */
      var big = x.k === 'dialing' ? (x.value == null ? X.absent() : x.value + ' of ' + x.of) : X.fmt(x.pctKind ? 'p' : (whole ? 'n' : 'd2'), x.value);
      var sub = x.k === 'dialing' ? X.fmt('p', x.pct) + ' of cycle elapsed · ' + (x.left == null ? X.absent() : x.left) + ' days left'
        : x.budget == null ? 'no ' + x.budgetWord.toLowerCase() + ' on file' : x.budgetWord + ' ' + X.fmt(x.pctKind ? 'p' : (Math.round(x.budget) === x.budget ? 'n' : 'd2'), x.budget);
      return '<div class="vt-kpi vt-sheet-tile" data-tile="' + X.esc(x.k) + '"><div class="lab">' + X.esc(x.label) + '</div><div class="val">' + X.esc(big) + '</div><div class="sub">' + X.esc(sub) + '</div></div>';
    };
    return '<div class="vt-kpis vt-sheet-strip">' + strip.map(t).join('') + '</div>';
  }
  return '<div class="vt-kpis vt-sheet-strip">' + strip.map(function (x) {
    var big = x.money ? X.fmt('r', x.value) : X.fmt('n', x.value);
    var sub = x.money ? (x.of == null ? 'GWP is not on file' : 'of ' + X.fmt('r', x.of) + ' GWP in view') : x.pct == null ? 'all sales to date in view' : X.fmt('p', x.pct) + ' of sales';
    return '<div class="vt-kpi vt-sheet-tile" data-tile="' + X.esc(x.k) + '"><div class="lab">' + X.esc(x.label) + '</div><div class="val">' + X.esc(big) + '</div><div class="sub">' + X.esc(sub) + '</div></div>';
  }).join('') + '</div>';
}
function sectionHtml(X, sec) {
  var body = sec.empty ? '<div class="empty">' + X.esc(sec.empty) + '</div>' : X.table(sec.cols, sec.rows);
  return '<div class="card mt vt-sheet' + (sec.half ? ' vt-sheet-half' : '') + '" data-sheet-part="' + X.esc(sec.id) + '">'
    + '<div class="cardhead"><div><h3>' + X.esc(sec.title) + '</h3>' + (sec.sub ? '<div class="sub">' + X.esc(sec.sub) + '</div>' : '')
    + '</div><div class="spacer"></div><span class="vt-absent vt-cellref" title="the workbook cells this table answers">' + X.esc(sec.cell || '') + '</span></div>'
    + body + (sec.notes || []).filter(Boolean).map(function (w) { return '<p class="why">' + X.esc(w) + '</p>'; }).join('') + '</div>';
}
function headlinesHtml(X) {
  var ins = X.D.insights || [];
  if (!ins.length) return '';
  return '<div class="card mt vt-sheet" data-sheet-part="headlines"><div class="cardhead"><div><h3>Headlines</h3></div></div><ul class="vt-ins">'
    + ins.map(function (i) { return '<li>' + X.esc(i.text) + ' <span class="vt-absent">(' + X.esc(i.cell) + ')</span></li>'; }).join('') + '</ul></div>';
}
function filtersHtml(X, M) {
  var f = X.filters || {}, opt = function (v, label, on) { return '<option value="' + X.esc(v) + '"' + (on ? ' selected' : '') + '>' + X.esc(label) + '</option>'; };
  var R = W() && root.VTEngine ? root.VTEngine.VT_RULES : (typeof require === 'function' ? require('./vt-engine.js').VT_RULES : null);
  return '<div class="filters vt-filters" data-sheet-part="filters">'
    + '<input type="date" aria-label="Sales dated from" data-vtr="pfrom" value="' + X.esc(f.from || '') + '" onchange="VTDash.set(\'pfrom\',this.value)">'
    + '<input type="date" aria-label="Sales dated to" data-vtr="pto" value="' + X.esc(f.to || '') + '" onchange="VTDash.set(\'pto\',this.value)">'
    + '<select aria-label="Channel" data-vtr="pchan" onchange="VTDash.set(\'pchan\',this.value)">' + opt('', 'All channels', !f.channel)
    + R.channels.keys.map(function (k) { return opt(k, R.channels.labels[k], k === f.channel); }).join('') + '</select>'
    + '<select aria-label="Campaign" data-vtr="pcamp" onchange="VTDash.set(\'pcamp\',this.value)">' + opt('', 'All campaigns', !f.campaign)
    + M.campaigns.map(function (cn) { return opt(cn, cn, cn === f.campaign); }).join('') + '</select>'
    + (f.from || f.to || f.channel || f.campaign ? '<button class="btn small" onclick="VTDash.clearPersons()">Clear filters</button>'
      : '<span class="note" style="margin:0">No date / channel / campaign filter applied</span>') + '</div>';
}
function drillHtml(X, sec) {
  var M = sec.model, opt = function (v, label, on) { return '<option value="' + X.esc(v) + '"' + (on ? ' selected' : '') + '>' + X.esc(label) + '</option>'; };
  var types = W().DIMS;
  var pick = '<div class="filters vt-filters" style="margin-top:0">'
    + '<select aria-label="Drill-down type" data-vtr="dtype" onchange="VTDash.set(\'dtype\',this.value)">'
    + types.map(function (d) { return opt(d.k, d.label, d.k === M.type); }).join('') + '</select>'
    + '<select aria-label="Drill-down name" data-vtr="dname" onchange="VTDash.set(\'dname\',this.value)">'
    + (M.names.length ? M.names.map(function (nm) { return opt(nm, nm, nm === M.name); }).join('') : opt('', 'Nobody in view', true)) + '</select></div>';
  var k = M.counts, ld = !!(X.D.gwp && X.D.gwp.loaded);
  var tile = function (lab, v, t) { return '<div class="vt-kpi vt-sheet-tile"><div class="lab">' + X.esc(lab) + '</div><div class="val">' + X.esc(X.fmt(t || 'n', v)) + '</div></div>'; };
  var tiles = '<div class="vt-kpis vt-sheet-strip">' + tile('Records', k.records) + tile('Fitted', k.fitted) + tile('Scheduled', k.scheduled)
    + tile('Cancelled', k.cancelled) + tile('Missed', k.missed) + tile('Fitted GWP', ld ? k.gwpFitted : null, 'r') + tile('Total GWP', ld ? k.gwpTotal : null, 'r') + '</div>';
  var body = M.name == null ? '<div class="empty">Nobody of this kind has a sale in view.</div>' : X.table(sec.cols, sec.rows);
  return '<div class="card mt vt-sheet" data-sheet-part="people-drill"><div class="cardhead"><div><h3>' + X.esc(sec.title) + '</h3>'
    + '<div class="sub">Pick a type, then a name · ' + X.esc(M.name ? M.typeLabel + ': ' + M.name : 'nobody in view') + '</div></div><div class="spacer"></div>'
    + '<span class="vt-absent vt-cellref">' + X.esc(sec.cell) + '</span></div>' + pick + tiles + body
    + '<p class="why">Every sale in view for this person, the workbook\'s columns. Case numbers and staff names only — no customer detail is ever on this page.</p></div>';
}
function render(tab, X) {
  if (tab === 'exco') {
    var E1 = excoSections(X);
    return '<div class="vt-sheetview" data-sheet="exco"><p class="note vt-sheet-sub">' + X.esc(E1.sub) + '</p>' + stripHtml(X, E1.strip) + headlinesHtml(X)
      + E1.sections.slice(0, 4).map(function (sc) { return sectionHtml(X, sc); }).join('')
      + '<div class="vt-sheet-pair">' + E1.sections.slice(4).map(function (sc) { return sectionHtml(X, sc); }).join('') + '</div>'
      + '<div class="card mt vt-sheet" data-sheet-part="notes"><div class="cardhead"><div><h3>Notes &amp; Definitions</h3></div></div><ul class="vt-ins">'
      + E1.notesAll.map(function (w) { return '<li>' + X.esc(w) + '</li>'; }).join('') + '</ul></div></div>';
  }
  if (tab === 'people') {
    var P1 = peopleSections(X), D1 = drillSection(X);
    return '<div class="vt-sheetview" data-sheet="people"><p class="note vt-sheet-sub">' + X.esc(P1.sub) + '</p>' + filtersHtml(X, P1) + stripHtml(X, P1.strip)
      + drillHtml(X, D1) + P1.sections.map(function (sc) { return sectionHtml(X, sc); }).join('') + '</div>';
  }
  if (tab === 'review') {
    var V1 = reviewSections(X), M = V1.review;
    var set = '<div class="card mt vt-sheet" data-sheet-part="review-settings"><div class="cardhead"><div><h3>Cycle settings &amp; checks</h3>'
      + '<div class="sub">' + X.esc(M.settings.words) + '</div></div><div class="spacer"></div><span class="vt-absent vt-cellref">Sales Review I4:K19</span></div>'
      + X.table([{ h: 'Setting', l: 1 }, { h: 'Value', l: 1 }], [
        { cells: [s('Cycle start'), s(X.longDay(M.settings.from))] }, { cells: [s('Cycle end'), s(X.longDay(M.settings.to))] },
        { cells: [s('Data up to'), s(X.longDay(M.settings.dataThrough))] }]
        .concat(M.settings.holidays.length ? M.settings.holidays.map(function (h, i) { return { cells: [s('Public holiday ' + (i + 1) + ' (not a dialing day)'), s(X.longDay(h.date) + ' · ' + h.name)] }; })
          : [{ cells: [s('Public holidays'), s('none inside this cycle')] }])
        .concat((M.checks || []).map(function (ck) { return { cls: 'subtotal', cells: [s('CHECK · ' + ck.label), s(ck.verdict + ' — ' + ck.words)] }; })))
      + '</div>';
    return '<div class="vt-sheetview" data-sheet="review"><p class="note vt-sheet-sub">' + X.esc(V1.sub) + '</p>' + stripHtml(X, M.strip, true) + set
      + V1.sections.map(function (sc) { return sectionHtml(X, sc); }).join('') + '</div>';
  }
  if (tab === 'pivots') {
    var pv = X.pivotSpecs ? X.pivotSpecs() : [];
    if (!pv.length) return '<div class="card mt"><div class="empty">The scheduler pivots need the Schedulers Data sheet: no daily export names the scheduler.</div></div>';
    return '<div class="vt-sheetview" data-sheet="pivots"><p class="note vt-sheet-sub">The four workbook pivots — scheduler × outcome — over ' + X.esc(X.D.viewLabel) + '.</p>'
      + pv.map(function (sp) {
        return sectionHtml(X, { id: 'pivot-' + String(sp.sheet).toLowerCase().replace(/[^a-z]+/g, '-'), title: sp.sheet, cols: sp.cols, rows: sp.rows, cell: sp.cell || '' });
      }).join('') + '</div>';
  }
  return '';
}

/* ================================================================ export: the three sheets, stacked blocks ==== */
function specs(X) {
  var out = [];
  var push = function (name, strip, secs, extra) {
    var blocks = [];
    if (strip) blocks.push({ title: 'Headline figures', cols: [{ h: 'Figure', l: 1 }, { h: 'Value' }, { h: 'Beside it' }],
      rows: strip.map(function (x) {
        var v = x.money ? r(x.value) : x.pctKind ? p(x.value) : (x.k === 'dialing' ? n(x.value) : q(x.value));
        var b = x.k === 'dialing' ? s('of ' + x.of + ' · ' + x.left + ' days left') : x.budget != null ? (x.pctKind ? p(x.budget) : q(x.budget))
          : x.pct != null ? p(x.pct) : x.of != null ? r(x.of) : s(null);
        return { cells: [s(x.label), v, b] };
      }) });
    (extra || []).forEach(function (b) { blocks.push(b); });
    secs.forEach(function (sc) { if (!sc.empty) blocks.push({ title: sc.title, cols: sc.cols, rows: sc.rows }); });
    out.push({ sheet: name, panel: 'sheet-' + name.toLowerCase().replace(/[^a-z]+/g, '-'), blocks: blocks });
  };
  var E1 = excoSections(X); push('Workbook - Exco Summary', E1.strip, E1.sections);
  var P1 = peopleSections(X); push('Workbook - Agent & Scheduler', P1.strip, P1.sections);
  var V1 = reviewSections(X); push('Workbook - Sales Review', V1.review.strip, V1.sections);
  return out;
}

return { TABS: TABS, render: render, specs: specs };
});
