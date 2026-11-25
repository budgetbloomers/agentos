/* VT PAGES — Vehicle Tracking in PULSE (Spec Kit 071, specs/071-vehicle-tracking-analytics/).
 *
 * THIS HALF (Phase C) IS THE UPLOAD STATION INTAKE: the three VT files are read IN THE BROWSER, the engine
 * (vt-engine.js, window.VTEngine) parses them and drops every customer field (FR-007), merges them into the case book,
 * and only the changed case rows + status events go to the Worker (begin → stage × n → commit, compare-and-set on the
 * book revision, FR-008). Nothing here computes a figure: the engine decides, this file carries and paints.
 * The report half (Phase D) is added below the marker at the end of the file.
 *
 * ISOLATION FROM VAS (FR-004): a VT file never reaches INGEST, regFile, save(), archiveUpload (the relay) or the Rake.
 * PULSE calls VTStation.kindOfSheets() before any sheet is ingested and hands the whole file here; vas-state is not
 * touched (verify-vt-isolation.mjs proves it byte for byte).
 *
 * Loads two ways (the companion-file pattern, plan D1): <script src="vt-pages.js" data-inline> in PULSE (works from
 * file://; tools/prepare-site.js inlines it) → window.VTStation, and require() in the Node suites → module.exports
 * (only the pure helpers are used there; every DOM / network function takes its environment at call time).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTStation = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

var API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
var STAGE_ROWS = 1000;                 // rows per stage call (plan DB-3)
var STAGE_BYTES = 480 * 1024;          // and under the Worker's 512 KB stage cap, with headroom
var MAX_TRIES = 3;                     // FR-008: a conflict re-reads, re-merges and retries up to 3 times
/* THE THREE VT SLOTS (spec 072 U-2). 'VT · Schedulers Data' REPLACED 'VT · Opening book (once)': the same sheet of the
   same master report, now read for the three facts the daily exports do not carry (Scheduler, GWP, true sale date)
   instead of the sale date alone, and re-uploadable instead of once-only. The old DB kind 'opening_book' is still legal
   in the database and still names itself on the receipts already stored (KIND below) - nothing historical stops reading. */
var DB_KIND = { vtBiFitted: 'bi_fitted', vtSchedMissed: 'sched_missed', vtSchedulers: 'schedulers_data' };
var LABEL = { vtBiFitted: 'VT · BI Active Fitted', vtSchedMissed: 'VT · Scheduled & Missed', vtSchedulers: 'VT · Schedulers Data' };
var REFUSE_DATING_FIRST = 'Load the Schedulers Data file after the first day\'s two files (BI Active Fitted and Scheduled & Missed). '
  + 'It only adds the scheduler, the GWP and the sale date to cases that are already in the book, so on an empty book it has nothing to date.';
/* the retired slot\'s name still answers, for anything that already asked for it */
var REFUSE_OPENING_FIRST = REFUSE_DATING_FIRST;

