/* VT WORKBOOK — the master VT report's own sheets, computed (Spec Kit 073, specs/073-vt-workbook-parity/).
 *
 * The owner, 26 Nov 2026: "we want to make the data analytics like how it is in the excel dashboard bring everything
 * in the agent os". The workbook (Master November 2026 - VT Report.xlsx) is the EXAMPLE OUTPUT and the acceptance
 * test: built from its own Schedulers Data sheet, every figure here equals the workbook's stored value for its cell
 * (verify-vt-workbook-oracle.mjs). Each figure carries the cell it answers.
 *
 * THE ENGINE DECIDES, THE PAGE PAINTS. This file is engine code: pure functions over VTEngine.dashboard()'s model and
 * the sale facts it hands out (model.facts / model.inView, non-enumerable). No DOM, no fetch, no clock. A fact never
 * carries a customer field, so nothing here can leak one.
 *
 *   VTWorkbook.exco(D)                    Exco Summary            (follows the page's View, like the sheet's C4)
 *   VTWorkbook.people(D, filters)         Agent & Scheduler Summary
 *   VTWorkbook.drill(D, type, name, f)    its drill-down: one person's every sale
 *   VTWorkbook.review(Dcycle)             Sales Review            (column C is ALWAYS the cycle view, G all data)
 *
 * AN ABSENCE IS NOT A NOUGHT. With no GWP or no budget on file the figure is null and the page says why.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTWorkbook = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

var ENG = null;
function E() {
  if (ENG) return ENG;
  if (root && root.VTEngine) return (ENG = root.VTEngine);
  if (typeof require === 'function') { try { ENG = require('./vt-engine.js'); } catch (e) { ENG = null; } }
  return ENG;
}
function R() { return E().VT_RULES; }

/* ---------------------------------------------------------------- small pieces ---- */
var ST = ['fitted', 'scheduled', 'cancelled', 'missed'];
var DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(d, n) { return iso(Date.parse(d + 'T00:00:00Z') + n * DAY); }
function mondayOf(d) { var w = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); }
function ratio(a, b) { return a != null && b != null && b > 0 ? a / b : null; }
function count(list, st) { var n = 0; for (var i = 0; i < list.length; i++) if (list[i].st === st) n++; return n; }
function sumGwp(list, test, loaded) {
  if (!loaded) return null;
  var s = 0; for (var i = 0; i < list.length; i++) if (test(list[i]) && list[i].gwp != null) s += +list[i].gwp;
  return s;
}
var isFitted = function (f) { return f.st === 'fitted'; };
var isLost = function (f) { return f.st === 'cancelled' || f.st === 'missed'; };
var isAny = function () { return true; };
/* the engine's own tally: Sales and Fitted over the view's sales set, the open outcomes over its open set (F0-9) */
function tally(sl, op, loaded) {
  var t = { sales: sl.length, fitted: count(sl, 'fitted'), scheduled: count(op, 'scheduled'),
    cancelled: count(op, 'cancelled'), missed: count(op, 'missed') };
  t.fitRate = ratio(t.fitted, t.sales); t.schedRate = ratio(t.scheduled, t.sales);
  t.canRate = ratio(t.cancelled, t.sales); t.missRate = ratio(t.missed, t.sales);
  t.gwpFitted = sumGwp(sl, isFitted, loaded); t.gwpTotal = sumGwp(sl, isAny, loaded); t.gwpLost = sumGwp(op, isLost, loaded);
  return t;
}
/* every status counted over ONE set (the workbook's COUNTIFS over its view criteria) */
function mix(list, loaded) {
  var t = { sales: list.length };
  ST.forEach(function (s) { t[s] = count(list, s); });
  t.fitRate = ratio(t.fitted, t.sales); t.canRate = ratio(t.cancelled, t.sales);
  t.missRate = ratio(t.missed, t.sales); t.schedRate = ratio(t.scheduled, t.sales);
  t.gwpFitted = sumGwp(list, isFitted, loaded); t.gwpTotal = sumGwp(list, isAny, loaded); t.gwpLost = sumGwp(list, isLost, loaded);
  return t;
}
function need(D) {
  if (!D || !D.facts || !D.inView) throw new Error('VTWorkbook needs a VTEngine.dashboard() model (spec 073: it carries model.facts)');
  return { A: D.facts, S: D.inView.sales, O: D.inView.open, loaded: !!(D.gwp && D.gwp.loaded) };
}
function chKeys() { return R().channels.keys.slice(); }
function chLabel(k) { return R().channels.labels[k] || k; }
function srLabel(k) { return R().channels.salesReviewLabels[k] || chLabel(k); }
function rollup() {
  var ru = R().channels.rollups || {}, k = Object.keys(ru)[0];
  return k ? { k: k, label: ru[k].label, members: ru[k].members.slice() } : null;
}
/* the campaigns in the workbook's own order (the rule book's campaign map), then any the map does not name */
function campaignOrder(list) {
  var map = R().channels.campaignMap || {}, named = Object.keys(map), seen = {};
  named.forEach(function (c) { seen[c] = 1; });
  var extra = {};
  list.forEach(function (f) { if (f.campaign && !seen[f.campaign]) extra[f.campaign] = 1; });
  return named.concat(Object.keys(extra).sort());
}
function bucketOf(f, D) { return E().periods.hrsBucket(f.apptOn, D.period.hrsAsAt, D.period.to); }
function aheadBuckets() { return R().periods.leadTimeBuckets.filter(function (b) { return b.k !== 'past'; }); }
function nameOk(v) { return v != null && v !== '' && v !== 0 && v !== '0'; }
/* ONE PERSON, HOWEVER THEY ARE SPELT. Excel's COUNTIFS and UNIQUE match names without regard to case, so the workbook
   counts "Ismail Samuel" and "ismail samuel" as one agent. Grouping on the exact string made three agents and one
   referring agent appear twice, each copy a sale short (oracle, 26 Nov). A person is their name with the case and the
   spacing folded; they are SHOWN under the spelling most of their rows carry. */
