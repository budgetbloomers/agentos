/* VT ENGINE — Vehicle Tracking analytics (Spec Kit 071, specs/071-vehicle-tracking-analytics/).
 *
 * THE ENGINE DECIDES, THE PAGE PAINTS. Every VT figure, status, rate, rating and verdict is
 * computed here and nowhere else: PULSE's VT pages, the published digest, the Worker and Agent
 * Analytics only carry and paint what this file returns. Pure functions only — no DOM, no fetch,
 * no clock (every "today" is passed in), the input book is never mutated.
 *
 * Loads two ways (plan "companion-file pattern"): a classic <script src="vt-engine.js" data-inline>
 * from PULSE (works from file://; prepare-site inlines it) → window.VTEngine, and require() in the
 * Node suites → module.exports.
 *
 * Rules: VT_RULES below is the operative copy of specs/vt_engine_rules.json — change both together
 * with a dated _changes[] entry; diagnostics/verify-vt-rules.mjs fails on drift and on any rule
 * literal written outside the @vt-rules block.
 *
 * Pipeline:  detect → parseBi / parseSm / parseOpeningBook (PII dropped here) → merge (case book +
 * events, FR-011..015) → model (MTD / weeks / days at agent, TL, sub-campaign, lead source, floor)
 * → rating (spec §6) → digest (plan §P).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* @vt-rules start */
var VT_RULES = {
  "version": "vt-1.0",
  "detection": {
    "vtBiFitted": {"requireHeaders":["installation status","vehicle reg number","box number","unit type","case number","created by"],"runBefore":["bi","inactive"],"footerPattern":"^Applied filters:"},
    "vtSchedMissed": {"requireHeaders":["missedandscheduledfitment","fitment date","case number","created by"],"footerPattern":"^No filters applied"},
    "vtOpeningBook": {"sheetName":"Schedulers Data","requireHeaders":["month","date","agent","case number","result"],"takeOnly":["case number","date"],"optional":true},
    "filenameDate": {"pattern":"(\\d{2})(\\d{2})(\\d{2})(?=\\D*\\.xlsx?$)","order":"ddmmyy","century":2000,"fallback":"todaySAST+warning"},
    "refuseIn": ["ops.detectSource","pulse.rakeDetect","relay.archiveUpload"]
  },
  "columns": {
    "bi": {"byPosition":true,"caseNumber":"AS","unitType":"Y","bundle":"Z","chargeEx":"X","chargeCheck":"AD","installedOn":"Q","contractCreatedOn":"O","createdBy":"L","sourcePartner":"AP"},
    "sm": {"caseNumber":"C","productType":"J","attempt":"L","bundle":"M","apptOn":"R","createdBy":"S","outcome":"U","sourcePartner":"A"},
    "opening": {"caseNumber":"F","saleDate":"B"},
    "discardAll": "every column not listed above (customer name, mobile, registration, chassis, box, account/contract numbers, consultants, fitment partner, last modified by)",
    "dateSerial": "Excel 1900 serial, integer part; text dates refused"
  },
  "vtUnitTypes": ["BEAME","MXV","Matrix Vision"],
  "status": {
    "values": ["scheduled","missed","fitted","cancelled"],
    "fromBi": "fitted",
    "fromSm": {"Scheduled Fitment":"scheduled","Missed Fitment":"missed"},
    "sameExtractPrecedence": ["fitted","missed","scheduled"],
    "acrossExtracts": "newer extract decides between missed and scheduled",
    "terminal": ["fitted"],
    "open": ["scheduled","missed"],
    "sticky": true,
    "olderExtractMayChangeStatus": false,
    "cancelledFrom": null
  },
  "saleDay": {
    "basis": "first_seen",
    "openingBook": "takes RPT 'Schedulers Data'!B for its cases",
    "openingWithoutDate": "null - in play, never counted as a sale on any day",
    "goLive": "unknown",
    "saleDateColumn": null
  },
  "fittedDay": {"from":["bi.installedOn","bi.contractCreatedOn"]},
  "apptDay": {"from":"sm.apptOn"},
  "identity": {
    "sellerFrom": ["sm.createdBy","bi.createdBy"],
    "stripSuffixes": [" - Panimax"],
    "collapseWhitespace": true,
    "caseFold": true,
    "chain": ["exact","alias","near","first_last"],
    "nearMinTokenLength": 4,
    "unmatched": "excluded from agent rows; counted on the receipt and in floor.unmatched",
    "creditOverrides": {}
  },
  "leadSources": {
    "map": {"RevX":"revx","Tracking Empire / Shawn Langley":"tracking_empire","Jag Web Marketing- Panimax":"jag","Afrilead- Panimax":"afrilead","Sales Enablement":"sales_enablement","Panimax - New Sales":{"ifSellerTeam":{"referral":"referral"},"else":"predictive"}},
    "unknown": "other",
    "groups": {"lead_gen":["revx","tracking_empire","jag","afrilead"],"predictive":["predictive"],"referral":["referral"],"other":["sales_enablement","other"]},
    "labels": {"revx":"Revx","tracking_empire":"Tracking Empire","jag":"Jag","afrilead":"Afrilead","predictive":"Predictive","referral":"Referral","sales_enablement":"Sales Enablement","other":"Other","lead_gen":"Lead Gen"}
  },
  "teams": {
    "fromCampaignRaw": "^Matrix Vehicle Tracking - (Digital|Predictive|Referral|Scheduling)\\s*$",
    "keys": {"Digital":"digital","Predictive":"predictive","Referral":"referral","Scheduling":"scheduling"},
    "notRated": ["scheduling"],
    "noTarget": "Target <= 0, '-' or blank"
  },
  "periods": {
    "periodStartDay": 26,
    "cycleKeyBy": "month the cycle ends in (cycle-YYYY-MM, worker/src/cycle.mjs)",
    "weekStart": "Mon",
    "weekEnd": "Sat",
    "sundayJoins": "week of the preceding Monday",
    "weeksClippedToCycle": true,
    "workingDay": "Mon-Fri and not dataOnlyDay (SA public holidays + extraHolidays)",
    "extraHolidays": ["2026-11-04"],
    "saturday": "data, not a working day",
    "hrsAheadAsAtOffsetDays": 1,
    "hrsAheadBuckets": [
      {"k":"h24","label":"24","days":0},
      {"k":"h48","label":"48","days":1},
      {"k":"h72","label":"72","days":2},
      {"k":"h72p","label":"72+","minDays":3},
      {"k":"past","label":"Past due","maxDays":-1}
    ]
  },
  "guards": {"thinBiShare":0.9,"thinSmShare":0.4,"uploadGapWorkingDays":1},
  "vat": 1.15,
  "reports": {
    "inPlay": "sold in cycle OR (sold earlier AND (open at any time in cycle OR fitted in cycle))",
    "columns": [
      {"id":"sales","label":"Sales","f":"count(set)","basis":"saleDay; MTD = inPlay"},
      {"id":"current","label":"Current","f":"count(set where saleDay >= cycle.from)","basis":"saleDay","mtdOnly":true},
      {"id":"rollover","label":"Rollover","f":"count(set where saleDay < cycle.from or saleDay null)","basis":"saleDay","mtdOnly":true},
      {"id":"fitted","label":"Fitted","f":"count(set where status=fitted)","basis":"status as at"},
      {"id":"scheduled","label":"Scheduled","f":"count(set where status=scheduled)","basis":"status as at"},
      {"id":"missed","label":"Missed","f":"count(set where status=missed)","basis":"status as at"},
      {"id":"cancelled","label":"Cancelled","f":"count(set where status=cancelled) or null when cancelledFrom is null","basis":"status as at"},
      {"id":"fitRate","label":"Fitted Rate %","f":"fitted / sales"},
      {"id":"missRate","label":"Missed Rate %","f":"missed / sales"},
      {"id":"schedRate","label":"Scheduled Rate %","f":"scheduled / sales"},
      {"id":"fitDone","label":"Fitments done","f":"count(cases fitted, fittedDay in window)","basis":"fittedDay"},
      {"id":"missAppt","label":"Missed appointments","f":"count(events to=missed, apptDay in window)","basis":"apptDay"},
      {"id":"due","label":"Due to fit","f":"count(open scheduled, apptDay in window)","basis":"apptDay"},
      {"id":"hrsAhead","label":"Hrs Ahead 24/48/72/72+/Past due","f":"bucket(apptDay - asAt) over open scheduled","basis":"asAt","mtdOnly":true},
      {"id":"hrsShare","label":"Hrs Ahead share vs budget","f":"bucket / open scheduled","mtdOnly":true,"levels":["team","sub","floor"]},
      {"id":"workingDays","label":"Working days","f":"working days from max(cycle.from, agent start, first tracked day) to last extract"},
      {"id":"spd","label":"SPD","f":"current / workingDays"},
      {"id":"target","label":"Target SPD","f":"Agent List Target; team = sum"},
      {"id":"toTarget","label":"% to target","f":"spd / target; teams: sum(current of targeted agents) / sum(target x workingDays)"},
      {"id":"fitBudget","label":"Fitment budget %","f":"budgets[cycle].fitment[sub][tenure]"},
      {"id":"value","label":"Fitted value (incl VAT, Charge Amount basis)","f":"sum(chargeEx of fitted) * vat","basis":"fittedDay"},
      {"id":"noSaleDay","label":"Sales without a sale day","f":"count(set where saleDay null)","mtdOnly":true,"showWhenPositive":true}
    ],
    "totals": "sum of counts; rates = ratio of sums",
    "absent": "—",
    "schedulerPivots": {"built":false,"why":"no upload names the scheduler (WR 3.4)"}
  },
  "rating": {
    "floor": 0.5,
    "window": "cycle-to-date (cycle.from → last extract)",
    "minCases": 5,
    "minTrackedDays": 5,
    "minInPlayToRate": 1,
    "renormalise": true,
    "lowerIsBetter": "att = clamp(target / value, 0, 1); value 0 → 1",
    "points": "round(w * clamp((att - floor) / (1 - floor), 0, 1), 1)",
    "score": "round(min(100, sum(points) / sum(measured w) * 100), 1)",
    "penalties": 0,
    "drivers": [
      {"k":"targetAch","label":"Target Achievement","w":35,"dir":"higher","value":"reports.spd","target":"Agent List Target (AL VT!I) for the cycle's list","note":"How close your sales per working day come to your target."},
      {"k":"fitRate","label":"Fitment Rate","w":30,"dir":"higher","value":"reports.fitRate (MTD in play)","target":"budgets[cycle].fitment[sub][tenure]","note":"Out of every 100 of your sales in play this month, how many are fitted."},
      {"k":"missRate","label":"Missed Rate","w":20,"dir":"lower","value":"reports.missRate (MTD in play)","target":"budgets[cycle].missed[sub]","note":"How many of your sales missed their fitment appointment. Lower is better."},
      {"k":"fitted","label":"Fitted vs target","w":15,"dir":"higher","value":"reports.fitDone (MTD)","target":"target * workingDays * budgets[cycle].fitment[sub][tenure]","note":"Fitments done this month against what your target would fit."}
    ],
    "notScored": {"gwp":"D7-a: Charge Amount x VAT equals RPT GWP on 328/1,104; budget Avg GWP is on the bundle-price basis; SM has no amount","hrsAhead":"D7-b: scheduler's queue, not the seller's","attendance_talk_qa_conversion_optins":"D7-c: not in the VT files","schedulers":"D7-d"},
    "bands": [{"label":"Elite","min":90},{"label":"Strong","min":80},{"label":"On track","min":70},{"label":"Building","min":60},{"label":"Needs support","min":0}]
  },
  "budgetFallback": "latest earlier cycle; the card names the cycle used",
  "budgets": {
    "cycle-2026-11": {"spd":{"digital":{"*":6.5},"referral":{"*":3},"predictive":{"Exp":2,"M2":1.5,"M1":1}},"fitment":{"digital":{"*":0.85},"referral":{"*":0.85},"predictive":{"*":0.8,"Exp":0.8,"M2":0.75,"M1":0.7},"floor":0.8},"missed":{"*":0.05},"cancelled":{"*":0.05},"hrsShare":{"h24":0.8,"h48":0.1,"h72":0.05,"h72p":0.05},"avgGwpShownNotScored":{"digital":166,"referral":199,"predictive":169}}
  }
};
/* @vt-rules end */

