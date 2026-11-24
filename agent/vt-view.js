/* VT VIEW — Vehicle Tracking in Agent Analytics (Spec Kit 071, Phase E, tasks E7–E8; spec US2–US4).
 *
 * THE ENGINE DECIDES, THE PAGE PAINTS. Every figure and every verdict here is a field of the published VT digest
 * (nicks_code/vt-engine.js digest(), served scoped by worker/src/vt.mjs): the rating, each driver's value, target,
 * attainment, points, effective weight, points available and At-target verdict, the band and the gap to the next band,
 * the weakest driver, the missing days. This file formats them and lays them out in the VAS card's own classes
 * (pg-score, pg-row, pg-bar2, chip2, pg-card, pg-tally) so a VT agent's card IS the VAS card with VT drivers. No rule
 * literal lives here (verify-vt-rules): weights, minima and the half-of-target floor come from the payload.
 *
 * WHO SEES WHAT
 *   a VT agent (D.scorecard === 'vt')  → Today: the VT rating card + "Your help requests"; My month: weeks and days.
 *       Hidden for a VT agent, because they have no VT meaning: Projected Commission (the VAS commission plans; VT has its
 *       own comm workbooks, not built), Links (the VAS floor's systems), the VAS session tiles / two checks / NBA ladder /
 *       top performers / campaign split (VAS money, R2A and dialler figures the VT files do not carry).
 *   a VT team leader → the VT rows on Team Results (instead of "Not reported on this page"), a VT card per agent, and the
 *       Reports tabs VT Month to date / VT Weekly / VT Daily with .xlsx export.
 *   a campaign manager with VT in scope → a "Vehicle Tracking" tab: floor, sub-campaigns, lead sources, team leaders,
 *       agents, Hrs Ahead, for Month to date / Weekly / Daily, with .xlsx export.
 * The hooks in agent/index.html are one line each (search "VTView"); everything else is here. Inlined at build by
 * tools/prepare-site.js (data-inline), loaded as a classic script from file://.
 */