function nameKey(v) { return String(v).trim().replace(/\s+/g, ' ').toLowerCase(); }
function groupNames(list, field) {
  var by = {};
  list.forEach(function (f) {
    var v = f[field]; if (!nameOk(v)) return;
    var k = nameKey(v), g = by[k] || (by[k] = { key: k, spellings: {}, n: 0 });
    g.n++; g.spellings[String(v).trim()] = (g.spellings[String(v).trim()] || 0) + 1;
  });
  Object.keys(by).forEach(function (k) {
    var sp = by[k].spellings; by[k].name = Object.keys(sp).sort(function (a, b) { return sp[b] - sp[a] || (a < b ? -1 : 1); })[0];
  });
  return by;
}
function isPerson(field, key) { return function (f) { return nameOk(f[field]) && nameKey(f[field]) === key; }; }

/* ================================================================ Exco Summary ==== */
function exco(D) {
  var x = need(D), A = x.A, S = x.S, O = x.O, ld = x.loaded, cyc = D.period;
  var all = tally(S, O, ld);

  /* B6:K8 — the strip. "% of sales" is each outcome over the sales in view. */
  var strip = [
    { k: 'sales', label: 'Total sales in view', value: all.sales, pct: null, cell: 'Exco Summary B7' },
    { k: 'fitted', label: 'Fitted', value: all.fitted, pct: all.fitRate, cell: 'Exco Summary C7' },
    { k: 'scheduled', label: 'Scheduled (pipeline)', value: all.scheduled, pct: all.schedRate, cell: 'Exco Summary E7' },
    { k: 'cancelled', label: 'Cancelled', value: all.cancelled, pct: all.canRate, cell: 'Exco Summary G7' },
    { k: 'missed', label: 'Missed', value: all.missed, pct: all.missRate, cell: 'Exco Summary I7' },
    { k: 'gwp', label: 'Fitted GWP', value: all.gwpFitted, pct: null, of: all.gwpTotal, money: true, cell: 'Exco Summary K7 / K8' }
  ];

  /* B17:L22 — Performance by Channel */
  var channels = chKeys().map(function (k) {
    var t = tally(S.filter(function (f) { return f.channel === k; }), O.filter(function (f) { return f.channel === k; }), ld);
    t.k = k; t.label = chLabel(k); t.share = ratio(t.sales, all.sales); return t;
  });
  var chTotal = Object.assign({ k: 'total', label: 'Total', share: all.sales ? 1 : null }, all);

  /* B25:L33 — Performance by Campaign, in the workbook's order, with its channel */
  var campNames = campaignOrder(A);
  var campaigns = campNames.map(function (name) {
    var t = tally(S.filter(function (f) { return f.campaign === name; }), O.filter(function (f) { return f.campaign === name; }), ld);
    t.name = name; t.channel = chLabel(E().channelOf(name, null)); return t;
  });
  var unnamed = tally(S.filter(function (f) { return !f.campaign; }), O.filter(function (f) { return !f.campaign; }), ld);
  if (unnamed.sales) { unnamed.name = 'No campaign on file'; unnamed.channel = '—'; campaigns.push(unnamed); }

  /* B36:L41 — Rollover Follow-up: sales dated before the cycle start, ALL data, never the view */
  var pre = A.filter(function (f) { return f.soldOn < cyc.from; });
  var rollRow = function (list, k, label) {
    var t = mix(list, ld); t.k = k; t.label = label;
    t.open = t.scheduled + t.cancelled + t.missed; t.openRate = ratio(t.open, t.sales);
    t.gwpOpen = sumGwp(list, function (f) { return f.st !== 'fitted'; }, ld);
    return t;
  };
  var rollover = { rows: chKeys().map(function (k) { return rollRow(pre.filter(function (f) { return f.channel === k; }), k, chLabel(k)); }),
    total: rollRow(pre, 'total', 'Total'), from: cyc.from,
    words: 'Rollovers are sales dated before ' + cyc.from + '. A fitted rollover counts towards this cycle; scheduled, cancelled and missed ones are open to action. Always the pre-cycle position, whatever the view.' };

  /* B66:H81 — Weekly Sales Outcomes: 14 Monday weeks ending at the week of the newest sale */
  var newest = A.reduce(function (m, f) { return !m || f.soldOn > m ? f.soldOn : m; }, null);
  var weeks = [];
  if (newest) {
    var first = addDays(mondayOf(newest), -13 * 7);
    for (var i = 0; i < 14; i++) {
      var wf = addDays(first, i * 7), wt = addDays(wf, 7);
      var t = mix(S.filter(function (f) { return f.soldOn >= wf && f.soldOn < wt; }), ld);
      t.from = wf; t.label = wf; weeks.push(t);
    }
  }
  var wTot = { sales: 0 }; ST.forEach(function (s) { wTot[s] = 0; });
  weeks.forEach(function (w) { wTot.sales += w.sales; ST.forEach(function (s) { wTot[s] += w[s]; }); });
  wTot.fitRate = ratio(wTot.fitted, wTot.sales);

  /* J66:L73 — Pipeline by Lead Time: every Scheduled booking, whatever the view */
  var sched = A.filter(function (f) { return f.st === 'scheduled'; });
  var leadTime = leadRows(sched, D, 'Exco Summary K');

  /* B84:D102 — Upcoming Scheduled Fitments: 16 days from the earliest appointment, later dates, total */
  var appts = sched.map(function (f) { return f.apptOn; }).filter(Boolean).sort();
  var up = { rows: [], later: 0, total: sched.length, from: appts[0] || null };
  if (up.from) {
    var shown = 0;
    for (var d = 0; d < 16; d++) {
      var day = addDays(up.from, d), n = 0;
      for (var j = 0; j < sched.length; j++) if (sched[j].apptOn === day) n++;
      shown += n; up.rows.push({ date: day, count: n, share: ratio(n, up.total) });
    }
    up.later = up.total - shown;
  } else up.later = up.total;
  up.laterShare = ratio(up.later, up.total);

  return { sheet: 'Exco Summary', view: D.view, viewLabel: D.viewLabel, period: cyc, strip: strip, gwpLoaded: ld,
    channels: channels, channelTotal: chTotal, campaigns: campaigns, campaignTotal: chTotal,
    rollover: rollover, weeks: weeks, weekTotal: wTot, leadTime: leadTime, upcoming: up,
    notes: notesFor(D) };
}
/* the five lead-time buckets + Not captured + Total over one Scheduled set */
function leadRows(sched, D, cellCol) {
  var B = aheadBuckets(), tl = {}, total = sched.length, named = 0;
  B.forEach(function (b) { tl[b.k] = 0; });
  sched.forEach(function (f) { var k = bucketOf(f, D); if (k && tl[k] != null) { tl[k]++; named++; } });
  var rows = B.map(function (b) { return { k: b.k, label: b.label, count: tl[b.k], share: ratio(tl[b.k], total) }; });
  rows.push({ k: 'notCaptured', label: 'Not captured', count: total - named, share: ratio(total - named, total),
    words: 'Scheduled with no lead-time bucket (no appointment date, or one already past): Scheduled minus the five buckets.' });
  return { rows: rows, total: total, cell: cellCol ? cellCol + '67:L73' : null };
}
function notesFor(D) {
  var p = D.period, ru = rollup();
  return [
    'The month cycle runs ' + p.from + ' to ' + p.to + '. Figures to ' + (D.dataThrough || '—') + '.',
    'View: ' + D.viewLabel + '. ' + (D.viewWords || ''),
    'Channels: ' + chKeys().map(function (k) {
      var camps = Object.keys(R().channels.campaignMap).filter(function (c) { return R().channels.campaignMap[c] === k; });
      return chLabel(k) + (camps.length ? ' = ' + camps.join(', ') : '');
    }).join('; ') + '.' + (ru ? ' ' + ru.label + ' = ' + ru.members.map(chLabel).join(' + ') + ', never counted twice in a total.' : ''),
    'The lead-time and upcoming-fitment tables cover every Scheduled booking, whatever the view.'
  ];
}