/* @mirror:sa-holidays start — identical in nicks_code/index.html and agent/index.html; verify-public-holidays.mjs fails on any difference */
/* SA PUBLIC HOLIDAYS, COMPUTED (Public Holidays Act 36 of 1994): the ten fixed dates, Good
   Friday and Family Day from the Gregorian Easter algorithm (Meeus/Jones/Butcher), and a
   holiday that falls on a Sunday observed on the Monday. Returns the OBSERVED dates for the
   year as 'YYYY-MM-DD' strings — the table this replaces had to be extended every December
   and would have silently gone blank in a January. One-off holidays the Act does not list
   (an election day) are added by the caller from the rule book, never here. */
function saHolidaysFor(year){
  var y=+year, a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25),
      g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7,
      m=Math.floor((a+11*h+22*l)/451), em=Math.floor((h+l-7*m+114)/31), ed=((h+l-7*m+114)%31)+1;
  var easter=Date.UTC(y,em-1,ed), DAY=864e5;
  var iso=function(t){ return new Date(t).toISOString().slice(0,10); };
  var days=[Date.UTC(y,0,1),Date.UTC(y,2,21),easter-2*DAY,easter+DAY,Date.UTC(y,3,27),Date.UTC(y,4,1),
            Date.UTC(y,5,16),Date.UTC(y,7,9),Date.UTC(y,8,24),Date.UTC(y,11,16),Date.UTC(y,11,25),Date.UTC(y,11,26)];
  var out=[]; for(var n=0;n<days.length;n++){ var t=days[n]; if(new Date(t).getUTCDay()===0) t+=DAY; out.push(iso(t)); }
  return out;
}
/* @mirror:sa-holidays end */

var R = VT_RULES, DAY = 864e5, EXCEL_EPOCH = 25569;