var GUARD_KIND = { vtBiFitted: 'bi', vtSchedMissed: 'sm', vtSchedulers: 'schedulers' };
function E() { return root.VTEngine || (typeof require === 'function' ? require('./vt-engine.js') : null); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function num(n) { return n == null ? '—' : Number(n).toLocaleString('en-ZA'); }
function sastToday(nowMs) { return new Date((nowMs == null ? Date.now() : nowMs) + 2 * 3600000).toISOString().slice(0, 10); }

/* ---------------------------------------------------------------- pure helpers (Node-tested) ---- */
/* engine row → the vt_cases columns (plan DB-2). The Worker and SQL never see a field the engine did not keep. */
function caseRowToDb(r) {
  return { case_number: String(r.caseNumber), status: r.status, status_on: r.statusOn, sold_on: r.soldOn, sold_basis: r.soldBasis,
    first_seen: r.firstSeen, last_seen: r.lastSeen, appt_on: r.apptOn, fitted_on: r.fittedOn, sm_attempt: r.smAttempt,
    products: r.products || [], bundle: r.bundle, charge_ex: r.chargeEx, partner_raw: r.partnerRaw, lead_source: r.leadSource,
    seller_name: r.sellerName, seller_cb: r.sellerCb, seller_match: r.sellerMatch, cancel_reason: r.cancelReason || null,
    /* Schedulers Data's own seven (spec 072 DB-3). A BI or Scheduled & Missed row sends them as null and the SQL
       coalesces, so a daily upload never blanks what the Schedulers Data upload set (plan risk 3). */
    scheduler_name: r.schedulerName == null ? null : r.schedulerName, scheduler_cb: r.schedulerCb == null ? null : r.schedulerCb,
    gwp_rpt: r.gwpRpt == null ? null : r.gwpRpt, referring_name: r.referringName == null ? null : r.referringName,
    referring_cb: r.referringCb == null ? null : r.referringCb, campaign_rpt: r.campaignRpt == null ? null : r.campaignRpt,
    result_rpt: r.resultRpt == null ? null : r.resultRpt };
}
function eventToDb(e) { return { case_number: String(e.caseNumber), on_date: e.onDate, from_status: e.from, to_status: e.to, appt_on: e.apptOn, reason: e.reason || null }; }
/* rows → stage batches: ≤ STAGE_ROWS rows and ≤ STAGE_BYTES of JSON each; ord is the row's position in the upload */
function batches(rows, maxRows, maxBytes) {
  maxRows = maxRows || STAGE_ROWS; maxBytes = maxBytes || STAGE_BYTES;
  var out = [], cur = [], bytes = 2, from = 0;
  rows.forEach(function (r, i) {
    var b = JSON.stringify(r).length + 1;
    if (cur.length && (cur.length >= maxRows || bytes + b > maxBytes)) { out.push({ from: from, rows: cur }); cur = []; bytes = 2; from = i; }
    cur.push(r); bytes += b;
  });
  if (cur.length) out.push({ from: from, rows: cur });
  return out;
}
/* vt_roster_at() → the engine's roster (FR-018). sub comes from the engine's own parse of the list's campaign cell. */
function rosterFromRpc(v) {
  var eng = E(), rows = (v && v.rows) || [];
  return rows.map(function (r) {
    var t = r.target == null ? null : Number(r.target);
    return { code: eng.normCB(r.code) || r.code, name: r.name || null, sf: r.sf || null, tl: r.tl || null, tlCode: eng.normCB(r.tl_code) || null,
      sub: eng.subOf(r.campaign_raw), campaignRaw: r.campaign_raw || null, tenure: r.tenure || null, role: null,
      target: t > 0 ? t : null, startDate: r.start_date || null, asOf: r.as_of || (v && v.as_of) || null };
  }).filter(function (r) { return r.code; });
}
/* file:// / Worker unreachable: PULSE's own roster rows of campaign VT. The sub-campaign is not in S.roster (the
   ingest folds it away), so it is unknown — the receipt says so (C7). */
function rosterFromPulse(rows) {
  var eng = E();
  return (rows || []).filter(function (a) { return a && String(a.campaign || '').toUpperCase() === 'VT'; }).map(function (a) {
    var t = typeof a.target === 'number' ? a.target : parseFloat(a.target);
    return { code: eng.normCB(a.code) || a.code, name: a.name || null, sf: a.sf || null, tl: a.tl || null, tlCode: null, sub: null,
      campaignRaw: null, tenure: a.tenure || null, role: null, target: t > 0 ? t : null, startDate: a.start || null, asOf: null };
  });
}
/* the header row of a sheet's text (PULSE's "### Sheet:" CSV): the first row with two or more cells */
function headerOf(text) {
  var lines = String(text || '').slice(0, 65536).split(/\r?\n/);
  for (var i = 0; i < lines.length && i < 20; i++) {
    var line = lines[i], delim = line.split('\t').length > line.split(',').length ? '\t' : ',';
    var cells = [], f = '', q = false;
    for (var j = 0; j < line.length; j++) {
      var c = line[j];
      if (q) { if (c === '"') { if (line[j + 1] === '"') { f += '"'; j++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === delim) { cells.push(f); f = ''; } else f += c;
    }
    cells.push(f);
    if (cells.filter(function (x) { return String(x).trim(); }).length >= 2) return cells.map(function (x) { return String(x).trim(); });
  }
  return [];
}
/* {sheetName: text} → {kind, sheet} for the first VT sheet, else null. `detect` is PULSE's detectType (VT rules first). */
function kindOfSheets(sheets, detect) {
  var d = detect || function (h, sn) { return E().detect(h, sn); };
  var names = Object.keys(sheets || {});
  for (var i = 0; i < names.length; i++) {
    var k = d(headerOf(sheets[names[i]]), names[i], []);
    if (k && DB_KIND[k]) return { kind: k, sheet: names[i] };
  }
  return null;
}
/* the workbook's sheets as arrays of arrays with RAW cells — date serials stay numbers (the engine refuses text dates) */
function workbookAoa(buf, XLSX) {
  var wb = XLSX.read(buf, { type: 'array' }), out = {};
  wb.SheetNames.forEach(function (n) { out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }); });
  return out;
}
function parseFor(kind, aoa) { var eng = E(); return kind === 'vtBiFitted' ? eng.parseBi(aoa) : kind === 'vtSchedMissed' ? eng.parseSm(aoa) : eng.parseSchedulers(aoa); }
/* the case count the thin-pull guard compares with (FR-006): BI = the last BI of the same business month; S&M = the
   last S&M; Schedulers Data = the last Schedulers Data file, whichever month it was loaded in (the sheet is the whole
   history, so its case count only ever grows - a sudden short file is a bad export, spec 072 U-6). */
function lastCountFor(kind, cycleKey, receipts) {
  var want = DB_KIND[kind], hit = (receipts || []).filter(function (u) { return u.state === 'committed' && u.kind === want && (kind !== 'vtBiFitted' || u.cycle_key === cycleKey); })
    .sort(function (a, b) { return String(b.extract_on).localeCompare(String(a.extract_on)) || (b.id - a.id); })[0];
  return hit && hit.counts && hit.counts.cases != null ? hit.counts.cases : null;
}
/* one merge, turned into what the Worker carries: stage rows (PII-free by construction) and the commit's arguments */
function planCommit(book, parsed, ctx) {
  /* ctx.receipts: the committed uploads read AFTER this book (derived cancellation, R1) — absent, nothing is cancelled */
  var m = E().merge(book, parsed, { extractOn: ctx.extractOn, roster: ctx.roster, aliases: ctx.aliases || {}, receipts: ctx.receipts });
  var cases = m.cases.map(caseRowToDb), events = m.events.map(eventToDb);
  return { merged: m, cases: cases, events: events,
    commit: { p_base_rev: book.rev || 0, p_counts: m.counts, p_unmatched: m.unmatched, p_warnings: m.warnings.concat(ctx.warnings || []),
      p_quiet_ack: !!ctx.quietAck, p_cases: cases.length, p_events: events.length } };
}
function listWarning(rv) {
  return 'the newest Agent List (' + rv.list_as_of + ') has no Vehicle Tracking rows, so this upload used the VT list of ' + rv.as_of
    + '. Load an Agent List that keeps the VT sheet, or the VT agents stay as they were on ' + rv.as_of + '.';
}
function receiptLines(r) {
  var c = r.counts || {}, lines = [];
  lines.push(LABEL[r.kind] + ' · ' + r.fileName);
  lines.push('Extract date ' + r.extractOn + (r.assumed ? ' (assumed: the file name carries no ddmmyy date)' : ''));
  if (r.kind === 'vtSchedulers') {
    /* WHAT THE FILE CHANGED, AND WHAT IT DID NOT (spec 072 B5). Every line is a count the merge returned. */
    var rd = c.redated || {};
    lines.push(num(c.cases) + ' cases read from the sheet' + (c.skippedBlank ? ' · ' + num(c.skippedBlank) + ' empty rows counted and skipped' : '')
      + ' · ' + num(c.changed) + ' case rows changed');
    lines.push('Sale dates re-stated: ' + num(c.changed === 0 ? 0 : (rd.from_first_seen || 0) + (rd.from_unknown || 0) + (rd.from_opening_book || 0))
      + ' (from the upload day ' + num(rd.from_first_seen || 0) + ' · from go-live, undated ' + num(rd.from_unknown || 0)
      + ' · from the retired opening book ' + num(rd.from_opening_book || 0) + ') · unchanged ' + num(rd.unchanged || 0));
    lines.push('Schedulers set: ' + num(c.schedulersSet) + ' · GWP set: ' + num(c.gwpSet) + ' · referrers set: ' + num(c.referrersSet));
    var ds = r.disagree || {}, byd = ds.byDirection || {};
    lines.push('Where this sheet disagrees with the daily exports: ' + num(ds.total || 0) + ' case' + ((ds.total || 0) === 1 ? '' : 's')
      + (Object.keys(byd).length ? ' (' + Object.keys(byd).sort().map(function (k) { return k + ': ' + num(byd[k]); }).join(' · ') + ')' : '')
      + ' — counted and shown on the VT Report, never applied.');
    lines.push('Business months this file reaches: ' + ((r.cycles || []).length ? (r.cycles || []).map(function (x) { return x.key + ' (' + num(x.cases) + (x.partial ? ', part of the month' : '') + ')'; }).join(' · ') : '—')
      + '. Each one can now be read on the VT Report; the published copy of a closed month is refreshed by the republish tool, not from here.');
    var us = r.unmatchedSchedulers || [];
    lines.push('Schedulers not on the Agent List: ' + (us.length ? us.map(function (u) { return u.name + ' (' + u.cases + ')'; }).join(', ') + ' — counted under the name as typed, never guessed' : 'none'));
    lines.push('Cases named here that are not in the book yet: ' + num(c.notInBook) + ' — counted, never invented.');
    lines.push('NOT changed by this file: no status (Fitted / Scheduled / Missed / Cancelled stays as the daily exports decided), no VAS figure, no agent score.');
  } else {
    lines.push((r.kind === 'vtBiFitted' ? 'VT lines ' + num(c.vtLines) + ' of ' + num(c.rows) + ' rows' : num(c.vtLines) + ' rows') + ' · cases ' + num(c.cases)
      + (c.skippedFooter || c.skippedBlank ? ' · skipped ' + num((c.skippedFooter || 0) + (c.skippedBlank || 0)) + ' footer/blank rows' : ''));
    lines.push('New ' + num(c['new']) + ' · to Fitted ' + num(c.toFitted) + ' · to Missed ' + num(c.toMissed) + ' · to Scheduled ' + num(c.toScheduled)
      + (c.toCancelled != null ? ' · to Cancelled ' + num(c.toCancelled) : ''));
    if (c.cancelledDropped) lines.push('Cancelled — dropped out of both files of ' + r.extractOn + ': ' + num(c.cancelledDropped) + ' open sale' + (c.cancelledDropped === 1 ? '' : 's') + ' (inferred: in neither the BI Active Fitted nor the Scheduled & Missed file of that day)');
    if (c.cancelledDeactivated) lines.push('Cancelled — contract deactivated in the BI file: ' + num(c.cancelledDeactivated));
    if (c.reappeared) lines.push('Back from Cancelled (seen again in this file): ' + num(c.reappeared));
    if (r.cancelNote) lines.push(r.cancelNote);
    var un = r.unmatched || [];
    lines.push('Sellers unmatched: ' + (un.length ? un.map(function (u) { return u.name + ' (' + u.cases + ')'; }).join(', ') : 'none'));
  }
  if (r.rosterFallback) lines.push('Agent List read from this page (the server roster was unreachable): sub-campaigns are unknown on this receipt');
  if (r.quietDay) lines.push('Accepted as a genuine quiet day (ticked by the uploader)');
  (r.warnings || []).forEach(function (w) { lines.push('Warning: ' + w); });
  lines.push('VAS money unchanged');
  return lines;
}

/* ---------------------------------------------------------------- the Worker ---- */
function call(env, method, p, body) {
  var tk = null; try { tk = root.sessionStorage && root.sessionStorage.getItem('cbx_token'); } catch (e) { tk = null; }
  var h = { 'X-Cbx-Client': 'v5' }; if (tk) h.Authorization = 'Bearer ' + tk; if (body != null) h['Content-Type'] = 'application/json';
  return (env.fetch || root.fetch)((root.__vtApiBase || API) + p, { method: method, headers: h, body: body == null ? undefined : JSON.stringify(body) })
    .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { status: r.status, ok: r.ok, j: j }; }); });
}
/* THE WORKER'S REFUSALS, IN WORDS (review fixes, Phase E). vt.mjs answers a named refusal as 409 {error:<code>, detail},
   a check violation as 409 bad_row, and anything else as 502 vt_<step>_failed — the uploader reads a sentence, never a code. */
var WORDS = {
  busy: 'This file is being loaded by another station or tab right now. Nothing was sent from here — try again in a few minutes.',
  version_conflict: 'The Vehicle Tracking book changed while this file was being saved.',
  bad_extract_on: 'The date in the file name is out of range (more than a few days ahead, or before Vehicle Tracking began). Rename the file with its real extract date (ddmmyy) and drop it again.',
  bad_cycle_key: 'The business month worked out from the file name is not one the server accepts. Check the date in the file name (ddmmyy).',
  bad_date: 'A date in the file is not a real calendar date, or is out of range. Export the file again and drop it.',
  bad_file_name: 'The file name is empty, too long, or has characters the server refuses. Rename it (for example "BI Active Fitted 101126.xlsx") and drop it again.',
  bad_row: 'A row in the file broke one of the database\'s rules, so nothing was saved. Export the file again; if it keeps happening, send the file to the support team.',
  duplicate_case: 'The same case number was sent twice in this upload, so nothing was saved. Drop the file again.',
  duplicate_event: 'The same status change was sent twice in this upload, so nothing was saved. Drop the file again.',
  bad_cancel: 'This upload would have marked sales cancelled for a day that is not complete on the server (its other file is missing, or a newer day is already complete). Nothing was saved — drop the file again.',
  too_many_uploads: 'Too many Vehicle Tracking uploads are being loaded at the same time. Wait for the others to finish, then drop this file again.',
  upload_too_large: 'This file carries more rows than one upload may hold. Export a smaller date range and load it in parts.',
  commit_too_large: 'This upload changes more cases than one save may carry. Export a smaller date range and load it in parts.',
  batch_too_large: 'A part of this upload was larger than the server takes in one call. Drop the file again.',
  stage_incomplete: 'Not every part of the upload reached the server, so nothing was saved. Drop the file again.',
  not_staging: 'This upload was already finished or abandoned on the server. Drop the file again.',
  unknown_upload: 'The server no longer knows this upload (it may have been cleared). Drop the file again.',
  not_owner: 'This upload was started by another account, so this account may not finish it. Wait a few minutes and drop the file again.',
  bad_receipt: 'The upload\'s receipt was not in the shape the server keeps. Refresh the page and drop the file again.',
  bad_user: 'The server could not tell who is uploading. Sign out, sign in again and drop the file again.',
  rows_not_array: 'A part of the upload was not in the shape the server keeps. Refresh the page and drop the file again.'
};
var STEP_WORDS = { begin: 'start the upload', stage: 'take the rows', commit: 'save the upload', abandon: 'cancel the upload', book: 'read the case book', roster: 'read the Agent List', uploads: 'read the receipts' };
function wordsFor(r) {
  var code = r && r.j && r.j.error ? String(r.j.error) : '', m = /^vt_(\w+)_failed$/.exec(code);
  if (WORDS[code]) return WORDS[code];
  if (m) return 'The server could not ' + (STEP_WORDS[m[1]] || m[1]) + ' just now. Nothing was saved — try again in a minute.';
  if (r && r.status === 413) return 'Too much was sent in one call. Drop the file again.';
  if (r && (r.status === 401 || r.status === 403)) return 'This sign-in may not load Vehicle Tracking files (it needs the Upload Station). Sign in again or ask an admin.';
  return code ? code : 'the server answered ' + (r ? r.status : '?');
}
function must(r, what) { if (!r.ok || !r.j) { var e = new Error(what + ' failed: ' + wordsFor(r)); e.status = r.status; e.code = r.j && r.j.error; throw e; } return r.j; }
/* THE MERGE READ IN PARTS (review fix 4): POST /api/vt/book is capped at 256 KB (≈ 20k case numbers), so above ALSO_CHUNK
   the file's case numbers go in parts; the books are united by case number and must all be the same revision, else the
   book moved mid-read and the caller retries (a conflict, exactly as a commit's). */