(function () {
'use strict';
var VT = { team: null, teamAt: 0, busy: false, cycle: '', day: '', week: '', detail: null };
var TL_TABS = [['vt_mtd_team', 'VT Month to date', 'mtd'], ['vt_weekly_team', 'VT Weekly', 'weekly'], ['vt_daily_team', 'VT Daily', 'daily']];
var CM_TABS = [['cm_vt', 'Month to date', 'mtd'], ['cm_vt_weekly', 'Weekly', 'weekly'], ['cm_vt_daily', 'Daily', 'daily']];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var SUBS = { digital: 'Digital', predictive: 'Predictive', referral: 'Referral', scheduling: 'Scheduling' };

/* ---------------------------------------------------------------- formatting only ---- */
function n0(v) { return num(v, 0); }
function n2(v) { return num(v, 2); }
function p1(v) { return v == null || isNaN(v) ? '—' : num(v * 100, 1) + '%'; }
function rv(v) { return R(v, 2); }
function day(d) { return d ? (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1].slice(0, 3) : '—'; }
function dayName(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T00:00:00Z').getUTCDay()] + ' ' + day(d); }
function monthOf(key) { return key ? MONTHS[+String(key).slice(11, 13) - 1] + ' ' + String(key).slice(6, 10) : ''; }
function subLabel(s) { return SUBS[s] || (s ? String(s) : 'No sub-campaign'); }
function isVt(d) { return !!(d && d.scorecard === 'vt'); }
function drv(d, k) { var l = (d && d.drivers) || []; for (var i = 0; i < l.length; i++) if (l[i].k === k) return l[i]; return { k: k, label: k, w: null, dir: 'higher', note: '' }; }
/* the digest's day rows are columnar (dayCols): back into objects, by name — values carried, nothing computed.
   The names come from the payload, so only plain field names are taken (security review LOW-2): letters and digits, starting
   with a letter, onto an object with no prototype — never __proto__ or a name the page would not read. */
var COL_NAME = /^[a-z][A-Za-z0-9]{0,39}$/;
function dayRow(d, cells) {
  if (!Array.isArray(cells)) return cells || null;
  var o = Object.create(null);
  (d.dayCols || []).forEach(function (k, i) { if (typeof k === 'string' && COL_NAME.test(k) && k !== 'constructor') o[k] = cells[i]; });
  return o;
}
/* a row's class is one of the page's own names (security review LOW-2): anything else is dropped, never written into class="" */
var CLS_NAME = /^[a-z][a-z0-9_-]{0,39}( [a-z][a-z0-9_-]{0,39}){0,3}$/;
function clsAttr(c) { return c && CLS_NAME.test(String(c)) ? ' class="' + esc(c) + '"' : ''; }
function daysOf(d, obj) { return ((obj && obj.days) || []).map(function (c) { return dayRow(d, c); }); }
function fmtDrv(p) {
  if (p.value == null) return '—';
  return p.k === 'targetAch' ? n2(p.value) + ' a day' : p.k === 'fitted' ? n0(p.value) : p1(p.value);
}
function fmtTgt(p) {
  if (p.target == null) return 'no target';
  return p.k === 'targetAch' ? n2(p.target) : p.k === 'fitted' ? num(p.target, 1) : p1(p.target);
}

/* ---------------------------------------------------------------- the rating card ---- */
/* r = me.rating (the engine's), d = the payload (drivers, minima, period). back = a leader's drill-down (no "Ask" button). */
function cardHTML(d, me, back) {
  var r = me && me.rating, h = '<div class="card vt-card" data-vt="card"><h2>Agent rating</h2>';
  if (!r) return h + '<p class="why">Your Vehicle Tracking rating has not been published yet.</p></div>';
  if (r.why === 'scheduling') return h + '<p class="why vt-sched">Scheduling agents are not rated yet: the uploads do not say which scheduler handled a sale.'
    + ' You are listed with your team, and your team\'s scheduling speed is below as context.</p>' + hrsHTML(d) + '</div>';
  if (!r.rated) return h + '<p class="why vt-notyet">Not rated yet. You have no Vehicle Tracking sales in play in your business month so far, so there is nothing to rate — never a 0.'
    + ' Your rating appears with your first sale.</p>' + helpBtns(d, me, back, null) + '</div>';
  var F = (d.minima && d.minima.floor != null ? d.minima.floor : null), floorPct = F == null ? null : F * 100;
  var cls = r.adj >= 80 ? 'good' : r.adj >= 65 ? 'mid' : 'low';
  h += '<div class="pg-score ' + cls + '"><b class="num">' + num(r.adj, 1) + '</b><small>out of 100</small></div>';
  h += '<h3 class="pg-verdict">' + esc(r.band || '') + (r.nextBand ? ' — ' + num(r.nextBand.gap, 1) + ' points from ' + esc(r.nextBand.label) : '') + '</h3>';
  var wk = null; (r.parts || []).forEach(function (p) { if (p.k === r.weakest && p.measured && p.available > 0) wk = p; });
  h += '<p class="why">' + n0(r.onTarget) + ' of your ' + n0(r.measuredCount) + ' drivers are at target.'
    + (wk ? ' The most points sitting unclaimed are in <b>' + esc(drv(d, wk.k).label) + '</b> — ' + num(wk.available, 1) + ' of them.' : '') + '</p>';
  var un = (r.parts || []).filter(function (p) { return !p.measured; });
  h += '<div class="tiny2" style="margin-top:4px">Your rating is worked out from your own business month to date ('
    + esc(day(r.window && r.window.from)) + ' – ' + esc(day(r.window && r.window.to)) + ') against the targets for your sub-campaign and level. It is never a ranking against your colleagues.'
    + (r.budgetCycle && d.period && r.budgetCycle !== d.period.key ? ' The fitment target and the budgets below are ' + esc(monthOf(r.budgetCycle)) + '\'s: this business month\'s budget is not loaded yet.' : '')
    + (un.length ? ' ' + un.map(function (p) { return esc(drv(d, p.k).label) + ' is not measured yet (' + esc(p.why || 'no value yet') + ')'; }).join('; ')
      + (un.length === 1 ? ', so it carries' : ', so they carry') + ' none of your points rather than counting against you; '
      + ((r.parts || []).length - un.length === 1 ? 'your other driver carries its weight.' : 'the other drivers share its weight.') : '') + '</div>';
  h += '<div class="pg-drv">' + (r.parts || []).map(function (p) { return rowHTML(d, p, floorPct); }).join('') + '</div>';
  h += infoHTML(r.info);
  h += '<div class="tiny2" style="margin-top:6px">Each bar changes shade at half of your target. Points only start there, so the solid part is what you are being paid for.'
    + ((r.parts || []).some(function (p) { return p.dir === 'lower'; }) ? ' On ' + esc(drv(d, (r.parts.filter(function (p) { return p.dir === 'lower'; })[0] || {}).k).label) + ' lower is better: the bar fills as your figure comes DOWN to its target, and it is full at the target or below.' : '') + '</div>';
  var lev = (r.parts || []).filter(function (p) { return p.measured && p.available > 0.2; }).sort(function (a, b) { return b.available - a.available; }).slice(0, 3);
  if (lev.length) h += '<div class="pg-cards">' + lev.map(function (p) {
    var lab = drv(d, p.k).label;
    return '<div class="pg-card vt-tip"><div class="t">' + esc(lab) + ' · ' + num(p.available, 1) + ' points available</div><p>'
      + (p.dir === 'lower' ? 'You are at ' + fmtDrv(p) + ' against a ceiling of ' + fmtTgt(p) + '. Bringing it down to ' + fmtTgt(p) + ' or below pays the full '
        : 'You are at ' + fmtDrv(p) + ' against ' + fmtTgt(p) + '. Reaching it pays the full ') + num(p.weff, p.weff % 1 ? 1 : 0) + ' points for this row.</p></div>';
  }).join('') + '</div>';
  h += '<div class="pg-tally">Composite ' + num(r.score, 1) + '  =  ' + num(r.adj, 1) + ' out of 100</div>';
  return h + helpBtns(d, me, back, wk) + '</div>';
}
function rowHTML(d, p, floorPct) {
  var lab = drv(d, p.k).label, lower = p.dir === 'lower';
  var att = p.att == null ? 0 : Math.max(0, Math.min(100, p.att * 100)), F = floorPct == null ? 0 : floorPct;
  var pale = Math.min(att, F), solid = Math.max(0, att - F);
  var bar = p.measured ? '<span class="pg-bar2 ' + (p.onTarget ? 'ok' : 'short') + '"><i class="pale" style="width:' + pale + '%"></i>'
    + (solid > 0 ? '<i class="solid" style="left:' + F + '%;width:' + solid + '%"></i>' : '') + (att < F ? '<u class="tick" style="left:' + F + '%"></u>' : '') + '</span>'
    : '<span class="pg-bar2"></span>';
  var v = '<span class="pg-v num">' + fmtDrv(p) + ' <small>' + (lower ? (p.target == null ? '' : 'max ' + fmtTgt(p)) : 'of ' + fmtTgt(p)) + '</small></span>';
  var pill = p.measured ? (p.onTarget ? '<span class="chip2 beat"><i></i>At target</span>' : '<span class="chip2 togo"><i></i>' + (lower ? 'Too high' : 'To go') + '</span>') : '';
  return '<div class="pg-row" data-k="' + esc(p.k) + '"><span class="pg-l">' + esc(lab) + (lower ? ' <small class="vt-lower">lower is better</small>' : '') + '</span>' + v + bar
    + '<span class="pg-chip">' + (p.measured ? '<b class="num">' + num(p.pointsEff, 1) + '</b> <small>/ ' + num(p.weff, p.weff % 1 ? 1 : 0) + ' pts</small> ' : '<small>not measured</small> ') + pill + '</span></div>';
}
/* the unscored figures (vt-1.2): shown so nothing is hidden, with no pill, no bar and no points — an unscored figure must
   not look like a verdict. A missed or cancelled sale is a sale not fitted, so it already counts in Fitment Rate, once. */
function infoHTML(x) {
  if (!x) return '';
  var line = function (k, label, val, note) { return '<div class="vt-info-row" data-k="' + esc(k) + '" style="display:flex;justify-content:space-between;gap:12px;padding:4px 0"><span class="pg-l">' + esc(label) + '</span> <span class="pg-v num">' + val + (note ? ' <small>' + note + '</small>' : '') + '</span></div>'; };
  var pct = function (n, rate, bud) { return n0(n) + ' <small>(' + p1(rate) + ' of your sales' + (bud != null ? ', budget ' + p1(bud) : '') + ')</small>'; };
  return '<div class="vt-info" data-vt="info" style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line,#ddd)"><div class="tiny2"><b>For your information — not part of your score</b></div>'
    + line('missed', 'Missed', pct(x.missed, x.missRate, x.missBudget), '')
    + line('cancelled', 'Cancelled', pct(x.cancelled, x.canRate, x.canBudget), '')
    + line('fitDone', 'Fitments done this month', n0(x.fitDone), '')
    + '<div class="tiny2">A missed or cancelled sale is a sale that is not fitted, so it already lowers your Fitment Rate. It is not taken off a second time.</div></div>';
}
function helpBtns(d, me, back, wk) {
  return '<div class="pg-btns"><button class="btn2 jbtn" data-vthow="1">★ How the score works</button>'
    + (back ? '' : '<button class="btn2" data-vtview="brief">Open my session brief</button>'
      + '<button class="btn2 primary" data-vthelp="1">Ask ' + esc(firstName((me && me.tl) || '') || 'your team leader') + (wk ? ' to help with ' + esc(drv(d, wk.k).label.toLowerCase()) : ' for help') + '</button>') + '</div>';
}
function hrsHTML(d) {
  var t = d.teamHrs, h = t && t.hrsAhead; if (!h) return '';
  var B = [['h24', '24 h'], ['h48', '48 h'], ['h72', '72 h'], ['h72p', '72+ h'], ['past', 'Past due']];
  return '<div class="scroller"><table class="tbl vt-hrs"><thead><tr><th class="l">' + esc(t.tl || 'Your team') + ' — open Scheduled</th>' + B.map(function (b) { return '<th>' + b[1] + '</th>'; }).join('') + '</tr></thead><tbody>'
    + '<tr><td class="l">' + n0(h.total) + ' booked</td>' + B.map(function (b) { return '<td class="num">' + n0(h[b[0]]) + (h.share && h.share[b[0]] != null ? ' <span class="sub2">' + p1(h.share[b[0]]) + '</span>' : '') + '</td>'; }).join('') + '</tr></tbody></table></div>';
}
/* the honest notes above the card: the missing day, the month that began before the first upload */
function notesHTML(d) {
  var out = [];
  if (d.trackFrom && d.period && d.trackFrom > d.period.from) out.push('This business month\'s figures start on ' + esc(dayName(d.trackFrom)) + ', the day after the first upload: cases already open then have no sale day, so they count in your statuses but as nobody\'s sale, and Target Achievement waits until there are enough tracked working days.');
  (d.gaps || []).forEach(function (g) { out.push('<b>' + esc(dayName(g.date)) + '</b>: no ' + esc(g.missing.join(' or ')) + ' upload. No file carries a sale date, so a sale first seen on the next upload is counted on that later day.'); });
  return out.length ? '<div class="card vt-notes"><p class="why" style="margin:0">' + out.join('<br>') + '</p></div>' : '';
}
function emptyHTML(d) {
  var prev = (d.cycles || []).filter(function (k) { return d.period && k < d.period.key; })[0];
  return '<div class="card vt-empty"><h2>Agent rating</h2><p class="why">No ' + esc(monthOf(d.period && d.period.key)) + ' figures yet — the first day lands after tomorrow morning\'s uploads.</p>'
    + (prev ? '<button class="btn2" data-vtcycle="' + esc(prev) + '">' + esc(monthOf(prev)) + ' (final)</button>' : '') + '</div>';
}

/* ---------------------------------------------------------------- the agent's own page ---- */
function agentNav() { return [['month', 'Today', ICON.month], ['brief', 'My month', ICON.mtd]]; }
function weekTable(d, me) {
  var cols = [['Week', function (w) { return esc(w.label || (day(w.from) + ' – ' + day(w.to))); }], ['Sales', 'sales'], ['Fitted', 'fitted'], ['Scheduled', 'scheduled'], ['Missed', 'missed'],
    ['Cancelled', 'cancelled'], ['Fitted %', 'fitRate', p1], ['Missed %', 'missRate', p1], ['Cancelled %', 'canRate', p1], ['Fitments done', 'fitDone'], ['Working days', 'wd'], ['SPD', 'spd', n2], ['Target SPD', 'target', n2], ['% to target', 'toTarget', p1]];
  var weeks = (me.weeks || []).filter(function (w) { return d.period && w.from <= (d.period.asOf || d.period.to); });
  return table(cols, weeks.slice().reverse(), 'vt-weeks');
}
function dayTable(d, me) {
  var cols = [['Day', function (x) { return esc(dayName(x.d)); }], ['Sales', 'sales'], ['Fitted', 'fitted'], ['Scheduled', 'scheduled'], ['Missed', 'missed'], ['Cancelled', 'cancelled'],
    ['Fitments done', 'fitDone'], ['Missed appointments', 'missAppt'], ['Due to fit', 'due'], ['Fitted value', 'value', rv]];
  return table(cols, daysOf(d, me).slice().reverse(), 'vt-days');
}
function table(cols, rows, cls) {
  return '<div class="scroller"><table class="tbl ' + cls + '"><thead><tr>' + cols.map(function (c, i) { return '<th' + (i ? '' : ' class="l"') + '>' + esc(c[0]) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + rows.map(function (r) { return '<tr' + clsAttr(r.__cls) + '>' + cols.map(function (c, i) { return '<td class="' + (i ? 'num' : 'l') + '">' + cell(c, r) + '</td>'; }).join('') + '</tr>'; }).join('')
    + '</tbody></table></div>';
}
function cell(c, r) { if (typeof c[1] === 'function') return c[1](r); var v = r ? r[c[1]] : null; return (c[2] || n0)(v == null ? null : v); }
function agentPage() {
  var d = D, me = d.me || {};
  ME = { code: me.code, name: me.name, tl: me.tl, campaign: 'Vehicle Tracking', tenure: me.tenure };   // the Help Center reads ME
  if (['month', 'brief'].indexOf(VIEW) < 0) VIEW = 'month';
  if (typeof MYHELP !== 'undefined' && !MYHELP && !d.__back && typeof myHelpLoad === 'function') myHelpLoad();
  var sub = d.empty ? 'Vehicle Tracking · ' + esc(monthOf(d.period && d.period.key)) + ' — no figures yet.'
    : 'Vehicle Tracking · your business month ' + esc(day(d.period && d.period.from)) + ' – ' + esc(day(d.period && d.period.to)) + ', figures to ' + esc(day(d.period && d.period.asOf)) + '.';
  if (VT.back && d.period && d.period.key === VT.back) { VT.back = ''; VT.liveD = null; }   // the agent refresh brought the live month back
  var back = VT.back ? '<div class="card vt-back"><button class="btn2" data-vtcycle="">Back to ' + esc(monthOf(VT.back)) + '</button></div>' : '';
  var body;
  if (d.empty) body = emptyHTML(d);
  else if (VIEW === 'brief') body = notesHTML(d) + '<div class="card"><h2>Your session brief — week by week</h2><p class="why">Sales are counted on the day a case first appears in the uploads; statuses are as at the latest upload.</p>' + weekTable(d, me) + '</div>'
    + '<div class="card"><h2>Day by day</h2>' + dayTable(d, me) + '</div>';
  else body = notesHTML(d) + cardHTML(d, me, false) + (typeof pgMyHelp === 'function' ? pgMyHelp() : '');
  shell(esc(greeting()) + ', ' + esc(firstName(d.name || me.name)), sub, back + body, VIEW);
}

/* ---------------------------------------------------------------- the leader's and manager's figures ---- */
var COLS_ALL = [['Sales', 'sales'], ['Current', 'current', null, 'mtd'], ['Rollover', 'rollover', null, 'mtd'], ['Fitted', 'fitted'], ['Scheduled', 'scheduled'], ['Missed', 'missed'],
  ['Cancelled', 'cancelled'], ['Fitted %', 'fitRate', p1], ['Missed %', 'missRate', p1], ['Scheduled %', 'schedRate', p1], ['Cancelled %', 'canRate', p1], ['Cancellation budget %', 'canBudget', p1, 'mtd'], ['Fitments done', 'fitDone'],
  ['Missed appointments', 'missAppt'], ['Due to fit', 'due'], ['Working days', 'workingDays', null, 'mtd'], ['Working days', 'wd', null, 'weekly'],
  ['SPD', 'spd', n2, 'mtd weekly'], ['Target SPD', 'target', n2], ['% to target', 'toTarget', p1, 'mtd weekly'], ['Fitted value (incl VAT)', 'value', rv]];
function colsFor(view) { return COLS_ALL.filter(function (c) { return !c[3] || c[3].indexOf(view) >= 0; }); }
/* the window of an agent row / aggregate for a view: MTD, the chosen week, the chosen day */
function winOf(d, obj, view) {
  if (!obj) return null;
  if (view === 'mtd') return obj.mtd || null;
  if (view === 'weekly') { var w = (obj.weeks || []).filter(function (x) { return x.k === weekKey(d); })[0]; return w || null; }
  var days = daysOf(d, obj), k = dayKey(d); for (var i = 0; i < days.length; i++) if (days[i] && days[i].d === k) { var x = Object.assign({}, days[i]); x.target = obj.target != null ? obj.target : (obj.mtd && obj.mtd.target); return x; }
  return null;
}
function weekKey(d) { var ws = (d.weeks || []).filter(function (w) { return w.from <= ((d.period && d.period.asOf) || ''); }); var k = VT.week; return ws.some(function (w) { return w.k === k; }) ? k : (ws.length ? ws[ws.length - 1].k : ''); }
function dayKey(d) { var ds = d.dates || []; return ds.indexOf(VT.day) >= 0 ? VT.day : ds[ds.length - 1]; }
function ratingText(a) { var r = a.rating || {}; return r.why === 'scheduling' ? 'not rated in v1' : r.rated ? num(r.adj, 1) + ' · ' + r.band : 'not rated yet'; }
/* the Rating column's tooltip, from the payload's drivers (no rule literal here) */
function ratingTip(d) {
  var ds = (d && d.drivers) || [];
  return 'Out of 100: ' + ds.map(function (x) { return x.label + ' ' + x.w + ' points'; }).join(' + ') + '. Missed, Cancelled and Fitments done are shown as columns, not scored: a missed or cancelled sale is a sale not fitted, so it already lowers Fitment Rate.';
}
/* one report as data: the screen AND the export walk it (the house rule — the workbook never carries a column the screen does not) */
function report(d, view, scope) {
  var cols = colsFor(view), rows = [];
  var agents = (d.agents || []).slice().sort(function (x, y) { return String(x.tl).localeCompare(String(y.tl)) || String(x.sub).localeCompare(String(y.sub)) || String(x.name).localeCompare(String(y.name)); });
  agents.forEach(function (a) { rows.push({ label: a.name || a.code, code: a.code, tl: a.tl, sub: subLabel(a.sub), w: winOf(d, a, view), rating: view === 'mtd' ? ratingText(a) : null }); });
  var totals = (d.tlAgg || []).map(function (t) { return { label: t.tl + ' total', tl: t.tl, sub: (t.subs || []).map(subLabel).join(', '), w: winOf(d, t, view), cls: 'totrow' }; });
  if (scope !== 'team' && d.floor) {
    var un = d.floor.unmatched;
    if (un && un.sellers && view === 'mtd') totals.push({ label: 'Unmatched sellers (' + n0(un.sellers) + ')', tl: '', sub: '', w: { sales: un.cases }, cls: 'totrow' });
    totals.push({ label: 'Floor total', tl: '', sub: '', w: winOf(d, d.floor, view), cls: 'totrow' });
  }
  return { cols: cols, rows: rows, totals: totals, view: view, ratingTip: ratingTip(d) };
}
function reportTable(rep, scope) {
  var head = ['Agent', 'Team leader', 'Sub-campaign'].concat(rep.cols.map(function (c) { return c[0]; })).concat(rep.view === 'mtd' ? ['Rating'] : []);
  var line = function (r) { return '<tr' + clsAttr(r.cls) + (r.code ? ' data-vtcb="' + esc(r.code) + '"' : '') + '><td class="l">' + (r.code ? '<button class="lnk" data-vtcb="' + esc(r.code) + '">' + esc(r.label) + '</button>' : '<b>' + esc(r.label) + '</b>') + '</td>'
    + '<td class="l">' + esc(r.tl || '') + '</td><td class="l">' + esc(r.sub || '') + '</td>' + rep.cols.map(function (c) { return '<td class="num">' + cell(c, r.w || {}) + '</td>'; }).join('')
    + (rep.view === 'mtd' ? '<td class="l">' + esc(r.rating || '') + '</td>' : '') + '</tr>'; };
  return '<div class="scroller"><table class="tbl vastbl vt-rep" data-vtrep="' + rep.view + '"><thead><tr>' + head.map(function (h, i) { return '<th' + (i < 3 ? ' class="l"' : '') + (h === 'Rating' && rep.ratingTip ? ' title="' + esc(rep.ratingTip) + '" data-vt="rating-th"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + rep.rows.map(line).join('') + rep.totals.map(line).join('') + '</tbody></table></div>';
}
function aggTable(d, title, items) {
  var cols = colsFor('mtd').filter(function (c) { return c[1] !== 'workingDays'; });
  return '<div class="card"><h3>' + esc(title) + '</h3>' + table([[title, function (r) { return esc(r.name); }]].concat(cols.map(function (c) { return [c[0], function (r) { return cell(c, r.w || {}); }]; })),
    items.map(function (it) { return { name: it.name, w: it.obj && it.obj.mtd, __cls: it.cls || '' }; }), 'vt-agg') + '</div>';
}
function hrsTable(d, scope) {
  var B = [['h24', '24 h'], ['h48', '48 h'], ['h72', '72 h'], ['h72p', '72+ h'], ['past', 'Past due']], bud = (d.budgets && d.budgets.hrsShare) || {};
  var items = (d.tlAgg || []).map(function (t) { return { name: t.tl + ' (team)', h: t.hrsAhead }; });
  if (scope !== 'team') { Object.keys(SUBS).forEach(function (s) { if (d.subAgg && d.subAgg[s]) items.push({ name: SUBS[s] + ' (sub-campaign)', h: d.subAgg[s].hrsAhead }); }); if (d.floor) items.push({ name: 'Floor', h: d.floor.hrsAhead }); }
  return '<div class="card"><h3>Hrs Ahead — open Scheduled cases</h3><p class="why">Each share sits beside its scheduling budget. Teams' + (scope === 'team' ? '' : ', sub-campaigns and the floor') + ' only — it is the schedulers\' queue, not a seller\'s figure.</p>'
    + table([['Level', function (r) { return esc(r.name); }], ['Open scheduled', function (r) { return n0(r.h && r.h.total); }]].concat(B.map(function (b) {
      return [b[1], function (r) { var h = r.h || {}; return n0(h[b[0]]) + ' <span class="sub2">' + p1(h.share && h.share[b[0]]) + (bud[b[0]] != null ? ' / ' + p1(bud[b[0]]) : '') + '</span>'; }]; })), items, 'vt-hrsrep') + '</div>';
}
function pickers(d, view) {
  var cyc = '<select class="ctrl" data-vtpick="cycle"><option value="">' + esc(monthOf(d.period && d.period.key)) + (VT.cycle ? '' : ' (live)') + '</option>'
    + (d.cycles || []).filter(function (k) { return !d.period || k !== d.period.key; }).map(function (k) { return '<option value="' + esc(k) + '">' + esc(monthOf(k)) + ' (final)</option>'; }).join('') + '</select>';
  if (VT.cycle) cyc = '<select class="ctrl" data-vtpick="cycle"><option value="">Back to the live month</option><option value="' + esc(VT.cycle) + '" selected>' + esc(monthOf(VT.cycle)) + '</option></select>';
  var extra = '';
  if (view === 'weekly') extra = '<select class="ctrl" data-vtpick="week">' + (d.weeks || []).filter(function (w) { return w.from <= ((d.period && d.period.asOf) || ''); }).map(function (w) { return '<option value="' + esc(w.k) + '"' + (w.k === weekKey(d) ? ' selected' : '') + '>Week of ' + esc(w.label) + '</option>'; }).join('') + '</select>';
  if (view === 'daily') extra = '<select class="ctrl" data-vtpick="day">' + (d.dates || []).slice().reverse().map(function (x) { return '<option value="' + esc(x) + '"' + (x === dayKey(d) ? ' selected' : '') + '>' + esc(dayName(x)) + '</option>'; }).join('') + '</select>';
  return cyc + extra;
}
function toolbar(tabs, active, d, view) {
  return '<div class="rep-bar"><div class="seg" id="reportTabs" role="tablist">' + tabs.map(function (t) { return '<button class="pill' + (t[0] === active ? ' on' : '') + '" role="tab" data-report="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>'
    + '<div class="rep-tools">' + pickers(d, view) + '<span class="rep-stamp">Published ' + esc(stampOf(d)) + '</span><button class="btn2" data-vtexport="' + active + '">&#8595; Export</button></div></div>';
}
function stampOf(d) { try { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d.updatedAt)); } catch (e) { return '—'; } }
function statesHTML(d, scope) {
  var out = [], sch = (d.notRated || []).filter(function (x) { return x.why === 'scheduling'; });
  if (sch.length) out.push('Scheduling agents are listed, not rated in v1 (' + n0(sch.length) + '): the uploads do not say which scheduler handled a sale.');
  if (d.floor && d.floor.unmatched && d.floor.unmatched.sellers && scope !== 'team') out.push('Unmatched sellers (' + n0(d.floor.unmatched.sellers) + '): their ' + n0(d.floor.unmatched.cases) + ' cases count in the floor total, never as agent rows. Correct them on the Agent List.');
  out.push('Cancelled includes sales that dropped out of both daily files: a Scheduled or Missed sale that is in neither the BI Active Fitted nor the Scheduled & Missed file of a day with both files in counts as Cancelled from that day (no file says "cancelled", so this is inferred), and a contract the BI file shows as deactivated. A cancelled sale stays in Sales, is no longer Scheduled or Missed, and comes back if a later file carries it; it is not fitted, so it lowers the agent\'s Fitment Rate (the one place the rating counts it). Cancellation % = cancelled ÷ sales, beside the ' + p1((((d.budgets || {}).cancelled) || {})['*']) + ' budget. Fitted value is the Charge Amount × VAT, not the bundle price.');
  return notesHTML(d) + '<p class="why vt-states">' + out.map(esc).join('<br>') + '</p>';
}
function tabsForTeam() { return typeof visibleReportTabs === 'function' ? visibleReportTabs() : TL_TABS; }   // the VAS tabs + the VT ones (the hook below appends them)
function teamPage(view) {
  var d = VT.team, t = TL_TABS.filter(function (x) { return x[0] === view; })[0], v = t[2];
  if (!d) { shell(esc(greeting()) + ', ' + esc(firstName(D.name)), 'Vehicle Tracking', '<div class="card"><p class="why">Reading the Vehicle Tracking figures…</p></div>', 'reports'); ensureScope(true); return; }
  var body = d.empty ? toolbar(tabsForTeam(), view, d, v) + emptyHTML(d)
    : toolbar(tabsForTeam(), view, d, v) + statesHTML(d, 'team') + '<div class="card"><h3>' + esc(d.team || 'Your team') + ' — ' + esc(t[1]) + '</h3>' + reportTable(report(d, v, 'team'), 'team') + '</div>' + (v === 'mtd' ? hrsTable(d, 'team') : '');
  shell(esc(greeting()) + ', ' + esc(firstName(D.name)), 'Your team\'s Vehicle Tracking ' + esc(t[1].replace(/^VT /, '').toLowerCase()) + ' — ' + esc(monthOf(d.period && d.period.key)) + ', business month ' + esc(day(d.period && d.period.from)) + ' – ' + esc(day(d.period && d.period.to)) + '.', body, 'reports');
  wireAll();
}
function cmPage(view) {
  var d = VT.team, t = CM_TABS.filter(function (x) { return x[0] === view; })[0], v = t[2];
  if (!d) { shell('Vehicle Tracking', '', '<div class="card"><p class="why">Reading the Vehicle Tracking figures…</p></div>', view); ensureScope(true); return; }
  var fl = d.floor && d.floor.mtd, body;
  if (d.empty) body = toolbar(CM_TABS, view, d, v) + emptyHTML(d);
  else {
    var tiles = '<div class="kpi-grid">' + kpi('🚗', 'var(--blue-soft)', 'In-play sales', n0(fl && fl.sales), '', 'Current ' + n0(fl && fl.current) + ' · rollover ' + n0(fl && fl.rollover))
      + kpi('🔧', 'var(--green-soft)', 'Fitted rate', p1(fl && fl.fitRate), '', n0(fl && fl.fitted) + ' fitted · ' + n0(fl && fl.fitDone) + ' fitments done')
      + kpi('⏰', 'var(--amber-soft)', 'Missed rate', p1(fl && fl.missRate), '', n0(fl && fl.missed) + ' missed · lower is better')
      + kpi('✖', 'var(--amber-soft)', 'Cancellation rate', p1(fl && fl.canRate), '', n0(fl && fl.cancelled) + ' cancelled · budget ' + p1(fl && fl.canBudget) + ' · lower is better')
      + kpi('🎯', 'var(--blue-soft)', '% to target', p1(fl && fl.toTarget), '', 'SPD ' + n2(fl && fl.spd) + ' against ' + n2(fl && fl.target)) + '</div>';
    var subs = Object.keys(SUBS).filter(function (s) { return d.subAgg && d.subAgg[s]; }).map(function (s) { return { name: SUBS[s], obj: d.subAgg[s] }; }).concat([{ name: 'Floor total', obj: d.floor, cls: 'totrow' }]);
    var leads = Object.keys(d.leadAgg || {}).sort(function (a, b) { return (!!d.leadAgg[a].members - !!d.leadAgg[b].members) || String(d.leadAgg[a].label).localeCompare(d.leadAgg[b].label); })
      .map(function (k) { return { name: d.leadAgg[k].label + (d.leadAgg[k].members ? ' (group)' : ''), obj: d.leadAgg[k], cls: d.leadAgg[k].members ? 'totrow' : '' }; });
    body = toolbar(CM_TABS, view, d, v) + (v === 'mtd' ? tiles : '') + statesHTML(d, 'campaign')
      + (v === 'mtd' ? aggTable(d, 'Sub-campaigns', subs) + aggTable(d, 'Lead sources', leads) : '')
      + '<div class="card"><h3>Agents and team leaders — ' + esc(t[1]) + '</h3>' + reportTable(report(d, v, 'campaign'), 'campaign') + '</div>' + (v === 'mtd' ? hrsTable(d, 'campaign') : '');
  }
  shell('Vehicle Tracking', esc(D.name || '') + ' · Campaign Manager · ' + esc(monthOf(d.period && d.period.key)) + ' business month ' + esc(day(d.period && d.period.from)) + ' – ' + esc(day(d.period && d.period.to)), body, 'cm_vt');
  wireAll();
}

/* ---------------------------------------------------------------- export (.xlsx), the screen's own rows ---- */
function exportReport(which) {
  var d = VT.team, tab = TL_TABS.concat(CM_TABS).filter(function (t) { return t[0] === which; })[0];
  if (!d || !tab || !window.XLSX) { toast(!window.XLSX ? 'Spreadsheet library not loaded — refresh and retry' : 'Nothing to export yet'); return null; }
  var rep = report(d, tab[2], CM_TABS.indexOf(tab) >= 0 ? 'campaign' : 'team');
  var head = ['Agent', 'CB', 'Team leader', 'Sub-campaign'].concat(rep.cols.map(function (c) { return c[0]; })).concat(rep.view === 'mtd' ? ['Rating'] : []);
  var val = function (c, w) { var v = w ? w[c[1]] : null; return typeof v === 'number' && isFinite(v) ? v : '—'; };
  var aoa = [head].concat(rep.rows.concat(rep.totals).map(function (r) { return [r.label, r.code || '', r.tl || '', r.sub || ''].concat(rep.cols.map(function (c) { return val(c, r.w); })).concat(rep.view === 'mtd' ? [r.rating || ''] : []); }));
  var per = rep.view === 'weekly' ? 'week of ' + weekKey(d) : rep.view === 'daily' ? dayKey(d) : monthOf(d.period && d.period.key);
  var label = { mtd: 'Month to date', weekly: 'Weekly', daily: 'Daily' }[rep.view];
  var name = ('TL VT ' + label + ' - ' + (d.team || 'Vehicle Tracking') + ' - ' + per).replace(/[\\\/:*?"<>|]+/g, '-') + '.xlsx';
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), ('VT ' + label).slice(0, 31));
  window.__vtLastExport = { name: name, sheets: [{ name: ('VT ' + label).slice(0, 31), aoa: aoa }] };
  XLSX.writeFile(wb, name); toast('Vehicle Tracking ' + label + ' exported (.xlsx)');
  return window.__vtLastExport;
}

/* ---------------------------------------------------------------- loading + the overlays ---- */
function teamScope() { return !!(D && !D.me && !isVt(D) && (D.role === 'team_leader' || D.scope === 'team' || D.scope === 'all' || D.scope === 'campaign')); }
function ensureScope(force) {
  if (VT.busy || !teamScope() || (!force && VT.teamAt && Date.now() - VT.teamAt < 120000)) return;   // once per 2 minutes, with or without VT rows (a VAS leader is asked once, not on every render)
  VT.busy = true;
  api('/api/portal/vt/overview' + (VT.cycle ? '?cycle=' + encodeURIComponent(VT.cycle) : '')).then(function (r) {
    VT.busy = false; VT.teamAt = Date.now();
    var had = !!VT.team;
    VT.team = r.ok && r.json && r.json.scorecard === 'vt' && (r.json.agents || []).length ? r.json : null;
    if (VT.team || had) render();
  }, function () { VT.busy = false; });
}
function overlay(html) {
  var old = document.getElementById('vtOv'); if (old) old.remove();
  var ov = document.createElement('div'); ov.className = 'help-ov'; ov.id = 'vtOv';
  ov.innerHTML = '<div class="help-box" style="max-width:900px"><div class="help-h" style="display:flex;justify-content:space-between;align-items:center"><b>Vehicle Tracking</b><button class="help-x" id="vtOvX">✕</button></div>' + html + '</div>';
  document.body.appendChild(ov);
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  document.getElementById('vtOvX').onclick = function () { ov.remove(); };
  return ov;
}
function howHTML(d) {
  var m = d.minima || {}, ds = d.drivers || [];
  return '<div class="vt-how"><p class="why">Your Vehicle Tracking rating is out of 100 and is built from ' + n0(ds.length) + ' drivers, each worth a share of the points:</p><ul>'
    + ds.map(function (x) { return '<li><b>' + esc(x.label) + '</b> — ' + n0(x.w) + ' points. ' + esc(x.note || '') + (x.dir === 'lower' ? ' Lower is better: you reach its target by coming in at or under it.' : '') + '</li>'; }).join('') + '</ul>'
    + '<p class="why">Every outcome counts once. Once a sale is booked it ends up fitted or not, so a missed or cancelled sale lowers your Fitment Rate and nothing else. Your missed and cancelled sales and your fitments done are shown under the drivers for your information, but they are not scored on their own: scoring them as well would take points off twice for the same sale.</p>'
    + '<p class="why">Each driver compares your own figure with your own target. Points start once you are at half of the target and grow until you reach it; at or past the target you get the driver\'s full points. The score is the points you have earned out of the points that could be earned.</p>'
    + '<p class="why">It is worked out over your business month to date — the whole month, not the last few days, because a sale is usually fitted a few days after it is made. Fitment Rate needs at least ' + n0(m.cases) + ' sales in play, and Target Achievement needs at least ' + n0(m.trackedDays)
    + ' tracked working days; until then that driver is shown but not scored, and the others share its weight — it never counts against you. There are no penalties, and you are never ranked against your colleagues.</p>'
    + '<p class="why">A cancelled sale: when a Scheduled or Missed sale is in neither of a day\'s two files (BI Active Fitted and Scheduled & Missed), or the BI file shows its contract deactivated, it counts as Cancelled from that day. A cancelled sale is still a sale; it is not fitted, so it lowers your Fitment Rate. It still counts in your sales per day, and it is no longer a Missed (or Scheduled) case. Cancellations are shown, not scored: there is no cancellation driver. If a later file carries the sale again, it goes back to that file\'s status.</p></div>';
}
function openAgent(cb) {
  var ov = overlay('<p class="why">Reading the Vehicle Tracking card…</p>');
  api('/api/portal/vt/agent?cb=' + encodeURIComponent(cb) + (VT.cycle ? '&cycle=' + encodeURIComponent(VT.cycle) : '')).then(function (r) {
    if (!document.body.contains(ov)) return;
    var box = ov.querySelector('.help-box');
    if (!r.ok) { box.insertAdjacentHTML('beforeend', '<p class="why">' + esc((r.json && r.json.error) || 'This card could not be read.') + '</p>'); return; }
    VT.detail = r.json;
    box.innerHTML = box.firstChild.outerHTML + '<h3>' + esc(r.json.me && r.json.me.name) + ' <span class="sub2">' + esc(r.json.me && r.json.me.code) + ' · ' + esc(subLabel(r.json.me && r.json.me.sub)) + '</span></h3>' + cardHTML(r.json, r.json.me, true);
    box.querySelector('#vtOvX').onclick = function () { ov.remove(); };
  });
}
function wireAll() {
  if (typeof wireShell === 'function') { /* shell() already wired the frame */ }
  if (typeof wireReports === 'function') wireReports();
  Array.prototype.forEach.call(document.querySelectorAll('[data-vtpick]'), function (s) {
    s.onchange = function () { var k = s.getAttribute('data-vtpick');
      if (k === 'cycle') { VT.cycle = s.value; VT.team = null; ensureScope(true); render(); } else { VT[k] = s.value; render(); } };
  });
}
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', function (e) {
  var t = e.target && e.target.closest ? e.target : null; if (!t) return;
  var b = t.closest('[data-vthow]'); if (b) { overlay(howHTML(VT.detail && document.getElementById('vtOv') ? VT.detail : (isVt(D) ? D : VT.team || D))); return; }
  b = t.closest('[data-vthelp]'); if (b) { if (typeof openHelp === 'function') openHelp(); return; }
  b = t.closest('[data-vtview]'); if (b) { VIEW = b.getAttribute('data-vtview'); render(); return; }
  b = t.closest('[data-vtexport]'); if (b) { exportReport(b.getAttribute('data-vtexport')); return; }
  b = t.closest('[data-vtcycle]'); if (b) { askCycle(b.getAttribute('data-vtcycle')); return; }
  b = t.closest('button[data-vtcb]'); if (b) { e.stopPropagation(); openAgent(b.getAttribute('data-vtcb')); }
}, true);
/* the agent's "(final)" link and "Back to …": the history key of a closed business month, then the live one */
function askCycle(key) {
  if (!isVt(D)) { VT.cycle = key || ''; VT.team = null; ensureScope(true); render(); return; }
  var live = VT.liveD || D;
  if (!key) { if (VT.liveD) { D = VT.liveD; VT.liveD = null; VT.back = ''; } render(); return; }
  api('/api/portal/vt/overview?cycle=' + encodeURIComponent(key)).then(function (r) {
    if (!r.ok || !r.json || r.json.scorecard !== 'vt') { toast((r.json && r.json.error) || 'Those figures are not published.'); return; }
    VT.liveD = live; VT.back = live.period && live.period.key; D = r.json; VIEW = 'month'; render();
  });
}

/* ---------------------------------------------------------------- the hooks agent/index.html calls ---- */
TL_TABS.forEach(function (t) { if (TL_VIEWS.indexOf(t[0]) < 0) TL_VIEWS.push(t[0]); if (LIVE_SAFE_VIEWS.indexOf(t[0]) < 0) LIVE_SAFE_VIEWS.push(t[0]); });
CM_TABS.forEach(function (t) { if (CM_VIEWS.indexOf(t[0]) < 0) CM_VIEWS.push(t[0]); });
window.VTView = {
  isVt: isVt,
  /* render(): the VT agent's page owns the screen */
  render: function () { if (isVt(D)) { agentPage(); return true; } return false; },
  /* navFor(): the agent nav for a VT agent; the manager's nav gains "Vehicle Tracking" when VT is in scope */
  nav: function (list, kind) {
    if (kind === 'agent') return isVt(D) ? agentNav() : list;
    if (kind === 'cm') { if (!VT.team) { ensureScope(false); return list; } var out = list.slice(); out.splice(4, 0, ['cm_vt', 'Vehicle Tracking', ICON.results, CM_TABS.map(function (t) { return [t[0], t[1]]; })]); return out; }
    return list;
  },
  /* visibleReportTabs(): a leader with VT agents also gets the three VT reports */
  reportTabs: function (list) { if (!VT.team) { ensureScope(false); return list; } return list.concat(TL_TABS.map(function (t) { return [t[0], t[1]]; })); },
  owns: function (v) { return TL_TABS.concat(CM_TABS).some(function (t) { return t[0] === v; }); },
  teamPage: function (v) { if (TL_TABS.some(function (t) { return t[0] === v; })) { teamPage(v); return true; } return false; },
  cmPage: function (v) { if (CM_TABS.some(function (t) { return t[0] === v; })) { cmPage(v); return true; } return false; },
  /* teamView's "Not reported on this page" row → the agent's VT row, when the VT digest has them */
  teamRow: function (a, nm) {
    if (!VT.team) { ensureScope(false); return ''; }
    var r = (VT.team.agents || []).filter(function (x) { return x.code === a.code; })[0]; if (!r) return '';
    var m = r.mtd || {};
    return '<tr class="vt-teamrow" data-vtrow="' + esc(r.code) + '">' + nm + '<td colspan="11"><b>Vehicle Tracking</b> · ' + esc(subLabel(r.sub)) + ' · ' + esc(ratingText(r)) + ' · sales ' + n0(m.sales) + ' · fitted ' + p1(m.fitRate)
      + ' · missed ' + p1(m.missRate) + ' · ' + p1(m.toTarget) + ' to target <button class="btn2" data-vtcb="' + esc(r.code) + '">Open VT card</button></td></tr>';
  },
  boot: function () { ensureScope(false); },
  exportReport: exportReport,
  state: function () { return { team: VT.team, cycle: VT.cycle, back: VT.back || '' }; },
  _cardHTML: cardHTML, _howHTML: howHTML, _report: report, _table: table, _dayRow: dayRow
};
})();