/* ---------------------------------------------------------------- small helpers ---- */
function iso(t) { return new Date(t).toISOString().slice(0, 10); }
function addDays(d, n) { return iso(Date.parse(d + 'T00:00:00Z') + n * DAY); }
function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY); }
function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
function maxD() { var m = null; for (var i = 0; i < arguments.length; i++) if (arguments[i] && (!m || arguments[i] > m)) m = arguments[i]; return m; }
function minD() { var m = null; for (var i = 0; i < arguments.length; i++) if (arguments[i] && (!m || arguments[i] < m)) m = arguments[i]; return m; }
function round(x, dp) { var f = Math.pow(10, dp); return Math.round(x * f) / f; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
function copy(o) { var r = {}; for (var k in o) r[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; return r; }
function sortedKeys(o) { return Object.keys(o).sort(); }
function serialToISO(n) { return (typeof n === 'number' && isFinite(n) && n > 0) ? iso((Math.floor(n) - EXCEL_EPOCH) * DAY) : null; }
function cnKey(v) { var s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : ''; }
var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function colIndex(letters) { var n = 0; for (var i = 0; i < letters.length; i++) n = n * ALPHA.length + ALPHA.indexOf(letters[i]) + 1; return n - 1; }
function normCB(v) { var m = String(v == null ? '' : v).trim().match(/^cb\s*-?\s*0*(\d+)$/i); return m ? 'CB' + m[1] : null; }
function union(a, b) { var s = {}; (a || []).concat(b || []).forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(); }

/* ---------------------------------------------------------------- periods ---- */
function cycleOf(d) {
  var y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10), S = R.periods.periodStartDay;
  if (day >= S) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return cycleByKey('cycle-' + y + '-' + String(m).padStart(2, '0'));
}
function cycleByKey(key) {
  var y = +key.slice(6, 10), m = +key.slice(11, 13), S = R.periods.periodStartDay;
  var from = iso(Date.UTC(y, m - 2, S)), to = iso(Date.UTC(y, m - 1, S - 1));
  return { key: key, from: from, to: to };
}
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function short(d) { return (+d.slice(8, 10)) + ' ' + MON[+d.slice(5, 7) - 1]; }
function mondayOf(d) { return addDays(d, -((dow(d) + 6) % 7)); }
/* Weeks run Monday–Saturday; a Sunday joins the week of the Monday before; clipped to the cycle. */
function weekKeyOf(d, cyc) { return maxD(mondayOf(d), cyc.from); }
function weeksOf(cyc) {
  var out = [], d = cyc.from;
  while (d <= cyc.to) {
    var from = d, sun = addDays(mondayOf(d), 6), to = minD(sun, cyc.to), sat = minD(addDays(mondayOf(d), 5), cyc.to);
    out.push({ k: from, from: from, to: to, label: short(from) + ' – ' + short(sat < from ? from : sat) });
    d = addDays(to, 1);
  }
  return out;
}
var _HOL = {};
function defaultDataOnly(d) {
  var y = d.slice(0, 4), set = _HOL[y] || (_HOL[y] = saHolidaysFor(+y));
  return dow(d) === 6 || set.indexOf(d) > -1 || (R.periods.extraHolidays || []).indexOf(d) > -1;
}
/* A working day is Mon–Fri and not a data-only day. PULSE hands its own dataOnlyDay in, so the VT
   calendar is the VAS calendar; Node uses the same computed calendar + the rule book's one-offs. */
function isWorkingDay(d, isDataOnlyDay) { var w = dow(d); return w > 0 && w < 6 && !(isDataOnlyDay || defaultDataOnly)(d); }
function workingDaysBetween(a, b, isDataOnlyDay) { var n = 0; for (var d = a; a && b && d <= b; d = addDays(d, 1)) if (isWorkingDay(d, isDataOnlyDay)) n++; return n; }
function hrsAsAt(extractOn) { return addDays(extractOn, R.periods.hrsAheadAsAtOffsetDays); }
function hrsBucket(apptOn, asAt) {
  if (!apptOn || !asAt) return null;
  var diff = dayDiff(apptOn, asAt), B = R.periods.hrsAheadBuckets;
  for (var i = 0; i < B.length; i++) {
    var b = B[i];
    if (b.days != null && diff === b.days) return b.k;
    if (b.minDays != null && diff >= b.minDays) return b.k;
    if (b.maxDays != null && diff <= b.maxDays) return b.k;
  }
  return null;
}
var periods = { cycleOf: cycleOf, cycleByKey: cycleByKey, weeksOf: weeksOf, weekKeyOf: weekKeyOf, isWorkingDay: isWorkingDay,
  workingDaysBetween: workingDaysBetween, hrsAsAt: hrsAsAt, hrsBucket: hrsBucket, addDays: addDays };

/* ---------------------------------------------------------------- detection + parse ---- */
/* Header names expected at each position the rule book reads (the files repeat Contract Status,
   Charge Amount and Unit Type, so BI is read by POSITION and each position is checked by name). */
var BI_NAMES = { caseNumber: 'case number', unitType: 'unit type', bundle: 'product bundle', chargeEx: 'charge amount', chargeCheck: 'charge amount',
  installedOn: 'installation date', contractCreatedOn: 'contract create date', createdBy: 'created by', sourcePartner: 'source partner' };
var SM_NAMES = { caseNumber: 'case number', productType: 'product type', attempt: 'status', bundle: 'bundle name', apptOn: 'fitment date',
  createdBy: 'created by', outcome: 'missedandscheduledfitment', sourcePartner: 'opportunity source partner' };

function detect(header, sheetName) {
  var h = (header || []).map(norm), has = function (list) { return list.every(function (x) { return h.indexOf(x) > -1; }); };
  var D = R.detection;
  if (has(D.vtBiFitted.requireHeaders)) return 'vtBiFitted';
  if (has(D.vtSchedMissed.requireHeaders)) return 'vtSchedMissed';
  if (has(D.vtOpeningBook.requireHeaders) && (!sheetName || norm(sheetName) === norm(D.vtOpeningBook.sheetName))) return 'vtOpeningBook';
  return null;
}
/* Extract date from the ddmmyy in the file name; else the caller's "today (SAST)", flagged. */
function extractDate(fileName, todaySAST) {
  var F = R.detection.filenameDate, m = String(fileName || '').match(new RegExp(F.pattern));
  if (m) {
    var d = +m[1], mo = +m[2], y = F.century + (+m[3]), t = Date.UTC(y, mo - 1, d);
    if (mo >= 1 && mo <= 12 && new Date(t).getUTCDate() === d) return { date: iso(t), assumed: false };
  }
  return { date: todaySAST || null, assumed: true };
}
function footer(cell, pattern) { return typeof cell === 'string' && new RegExp(pattern, 'i').test(cell.trim()); }
function blankRow(r) { return !r || r.every(function (v) { return v == null || v === ''; }); }
function dateCell(v, warn, what) { if (v == null || v === '') return null; if (typeof v === 'number') return serialToISO(v); warn(what + ' is text, not a date serial: ignored'); return null; }
function strCell(v) { var s = v == null ? '' : String(v).trim(); return s || null; }
function makeWarn() { var seen = {}, list = []; return { list: list, add: function (w) { if (!seen[w]) { seen[w] = 1; list.push(w); } } }; }

function parseBi(aoa) {
  var C = R.columns.bi, H = (aoa[0] || []).map(norm), idx = {}, missing = [];
  Object.keys(BI_NAMES).forEach(function (f) { var i = colIndex(C[f]); idx[f] = i; if (H[i] !== BI_NAMES[f]) missing.push(BI_NAMES[f] + ' (column ' + C[f] + ')'); });
  var out = { kind: 'bi', rows: 0, vtLines: 0, skippedFooter: 0, skippedBlank: 0, missing: missing, cases: {}, warnings: [] };
  if (missing.length) return out;
  var W = makeWarn(), VT = R.vtUnitTypes, foot = R.detection.vtBiFitted.footerPattern;
  for (var n = 1; n < aoa.length; n++) {
    var r = aoa[n]; if (blankRow(r)) continue;
    if (footer(r[0], foot)) { out.skippedFooter++; continue; }
    out.rows++;
    var cn = cnKey(r[idx.caseNumber]); if (!cn) { out.skippedBlank++; continue; }
    var unit = strCell(r[idx.unitType]); if (VT.indexOf(unit) < 0) continue;
    out.vtLines++;
    var x = +r[idx.chargeEx] || 0, chk = +r[idx.chargeCheck] || 0;
    if (Math.abs(x - chk) > 0.005) W.add('Charge Amount X differs from AD on a VT line: X used');
    var inst = dateCell(r[idx.installedOn], W.add, 'Installation Date'), con = dateCell(r[idx.contractCreatedOn], W.add, 'Contract Create Date');
    var c = out.cases[cn] || (out.cases[cn] = { products: [], bundle: null, chargeEx: 0, fittedOn: null, seller: null, partner: null });
    c.products = union(c.products, [unit]);
    c.bundle = c.bundle || strCell(r[idx.bundle]);
    c.chargeEx = round(c.chargeEx + x, 2);
    c.fittedOn = maxD(c.fittedOn, inst || con);
    c.seller = c.seller || normSeller(r[idx.createdBy]) || null;
    c.partner = c.partner || strCell(r[idx.sourcePartner]);
  }
  out.warnings = W.list;
  return out;
}
function byName(H, names) { var idx = {}, missing = []; Object.keys(names).forEach(function (f) { var i = H.indexOf(names[f]); idx[f] = i; if (i < 0) missing.push(names[f]); }); return { idx: idx, missing: missing }; }
function parseSm(aoa) {
  var H = (aoa[0] || []).map(norm), b = byName(H, SM_NAMES), idx = b.idx;
  var out = { kind: 'sm', rows: 0, lines: 0, skippedFooter: 0, skippedBlank: 0, missing: b.missing, cases: {}, warnings: [] };
  if (b.missing.length) return out;
  var W = makeWarn(), MAP = R.status.fromSm, PREC = R.status.sameExtractPrecedence, foot = R.detection.vtSchedMissed.footerPattern;
  for (var n = 1; n < aoa.length; n++) {
    var r = aoa[n]; if (blankRow(r)) continue;
    if (footer(r[0], foot)) { out.skippedFooter++; continue; }
    out.rows++;
    var cn = cnKey(r[idx.caseNumber]); if (!cn) { out.skippedBlank++; continue; }
    var st = MAP[strCell(r[idx.outcome])]; if (!st) { W.add('unknown MissedAndScheduledFitment value: row skipped'); continue; }
    out.lines++;
    var c = out.cases[cn] || (out.cases[cn] = { status: st, apptOn: null, attempt: null, products: [], bundle: null, seller: null, partner: null });
    if (PREC.indexOf(st) < PREC.indexOf(c.status)) c.status = st;
    c.apptOn = maxD(c.apptOn, dateCell(r[idx.apptOn], W.add, 'Fitment Date'));
    c.attempt = c.attempt || strCell(r[idx.attempt]);
    c.products = union(c.products, [strCell(r[idx.productType])]);
    c.bundle = c.bundle || strCell(r[idx.bundle]);
    c.seller = c.seller || normSeller(r[idx.createdBy]) || null;
    c.partner = c.partner || strCell(r[idx.sourcePartner]);
  }
  out.warnings = W.list;
  return out;
}
/* The optional opening book (FR-003, A6): the hand report's Schedulers Data. ONLY case → sale date
   is taken; Result, GWP, Scheduler, agent and customer contact never leave this function. */
function parseOpeningBook(aoa) {
  var H = (aoa[0] || []).map(norm), b = byName(H, { caseNumber: 'case number', saleDate: 'date' });
  var out = { kind: 'opening', rows: 0, skippedBlank: 0, skippedFooter: 0, missing: b.missing, cases: {}, warnings: [] };
  if (b.missing.length) return out;
  var W = makeWarn();
  for (var n = 1; n < aoa.length; n++) {
    var r = aoa[n]; if (blankRow(r)) continue; out.rows++;
    var cn = cnKey(r[b.idx.caseNumber]), d = dateCell(r[b.idx.saleDate], W.add, 'Date');
    if (!cn || !d) { out.skippedBlank++; continue; }
    out.cases[cn] = { soldOn: minD(d, (out.cases[cn] || {}).soldOn) };
  }
  out.warnings = W.list;
  return out;
}
/* Fallback roster from the Agent List workbook (VT + TL sheets): for the Node oracle and the
   file:// station. Production reads the roster of record (/api/roster + vt_roster_at, FR-018). */
function parseRoster(vtAoa, tlAoa, asOf) {
  var H = (vtAoa[0] || []).map(norm), b = byName(H, { code: 'employee code', start: 'start date', tl: 'team leader', name: 'agent name',
    campaign: 'campaign', tenure: 'tenure', role: 'job title', sf: 'sales force', target: 'target' });
  if (b.missing.length) return [];
  var T = ((tlAoa && tlAoa[0]) || []).map(norm), tc = T.indexOf('employee code'), tn = T.indexOf('team leader name'), tl = {};
  (tlAoa || []).slice(1).forEach(function (r) { if (r && tc > -1 && tn > -1 && r[tn]) tl[norm(r[tn])] = normCB(r[tc]); });
  var i = b.idx, out = [];
  vtAoa.slice(1).forEach(function (r) {
    var code = r && normCB(r[i.code]), sub = r && subOf(r[i.campaign]); if (!code || !sub) return;
    var t = typeof r[i.target] === 'number' ? r[i.target] : parseFloat(r[i.target]);
    out.push({ code: code, name: strCell(r[i.name]), sf: strCell(r[i.sf]), tl: strCell(r[i.tl]), tlCode: tl[norm(r[i.tl])] || null, sub: sub,
      campaignRaw: strCell(r[i.campaign]), tenure: strCell(r[i.tenure]), role: strCell(r[i.role]), target: t > 0 ? t : null,
      startDate: typeof r[i.start] === 'number' ? serialToISO(r[i.start]) : null, asOf: asOf || null });
  });
  return out;
}

/* ---------------------------------------------------------------- identity, lead source, team ---- */
function normSeller(name) {
  var s = String(name == null ? '' : name).replace(/\s+/g, ' ');
  (R.identity.stripSuffixes || []).forEach(function (suf) {
    var body = suf.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    s = s.replace(new RegExp('\\s*' + body + '\\s*$', 'i'), '');
  });
  return norm(s);
}
function tokNear(a, b) {
  if (a === b) return true;
  var min = R.identity.nearMinTokenLength;
  if (a.length < min || b.length < min || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    var diff = []; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length <= 1) return true;
    return diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a, j = 0;
  while (j < s.length && s[j] === l[j]) j++;
  return s.slice(j) === l.slice(j + 1);
}
function nearTokens(a, b) {
  if (a.length !== b.length || a.length < 2) return false;
  var fuzzy = 0; for (var i = 0; i < a.length; i++) { if (a[i] === b[i]) continue; if (!tokNear(a[i], b[i]) || ++fuzzy > 1) return false; }
  return fuzzy === 1;
}
/* exact → alias → one-typo near-spelling → VT-only unique first+last token → unmatched. Every step is
   UNIQUE-OR-NOTHING: two people fitting is nobody (CLAUDE.md 7: flagged, never guessed). */
function resolveSeller(name, roster, aliases, opts) {
  var n = normSeller(name), chain = (opts && opts.chain) || R.identity.chain, tk = n.split(' ').filter(Boolean);
  var people = (roster || []).map(function (r) { return { code: r.code, names: [r.name, r.sf].filter(Boolean).map(normSeller) }; });
  function only(test) { var hit = {}; people.forEach(function (p) { if (p.names.some(test)) hit[p.code] = 1; }); var k = Object.keys(hit); return k.length === 1 ? k[0] : k.length ? false : null; }
  for (var s = 0; n && s < chain.length; s++) {
    var step = chain[s], code = null;
    if (step === 'exact') code = only(function (x) { return x === n; });
    else if (step === 'alias') code = (aliases && aliases[n]) ? normCB(aliases[n]) : null;
    else if (step === 'near') code = only(function (x) { return nearTokens(tk, x.split(' ')); });
    else if (step === 'first_last') code = tk.length < 2 ? null : only(function (x) { var t = x.split(' '); return t.length >= 2 && t[0] === tk[0] && t[t.length - 1] === tk[tk.length - 1]; });
    if (code === false) return { code: null, method: 'unmatched', name: n };
    if (code) return { code: code, method: step, name: n };
  }
  return { code: null, method: 'unmatched', name: n };
}
function leadSourceOf(partner, sellerSub) {
  var L = R.leadSources, p = norm(partner), hit = null;
  Object.keys(L.map).forEach(function (k) { if (norm(k) === p) hit = L.map[k]; });
  if (!hit) return L.unknown;
  if (typeof hit === 'string') return hit;
  return (hit.ifSellerTeam && hit.ifSellerTeam[sellerSub]) || hit['else'];
}
function leadGroupOf(key) { var G = R.leadSources.groups; for (var g in G) if (G[g].indexOf(key) > -1) return g; return null; }
function subOf(campaignRaw) { var m = String(campaignRaw == null ? '' : campaignRaw).match(new RegExp(R.teams.fromCampaignRaw)); return m ? R.teams.keys[m[1]] : null; }

/* ---------------------------------------------------------------- the case book ---- */
/* book = { rev, openedOn, openingBookOn, cases: { "<case number>": row }, events: [ … ] }
   row  = the vt_cases columns (plan DB-2) in camelCase; events = status changes only (FR-013). */
function emptyBook() { return { rev: 0, openedOn: null, openingBookOn: null, cases: {}, events: [] }; }
function better(a, b) { var P = R.status.sameExtractPrecedence; return P.indexOf(a) <= P.indexOf(b) ? a : b; }
function saleDayOf(firstSeen, openedOn) { return firstSeen > openedOn ? { soldOn: firstSeen, soldBasis: R.saleDay.basis } : { soldOn: null, soldBasis: R.saleDay.goLive }; }
function sameRow(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* Apply one observed case to its row (FR-011..FR-016). `rel` is where this extract sits against the
   last extract that carried the case: 'new' | 'newer' | 'same' | 'older'. */
function applyObs(prev, o, kind, ext, rel, ctx) {
  var row = prev ? copy(prev) : { caseNumber: o.cn, status: null, statusOn: null, soldOn: null, soldBasis: null, firstSeen: ext, lastSeen: ext,
    apptOn: null, fittedOn: null, smAttempt: null, products: [], bundle: null, chargeEx: null, partnerRaw: null, leadSource: null,
    sellerName: null, sellerCb: null, sellerMatch: null };
  var obsStatus = kind === 'bi' ? R.status.fromBi : o.status, wins = rel === 'new' || rel === 'newer' || rel === 'same';
  var terminal = row.status && R.status.terminal.indexOf(row.status) > -1, next = row.status;
  if (rel === 'new') next = obsStatus;
  else if (!terminal && rel === 'same') next = better(row.status, obsStatus);
  else if (!terminal && rel === 'newer') next = obsStatus;
  var set = function (k, v, overwrite) { if (v != null && (overwrite || row[k] == null)) row[k] = v; };
  if (kind === 'bi') { set('fittedOn', o.fittedOn, wins); set('chargeEx', o.chargeEx, wins); set('bundle', o.bundle, false); }
  else { set('apptOn', o.apptOn, wins); set('smAttempt', o.attempt, wins); set('bundle', o.bundle, wins); }
  row.products = union(row.products, o.products);
  /* the seller and partner come from S&M first (identity.sellerFrom): BI only fills a blank */
  var smFirst = kind === 'sm' && wins;
  if (o.seller && (smFirst || !row.sellerName)) { var who = resolveSeller(o.seller, ctx.roster, ctx.aliases); row.sellerName = who.name; row.sellerCb = who.code; row.sellerMatch = who.method; }
  set('partnerRaw', o.partner, smFirst);
  var team = row.sellerCb && ctx.subOfCode[row.sellerCb];
  row.leadSource = leadSourceOf(row.partnerRaw, team || null);
  row.firstSeen = minD(row.firstSeen, ext); row.lastSeen = maxD(row.lastSeen, ext);
  if (row.soldBasis !== 'opening_book') { var sd = saleDayOf(row.firstSeen, ctx.openedOn); row.soldOn = sd.soldOn; row.soldBasis = sd.soldBasis; }
  var event = null;
  if (next !== row.status) { event = { caseNumber: o.cn, onDate: ext, from: row.status, to: next, apptOn: row.apptOn }; row.status = next; row.statusOn = ext; }
  return { row: row, event: event };
}

/* merge(book, parsed, {extractOn, roster, aliases}) → { book, cases (changed rows), events (new),
   counts, unmatched, warnings }. Pure and deterministic: the input book is never touched. */
function merge(book, parsed, opts) {
  book = book || emptyBook(); opts = opts || {};
  var ext = opts.extractOn, kind = parsed.kind, cases = copy(book.cases || {}), changed = [], events = [];
  var counts = { rows: parsed.rows || 0, vtLines: parsed.vtLines != null ? parsed.vtLines : (parsed.lines || 0), cases: 0, 'new': 0, toFitted: 0, toMissed: 0, toScheduled: 0,
    changed: 0, skippedFooter: parsed.skippedFooter || 0, skippedBlank: parsed.skippedBlank || 0, notInBook: 0 };
  var out = { rev: book.rev || 0, openedOn: book.openedOn || null, openingBookOn: book.openingBookOn || null, cases: cases, events: null };
  var unmatched = {}, warnings = (parsed.warnings || []).slice();
  if (!ext) throw new Error('merge needs opts.extractOn');
  if (kind === 'opening') {
    sortedKeys(parsed.cases).forEach(function (cn) {
      counts.cases++;
      var prev = cases[cn]; if (!prev) { counts.notInBook++; return; }
      var row = copy(prev); row.soldOn = parsed.cases[cn].soldOn; row.soldBasis = 'opening_book';
      if (!sameRow(row, prev)) { cases[cn] = row; changed.push(row); }
    });
    out.openingBookOn = out.openingBookOn || ext;
    if (counts.notInBook) warnings.push(counts.notInBook + ' opening-book cases are not in the book yet: load the opening book after the first day\'s two files');
  } else {
    if (!out.openedOn) out.openedOn = ext;
    var ctx = { roster: opts.roster || [], aliases: opts.aliases || {}, openedOn: out.openedOn, subOfCode: {} };
    ctx.roster.forEach(function (r) { ctx.subOfCode[r.code] = r.sub; });
    sortedKeys(parsed.cases).forEach(function (cn) {
      counts.cases++;
      var prev = cases[cn], o = copy(parsed.cases[cn]); o.cn = cn;
      var rel = !prev ? 'new' : ext > prev.lastSeen ? 'newer' : ext === prev.lastSeen ? 'same' : 'older';
      var r = applyObs(prev, o, kind, ext, rel, ctx);
      if (!prev) counts['new']++;
      if (r.event) { events.push(r.event); counts[{ fitted: 'toFitted', missed: 'toMissed', scheduled: 'toScheduled' }[r.event.to]]++; }
      if (!r.row.sellerCb && r.row.sellerName) unmatched[r.row.sellerName] = (unmatched[r.row.sellerName] || 0) + 1;
      if (!prev || !sameRow(r.row, prev)) { cases[cn] = r.row; changed.push(r.row); }
    });
  }
  counts.changed = changed.length;
  out.events = (book.events || []).concat(events);
  return { book: out, cases: changed, events: events, counts: counts,
    unmatched: sortedKeys(unmatched).map(function (n) { return { name: n, cases: unmatched[n] }; }), warnings: warnings };
}
/* Convert the vt_book() RPC value (plan DB-3, positional arrays) into a book. The last three columns (Phase C) carry
   what merge and model read back — without partnerRaw a re-read book re-folded every lead source to 'other'. */
var BOOK_COLS = ['caseNumber', 'status', 'statusOn', 'soldOn', 'soldBasis', 'firstSeen', 'lastSeen', 'apptOn', 'fittedOn', 'products', 'chargeEx', 'leadSource', 'sellerName', 'sellerCb', 'sellerMatch', 'smAttempt', 'bundle', 'partnerRaw'];
var EVENT_COLS = ['caseNumber', 'onDate', 'from', 'to', 'apptOn'];
function bookFromRpc(v) {
  var b = emptyBook(); if (!v) return b;
  b.rev = v.rev || 0; b.openedOn = v.openedOn || v.opened_on || null; b.openingBookOn = v.openingBookOn || v.opening_book_on || null;
  (v.cases || []).forEach(function (a) { var r = {}; BOOK_COLS.forEach(function (k, i) { r[k] = a[i] == null ? null : a[i]; }); r.caseNumber = cnKey(r.caseNumber); r.products = r.products || []; b.cases[r.caseNumber] = r; });
  b.events = (v.events || []).map(function (a) { var e = {}; EVENT_COLS.forEach(function (k, i) { e[k] = a[i] == null ? null : a[i]; }); e.caseNumber = cnKey(e.caseNumber); return e; });
  return b;
}
/* FR-006: thin pulls are refused (BI) or need the quiet-day tick (S&M); a file with no VT line is refused. */
function guardUpload(kind, cases, lastCount, quietAck) {
  var G = R.guards;
  if (!cases) return { ok: false, reason: 'This file has no Vehicle Tracking lines.' };
  if (lastCount == null || !(lastCount > 0)) return { ok: true, reason: null };
  var share = kind === 'bi' ? G.thinBiShare : G.thinSmShare;
  if (cases >= share * lastCount) return { ok: true, reason: null };
  if (kind !== 'bi' && quietAck) return { ok: true, reason: 'Accepted as a genuine quiet day: ' + cases + ' cases against ' + lastCount + ' on the previous file.', quietDay: true };
  return { ok: false, reason: 'Refused as a thin pull: ' + cases + ' cases against ' + lastCount + ' on the previous ' + (kind === 'bi' ? 'BI file of this business month' : 'Scheduled & Missed file') + '.' };
}

/* ---------------------------------------------------------------- budgets ---- */
function budgetFor(cycleKey) {
  if (R.budgets[cycleKey]) return { cycle: cycleKey, b: R.budgets[cycleKey] };
  var earlier = sortedKeys(R.budgets).filter(function (k) { return k < cycleKey; });
  return earlier.length ? { cycle: earlier[earlier.length - 1], b: R.budgets[earlier[earlier.length - 1]] } : null;
}
function pick(tbl, sub, tenure) { var t = tbl && (tbl[sub] || tbl['*']); if (t == null) return null; if (typeof t === 'number') return t; return t[tenure] != null ? t[tenure] : (t['*'] != null ? t['*'] : null); }
function fitBudget(bud, sub, tenure) { return bud ? pick(bud.b.fitment, sub, tenure) : null; }
function missBudget(bud, sub) { return bud ? pick(bud.b.missed, sub, null) : null; }
function spdBudget(bud, sub, tenure) { return bud ? pick(bud.b.spd, sub, tenure) : null; }   // the Sales Review SPD budget (the list's Target should equal it — the validator checks, F2)

/* ---------------------------------------------------------------- counts → rates ---- */
function rates(c, wd) {
  var r = copy(c), s = c.sales;
  r.fitRate = s > 0 ? c.fitted / s : null; r.missRate = s > 0 ? c.missed / s : null; r.schedRate = s > 0 ? c.scheduled / s : null;
  r.spd = wd > 0 ? (c.current != null ? c.current : c.sales) / wd : null;
  return r;
}
function inWin(d, w) { return !!d && d >= w.from && d <= w.to; }
/* One window over a set of case facts. mtd=true: the in-play set (Current + Rollover); else the
   cohort sold in the window. Statuses are as at the model's asOf (cohort columns); fitments, missed
   appointments, due-to-fit and value count on their own dates (activity columns). */
function tally(facts, missEv, w, mtd, asOf) {
  var t = { sales: 0, fitted: 0, scheduled: 0, missed: 0, cancelled: R.status.cancelledFrom ? 0 : null, fitDone: 0, missAppt: 0, due: 0, value: 0 };
  if (mtd) { t.current = 0; t.rollover = 0; t.noSaleDay = 0; }
  var act = { from: w.from, to: minD(w.to, asOf) };
  for (var i = 0; i < facts.length; i++) {
    var f = facts[i], inSet = mtd ? f.inPlay : inWin(f.soldOn, w);
    if (inSet) {
      t.sales++; if (t[f.st] != null) t[f.st]++;
      if (mtd) { if (f.current) t.current++; else t.rollover++; if (!f.soldOn) t.noSaleDay++; }
    }
    if (f.st === 'fitted' && inWin(f.fittedOn, act)) { t.fitDone++; t.value += f.charge; }
    if (f.st === 'scheduled' && inWin(f.apptOn, w)) t.due++;
  }
  for (var j = 0; j < missEv.length; j++) if (inWin(missEv[j].apptOn, w)) t.missAppt++;
  t.value = round(t.value * R.vat, 2);
  return t;
}
function hrsAhead(facts, asAt) {
  var h = { total: 0 }, share = {}; R.periods.hrsAheadBuckets.forEach(function (b) { h[b.k] = 0; });
  facts.forEach(function (f) { if (f.st !== 'scheduled') return; var k = hrsBucket(f.apptOn, asAt); h.total++; if (k) h[k]++; });
  R.periods.hrsAheadBuckets.forEach(function (b) { share[b.k] = h.total ? h[b.k] / h.total : null; });
  h.share = share; return h;
}

/* ---------------------------------------------------------------- model ---- */
function statusAt(row, evs, date) {
  if (!evs || !evs.length) return row.firstSeen <= date ? row.status : null;
  var s = null; for (var i = 0; i < evs.length; i++) if (evs[i].onDate <= date) s = evs[i].to; return s;
}
function rosterFor(roster, key) {
  if (Array.isArray(roster)) return roster;
  var keys = sortedKeys(roster || {}).filter(function (k) { return k <= key; });
  return keys.length ? roster[keys[keys.length - 1]] : [];
}
/* model(book, roster | rosterByCycle, {asOf, cycleKey, isDataOnlyDay, aliases}) → the VT model of one
   business month: every spec §5 column at agent / team leader / sub-campaign / lead source / floor
   for MTD, each week and each day, plus each agent's rating. */
function model(book, roster, opts) {
  opts = opts || {};
  var latest = null; for (var cn0 in book.cases) latest = maxD(latest, book.cases[cn0].lastSeen);
  var asOf = opts.asOf || latest, cyc = opts.cycleKey ? cycleByKey(opts.cycleKey) : cycleOf(asOf);
  asOf = minD(asOf, cyc.to);
  var DO = opts.isDataOnlyDay, ros = rosterFor(roster, cyc.key), byCode = {};
  ros.forEach(function (r) { byCode[r.code] = r; });
  var trackFrom = maxD(cyc.from, book.openingBookOn ? cyc.from : (book.openedOn ? addDays(book.openedOn, 1) : cyc.from));
  var evBy = {}; (book.events || []).forEach(function (e) { (evBy[e.caseNumber] = evBy[e.caseNumber] || []).push(e); });
  for (var k0 in evBy) evBy[k0].sort(function (a, b) { return a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : 0; });
  var before = addDays(cyc.from, -1), OPEN = R.status.open, facts = [], missEv = [], unmatchedNames = {};
  sortedKeys(book.cases).forEach(function (cn) {
    var row = book.cases[cn], evs = evBy[cn], st = statusAt(row, evs, asOf);
    if (!st || (row.soldOn && row.soldOn > asOf)) return;
    var code = row.sellerCb && byCode[row.sellerCb] ? row.sellerCb : (row.sellerName ? resolveSeller(row.sellerName, ros, opts.aliases).code : null);
    var a = code ? byCode[code] : null, current = !!row.soldOn && row.soldOn >= cyc.from;
    var touched = (evs || []).some(function (e) { return e.onDate >= cyc.from && e.onDate <= asOf; });
    var inPlay = current || OPEN.indexOf(statusAt(row, evs, before)) > -1 || touched || inWin(row.fittedOn, { from: cyc.from, to: asOf }) || (!evs && row.lastSeen >= cyc.from);
    var f = { cn: cn, code: code, tl: a ? a.tlCode : null, sub: a ? a.sub : null, lead: leadSourceOf(row.partnerRaw, a ? a.sub : null), st: st,
      soldOn: row.soldOn, current: current, inPlay: inPlay, fittedOn: row.fittedOn, apptOn: row.apptOn, charge: +row.chargeEx || 0 };
    facts.push(f);
    if (!code && inPlay) unmatchedNames[row.sellerName || '(blank)'] = (unmatchedNames[row.sellerName || '(blank)'] || 0) + 1;
    (evs || []).forEach(function (e) { if (e.to === 'missed' && e.onDate <= asOf) missEv.push({ f: f, apptOn: e.apptOn }); });
  });
  var weeks = weeksOf(cyc), dates = [], hAsAt = hrsAsAt(asOf), bud = budgetFor(cyc.key);
  for (var d = cyc.from; d <= asOf; d = addDays(d, 1)) dates.push(d);
  var wd = function (a, b) { return a && b && a <= b ? workingDaysBetween(a, b, DO) : 0; };
  var mtdWin = { from: cyc.from, to: cyc.to };
  function windows(fs, ev, wdOf) {
    return {
      mtd: rates(tally(fs, ev, mtdWin, true, asOf), wdOf(cyc.from, asOf)),
      weeks: weeks.map(function (w) { var n = wdOf(w.from, minD(w.to, asOf)), r = rates(tally(fs, ev, w, false, asOf), n); r.k = w.k; r.from = w.from; r.to = w.to; r.wd = n; return r; }),
      days: dates.map(function (x) { var r = rates(tally(fs, ev, { from: x, to: x }, false, asOf), 0); r.d = x; return r; })
    };
  }
  var factsOf = function (pred) { return facts.filter(pred); }, evOf = function (pred) { return missEv.filter(function (e) { return pred(e.f); }); };
  var agents = ros.map(function (a) {
    var start = maxD(trackFrom, a.startDate), mine = function (f) { return f.code === a.code; }, fs = factsOf(mine);
    var W = windows(fs, evOf(mine), function (x, y) { return wd(maxD(x, start), y); });
    var fb = fitBudget(bud, a.sub, a.tenure), wdays = wd(start, asOf);
    var finishRow = function (r) { r.target = a.target; r.toTarget = a.target && r.spd != null ? r.spd / a.target : null; return r; };
    W.mtd = finishRow(W.mtd); W.mtd.fitBudget = fb; W.mtd.workingDays = wdays; W.weeks.forEach(finishRow);
    /* the agent split by lead source: MTD (leads), and each week / day (leadWeeks / leadDays, Phase E) so the lead-source
       filter shows agent rows on Weekly and Daily too. The digest carries only the MTD split (plan §P). */
    var leads = {}, leadWeeks = {}, leadDays = {}; fs.forEach(function (f) { leads[f.lead] = 1; });
    sortedKeys(leads).forEach(function (l) { var p = function (f) { return f.code === a.code && f.lead === l; }, lf = factsOf(p), le = evOf(p);
      leads[l] = rates(tally(lf, le, mtdWin, true, asOf), wdays);
      var LW = windows(lf, le, function (x, y) { return wd(maxD(x, start), y); }); leadWeeks[l] = LW.weeks.map(finishRow); leadDays[l] = LW.days; });
    var row = { code: a.code, name: a.name, tl: a.tl, tlCode: a.tlCode, sub: a.sub, tenure: a.tenure, role: a.role, target: a.target, startDate: a.startDate || null,
      workingDays: wdays, trackedDays: wdays, mtd: W.mtd, weeks: W.weeks, days: W.days, leads: leads, leadWeeks: leadWeeks, leadDays: leadDays };
    row.rating = rating(row, { cycleKey: cyc.key, asOf: asOf });
    row.rated = row.rating.rated;
    return row;
  });
  /* aggregates: sums of counts, rates = ratios of sums; % to target = Σ current of targeted agents ÷ Σ (target × their working days) */
  function agg(pred, members, extra) {
    var fs = factsOf(pred), W = windows(fs, evOf(pred), wd);
    var tg = members.filter(function (m) { return m.target > 0; });
    W.mtd.target = tg.length ? round(tg.reduce(function (s, m) { return s + m.target; }, 0), 2) : null;
    var den = tg.reduce(function (s, m) { return s + m.target * m.workingDays; }, 0);
    W.mtd.toTarget = den > 0 ? tg.reduce(function (s, m) { return s + (m.mtd.current || 0); }, 0) / den : null;
    W.weeks.forEach(function (w, i) { var dn = tg.reduce(function (s, m) { return s + m.target * m.weeks[i].wd; }, 0);
      w.target = W.mtd.target; w.toTarget = dn > 0 ? tg.reduce(function (s, m) { return s + m.weeks[i].sales; }, 0) / dn : null; });
    W.hrsAhead = hrsAhead(fs, hAsAt);
    for (var k in extra) W[k] = extra[k];
    return W;
  }
  var tls = {}; agents.forEach(function (a) { if (a.tlCode) (tls[a.tlCode] = tls[a.tlCode] || []).push(a); });
  var tlAgg = sortedKeys(tls).map(function (t) { var m = tls[t], codes = m.map(function (x) { return x.code; });
    return agg(function (f) { return codes.indexOf(f.code) > -1; }, m, { tlCode: t, tl: m[0].tl, subs: union(m.map(function (x) { return x.sub; })), agents: codes }); });
  var subAgg = {}; Object.keys(R.teams.keys).forEach(function (k) { var s = R.teams.keys[k];
    subAgg[s] = agg(function (f) { return f.sub === s; }, agents.filter(function (a) { return a.sub === s; }), { sub: s }); });
  var leadAgg = {}, lk = {}; facts.forEach(function (f) { lk[f.lead] = 1; });
  sortedKeys(lk).forEach(function (l) { leadAgg[l] = agg(function (f) { return f.lead === l; }, [], { lead: l, label: R.leadSources.labels[l] || l }); });
  Object.keys(R.leadSources.groups).forEach(function (g) { var mem = R.leadSources.groups[g];
    if (mem.length > 1 && !leadAgg[g]) leadAgg[g] = agg(function (f) { return mem.indexOf(f.lead) > -1; }, [], { lead: g, label: R.leadSources.labels[g] || g, members: mem }); });
  var floor = agg(function () { return true; }, agents, {});
  floor.unmatched = { sellers: Object.keys(unmatchedNames).length, cases: Object.keys(unmatchedNames).reduce(function (s, n) { return s + unmatchedNames[n]; }, 0), names: sortedKeys(unmatchedNames) };
  var period = { key: cyc.key, from: cyc.from, to: cyc.to, asOf: asOf, hrsAsAt: hAsAt };
  return {
    period: period, gaps: opts.receipts ? uploadGaps(opts.receipts, { period: period }, DO) : null,
    workingDays: wd(cyc.from, cyc.to), workingDaysElapsed: wd(trackFrom, asOf), trackFrom: trackFrom,
    weeks: weeks, dates: dates, agents: agents,
    notRated: agents.filter(function (a) { return !a.rated; }).map(function (a) { return { code: a.code, name: a.name, tl: a.tl, tlCode: a.tlCode, sub: a.sub, why: a.rating.why }; }),
    tlAgg: tlAgg, subAgg: subAgg, leadAgg: leadAgg, floor: floor,
    budgets: bud ? { cycle: bud.cycle, fitment: bud.b.fitment, missed: bud.b.missed, hrsShare: bud.b.hrsShare, spd: bud.b.spd } : null
  };
}

/* THE UPLOAD GAP (moved here from the page in Phase E, so the digest carries it to Agent Analytics): every working day
   (the engine's calendar) from the first committed upload — or the business month's start — to the figures' date on which
   a daily file was not committed. No file carries a sale date (A5), so a sale first seen on a later upload is counted on
   that later day; this says which days. receipts: vt_uploads rows {kind:'bi_fitted'|'sched_missed', state, extract_on}. */
var GAP_KINDS = { bi_fitted: 'BI Active Fitted', sched_missed: 'Scheduled & Missed' };
function uploadGaps(receipts, M, isDataOnlyDay) {
  var have = { bi_fitted: {}, sched_missed: {} }, first = null, out = [];
  (receipts || []).forEach(function (u) { if (!u || u.state !== 'committed' || !have[u.kind]) return; have[u.kind][u.extract_on] = 1; if (!first || u.extract_on < first) first = u.extract_on; });
  if (!first || !M || !M.period || !M.period.asOf) return out;
  for (var d = maxD(first, M.period.from); d <= M.period.asOf; d = addDays(d, 1)) {
    if (!isWorkingDay(d, isDataOnlyDay)) continue;
    var miss = Object.keys(GAP_KINDS).filter(function (k) { return !have[k][d]; }).map(function (k) { return GAP_KINDS[k]; });
    if (miss.length) out.push({ date: d, missing: miss });
  }
  return out;
}

/* ---------------------------------------------------------------- rating (spec §6) ---- */
function bandOf(score) { if (score == null) return null; var B = R.rating.bands; for (var i = 0; i < B.length; i++) if (score >= B[i].min) return B[i]; return B[B.length - 1]; }
function driverInputs(k, a, bud) {
  var m = a.mtd || {}, G = R.rating, hasT = a.target > 0, days = (a.trackedDays || 0) >= G.minTrackedDays, cases = (m.sales || 0) >= G.minCases;
  var fb = fitBudget(bud, a.sub, a.tenure);
  if (k === 'targetAch') return { value: m.spd, target: hasT ? a.target : null, evidence: hasT && days, why: !hasT ? 'no target' : !days ? 'fewer than ' + G.minTrackedDays + ' tracked working days' : null };
  if (k === 'fitRate') return { value: m.fitRate, target: fb, evidence: cases && fb != null, why: !cases ? 'fewer than ' + G.minCases + ' sales in play' : fb == null ? 'no fitment budget' : null };
  if (k === 'missRate') { var mb = missBudget(bud, a.sub); return { value: m.missRate, target: mb, evidence: cases && mb != null, why: !cases ? 'fewer than ' + G.minCases + ' sales in play' : mb == null ? 'no missed budget' : null }; }
  var t = hasT && fb != null ? round(a.target * (a.workingDays || 0) * fb, 3) : null;
  return { value: m.fitDone, target: t, evidence: t != null && t > 0 && days, why: !hasT ? 'no target' : fb == null ? 'no fitment budget' : !days ? 'fewer than ' + G.minTrackedDays + ' tracked working days' : null };
}
/* rating(agentRow, {cycleKey, asOf}) — points start at half of target, unmeasured drivers renormalise,
   effective weights published (FR-042), no penalties, no ranking. */
function rating(a, ctx) {
  var G = R.rating, F = G.floor, cyc = cycleByKey(ctx.cycleKey), bud = budgetFor(ctx.cycleKey);
  var base = { rated: false, why: null, score: null, adj: null, band: null, nextBand: null, parts: [], weightScored: 0, unmeasured: [], weakest: null, onTarget: null, measuredCount: 0,
    window: { from: cyc.from, to: ctx.asOf || null }, budgetCycle: bud ? bud.cycle : null };
  if (R.teams.notRated.indexOf(a.sub) > -1) { base.why = 'scheduling'; return base; }
  if (((a.mtd || {}).sales || 0) < G.minInPlayToRate) { base.why = 'nodata'; return base; }
  var parts = G.drivers.map(function (d) {
    var x = driverInputs(d.k, a, bud), v = x.value, t = x.target, att = null;
    if (v != null && t != null) att = d.dir === 'lower' ? (v === 0 ? 1 : clamp01(t / v)) : (t > 0 ? clamp01(v / t) : null);
    var measured = !!x.evidence && att != null;
    return { k: d.k, label: d.label, w: d.w, dir: d.dir, value: v, target: t, measured: measured, shown: true, att: att,
      points: measured ? round(d.w * clamp01((att - F) / (1 - F)), 1) : null,
      onTarget: v == null || t == null ? null : d.dir === 'lower' ? v <= t : v >= t, note: d.note, why: measured ? null : (x.why || 'no value yet') };
  });
  var ws = parts.reduce(function (s, p) { return s + (p.measured ? p.w : 0); }, 0), raw = parts.reduce(function (s, p) { return s + (p.measured ? p.points : 0); }, 0);
  parts.forEach(function (p) { p.weff = p.measured ? round(p.w / ws * 100, 1) : null; p.pointsEff = p.measured ? round(p.points * 100 / ws, 1) : null;
    p.available = p.measured ? round(p.weff - p.pointsEff, 1) : null; });
  base.parts = parts; base.weightScored = ws; base.unmeasured = parts.filter(function (p) { return !p.measured; }).map(function (p) { return p.k; });
  if (!ws) { base.why = 'nodata'; return base; }
  var score = round(Math.min(100, raw / ws * 100), 1), band = bandOf(score), B = G.bands, i = B.indexOf(band);
  base.rated = true; base.score = score; base.adj = score; base.band = band.label;
  base.nextBand = i > 0 ? { label: B[i - 1].label, min: B[i - 1].min, gap: round(B[i - 1].min - score, 1) } : null;
  var best = null; parts.forEach(function (p) { if (p.measured && (!best || p.available > best.available)) best = p; });
  base.weakest = best ? best.k : null;
  base.onTarget = parts.filter(function (p) { return p.measured && p.onTarget; }).length; base.measuredCount = parts.filter(function (p) { return p.measured; }).length;   // the card's "n of your m drivers" (Phase E)
  return base;
}

/* ---------------------------------------------------------------- digest (plan §P) ---- */
function driversOnce() { return R.rating.drivers.map(function (d) { return { k: d.k, label: d.label, w: d.w, dir: d.dir, note: d.note }; }); }
/* THE PUBLISHED SHAPE (size: a full business month of ~48 agents is ~530 KB as objects, ~85 % of it day rows). So every
   days[] in the digest is COLUMNAR — one array per day in the order of the top-level dayCols — and every fraction is kept
   to six decimals (a rate is printed to 0.1 %). The agent row drops the weekly / daily lead-source splits (PULSE's pages
   only) and the per-agent driver labels and notes, which travel once in drivers. Nothing is recomputed: values are carried. */
var DAY_COLS = ['d', 'sales', 'fitted', 'scheduled', 'missed', 'cancelled', 'fitDone', 'missAppt', 'due', 'value', 'fitRate', 'missRate', 'schedRate'];
function six(v) { return typeof v === 'number' && v % 1 !== 0 ? Math.round(v * 1e6) / 1e6 : v; }
function dayCells(x) { return DAY_COLS.map(function (k) { return x[k] == null ? null : six(x[k]); }); }
function compact(o) {
  if (Array.isArray(o)) return o.map(compact);
  if (!o || typeof o !== 'object') return six(o);
  var r = {}; for (var k in o) r[k] = k === 'days' && Array.isArray(o[k]) ? o[k].map(dayCells) : compact(o[k]);
  return r;
}
function digestRow(a) {
  var r = {}; for (var k in a) if (k !== 'leadWeeks' && k !== 'leadDays') r[k] = a[k];
  r.rating = copy(a.rating); r.rating.parts = (a.rating.parts || []).map(function (p) { var q = copy(p); delete q.label; delete q.note; return q; });
  return r;
}
/* digest(model, {updatedAt}) — `empty` is DERIVED (no in-play sale anywhere on the floor), never the caller's say-so */
function digest(M, opts) {
  opts = opts || {};
  var fl = M.floor && M.floor.mtd, empty = !(fl && fl.sales > 0) && !M.agents.some(function (a) { return a.mtd && a.mtd.sales > 0; });
  return { scorecard: 'vt', version: R.version, rulesVersion: R.version, period: M.period, empty: empty, updatedAt: opts.updatedAt || null,
    workingDays: M.workingDays, workingDaysElapsed: M.workingDaysElapsed, trackFrom: M.trackFrom, weeks: M.weeks, dates: M.dates, drivers: driversOnce(),
    agents: compact(M.agents.map(digestRow)), notRated: M.notRated, tlAgg: compact(M.tlAgg), subAgg: compact(M.subAgg), leadAgg: compact(M.leadAgg),
    floor: compact(M.floor), budgets: M.budgets, gaps: M.gaps || null, dayCols: DAY_COLS, minima: { cases: R.rating.minCases, trackedDays: R.rating.minTrackedDays, floor: R.rating.floor } };
}
function emptyCyclePayload(cycleKey, opts) {
  var c = cycleByKey(cycleKey), bud = budgetFor(cycleKey);
  return { scorecard: 'vt', version: R.version, rulesVersion: R.version, period: { key: c.key, from: c.from, to: c.to, asOf: null, hrsAsAt: null }, empty: true,
    updatedAt: (opts && opts.updatedAt) || null, workingDays: workingDaysBetween(c.from, c.to), workingDaysElapsed: null, weeks: weeksOf(c), dates: [],
    drivers: driversOnce(), agents: [], notRated: [], tlAgg: [], subAgg: {}, leadAgg: {},
    floor: { mtd: null, weeks: [], days: [], hrsAhead: null, unmatched: null }, trackFrom: null, gaps: null, dayCols: DAY_COLS, minima: { cases: R.rating.minCases, trackedDays: R.rating.minTrackedDays, floor: R.rating.floor },
    budgets: bud ? { cycle: bud.cycle, fitment: bud.b.fitment, missed: bud.b.missed, hrsShare: bud.b.hrsShare, spd: bud.b.spd } : null };
}

return {
  VT_RULES: VT_RULES, version: R.version, saHolidaysFor: saHolidaysFor, periods: periods, serialToISO: serialToISO, normCB: normCB,
  detect: detect, extractDate: extractDate, parseBi: parseBi, parseSm: parseSm, parseOpeningBook: parseOpeningBook, parseRoster: parseRoster,
  normSeller: normSeller, resolveSeller: resolveSeller, leadSourceOf: leadSourceOf, leadGroupOf: leadGroupOf, subOf: subOf,
  emptyBook: emptyBook, merge: merge, bookFromRpc: bookFromRpc, guardUpload: guardUpload,
  rates: rates, model: model, rating: rating, bandOf: bandOf, digest: digest, emptyCyclePayload: emptyCyclePayload, uploadGaps: uploadGaps,
  budgetFor: budgetFor, spdBudget: spdBudget
};
});