var ALSO_CHUNK = 15000;
async function readBook(env, from, cns) {
  var eng = E(), parts = [];
  for (var i = 0; i < cns.length; i += ALSO_CHUNK) parts.push(cns.slice(i, i + ALSO_CHUNK));
  if (!parts.length) parts.push([]);
  var books = [];
  for (var p = 0; p < parts.length; p++) books.push(eng.bookFromRpc(must(await call(env, 'POST', '/api/vt/book', { p_from: from, p_also: parts[p] }), 'Reading the VT book')));
  if (books.length === 1) return books[0];
  if (books.some(function (b) { return b.rev !== books[0].rev; })) return null;
  var out = books[0], seen = {};
  out.events.forEach(function (e) { seen[JSON.stringify(e)] = 1; });
  books.slice(1).forEach(function (b) {
    for (var cn in b.cases) out.cases[cn] = b.cases[cn];
    b.events.forEach(function (e) { var k = JSON.stringify(e); if (!seen[k]) { seen[k] = 1; out.events.push(e); } });
  });
  return out;
}

/* ---------------------------------------------------------------- the page (DOM) ---- */
function doc() { return root.document || null; }
function toast(msg, kind, ms) { if (typeof root.toast === 'function') root.toast(msg, kind, ms); }
function banner(text, actions) {
  var d = doc(); if (!d) return;
  var el = d.getElementById('vtBanner');
  if (!text) { if (el) el.remove(); return; }
  if (!el) { el = d.createElement('div'); el.id = 'vtBanner'; el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:16px;right:16px;top:12px;z-index:9999;background:#b42318;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    d.body.appendChild(el); }
  el.innerHTML = '<b>Vehicle Tracking upload not saved.</b> ' + esc(text) + ' ' + (actions || '')
    + ' <button type="button" class="btn small" style="margin-left:8px" onclick="this.parentNode.remove()">Dismiss</button>';
}
function showReceipt(r) {
  var d = doc(); root.__vtReceipts = [r].concat(root.__vtReceipts || []).slice(0, 10);
  if (!d) return;
  var box = d.getElementById('vtReceiptCard');
  if (!box) { box = d.createElement('div'); box.id = 'vtReceiptCard'; box.className = 'card mt';
    var host = d.getElementById('vtStation'); (host || d.body).appendChild(box); }
  box.innerHTML = '<div class="cardhead"><div><h3>Vehicle Tracking receipt</h3></div></div><ul class="vt-receipt">'
    + receiptLines(r).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
}
/* the three VT cards: their own group under the VAS slots, so the VAS cards (and their layout guard) are unchanged */
function slotsHtml() {
  var cards = [['vtBiFitted', 'The daily BI Active Fitted export. Only the Vehicle Tracking lines are kept (Unit Type BEAME, MXV or Matrix Vision); every VAS line and every customer field stays in this browser. It never touches VAS money.'],
    ['vtSchedMissed', 'The daily Scheduled & Missed export: open fitment bookings and missed appointments. Mobile numbers, registrations and chassis numbers are dropped before anything is sent.'],
    ['vtSchedulers', 'The Schedulers Data sheet of the master VT report: the scheduler, the GWP and the true sale date for every case. Upload it whenever the master is updated — it may be re-uploaded as often as you like. It never changes a status: the daily exports decide those, and where the sheet disagrees the receipt says so. Load it after the first two daily files — it can only add to cases that are already in the book.']];
  return '<div class="card mt" id="vtStation"><div class="cardhead"><div><h3>Vehicle Tracking</h3><div class="sub">Vehicle Tracking files keep their own case book. They never change a VAS figure.</div></div></div>'
    + '<div class="slots vt-slots">' + cards.map(function (c) {
      return '<div class="slot vtslot" data-vtslot="' + c[0] + '" tabindex="0" role="button" aria-label="Upload ' + esc(LABEL[c[0]]) + '"'
        + ' onclick="VTStation.pick(\'' + c[0] + '\')" ondragover="event.preventDefault()" ondrop="VTStation.drop(event,\'' + c[0] + '\')">'
        + '<div class="shead"><b>' + esc(LABEL[c[0]]) + '</b><button type="button" class="btn small spick">Choose file</button></div>'
        + '<div class="sdesc">' + esc(c[1]) + '</div></div>'; }).join('') + '</div></div>';
}
function pick(kind) { var d = doc(); if (!d) return; root.__slotExpected = kind; var fi = d.getElementById('fileInput'); if (fi) fi.click(); }
function drop(ev, kind) { ev.preventDefault(); if (typeof root.handleFiles === 'function') root.handleFiles(ev.dataTransfer.files, kind); }

/* ---------------------------------------------------------------- intake (C6) ---- */
/* ingest(name, buf, hash, expected, found, opts) → Promise<true|false>. `found` = kindOfSheets()'s answer.
   opts: {quietAck, fetch, now, XLSX, pulseRoster}. Every refusal says why, in words, and writes nothing. */
async function ingest(name, buf, hash, expected, found, opts) {
  opts = opts || {}; var env = { fetch: opts.fetch }, eng = E(), kind = found.kind;
  var fail = function (msg, actions) { banner(msg, actions); toast(name + ': ' + msg, 'err', 20000); return false; };
  if (expected && expected !== kind) toast('Heads up: "' + name + '" is actually ' + LABEL[kind] + ' — filed there instead', 'err', 9000);
  if (!/^[0-9a-f]{64}$/.test(String(hash || ''))) return fail('This browser could not fingerprint the file (it needs a secure https page). Nothing was sent.');
  try {
    var rec = must(await call(env, 'GET', '/api/vt/uploads?limit=60'), 'Reading the VT receipts');
    var seen = (rec.uploads || []).filter(function (u) { return u.sha256 === hash && u.state === 'committed'; })[0];
    /* A DUPLICATE IS THE COMMONEST "nothing happened" (25 Nov 2026, the owner: "I uploaded again nothing").
       The fingerprint is the file's BYTES, so renaming yesterday's export to today's date changes nothing - it is
       skipped, and a quiet toast that fades away reads as the station doing nothing at all. So say it in the banner,
       name the copy already in the book and the day it was taken, and name the ONE fix: export the file again. */
    if (seen) {
      banner('"' + name + '" is byte-for-byte the file already in the book'
        + (seen.file_name === name ? '' : ' (loaded as "' + seen.file_name + '")')
        + ', taken on ' + String(seen.extract_on || '?')
        + (seen.committed_at ? ' and loaded on ' + String(seen.committed_at).slice(0, 10) : '')
        + '. Renaming a file does not make it a new one - the fingerprint is its contents, not its name. Export the day'
        + String.fromCharCode(39) + 's file again from Salesforce and drop that one.');
      toast('Skipped ' + name + ' — already uploaded' + (seen.file_name !== name ? ' (as "' + seen.file_name + '")' : '')
        + '. Nothing changed: export a fresh file from Salesforce.', 'err', 20000);
      return true;
    }
    var XL = opts.XLSX || root.XLSX; if (!XL) return fail('The spreadsheet reader did not load. Refresh the page and drop the file again.');
    var aoa = workbookAoa(buf, XL)[found.sheet] || [], parsed = parseFor(kind, aoa);
    if (parsed.missing && parsed.missing.length) return fail('Missing required columns: ' + parsed.missing.join(', ') + '.');
    /* spec A2: one row, one case. A repeated case number makes the whole file unusable, so nothing is sent and the
       duplicates are named - the pattern publish_agent_list() uses for a duplicate CB inside one Agent List. */
    if (parsed.duplicates && parsed.duplicates.length) return fail('This file carries ' + num(parsed.duplicates.length)
      + ' case number' + (parsed.duplicates.length === 1 ? '' : 's') + ' more than once (' + parsed.duplicates.slice(0, 5).join(', ')
      + (parsed.duplicates.length > 5 ? ', …' : '') + '). One row is one case, so nothing was sent. Fix the sheet and drop it again.');
    var ex = eng.extractDate(name, sastToday(opts.now)), cyc = eng.periods.cycleOf(ex.date), nCases = Object.keys(parsed.cases).length;
    var warnings = ex.assumed ? ['extract date assumed (' + ex.date + '): the file name carries no ddmmyy date'] : [];
    /* spec 072 U-6: no exemption any more - the Schedulers Data file takes the thin-pull guard like the daily files
       (its case count only grows), with the same genuine-quiet-day acknowledgement button where one applies. */
    {
      var g = eng.guardUpload(GUARD_KIND[kind], nCases, lastCountFor(kind, cyc.key, rec.uploads), opts.quietAck);
      if (!g.ok) {
        var again = kind !== 'vtBiFitted' && nCases > 0 ? '<button type="button" class="btn small" onclick="VTStation.retryQuiet()">This is a genuine quiet day — load it</button>' : '';
        if (again) root.__vtQuietRetry = function () { banner(null); return ingest(name, buf, hash, expected, found, Object.assign({}, opts, { quietAck: true })); };
        return fail(g.reason, again);
      }
    }
    var roster, fallback = false;
    try {
      var rv = must(await call(env, 'GET', '/api/vt/roster?on=' + cyc.to), 'Reading the Agent List');
      roster = rosterFromRpc(rv);
      /* review fix 5: the VT list in force is older than the newest Agent List — that newer list carried no VT rows */
      if (rv && rv.list_as_of && rv.as_of && rv.list_as_of !== rv.as_of) warnings.push(listWarning(rv));
    } catch (e) { roster = rosterFromPulse(opts.pulseRoster || (root.S && root.S.roster)); fallback = true; }
    for (var attempt = 1; attempt <= MAX_TRIES; attempt++) {
      var book = await readBook(env, cyc.from, Object.keys(parsed.cases).map(Number));
      if (!book) continue;   // the book moved between two parts of the read: re-read (a conflict, FR-008)
      if (kind === 'vtSchedulers' && !book.openedOn) return fail(REFUSE_DATING_FIRST);
      /* the receipts are read AFTER the book, every attempt (derived cancellation, R1): a file committed after the book read
         moves the revision, so this commit is refused and re-merged; one committed before it is in both reads */
      var rcp = kind === 'vtSchedulers' ? null : (must(await call(env, 'GET', '/api/vt/uploads?limit=60'), 'Reading the VT receipts').uploads || []);
      var plan = planCommit(book, parsed, { extractOn: ex.date, roster: roster, warnings: warnings, quietAck: opts.quietAck, receipts: rcp });
      /* p_user is never sent (review fix 6): the Worker appends the session's own username to every write */
      var br = await call(env, 'POST', '/api/vt/upload/begin', { p_sha256: hash, p_kind: DB_KIND[kind], p_file_name: String(name).slice(0, 300), p_extract_on: ex.date, p_cycle_key: cyc.key });
      if (br.status === 409 && br.j && br.j.error === 'busy') return fail(WORDS.busy);   // review fix 2: words, and never stage into the other upload's id
      var b = must(br, 'Starting the upload');
      if (b.duplicate) { toast('Skipped ' + name + ' — already uploaded'); return true; }
      try {
        var parts = [['case', plan.cases], ['event', plan.events]];
        for (var p = 0; p < parts.length; p++) {
          var bs = batches(parts[p][1]);
          for (var i = 0; i < bs.length; i++) must(await call(env, 'POST', '/api/vt/upload/stage', { p_id: b.id, p_kind: parts[p][0], p_from_ord: bs[i].from, p_rows: bs[i].rows }), 'Sending the rows');
        }
        var c = await call(env, 'POST', '/api/vt/upload/commit', Object.assign({ p_id: b.id }, plan.commit));
        /* another station moved the book (FR-008). Review fix 1: abandon OUR upload id first — a re-begin of the same bytes
           within 15 minutes is otherwise refused as busy — then re-read, re-merge and retry */
        if (c.status === 409 && c.j && c.j.error === 'version_conflict') { await call(env, 'POST', '/api/vt/upload/abandon', { p_id: b.id }).catch(function () {}); continue; }
        must(c, 'Saving the upload');
      } catch (e) { await call(env, 'POST', '/api/vt/upload/abandon', { p_id: b.id }).catch(function () {}); throw e; }
      var r = { kind: kind, fileName: name, extractOn: ex.date, assumed: ex.assumed, counts: plan.merged.counts, unmatched: plan.merged.unmatched,
        warnings: plan.commit.p_warnings, rosterFallback: fallback, quietDay: !!opts.quietAck, rev: c.j.rev, attempts: attempt,
        cancelNote: plan.merged.cancel ? plan.merged.cancel.note : null,
        disagree: plan.merged.disagree, unmatchedSchedulers: plan.merged.unmatchedSchedulers, cycles: plan.merged.cycles };
      banner(null); showReceipt(r);
      toast(LABEL[kind] + ' loaded: ' + num(plan.merged.counts.cases) + ' cases, ' + num(plan.events.length) + ' status changes'
        + (plan.merged.counts.cancelledDropped ? ' (' + num(plan.merged.counts.cancelledDropped) + ' cancelled: in neither file of the day)' : '') + ' · VAS money unchanged', '', 9000);
      root.__vtBook = plan.merged.book; root.__vtRoster = roster;
      if (root.VTPages && typeof root.VTPages.adopt === 'function') { try { root.VTPages.adopt(r, plan.merged.book, roster); } catch (e) { /* the pages re-read the book on their next open */ } }
      /* the VT Report takes the same hand-over (spec 072 Phase C note → D5): an upload refreshes the dashboard
         instead of leaving it on the book it read when it was opened */
      if (root.VTDash && typeof root.VTDash.adopt === 'function') { try { root.VTDash.adopt(r, plan.merged.book, roster); } catch (e) { /* the report re-reads the book on its next open */ } }
      if (root.VTStation && typeof root.VTStation.afterCommit === 'function') { try { root.VTStation.afterCommit(r, plan.merged.book, roster); } catch (e) { /* the publish (Phase E) reports its own failures */ } }
      return true;
    }
    return fail('The VT book kept changing while this file was being saved (' + MAX_TRIES + ' tries). Nothing was saved — drop the file again.');
  } catch (e) {
    return fail(e && e.status === 0 || /fetch|network/i.test(String(e && e.message)) ? 'The server could not be reached, so nothing was saved. Check the connection and drop the file again.' : String((e && e.message) || e));
  }
}
function retryQuiet() { return root.__vtQuietRetry ? root.__vtQuietRetry() : null; }

return { API: API, LABEL: LABEL, DB_KIND: DB_KIND, GUARD_KIND: GUARD_KIND, REFUSE_DATING_FIRST: REFUSE_DATING_FIRST, REFUSE_OPENING_FIRST: REFUSE_OPENING_FIRST,
  caseRowToDb: caseRowToDb, eventToDb: eventToDb, batches: batches, rosterFromRpc: rosterFromRpc, rosterFromPulse: rosterFromPulse,
  headerOf: headerOf, kindOfSheets: kindOfSheets, workbookAoa: workbookAoa, parseFor: parseFor, lastCountFor: lastCountFor, planCommit: planCommit,
  receiptLines: receiptLines, slotsHtml: slotsHtml, pick: pick, drop: drop, ingest: ingest, retryQuiet: retryQuiet, call: call, must: must, afterCommit: null,
  WORDS: WORDS, wordsFor: wordsFor, readBook: readBook, listWarning: listWarning, ALSO_CHUNK: ALSO_CHUNK };
});
/* ================= report half (Phase D) below this line ================= */
/* VT REPORT PAGES — Vehicle Tracking → Month to date / Weekly / Daily in VAS Analytics (spec 071 US5, FR-030..FR-033).
 *
 * ENGINE DECIDES, PAGE PAINTS. Every figure on these pages is a field of VTEngine.model() (one call, modelFor below,
 * the same call the digest publish must use): this half only picks which rows a filter shows, formats them and writes
 * the same rows to .xlsx. Absent figures read "—", never 0. Cancelled is a real count since the derived-cancellation fix (2026-11-23):
 * a sale that dropped out of both files of a complete day, or whose contract the BI file shows deactivated. Totals are the
 * engine's own aggregates (sums of counts, ratios of sums) — never a mean of the rows on screen.
 * The book is read from GET /api/vt/book?from=<business month start>, the Agent List in force from
 * /api/vt/roster?on=<month end> (the whole-month rule); a station commit hands both over directly (adopt).
 * Window: window.VTPages (PULSE: PAGES.vt_mtd|vt_weekly|vt_daily → VTPages.render(view)); Node: require(...).Pages.
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports && module.exports.ingest;
  var api = factory(root, node ? module.exports : root.VTStation);
  if (node) module.exports.Pages = api; else root.VTPages = api;
})(typeof self !== 'undefined' ? self : this, function (root, ST) {
'use strict';

var VIEWS = { mtd: 'Month to date', weekly: 'Weekly', daily: 'Daily' };
var TAB = { mtd: 'vt_mtd', weekly: 'vt_weekly', daily: 'vt_daily' };
var PORTAL_ROLES = ['agent', 'team_leader', 'campaign_manager'];   // unmatched sellers' names are for staff only (plan §P)
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
var GUARD_KIND = { vtBiFitted: 'bi', vtSchedMissed: 'sm', vtSchedulers: 'schedulers' };
function E() { return root.VTEngine || (typeof require === 'function' ? require('./vt-engine.js') : null); }
function R() { return E().VT_RULES; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function jsq(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
var NF = {};
function nf(d) { return NF[d] || (NF[d] = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: d, maximumFractionDigits: d })); }
/* one formatter for the screen and the export check: n count · p percent · d2 two decimals · r rand · s text */
function fmtCell(t, v) {
  if (t === 's') return v == null || v === '' ? '—' : String(v);
  if (v == null || typeof v !== 'number' || !isFinite(v)) return '—';
  if (t === 'p') return (v * 100).toFixed(1) + '%';
  if (t === 'd2') return nf(2).format(v);
  if (t === 'r') return 'R ' + nf(2).format(v);
  return nf(0).format(v);
}
var XFMT = { p: '0.0%', d2: '0.00', r: '"R "#,##0.00', n: '#,##0' };
function longDay(d) { return d ? (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1].slice(0, 3) + ' ' + d.slice(0, 4) : '—'; }
function shortDay(d) { return d ? (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1].slice(0, 3) : '—'; }
function dayName(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T00:00:00Z').getUTCDay()] + ' ' + shortDay(d); }
function monthOf(key) { return MONTHS[+key.slice(11, 13) - 1] + ' ' + key.slice(6, 10); }
function sastToday() { return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); }
function subLabel(s) { var K = R().teams.keys; for (var k in K) if (K[k] === s) return k; return s ? String(s) : 'No sub-campaign'; }
function subKeys() { var K = R().teams.keys; return Object.keys(K).map(function (k) { return K[k]; }); }