/* ================================================================ Agent & Scheduler Summary ==== */
var DIMS = [{ k: 'scheduler', label: 'Scheduler', all: 'All schedulers', cell: 'Agent & Scheduler Summary B38:W' },
  { k: 'agent', label: 'Agent', all: 'All agents', cell: 'Agent & Scheduler Summary B67:W' },
  { k: 'referrer', label: 'Referring Agent', all: 'All referring agents', cell: 'Agent & Scheduler Summary B162:W' }];
function keeper(fl) {
  fl = fl || {};
  return function (f) {
    if (fl.from && f.soldOn < fl.from) return false;
    if (fl.to && f.soldOn > fl.to) return false;
    if (fl.channel && f.channel !== fl.channel) return false;
    if (fl.campaign && f.campaign !== fl.campaign) return false;
    return true;
  };
}
function people(D, filters) {
  var x = need(D), A = x.A, ld = x.loaded, cyc = D.period, keep = keeper(filters);
  var S = x.S.filter(keep), O = x.O.filter(keep), camps = campaignOrder(A);
  var pre = A.filter(function (f) { return f.soldOn < cyc.from && keep(f); });
  var summary = function (dim) {
    var names = groupNames(S, dim.k);
    var row = function (label, sl, op, pr) {
      var t = tally(sl, op, ld); t.name = label;
      t.gwpPerFitted = ld && t.fitted > 0 ? t.gwpFitted / t.fitted : null;   /* A&SS Q164: GWP / Fitted (referring agents) */
      t.roll = { sales: pr.length, fitted: count(pr, 'fitted'), scheduled: count(pr, 'scheduled'),
        canMiss: count(pr, 'cancelled') + count(pr, 'missed') };
      t.byCampaign = camps.map(function (c) { return { campaign: c, sales: sl.filter(function (f) { return f.campaign === c; }).length }; });
      return t;
    };
    var rows = Object.keys(names).map(function (k) {
      var mine = isPerson(dim.k, k);
      return row(names[k].name, S.filter(mine), O.filter(mine), pre.filter(mine));
    }).sort(function (a, b) { return b.sales - a.sales || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    var named = function (f) { return nameOk(f[dim.k]); };
    var total = row(dim.all, S.filter(named), O.filter(named), pre.filter(named));
    total.reconciles = dim.k === 'referrer' ? null : total.sales === S.length;
    return { k: dim.k, label: dim.label, rows: rows, total: total, cell: dim.cell,
      unnamed: S.length - total.sales,
      words: dim.k === 'referrer' ? 'Covers every sale with a referring agent captured.' : (total.sales === S.length
        ? 'Reconciles to total sales in view.' : (S.length - total.sales) + ' sale(s) in view carry no ' + dim.label.toLowerCase() + ', so this table is short of the total by that many.') };
  };

  /* B51:I59 — Scheduler Pipeline by Lead Time: every Scheduled booking, the Channel + Campaign filters only */
  var chOnly = keeper({ channel: (filters || {}).channel, campaign: (filters || {}).campaign });
  var sched = A.filter(function (f) { return f.st === 'scheduled' && chOnly(f); });
  var sNames = groupNames(sched, 'scheduler');
  var leadAll = leadRows(sched.filter(function (f) { return nameOk(f.scheduler); }), D);
  var leadBy = Object.keys(sNames).map(function (k) {
    var l = leadRows(sched.filter(isPerson('scheduler', k)), D); l.name = sNames[k].name; return l;
  }).sort(function (a, b) { return b.total - a.total || (a.name < b.name ? -1 : 1); });

  var tops = DIMS.map(summary);
  return { sheet: 'Agent & Scheduler Summary', view: D.view, viewLabel: D.viewLabel, period: cyc, gwpLoaded: ld,
    filters: filters || {}, campaigns: camps, summaries: tops,
    schedulerLead: { all: leadAll, rows: leadBy, cell: 'Agent & Scheduler Summary B51:I59',
      words: 'Every Scheduled booking, whatever the view and the dates; it follows the Channel and Campaign filters.' },
    strip: exco(D).strip.map(function (s) { return Object.assign({}, s, { cell: s.cell.replace('Exco Summary', 'Agent & Scheduler Summary') }); }) };
}
/* Y17:AE… — one person's every sale in view, the workbook's seven columns. Never a customer field (a fact has none). */
function drill(D, type, name, filters) {
  var x = need(D), keep = keeper(filters), ld = x.loaded;
  var dim = DIMS.filter(function (d) { return d.k === type; })[0];
  if (!dim) throw new Error('VTWorkbook.drill: type is one of scheduler, agent, referrer');
  var S = x.S.filter(keep);
  var g = groupNames(S, type);
  var keys = Object.keys(g).sort(function (a, b) { return g[b].n - g[a].n || (g[a].name < g[b].name ? -1 : 1); });
  var list = keys.map(function (k) { return g[k].name; });
  var wantKey = name != null && g[nameKey(name)] ? nameKey(name) : keys[0] || null;
  var who = wantKey == null ? null : g[wantKey].name;
  var mine = wantKey == null ? [] : S.filter(isPerson(type, wantKey));
  mine.sort(function (a, b) { return a.soldOn < b.soldOn ? -1 : a.soldOn > b.soldOn ? 1 : (a.cn < b.cn ? -1 : 1); });
  var t = mix(mine, ld);
  return { type: type, typeLabel: dim.label, name: who, names: list, cell: 'Agent & Scheduler Summary Y17:AE',
    counts: { records: mine.length, fitted: t.fitted, scheduled: t.scheduled, cancelled: t.cancelled, missed: t.missed,
      gwpFitted: t.gwpFitted, gwpTotal: t.gwpTotal },
    rows: mine.map(function (f) {
      return { agent: f.agent || null, soldOn: f.soldOn, caseNumber: f.cn,
        cycleTag: f.current ? 'Current' : f.pre ? 'Rollover' : 'After cycle',
        referrer: nameOk(f.referrer) ? f.referrer : null, scheduler: nameOk(f.scheduler) ? f.scheduler : null,
        campaign: f.campaign || null, result: f.st, gwp: ld ? (f.gwp == null ? null : +f.gwp) : null };
    }) };
}

/* ================================================================ Sales Review ==== */
/* Dc must be the CYCLE-view model: the sheet's column C is the cycle view whatever the page's View is set to. */
function review(Dc) {
  var x = need(Dc), A = x.A, O = x.O, ld = x.loaded, cyc = Dc.period, dd = Dc.dialingDays || {};
  var cb = Dc.budget, ru = rollup(), share = R().dashboardHrsShare, BK = aheadBuckets();
  var keys = chKeys(), byK = {}; (Dc.channels || []).forEach(function (c) { byK[c.k] = c; });
  var pace = function (v) { return v != null && dd.elapsed > 0 ? v / dd.elapsed * dd.total : null; };
  var members = function (k) { return ru && k === ru.k ? ru.members : [k]; };
  /* the five rows of every KPI group, in the sheet's order: Digital, Other, Panimax, Referrals, Predictive */
  var other = keys.filter(function (k) { return k !== 'lead_gen' && (!ru || ru.members.indexOf(k) < 0); });
  var order = ['lead_gen'].concat(other, ru ? [ru.k] : [], ru ? ru.members : []);
  var totalOf = ['lead_gen'].concat(other, ru ? [ru.k] : []);              /* SR C51 = SUM(C52:C54) */
  var label = function (k) { return ru && k === ru.k ? ru.label : srLabel(k); };
  var sumKeys = function (fn) { var v = 0, any = false; totalOf.forEach(function (q) { var y = fn(q); if (y != null) { v += y; any = true; } }); return any ? v : null; };

  /* actual per channel (cycle view), all-data per channel, and the five-bucket counts */
  var cyOf = function (k) {
    var m = members(k), sum = { sales: 0, fitted: 0, scheduled: 0, missed: 0, cancelled: 0 };
    m.forEach(function (c) { var t = byK[c]; if (t) Object.keys(sum).forEach(function (s) { sum[s] += t[s] || 0; }); });
    var op = O.filter(function (f) { return f.st === 'scheduled' && m.indexOf(f.channel) > -1; });
    BK.forEach(function (b) { sum[b.k] = op.filter(function (f) { return bucketOf(f, Dc) === b.k; }).length; });
    return sum;
  };
  var allOf = function (k) {
    var m = members(k), list = A.filter(function (f) { return m.indexOf(f.channel) > -1; }), t = mix(list, ld);
    var sch = list.filter(function (f) { return f.st === 'scheduled'; });
    BK.forEach(function (b) { t[b.k] = sch.filter(function (f) { return bucketOf(f, Dc) === b.k; }).length; });
    return t;
  };
  var budgetOf = function (bag, k) {
    if (!cb) return null;
    var v = 0, any = false;
    members(k).forEach(function (c) { if (bag[c] != null) { v += bag[c]; any = true; } });
    return any ? v : null;
  };
  var sbOf = function (k) { return budgetOf(cb ? cb.sales : {}, k); };
  var fbOf = function (k) { return budgetOf(cb ? cb.fitments : {}, k); };
  var CY = {}, AL = {}; order.forEach(function (k) { CY[k] = cyOf(k); AL[k] = allOf(k); });
  var cyTot = {}, alTot = {};
  ['sales', 'fitted', 'scheduled', 'missed', 'cancelled'].concat(BK.map(function (b) { return b.k; })).forEach(function (f) {
    cyTot[f] = sumKeys(function (q) { return CY[q][f]; }); alTot[f] = sumKeys(function (q) { return AL[q][f]; });
  });
  var C_ = function (k) { return k === 'total' ? cyTot : CY[k]; };
  var A_ = function (k) { return k === 'total' ? alTot : AL[k]; };

  var row = function (kpi, k, budget, actual, forecast, allData, opts) {
    opts = opts || {};
    return { kpi: kpi, channel: k, label: k === 'total' ? kpi : label(k), budget: budget, actual: actual,
      pctTgt: actual == null || budget == null ? null : ratio(actual, budget),
      deficit: actual == null || budget == null ? null : actual - budget,
      forecast: forecast, forecastDash: !!opts.dash, allData: allData, kind: opts.kind || 'n', total: k === 'total' };
  };
  var groups = [];
  var addGroup = function (kpi, kind, fn) { groups.push({ kpi: kpi, kind: kind, rows: [fn('total')].concat(order.map(fn)) }); };

  /* B49 Dialing Days: E49 is the days LEFT (B - C), not C - B */
  groups.push({ kpi: 'Dialing Days', kind: 'n', rows: [{ kpi: 'Dialing Days', channel: 'total', label: 'Dialing Days', total: true, kind: 'n',
    budget: dd.total, actual: dd.elapsed, pctTgt: ratio(dd.elapsed, dd.total),
    deficit: dd.total != null && dd.elapsed != null ? dd.total - dd.elapsed : null, deficitWords: 'days left', forecast: null, allData: null }] });
  /* B50 HC: distinct schedulers with a sale dated in the cycle */
  var hcSet = {}; A.forEach(function (f) { if (f.current && nameOk(f.scheduler)) hcSet[nameKey(f.scheduler)] = 1; });
  var hc = Object.keys(hcSet).length;
  groups.push({ kpi: 'HC', kind: 'n', rows: [{ kpi: 'HC', channel: 'total', label: 'HC', total: true, kind: 'n',
    budget: cb ? cb.headcount : null, actual: hc, pctTgt: null, deficit: cb && cb.headcount != null ? hc - cb.headcount : null,
    forecast: null, allData: null }] });

  addGroup('Total Sales', 'n', function (k) {
    return row('Total Sales', k, k === 'total' ? sumKeys(sbOf) : sbOf(k), C_(k).sales, pace(C_(k).sales), A_(k).sales);
  });
  addGroup('Total Fitments', 'n', function (k) {
    return row('Total Fitments', k, k === 'total' ? sumKeys(fbOf) : fbOf(k), C_(k).fitted, pace(C_(k).fitted), A_(k).fitted);
  });
  addGroup('Fitment Rate', 'p', function (k) {
    var b = cb && (k === 'total' || sbOf(k) != null) ? cb.fitmentRate : null;
    return row('Fitment Rate', k, b, ratio(C_(k).fitted, C_(k).sales), ratio(pace(C_(k).fitted), pace(C_(k).sales)),
      ratio(A_(k).fitted, A_(k).sales), { kind: 'p' });
  });
  var countGroup = function (kpi, field, pctKey) {
    var bOne = function (q) { var sb = sbOf(q); return cb && sb != null ? cb[pctKey] * sb : null; };
    addGroup(kpi, 'n', function (k) {
      return row(kpi, k, k === 'total' ? sumKeys(bOne) : bOne(k), C_(k)[field], null, A_(k)[field], { dash: true });
    });
  };
  countGroup('Missed', 'missed', 'missedPct');
  countGroup('Cancelled', 'cancelled', 'cancelledPct');
  addGroup('Cancelled %', 'p', function (k) {
    var b = cb && (k === 'total' || sbOf(k) != null) ? cb.cancelledPct : null;
    return row('Cancelled %', k, b, ratio(C_(k).cancelled, C_(k).sales), null, ratio(A_(k).cancelled, A_(k).sales), { kind: 'p', dash: true });
  });
  countGroup('Total Scheduled', 'scheduled', 'scheduledPct');
  BK.forEach(function (bk) {
    var sh = share[bk.k];
    var name = 'Scheduled ' + (/^\d+$/.test(bk.label) ? bk.label + 'hrs' : bk.label.replace(/^(\d+)\+ /, '$1hrs + ')) + (sh != null ? ' - ' + Math.round(sh * 100) + '%' : '');
    var bOne = function (q) { var sb = sbOf(q); return cb && sb != null && sh != null ? sh * cb.scheduledPct * sb : null; };
    addGroup(name, 'n', function (k) {
      return row(name, k, k === 'total' ? sumKeys(bOne) : bOne(k), C_(k)[bk.k], null, A_(k)[bk.k], { dash: true });
    });
    groups[groups.length - 1].bucket = bk.k;
  });

  /* A4:G7 — the strip, each figure beside its budget */
  var g = function (kpi) { return groups.filter(function (q) { return q.kpi === kpi; })[0].rows[0]; };
  var strip = [
    { k: 'dialing', label: 'Dialing days', value: dd.elapsed, of: dd.total, pct: dd.pct, left: dd.left, cell: 'Sales Review A5:A7' },
    { k: 'sales', label: 'Total sales', value: g('Total Sales').actual, budget: g('Total Sales').budget, budgetWord: 'Budget', cell: 'Sales Review B5' },
    { k: 'fitted', label: 'Fitments', value: g('Total Fitments').actual, budget: g('Total Fitments').budget, budgetWord: 'Budget', cell: 'Sales Review C5' },
    { k: 'fitRate', label: 'Fitment rate', value: g('Fitment Rate').actual, budget: g('Fitment Rate').budget, budgetWord: 'Target', pctKind: true, cell: 'Sales Review D5' },
    { k: 'canPct', label: 'Cancelled %', value: g('Cancelled %').actual, budget: g('Cancelled %').budget, budgetWord: 'Target', pctKind: true, cell: 'Sales Review E5' },
    { k: 'scheduled', label: 'Scheduled pipeline', value: g('Total Scheduled').actual, budget: g('Total Scheduled').budget, budgetWord: 'Budget', cell: 'Sales Review F5' },
    { k: 'forecast', label: 'Forecast sales', value: g('Total Sales').forecast, budget: g('Total Sales').budget, budgetWord: 'Budget', cell: 'Sales Review G5' }
  ];

  /* A28:G34 Sales & Fitments vs Budget and A37:G43 Outcome Mix: Digital, Referrals, Predictive, Other, Panimax, Total */
  var visOrder = ['lead_gen'].concat(ru ? ru.members : [], other, ru ? [ru.k] : []);
  var srow = function (kpi, k) { return groups.filter(function (q) { return q.kpi === kpi; })[0].rows.filter(function (r) { return r.channel === k; })[0]; };
  var vsBudget = visOrder.concat(['total']).map(function (k) {
    var s = srow('Total Sales', k), f = srow('Total Fitments', k);
    return { channel: k, label: k === 'total' ? 'Total' : label(k), salesBudget: s.budget, salesActual: s.actual, salesForecast: s.forecast,
      fitBudget: f.budget, fitActual: f.actual, fitForecast: f.forecast };
  });
  var outcomeMix = visOrder.concat(['total']).map(function (k) {
    var c = C_(k);
    return { channel: k, label: k === 'total' ? 'Total' : label(k), fitted: c.fitted, scheduled: c.scheduled, missed: c.missed,
      cancelled: c.cancelled, sales: c.sales, fitRate: ratio(c.fitted, c.sales) };
  });

  /* I4:K15 — Cycle settings: the holidays inside this cycle that are not dialing days */
  var hol = {};
  var years = {}; years[cyc.from.slice(0, 4)] = 1; years[cyc.to.slice(0, 4)] = 1;
  Object.keys(years).forEach(function (y) {
    var list = E().saHolidaysFor ? E().saHolidaysFor(+y) : [];
    (list || []).forEach(function (h) { var d = typeof h === 'string' ? h : h && h.date; if (d) hol[d] = (h && h.name) || 'Public holiday'; });
  });
  (R().periods.extraHolidays || []).forEach(function (h) { var d = typeof h === 'string' ? h : h && h.date; if (d) hol[d] = hol[d] || (h && h.name) || 'Public holiday (one-off)'; });
  var holidays = Object.keys(hol).filter(function (d) { return d >= cyc.from && d <= cyc.to; }).sort()
    .map(function (d) { return { date: d, name: hol[d] }; });

  return { sheet: 'Sales Review', period: cyc, view: 'cycle', strip: strip, groups: groups, vsBudget: vsBudget, outcomeMix: outcomeMix,
    settings: { from: cyc.from, to: cyc.to, dataThrough: Dc.dataThrough, holidays: holidays,
      words: 'Saturdays and Sundays are excluded automatically; these dates are not dialing days either.' },
    checks: Dc.integrity || [], budgetWords: cb ? cb.words : 'No budget is on file for this cycle, so every target column is blank.',
    gwpLoaded: ld };
}

return { exco: exco, people: people, drill: drill, review: review, DIMS: DIMS };
});
