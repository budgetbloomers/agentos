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
var DB_KIND = { vtBiFitted: 'bi_fitted', vtSchedMissed: 'sched_missed', vtOpeningBook: 'opening_book' };
var LABEL = { vtBiFitted: 'VT · BI Active Fitted', vtSchedMissed: 'VT · Scheduled & Missed', vtOpeningBook: 'VT · Opening book (once)' };
var REFUSE_OPENING_FIRST = 'Load the opening book after the first day\'s two files (BI Active Fitted and Scheduled & Missed). '
  + 'It only adds sale dates to cases that are already in the book, so on an empty book it has nothing to date.';

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
    seller_name: r.sellerName, seller_cb: r.sellerCb, seller_match: r.sellerMatch };
}
function eventToDb(e) { return { case_number: String(e.caseNumber), on_date: e.onDate, from_status: e.from, to_status: e.to, appt_on: e.apptOn }; }
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
function parseFor(kind, aoa) { var eng = E(); return kind === 'vtBiFitted' ? eng.parseBi(aoa) : kind === 'vtSchedMissed' ? eng.parseSm(aoa) : eng.parseOpeningBook(aoa); }
/* the case count the thin-pull guard compares with (FR-006): BI = the last BI of the same business month; S&M = the last S&M */
function lastCountFor(kind, cycleKey, receipts) {
  var want = DB_KIND[kind], hit = (receipts || []).filter(function (u) { return u.state === 'committed' && u.kind === want && (kind !== 'vtBiFitted' || u.cycle_key === cycleKey); })
    .sort(function (a, b) { return String(b.extract_on).localeCompare(String(a.extract_on)) || (b.id - a.id); })[0];
  return hit && hit.counts && hit.counts.cases != null ? hit.counts.cases : null;
}
/* one merge, turned into what the Worker carries: stage rows (PII-free by construction) and the commit's arguments */
function planCommit(book, parsed, ctx) {
  var m = E().merge(book, parsed, { extractOn: ctx.extractOn, roster: ctx.roster, aliases: ctx.aliases || {} });
  var cases = m.cases.map(caseRowToDb), events = m.events.map(eventToDb);
  return { merged: m, cases: cases, events: events,
    commit: { p_base_rev: book.rev || 0, p_counts: m.counts, p_unmatched: m.unmatched, p_warnings: m.warnings.concat(ctx.warnings || []),
      p_quiet_ack: !!ctx.quietAck, p_cases: cases.length, p_events: events.length } };
}
function receiptLines(r) {
  var c = r.counts || {}, lines = [];
  lines.push(LABEL[r.kind] + ' · ' + r.fileName);
  lines.push('Extract date ' + r.extractOn + (r.assumed ? ' (assumed: the file name carries no ddmmyy date)' : ''));
  if (r.kind === 'vtOpeningBook') lines.push(num(c.cases) + ' cases in the opening book · ' + num(c.changed) + ' sale dates applied · ' + num(c.notInBook) + ' not in the book yet');
  else {
    lines.push((r.kind === 'vtBiFitted' ? 'VT lines ' + num(c.vtLines) + ' of ' + num(c.rows) + ' rows' : num(c.vtLines) + ' rows') + ' · cases ' + num(c.cases)
      + (c.skippedFooter || c.skippedBlank ? ' · skipped ' + num((c.skippedFooter || 0) + (c.skippedBlank || 0)) + ' footer/blank rows' : ''));
    lines.push('New ' + num(c['new']) + ' · to Fitted ' + num(c.toFitted) + ' · to Missed ' + num(c.toMissed) + ' · to Scheduled ' + num(c.toScheduled));
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
function must(r, what) { if (!r.ok || !r.j) { var e = new Error(what + ' failed' + (r.j && r.j.error ? ': ' + r.j.error : ' (' + r.status + ')')); e.status = r.status; throw e; } return r.j; }

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
    ['vtOpeningBook', 'Optional, once: the Schedulers Data sheet of the hand-built VT report, for the sale dates of the cases already open at go-live. Load it after the first day\'s two files — it can only date cases that are already in the book.']];
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
    if (seen) { toast('Skipped ' + name + ' — already uploaded' + (seen.file_name !== name ? ' (as "' + seen.file_name + '")' : '')); return true; }
    var XL = opts.XLSX || root.XLSX; if (!XL) return fail('The spreadsheet reader did not load. Refresh the page and drop the file again.');
    var aoa = workbookAoa(buf, XL)[found.sheet] || [], parsed = parseFor(kind, aoa);
    if (parsed.missing && parsed.missing.length) return fail('Missing required columns: ' + parsed.missing.join(', ') + '.');
    var ex = eng.extractDate(name, sastToday(opts.now)), cyc = eng.periods.cycleOf(ex.date), nCases = Object.keys(parsed.cases).length;
    var warnings = ex.assumed ? ['extract date assumed (' + ex.date + '): the file name carries no ddmmyy date'] : [];
    if (kind !== 'vtOpeningBook') {
      var g = eng.guardUpload(kind === 'vtBiFitted' ? 'bi' : 'sm', nCases, lastCountFor(kind, cyc.key, rec.uploads), opts.quietAck);
      if (!g.ok) {
        var again = kind === 'vtSchedMissed' && nCases > 0 ? '<button type="button" class="btn small" onclick="VTStation.retryQuiet()">This is a genuine quiet day — load it</button>' : '';
        if (again) root.__vtQuietRetry = function () { banner(null); return ingest(name, buf, hash, expected, found, Object.assign({}, opts, { quietAck: true })); };
        return fail(g.reason, again);
      }
    }
    var roster, fallback = false;
    try { roster = rosterFromRpc(must(await call(env, 'GET', '/api/vt/roster?on=' + cyc.to), 'Reading the Agent List')); }
    catch (e) { roster = rosterFromPulse(opts.pulseRoster || (root.S && root.S.roster)); fallback = true; }
    for (var attempt = 1; attempt <= MAX_TRIES; attempt++) {
      var book = eng.bookFromRpc(must(await call(env, 'POST', '/api/vt/book', { p_from: cyc.from, p_also: Object.keys(parsed.cases).map(Number) }), 'Reading the VT book'));
      if (kind === 'vtOpeningBook' && !book.openedOn) return fail(REFUSE_OPENING_FIRST);
      var plan = planCommit(book, parsed, { extractOn: ex.date, roster: roster, warnings: warnings, quietAck: opts.quietAck });
      var b = must(await call(env, 'POST', '/api/vt/upload/begin', { p_sha256: hash, p_kind: DB_KIND[kind], p_file_name: String(name).slice(0, 300), p_extract_on: ex.date, p_cycle_key: cyc.key }), 'Starting the upload');
      if (b.duplicate) { toast('Skipped ' + name + ' — already uploaded'); return true; }
      try {
        var parts = [['case', plan.cases], ['event', plan.events]];
        for (var p = 0; p < parts.length; p++) {
          var bs = batches(parts[p][1]);
          for (var i = 0; i < bs.length; i++) must(await call(env, 'POST', '/api/vt/upload/stage', { p_id: b.id, p_kind: parts[p][0], p_from_ord: bs[i].from, p_rows: bs[i].rows }), 'Sending the rows');
        }
        var c = await call(env, 'POST', '/api/vt/upload/commit', Object.assign({ p_id: b.id }, plan.commit));
        if (c.status === 409) continue;   // another station moved the book: re-read, re-merge, retry (FR-008)
        must(c, 'Saving the upload');
      } catch (e) { await call(env, 'POST', '/api/vt/upload/abandon', { p_id: b.id }).catch(function () {}); throw e; }
      var r = { kind: kind, fileName: name, extractOn: ex.date, assumed: ex.assumed, counts: plan.merged.counts, unmatched: plan.merged.unmatched,
        warnings: plan.commit.p_warnings, rosterFallback: fallback, quietDay: !!opts.quietAck, rev: c.j.rev, attempts: attempt };
      banner(null); showReceipt(r);
      toast(LABEL[kind] + ' loaded: ' + num(plan.merged.counts.cases) + ' cases, ' + num(plan.events.length) + ' status changes · VAS money unchanged', '', 9000);
      root.__vtBook = plan.merged.book; root.__vtRoster = roster;
      if (typeof root.VTStation.afterCommit === 'function') { try { root.VTStation.afterCommit(r, plan.merged.book, roster); } catch (e) { /* the publish (Phase E) reports its own failures */ } }
      return true;
    }
    return fail('The VT book kept changing while this file was being saved (' + MAX_TRIES + ' tries). Nothing was saved — drop the file again.');
  } catch (e) {
    return fail(e && e.status === 0 || /fetch|network/i.test(String(e && e.message)) ? 'The server could not be reached, so nothing was saved. Check the connection and drop the file again.' : String((e && e.message) || e));
  }
}
function retryQuiet() { return root.__vtQuietRetry ? root.__vtQuietRetry() : null; }

return { API: API, LABEL: LABEL, DB_KIND: DB_KIND, REFUSE_OPENING_FIRST: REFUSE_OPENING_FIRST,
  caseRowToDb: caseRowToDb, eventToDb: eventToDb, batches: batches, rosterFromRpc: rosterFromRpc, rosterFromPulse: rosterFromPulse,
  headerOf: headerOf, kindOfSheets: kindOfSheets, workbookAoa: workbookAoa, parseFor: parseFor, lastCountFor: lastCountFor, planCommit: planCommit,
  receiptLines: receiptLines, slotsHtml: slotsHtml, pick: pick, drop: drop, ingest: ingest, retryQuiet: retryQuiet, afterCommit: null };
});
/* ================= report half (Phase D) below this line ================= */