/* ---------------------------------------------------------------- state ---- */
var C = { book: null, bookFrom: null, bookAt: null, bookId: 0, rosters: {}, fallback: {}, receipts: null, recErr: false,
  status: 'idle', error: null, pending: null, memo: null, ui: {} };
function host() { return root.__mtd && typeof root.__mtd.state === 'function' ? root.__mtd.state() : null; }
function ui() { var S = host(); if (S && S.ui) { S.ui.vt = S.ui.vt || {}; return S.ui.vt; } return C.ui; }
function saveUi() { if (typeof root.saveUI === 'function') { try { root.saveUI(); } catch (e) { /* a view setting only */ } } }
function onTab(re) { var S = host(); return !S || !S.ui || re.test(String(S.ui.tab || '')); }
function repaint() { if (typeof root.renderPage === 'function' && onTab(/^vt_|^data$/)) root.renderPage(); }
function isStaff() { var u = root.CBX_USER || null; return !!u && PORTAL_ROLES.indexOf(u.role) < 0; }
function pulseRoster() { var S = host(); return (S && S.roster) || []; }
function DO() { return typeof root.dataOnlyDay === 'function' ? root.dataOnlyDay : undefined; }   // PULSE's calendar: the VT working days are the VAS ones

/* THE one model call (Phase E's digest publish must use it too, so the screen and the published figures are one set) */
function modelFor(book, roster, cycleKey, receipts) { return E().model(book, roster, { cycleKey: cycleKey, isDataOnlyDay: DO(), aliases: {}, receipts: receipts || undefined }); }
function latestExtract() {
  var d = null; (C.receipts || []).forEach(function (u) { if (u.state === 'committed' && u.kind !== 'opening_book' && (!d || u.extract_on > d)) d = u.extract_on; });
  if (C.book) for (var cn in C.book.cases) { var l = C.book.cases[cn].lastSeen; if (l && (!d || l > d)) d = l; }
  return d;
}
function cycleKeys() {
  var P = E().periods, first = C.book && C.book.openedOn, out = [];
  (C.receipts || []).forEach(function (u) { if (u.state === 'committed' && (!first || u.extract_on < first)) first = u.extract_on; });
  var last = P.cycleOf(sastToday()).key, l = latestExtract(); if (l && P.cycleOf(l).key > last) last = P.cycleOf(l).key;
  for (var k = first ? P.cycleOf(first).key : last, i = 0; k <= last && i < 60; i++) { out.push(k); k = P.cycleOf(P.addDays(P.cycleByKey(k).to, 1)).key; }
  return out.reverse();
}
function currentCycle() {
  var P = E().periods, u = ui();
  if (u.cycle && /^cycle-\d{4}-\d{2}$/.test(u.cycle)) return P.cycleByKey(u.cycle);
  return P.cycleOf(latestExtract() || sastToday());
}

/* ---------------------------------------------------------------- loading ---- */
function env() { return { fetch: root.__vtFetch || undefined }; }
function fetchReceipts() {
  return ST.call(env(), 'GET', '/api/vt/uploads?limit=100').then(function (r) { C.receipts = ST.must(r, 'Reading the VT receipts').uploads || []; C.recErr = false; C.memo = null; })
    .catch(function () { C.receipts = C.receipts || []; C.recErr = true; });
}
function fetchBook(from) {
  return ST.call(env(), 'GET', '/api/vt/book?from=' + encodeURIComponent(from)).then(function (r) {
    C.book = E().bookFromRpc(ST.must(r, 'Reading the Vehicle Tracking book')); C.bookFrom = from; C.bookAt = Date.now(); C.bookId++; C.memo = null; });
}
function fetchRoster(cyc) {
  return ST.call(env(), 'GET', '/api/vt/roster?on=' + cyc.to).then(function (r) { C.rosters[cyc.key] = ST.rosterFromRpc(ST.must(r, 'Reading the Agent List')); C.fallback[cyc.key] = false; })
    .catch(function () { C.rosters[cyc.key] = ST.rosterFromPulse(pulseRoster()); C.fallback[cyc.key] = true; })
    .then(function () { C.memo = null; });
}
/* what the shown business month still needs: one load at a time, a repaint when it lands */
function ensure() {
  if (C.pending || C.status === 'error') return;
  var job = null, cyc = currentCycle();
  if (!C.receipts) job = fetchReceipts();
  else if (!C.book || C.bookFrom > cyc.from) job = fetchBook(cyc.from);
  else if (!C.rosters[cyc.key]) job = fetchRoster(cyc);
  if (!job) return;
  C.status = 'loading';
  C.pending = job.then(function () { C.status = 'ready'; C.error = null; }, function (e) { C.status = 'error'; C.error = String((e && e.message) || e); })
    .then(function () { C.pending = null; ensure(); if (!C.pending) repaint(); });
}
function ready() { var cyc = currentCycle(); return !!(C.receipts && C.book && C.bookFrom <= cyc.from && C.rosters[cyc.key]); }
function retry() { C.status = 'idle'; C.error = null; ensure(); repaint(); }
/* a station commit hands over the merged book (read from the extract's business month) and the roster it used */
function adopt(receipt, book, roster) {
  var cyc = E().periods.cycleOf(receipt.extractOn);
  C.book = book; C.bookFrom = cyc.from; C.bookAt = Date.now(); C.bookId++; C.rosters[cyc.key] = roster; C.fallback[cyc.key] = !!receipt.rosterFallback;
  C.receipts = null; C.memo = null; C.status = 'idle';
  if (onTab(/^vt_/)) { ensure(); repaint(); }
}
function model() {
  var cyc = currentCycle(), key = C.bookId + '|' + cyc.key;
  if (!C.memo || C.memo.key !== key) C.memo = { key: key, M: modelFor(C.book, C.rosters[cyc.key], cyc.key, C.receipts) };
  return C.memo.M;
}
/* the missing-day list is the ENGINE's (VTEngine.uploadGaps, Phase E: it travels in the digest too); kept here as a name */
function uploadGaps(receipts, M, isDataOnlyDay) { return E().uploadGaps(receipts, M, isDataOnlyDay); }

/* ---------------------------------------------------------------- columns ---- */
function col(h, k, t, l) { return { h: h, k: k, t: t || 'n', l: !!l }; }
function figCols(view, M) {
  var c = [col('Sales', 'sales')];
  if (view === 'mtd') c.push(col('Current', 'current'), col('Rollover', 'rollover'));
  c.push(col('Fitted', 'fitted'), col('Scheduled', 'scheduled'), col('Missed', 'missed'), col('Cancelled', 'cancelled'),
    col('Fitted %', 'fitRate', 'p'), col('Missed %', 'missRate', 'p'), col('Scheduled %', 'schedRate', 'p'), col('Cancelled %', 'canRate', 'p'),
    col('Fitments done', 'fitDone'), col('Missed appointments', 'missAppt'), col('Due to fit', 'due'));
  if (view === 'mtd') c.push(col('Working days', 'workingDays'));
  if (view === 'weekly') c.push(col('Working days', 'wd'));
  if (view !== 'daily') c.push(col('SPD', 'spd', 'd2'));
  c.push(col('Target SPD', 'target', 'd2'));
  if (view !== 'daily') c.push(col('% to target', 'toTarget', 'p'));
  if (view === 'mtd') c.push(col('Fitment budget %', 'fitBudget', 'p'), col('Cancellation budget %', 'canBudget', 'p'));
  c.push(col('Fitted value (incl VAT)', 'value', 'r'));
  if (view === 'mtd' && M.floor.mtd && M.floor.mtd.noSaleDay > 0) c.push(col('Sales without a sale day', 'noSaleDay'));
  return c;
}
function cellOf(c, row) {
  if (c.k === 'rating') return row.rating;
  if (c.t === 's') return row.meta[c.k];
  var w = row.w || {}; return w[c.k] == null ? null : w[c.k];
}
/* the Rating column's tooltip, from the rule book's drivers (vt-1.2: two, 50 + 50) */
function ratingTip() {
  return 'Out of 100: ' + R().rating.drivers.map(function (d) { return d.label + ' ' + d.w + ' points'; }).join(' + ')
    + '. Missed, Cancelled and Fitments done are shown as columns, not scored: a missed or cancelled sale is a sale not fitted, so it already lowers Fitment Rate.';
}
function ratingText(a) {
  if (!a || !a.rating) return null;
  if (a.rating.why === 'scheduling') return 'not rated in v1';
  return a.rating.rated ? a.rating.score.toFixed(1) + ' · ' + a.rating.band : null;
}

/* ---------------------------------------------------------------- rows: model + filters → tables (no arithmetic) ---- */
function winOf(obj, view, idx) { if (!obj) return null; return view === 'mtd' ? obj.mtd : view === 'weekly' ? (obj.weeks || [])[idx] : (obj.days || [])[idx]; }
function agentWin(a, view, idx, f) {
  if (f.lead) {   // the engine's per-agent split by lead source: MTD, each week, each day (Phase E)
    if (view === 'mtd') return (a.leads || {})[f.lead] || null;
    var lw = ((view === 'weekly' ? a.leadWeeks : a.leadDays) || {})[f.lead], x = lw ? lw[idx] || null : null;
    if (x && view === 'daily') { x = Object.assign({}, x); x.target = a.target; }
    return x;
  }
  var w = winOf(a, view, idx); if (w && view === 'daily') { w = Object.assign({}, w); w.target = a.target; }   // the list's target, as read (C18)
  return w;
}
function leadOptions(M) { return Object.keys(M.leadAgg).sort(function (a, b) { return (!!M.leadAgg[a].members - !!M.leadAgg[b].members) || String(M.leadAgg[a].label).localeCompare(M.leadAgg[b].label); }); }
function tlRow(M, code) { return M.tlAgg.filter(function (x) { return x.tlCode === code; })[0] || null; }
function tlName(M, code) { var t = tlRow(M, code); return t ? t.tl : code; }
function tlsShown(M, f) { return M.tlAgg.filter(function (t) { return (!f.tl || t.tlCode === f.tl) && (!f.sub || t.subs.indexOf(f.sub) > -1); }); }
/* the engine aggregate that IS this view's total: lead source → team leader → sub-campaign → floor */
function totalOf(M, f) {
  if (f.lead) return { obj: M.leadAgg[f.lead], label: M.leadAgg[f.lead].label + ' total' };
  if (f.tl) { var t = tlRow(M, f.tl); return { obj: t, label: (t ? t.tl : f.tl) + ' total' + (f.sub && t && t.subs.join() !== f.sub ? ' (all their sub-campaigns)' : '') }; }
  if (f.sub) return { obj: M.subAgg[f.sub], label: subLabel(f.sub) + ' total' };
  return { obj: M.floor, label: 'Floor total' };
}
function agentTable(view, M, f, idx) {
  var rows = [], notes = [], groupLead = f.lead && M.leadAgg[f.lead].members;
  if (groupLead) notes.push('Agent rows are split by single lead sources; ' + esc(M.leadAgg[f.lead].label) + ' is a group, so only its total is shown.');
  else {
    var groups = {};
    M.agents.forEach(function (a) { if ((!f.tl || a.tlCode === f.tl) && (!f.sub || a.sub === f.sub)) (groups[a.tlCode || ''] = groups[a.tlCode || ''] || []).push(a); });
    Object.keys(groups).sort(function (x, y) { return String(tlName(M, x) || '~').localeCompare(String(tlName(M, y) || '~')); }).forEach(function (k) {
      var shown = 0;
      groups[k].slice().sort(function (x, y) { return String(x.sub).localeCompare(String(y.sub)) || String(x.name).localeCompare(String(y.name)); }).forEach(function (a) {
        var w = agentWin(a, view, idx, f); if (f.lead && !w) return; shown++;
        rows.push({ cls: '', code: a.code, meta: { tl: a.tl, sub: subLabel(a.sub), agent: a.name || a.code }, w: w, rating: view === 'mtd' ? ratingText(a) : undefined });
      });
      var t = tlRow(M, k);
      if (t && shown && !f.lead && !f.tl && !f.sub) rows.push({ cls: 'subtotal', meta: { tl: t.tl + ' total', sub: t.subs.map(subLabel).join(', '), agent: '' }, w: winOf(t, view, idx) });
    });
  }
  var un = M.floor.unmatched;   // FR-032: one line, never agent rows; its in-play cases are inside the floor total
  if (!f.tl && !f.sub && !f.lead && un && un.sellers) rows.push({ cls: 'subtotal', meta: { tl: 'Unmatched sellers (' + un.sellers + ')', sub: '', agent: '' }, w: view === 'mtd' ? { sales: un.cases } : {} });
  var tot = totalOf(M, f);
  rows.push({ cls: 'total', meta: { tl: tot.label, sub: '', agent: '' }, w: winOf(tot.obj, view, idx) });
  var cols = [col('Team leader', 'tl', 's', 1), col('Sub-campaign', 'sub', 's', 1), col('Agent', 'agent', 's', 1)].concat(figCols(view, M));
  if (view === 'mtd') { var rc = col('Rating', 'rating', 's'); rc.tip = ratingTip(); cols.push(rc); }
  return { cols: cols, rows: rows, notes: notes };
}
function aggTable(M, label, items) {
  return { cols: [col(label, 'name', 's', 1)].concat(figCols('mtd', M)), notes: [],
    rows: items.map(function (it) { return { cls: it.cls || '', meta: { name: it.name }, w: winOf(it.obj, 'mtd', 0) }; }) };
}
function hrsTable(M, f) {
  var B = R().periods.leadTimeBuckets, bud = (M.budgets && M.budgets.hrsShare) || {}, cols = [col('Level', 'name', 's', 1), col('Open scheduled', 'total')];
  B.forEach(function (b) { var lab = b.k === 'past' ? b.label : b.label + ' h';
    cols.push(col(lab, 'n_' + b.k)); if (b.k !== 'past') cols.push(col(lab + ' share', 's_' + b.k, 'p'), col(lab + ' budget', 'b_' + b.k, 'p')); });
  var mk = function (name, obj, cls) { var h = (obj && obj.hrsAhead) || {}, w = { total: h.total };
    B.forEach(function (b) { w['n_' + b.k] = h[b.k]; w['s_' + b.k] = (h.share || {})[b.k]; w['b_' + b.k] = bud[b.k] == null ? null : bud[b.k]; });
    return { cls: cls || '', meta: { name: name }, w: w }; };
  var rows = tlsShown(M, f).map(function (t) { return mk(t.tl + ' (team)', t); });
  if (!f.tl) subKeys().filter(function (s) { return !f.sub || s === f.sub; }).forEach(function (s) { rows.push(mk(subLabel(s) + ' (sub-campaign)', M.subAgg[s], 'subtotal')); });
  if (!f.tl && !f.sub) rows.push(mk('Floor', M.floor, 'total'));
  /* THE FIFTH COLUMN (spec 072 task D3 / FR-034): 72+ now splits into "72+ in cycle" and "72+ out cycle". The budget
     these shares are read against is `budgets[cycle].hrsShare` from Sales_Review_YTD 2026.xlsx, which carries ONE
     72+ key (h72p, 5 %) and not two — so neither split column claims it, both read the absent marker, and this note
     says why rather than halving a budget nobody wrote. Neither share is scored. */
  var split = B.filter(function (b) { return b.k !== 'past' && bud[b.k] == null; }).map(function (b) { return b.label + ' h'; });
  var notes = ['The share budget is <b>budgets[' + esc((M.budgets && M.budgets.cycle) || '') + '].hrsShare</b> (Sales_Review_YTD 2026.xlsx): '
    + B.filter(function (b) { return b.k !== 'past' && bud[b.k] != null; }).map(function (b) { return '<b>' + esc(b.label) + ' h</b> ' + esc(fmtCell('p', bud[b.k])); }).join(', ') + '.'
    + (split.length ? ' The rule book carries a single <b>72+</b> budget (' + esc(fmtCell('p', bud.h72p)) + ') and not one per split column, so '
      + split.map(esc).join(' and ') + ' show ' + esc(R().reports.absent) + ' for their budget rather than a share nobody wrote.' : '')
    + ' Neither share is scored (the agent rating reads Target Achievement and Fitment Rate only).'];
  return { cols: cols, rows: rows, notes: notes };
}
/* every table a view shows, in order — the screen AND the export are drawn from this one list */
function tables(view, M, f) {
  var out = [];
  if (view === 'mtd') {
    out.push(Object.assign(agentTable('mtd', M, f, 0), { title: 'Agents', sheet: 'MTD agents' }));
    if (!f.lead) out.push(Object.assign(aggTable(M, 'Team leader', tlsShown(M, f).map(function (t) { return { name: t.tl, obj: t }; })), { title: 'Team leaders', sheet: 'MTD team leaders' }));
    if (!f.tl && !f.lead) {
      var subs = subKeys().filter(function (s) { return !f.sub || s === f.sub; }).map(function (s) { return { name: subLabel(s), obj: M.subAgg[s] }; });
      if (!f.sub) { if (M.floor.unmatched && M.floor.unmatched.sellers) subs.push({ name: 'Unmatched sellers (' + M.floor.unmatched.sellers + ')', obj: { mtd: { sales: M.floor.unmatched.cases } }, cls: 'subtotal' });
        subs.push({ name: 'Floor total', obj: M.floor, cls: 'total' }); }
      out.push(Object.assign(aggTable(M, 'Sub-campaign', subs), { title: 'Sub-campaigns', sheet: 'MTD sub-campaigns' }));
    }
    if (!f.tl && !f.sub) {
      var leads = leadOptions(M).filter(function (l) { return !f.lead || l === f.lead; })
        .map(function (l) { return { name: M.leadAgg[l].label + (M.leadAgg[l].members ? ' (group)' : ''), obj: M.leadAgg[l], cls: M.leadAgg[l].members ? 'subtotal' : '' }; });
      if (!f.lead) leads.push({ name: 'Floor total', obj: M.floor, cls: 'total' });
      out.push(Object.assign(aggTable(M, 'Lead source', leads), { title: 'Lead sources', sheet: 'MTD lead sources',
        notes: ['Lead source is the Salesforce Source Partner. "Panimax - New Sales" counts as Referral when the seller is on the Referral team, otherwise Predictive; Sales Enablement keeps its own line.'] }));
    }
    if (!f.lead) { var ht = hrsTable(M, f);
      out.push(Object.assign(ht, { title: 'Hrs Ahead — open Scheduled cases', sheet: 'MTD hrs ahead',
        notes: ['Hours ahead = appointment day against ' + esc(longDay(M.period.hrsAsAt)) + ' (the day after the latest extract). Each share sits beside its scheduling budget; teams, sub-campaigns and the floor only.'].concat(ht.notes || []) })); }
  } else if (view === 'weekly') {
    M.weeks.map(function (w, i) { return { w: w, i: i }; }).filter(function (x) { return x.w.from <= M.period.asOf; }).reverse().forEach(function (x) {
      out.push(Object.assign(agentTable('weekly', M, f, x.i), { title: 'Week of ' + x.w.label, sub: x.w.from + ' → ' + (x.w.to < M.period.asOf ? x.w.to : M.period.asOf), sheet: 'Week ' + x.w.label }));
    });
  } else {
    var d = dayOf(M, f);
    out.push(Object.assign(agentTable('daily', M, f, M.dates.indexOf(d)), { title: dayName(d), sub: d, sheet: 'Daily ' + d }));
  }
  return out;
}
function dayOf(M, f) { return f.day && M.dates.indexOf(f.day) > -1 ? f.day : M.dates[M.dates.length - 1]; }
function filters() { var u = ui(); return { tl: u.tl || '', sub: u.sub || '', lead: u.lead || '', day: u.day || '' }; }
function validFilters(M) {   // a saved filter this month does not carry is dropped, never left silently emptying the page
  var u = ui(), f = filters();
  if (f.tl && !tlRow(M, f.tl)) f.tl = '';
  if (f.sub && subKeys().indexOf(f.sub) < 0) f.sub = '';
  if (f.lead && !M.leadAgg[f.lead]) f.lead = '';
  u.tl = f.tl; u.sub = f.sub; u.lead = f.lead; return f;
}

/* ---------------------------------------------------------------- HTML (PULSE's own classes) ---- */
function tableHtml(t) {
  var th = t.cols.map(function (c) { return '<th class="' + (c.l ? 'l' : '') + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + esc(c.h) + '</th>'; }).join('');
  var body = t.rows.map(function (r) { return '<tr class="' + r.cls + '"' + (r.code ? ' data-code="' + esc(r.code) + '"' : '') + '>' + t.cols.map(function (c) {
    return '<td class="' + (c.l ? 'l' : '') + '">' + esc(fmtCell(c.t, cellOf(c, r))) + '</td>'; }).join('') + '</tr>'; }).join('');
  return '<div class="tablewrap"><table class="data vt-table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function card(t) {
  return '<div class="card mt vt-card" data-sheet="' + esc(t.sheet) + '"><div class="cardhead"><div><h3>' + esc(t.title) + '</h3>' + (t.sub ? '<div class="sub">' + esc(t.sub) + '</div>' : '') + '</div></div>'
    + tableHtml(t) + (t.notes || []).map(function (n) { return '<p class="note" style="margin:10px 0 0;max-width:none">' + n + '</p>'; }).join('') + '</div>';
}
function warn(title, sub, body, tone) {
  return '<div class="card mt vt-state" data-tone="' + (tone || 'warn') + '" style="border-left:3px solid var(' + (tone === 'crit' ? '--crit' : tone === 'info' ? '--accent' : '--amber') + ')"><div class="cardhead"><div><h3>' + title + '</h3>'
    + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></div>' + (body ? '<p class="note" style="max-width:none">' + body + '</p>' : '') + '</div>';
}
function updatedAt() {
  var t = null; (C.receipts || []).forEach(function (u) { if (u.state === 'committed' && u.committed_at && (!t || u.committed_at > t)) t = u.committed_at; });
  var ms = t ? Date.parse(t) : C.bookAt; if (!ms) return '—';
  return new Date(ms).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
function headHtml(view, M) {
  var cyc = currentCycle();
  var sub = 'Business month <b>' + esc(monthOf(cyc.key)) + '</b> · ' + esc(shortDay(cyc.from)) + ' – ' + esc(longDay(cyc.to))
    + (M ? ' · figures to ' + esc(longDay(M.period.asOf)) + ' · updated ' + esc(updatedAt()) : '') + (view === 'weekly' ? ' · weeks run Monday–Saturday' : '');
  return '<div class="page-head"><h2>Vehicle Tracking — ' + esc(VIEWS[view]) + '</h2><div class="sub vt-period">' + sub + '</div><div class="spacer"></div>'
    + (M ? '<button class="btn small" id="vtExport" onclick="VTPages.exportView(\'' + view + '\')">' + DL + '<span>Export .xlsx</span></button>' : '') + '</div>';
}
function controlsHtml(view, M, f) {
  var opt = function (v, label, on) { return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; };
  var html = '<select aria-label="Business month" data-vt="cycle" onchange="VTPages.set(\'cycle\',this.value)">'
    + cycleKeys().map(function (k) { return opt(k, monthOf(k) + ' (26th–25th)', k === currentCycle().key); }).join('') + '</select>';
  if (M) {
    html += '<select aria-label="Team leader" data-vt="tl" onchange="VTPages.set(\'tl\',this.value)">' + opt('', 'All team leaders', !f.tl)
      + M.tlAgg.map(function (t) { return opt(t.tlCode, t.tl, f.tl === t.tlCode); }).join('') + '</select>'
      + '<select aria-label="Lead source" data-vt="lead" onchange="VTPages.set(\'lead\',this.value)">' + opt('', 'All lead sources', !f.lead)
      + leadOptions(M).map(function (l) { return opt(l, M.leadAgg[l].label + (M.leadAgg[l].members ? ' (group)' : ''), f.lead === l); }).join('') + '</select>';
    if (view === 'daily' && M.dates.length) { var d = dayOf(M, f);
      html += '<button class="btn small" title="Previous day" onclick="VTPages.step(-1)">‹</button><select aria-label="Day" data-vt="day" onchange="VTPages.set(\'day\',this.value)">'
        + M.dates.slice().reverse().map(function (x) { return opt(x, dayName(x), x === d); }).join('') + '</select><button class="btn small" title="Next day" onclick="VTPages.step(1)">›</button>'; }
  }
  html = '<div class="filters vt-filters">' + html + '</div>';
  if (!M) return html;
  var on = [f.tl ? 'team leader <b>' + esc(tlName(M, f.tl)) + '</b>' : '', f.sub ? 'sub-campaign <b>' + esc(subLabel(f.sub)) + '</b>' : '', f.lead ? 'lead source <b>' + esc(M.leadAgg[f.lead].label) + '</b>' : ''].filter(Boolean);
  return html + '<div class="chiprow" style="margin-bottom:6px">' + [['', 'All sub-campaigns']].concat(subKeys().map(function (s) { return [s, subLabel(s)]; })).map(function (c) {
    return '<button class="chip' + (f.sub === c[0] ? ' on' : '') + '" onclick="VTPages.set(\'sub\',\'' + jsq(c[0]) + '\')">' + esc(c[1]) + '</button>'; }).join('')
    + (on.length ? '<span class="note" style="margin-left:10px">filtered by ' + on.join(' and ') + ' — <a href="#" onclick="VTPages.clear();return false">clear filters</a></span>' : '') + '</div>';
}
function statesHtml(M) {
  var out = [], cyc = currentCycle(), un = M.floor.unmatched;
  if (C.fallback[cyc.key]) out.push(warn('Agent List read from this page', 'the server roster could not be reached', 'Sub-campaigns are unknown until the Worker answers, so agents sit under "No sub-campaign" and the fitment budgets read "—". Refresh to try again.'));
  if (C.recErr) out.push(warn('Upload receipts could not be read', '', 'Missing-day warnings are not checked on this screen until the receipts load again.'));
  var gaps = M.gaps || [];   // the engine decided which days (VTEngine.uploadGaps); the page paints them
  if (gaps.length) out.push(warn('A day\'s upload is missing', gaps.length + ' working day' + (gaps.length === 1 ? '' : 's') + ' in this business month',
    gaps.map(function (g) { return '<b>' + esc(dayName(g.date)) + '</b>: no ' + esc(g.missing.join(' or ')); }).join(' · ')
    + '. No file carries a sale date, so a sale first seen on the next upload is counted on that later day. Load the missing day\'s files in the Upload Station.'));
  if (M.trackFrom > M.period.from && !(C.book && C.book.openingBookOn)) out.push(warn('This business month started before the first upload', 'tracked from ' + esc(longDay(M.trackFrom)),
    'Cases already open on ' + esc(longDay(C.book && C.book.openedOn)) + ' have no sale day: their statuses count, but they are no day\'s sales'
    + (M.floor.mtd && M.floor.mtd.noSaleDay ? ' (' + fmtCell('n', M.floor.mtd.noSaleDay) + ' in play)' : '') + ', and Target Achievement waits for 5 tracked working days. Loading the opening book once (Upload Station → VT · Opening book) supplies their sale days.'));
  if (un && un.sellers) out.push(warn('Unmatched sellers (' + un.sellers + ')', fmtCell('n', un.cases) + ' case' + (un.cases === 1 ? '' : 's') + ' in play',
    'They count in the floor total, never as agent rows. ' + (isStaff() ? 'As Salesforce spells them: <b>' + un.names.map(esc).join('</b>, <b>') + '</b>. ' : '')
    + 'Add or correct them on the Agent List and they resolve on the next upload.'));
  var sch = M.notRated.filter(function (n) { return n.why === 'scheduling'; });
  if (sch.length) out.push(warn('Scheduling agents are listed, not rated in v1', sch.length + ' agent' + (sch.length === 1 ? '' : 's'),
    'The uploads do not say which scheduler handled a sale, so scheduling agents carry no sales and no rating yet. The Hrs Ahead table is the scheduling-speed view.', 'info'));
  /* 25 Nov 2026: this was the ONE block on the page that sat outside a card - bare full-bleed text between two
     carded warnings, which is what "the format is all off" looked like next to everything around it. */
  out.push('<div class="card vt-note"><p class="note vt-cancel-note" style="margin:0;max-width:none">Cancelled includes sales that dropped out of both daily files: a Scheduled or Missed sale that is in neither the BI Active Fitted nor the Scheduled & Missed file of a day with both files in counts as Cancelled from that day (no file says "cancelled", so this is inferred), and a contract the BI file shows as deactivated. A cancelled sale stays in Sales, is no longer Scheduled or Missed, and comes back if a later file carries it; it is not fitted, so it lowers the agent\'s Fitment Rate (the one place the rating counts it). Cancellation % = cancelled ÷ sales, beside the ' + fmtCell('p', (((M.budgets || {}).cancelled) || {})['*']) + ' budget. Fitted value is the Charge Amount × VAT, not the bundle price.</p></div>');
  return out.join('');
}
function render(view) {
  if (!VIEWS[view]) view = 'mtd';
  if (!E() || !ST) return '<div class="card"><div class="empty"><div class="big">Vehicle Tracking did not load</div>Refresh the page.</div></div>';
  ensure();
  if (C.status === 'error') return headHtml(view, null) + warn('The Vehicle Tracking book could not be read', esc(C.error || ''),
    'Nothing on this page is shown from an old copy. <button class="btn small primary" onclick="VTPages.retry()">Retry</button>', 'crit');
  if (!ready()) return headHtml(view, null) + '<div class="card vt-loading"><div class="empty"><div class="big">Reading the Vehicle Tracking book…</div>The case book and the Agent List for this business month are loading.</div></div>';
  var committed = C.receipts.filter(function (u) { return u.state === 'committed'; }).length;
  if (!Object.keys(C.book.cases).length && !committed) return headHtml(view, null) + '<div class="card vt-empty"><div class="empty"><div class="big">No Vehicle Tracking uploads yet</div>'
    + 'Load the day\'s <b>BI Active Fitted</b> and <b>Scheduled &amp; Missed</b> exports in the Upload Station; these reports build themselves from them.'
    + (typeof root.tabAllowed !== 'function' || root.tabAllowed('data') ? '<p style="margin:12px 0 0"><button class="btn small primary" onclick="go(\'data\')">Open the Upload Station</button></p>' : '') + '</div></div>';
  var M = model(), f = validFilters(M);
  /* E2: a staff page open on the latest business month republishes the VT digest when an upload landed after the live
     copy was written (vt-publish.js decides; the digest is this same model) */
  if (root.VTPublish && isStaff() && M.period.key === E().periods.cycleOf(latestExtract() || sastToday()).key) {
    try { root.VTPublish.onPageReady(C.book, C.rosters[M.period.key], M.period.key, C.receipts); } catch (e) { /* the publisher reports its own failures */ }
  }
  if (!M.dates.length || !M.period.asOf || M.period.asOf < M.period.from) {
    var prev = cycleKeys().filter(function (k) { return k < currentCycle().key; })[0];
    return headHtml(view, null) + controlsHtml(view, null, f) + '<div class="card vt-empty"><div class="empty"><div class="big">No ' + esc(monthOf(currentCycle().key)) + ' figures yet</div>No Vehicle Tracking upload falls in this business month yet.'
      + (prev ? '<p style="margin:12px 0 0"><button class="btn small" onclick="VTPages.set(\'cycle\',\'' + prev + '\')">' + esc(monthOf(prev)) + ' (final)</button></p>' : '') + '</div></div>';
  }
  return headHtml(view, M) + controlsHtml(view, M, f) + statesHtml(M) + tables(view, M, f).map(card).join('');
}

/* ---------------------------------------------------------------- actions + export ---- */
function set(k, v) { var u = ui(); u[k] = v == null ? '' : String(v); if (k === 'cycle') u.day = ''; saveUi(); repaint(); }
function clear() { var u = ui(); u.tl = ''; u.sub = ''; u.lead = ''; saveUi(); repaint(); }
function step(dir) { if (!ready()) return; var M = model(), i = M.dates.indexOf(dayOf(M, filters())) + dir; if (i >= 0 && i < M.dates.length) set('day', M.dates[i]); }
function exportValue(c, r) { var v = cellOf(c, r); if (c.t === 's') return v == null || v === '' ? '—' : String(v); return typeof v === 'number' && isFinite(v) ? v : '—'; }
/* the workbook of a view: one sheet per table on screen, the same rows and columns, generated now from the model */
function workbookFor(view) {
  if (!ready() || !VIEWS[view]) return null;
  var M = model(); if (!M.dates.length) return null;
  var f = validFilters(M), used = {};
  var sheets = tables(view, M, f).map(function (t) {
    var nm = String(t.sheet).replace(/[:\\\/?*\[\]]/g, '-').slice(0, 31), i = 1; while (used[nm]) nm = (String(t.sheet).slice(0, 27) + ' ~' + (i++)).slice(0, 31); used[nm] = 1;
    return { name: nm, cols: t.cols, aoa: [t.cols.map(function (c) { return c.h; })].concat(t.rows.map(function (r) { return t.cols.map(function (c) { return exportValue(c, r); }); })) };
  });
  var tag = [f.tl ? tlName(M, f.tl) : '', f.sub ? subLabel(f.sub) : '', f.lead ? M.leadAgg[f.lead].label : ''].filter(Boolean).join(' ') || 'All';
  return { sheets: sheets, name: ('VT ' + VIEWS[view] + ' - ' + tag + ' - ' + monthOf(M.period.key) + ' to ' + shortDay(view === 'daily' ? dayOf(M, f) : M.period.asOf)).replace(/[\\\/:*?"<>|]+/g, '-') + '.xlsx' };
}
function exportView(view) {
  var X = root.XLSX, wb = workbookFor(view), say = typeof root.toast === 'function' ? root.toast : function () {};
  if (!wb) { say('Nothing to export yet'); return null; }
  if (!X || !X.writeFile) { say('Spreadsheet library not loaded - refresh and retry'); return null; }
  var book = X.utils.book_new();
  wb.sheets.forEach(function (s) {
    var ws = X.utils.aoa_to_sheet(s.aoa);
    s.cols.forEach(function (c, ci) { if (XFMT[c.t]) for (var ri = 1; ri < s.aoa.length; ri++) { var a = X.utils.encode_cell({ r: ri, c: ci }); if (ws[a] && ws[a].t === 'n') ws[a].z = XFMT[c.t]; } });
    X.utils.book_append_sheet(book, ws, s.name);
  });
  root.__vtLastExport = { name: wb.name, sheets: wb.sheets.map(function (s) { return { name: s.name, aoa: s.aoa, types: s.cols.map(function (c) { return c.t; }) }; }) };
  X.writeFile(book, wb.name);
  say('Vehicle Tracking ' + VIEWS[view] + ' exported (.xlsx)');
  return root.__vtLastExport;
}

/* ---------------------------------------------------------------- Upload Station: the last 10 VT receipts (D3) ---- */
function receiptsCardHtml() {
  var top = '<div class="card mt" id="vtReceipts"><div class="cardhead"><div><h3>Vehicle Tracking uploads</h3><div class="sub">the last 10 files committed to the VT case book</div></div></div>';
  if (!C.receipts) {
    if (!C.pending) C.pending = fetchReceipts().then(function () { C.pending = null; repaint(); });
    return top + '<p class="note">Reading the receipts…</p></div>';
  }
  var rows = C.receipts.filter(function (u) { return u.state === 'committed'; }).slice(0, 10);
  if (!rows.length) return top + '<p class="note">' + (C.recErr ? 'The receipts could not be read.' : 'No Vehicle Tracking file has been uploaded yet.') + '</p></div>';
  var KIND = { bi_fitted: 'BI Active Fitted', sched_missed: 'Scheduled & Missed', schedulers_data: 'Schedulers Data', opening_book: 'Opening book (retired)' };
  var H = ['Committed', 'Kind', 'File', 'Extract date', 'Cases', 'New', 'To Fitted', 'To Missed', 'To Scheduled', 'Unmatched sellers', 'Warnings'];
  return top + '<div class="tablewrap"><table class="data"><thead><tr>' + H.map(function (h, i) { return '<th class="' + (i < 4 ? 'l' : '') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>'
    + rows.map(function (u) { var c = u.counts || {};
      return '<tr><td class="l">' + esc(u.committed_at ? new Date(u.committed_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false }).slice(0, 17) : '—')
        + '</td><td class="l">' + esc(KIND[u.kind] || u.kind) + '</td><td class="l">' + esc(u.file_name) + '</td><td class="l">' + esc(u.extract_on) + '</td>'
        + [c.cases, c['new'], c.toFitted, c.toMissed, c.toScheduled, (u.unmatched || []).length].map(function (v) { return '<td>' + esc(fmtCell('n', v)) + '</td>'; }).join('')
        + '<td>' + esc(fmtCell('n', (u.warnings || []).length) + (u.quiet_day_ack ? ' · quiet day' : '')) + '</td></tr>'; }).join('')
    + '</tbody></table></div></div>';
}

return { VIEWS: VIEWS, TAB: TAB, render: render, set: set, clear: clear, step: step, retry: retry, adopt: adopt, exportView: exportView, workbookFor: workbookFor,
  receiptsCardHtml: receiptsCardHtml, modelFor: modelFor, uploadGaps: uploadGaps, fmtCell: fmtCell, tables: tables,
  state: function () { return { status: C.status, error: C.error, ready: ready(), cycle: currentCycle().key, model: ready() ? model() : null, book: C.book, receipts: C.receipts, filters: filters() }; },
  _reset: function () { C.book = null; C.bookFrom = null; C.bookId++; C.rosters = {}; C.fallback = {}; C.receipts = null; C.recErr = false; C.status = 'idle'; C.error = null; C.pending = null; C.memo = null; C.ui = {}; } };
});
