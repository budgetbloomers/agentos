/* VT PUBLISH — the Vehicle Tracking digest, from PULSE to Agent Analytics (Spec Kit 071, Phase E, task E2).
 *
 * ONE SET OF NUMBERS. The digest is VTEngine.digest(VTPages.modelFor(book, roster, cycleKey, receipts)) — the very call the
 * VT pages paint — so the figures an agent, team leader or campaign manager reads in Agent Analytics are the figures a
 * manager reads in VAS Analytics, by construction. Nothing here computes a figure.
 *
 * WHERE IT GOES. POST /api/kv?key=vt-digest (the live business month) and ?key=vt-digest-cycle-YYYY-MM (that month's own
 * history copy). Never the VAS digest keys. The Worker fences both (worker/src/rules.mjs vtDigestFence: the current SAST
 * business month 26th–25th or the one just closed until it publishes, the whole month only, never empty over data, staff
 * only); the page fences itself first with the same rule (liveOk), as PULSE does for the VAS digest.
 *
 * WHEN. After every committed VT upload (VTStation.afterCommit) and when a VT page opens on a book that changed after the
 * last publish (stale(): the newest committed receipt is later than the live digest's own timestamp).
 *
 * A PUBLISH MUST BE ACKNOWLEDGED (CLAUDE.md non-negotiable 14): a failed publish is a STATE — window.__vtDigestDirtySince,
 * a persistent red banner, retries at 30 s → 2 m → 5 m, and a beforeunload challenge while dirty; __vtDigestOk is the ack.
 *
 * Loads like its siblings: <script src="vt-publish.js" data-inline> in PULSE → window.VTPublish; require() in Node.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTPublish = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

var API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
var RETRY_MS = [30000, 120000, 300000];
function E() { return root.VTEngine || (typeof require === 'function' ? require('./vt-engine.js') : null); }
function P() { return root.VTPages || (typeof require === 'function' ? require('./vt-pages.js').Pages : null); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function sastDay(nowMs) { return new Date(nowMs + 2 * 3600000).toISOString().slice(0, 10); }

/* ---------------------------------------------------------------- pure (Node-tested) ---- */
/** the digest of one business month — the page's own model call */
function buildDigest(book, roster, cycleKey, receipts, nowMs) {
  var M = P().modelFor(book, roster, cycleKey, receipts || []);
  return E().digest(M, { updatedAt: new Date(nowMs == null ? Date.now() : nowMs).toISOString() });
}
/** the live key's month rule, mirror of worker/src/rules.mjs liveVtDigestAllowed: the current SAST business month, or the
 *  one just closed (the Worker then refuses it once the current one is live). Never older, never later. */
function liveOk(cycleKey, nowMs) {
  var per = E().periods, cur = per.cycleOf(sastDay(nowMs == null ? Date.now() : nowMs)).key;
  var prev = per.cycleOf(per.addDays(per.cycleByKey(cur).from, -1)).key;
  return cycleKey === cur || cycleKey === prev;
}
/** which keys a digest is posted under: its own history key (not for an empty month — nothing to keep), and the live key
 *  when the month rule allows it */
function keysFor(d, nowMs) {
  var k = d && d.period && d.period.key, out = [];
  if (!k || !/^cycle-\d{4}-\d{2}$/.test(k)) return out;
  if (liveOk(k, nowMs)) out.push('vt-digest');
  if (!d.empty) out.push('vt-digest-' + k);
  return out;
}
/** stale: a committed upload landed after the live digest was written (or nothing is live yet) */
function stale(receipts, liveUpdatedAt) {
  var last = null; (receipts || []).forEach(function (u) { if (u && u.state === 'committed' && u.committed_at && (!last || u.committed_at > last)) last = u.committed_at; });
  if (!last) return false;
  return !liveUpdatedAt || Date.parse(last) > Date.parse(liveUpdatedAt);
}

/* ---------------------------------------------------------------- state + the save-ack machinery ---- */
var S = { pending: null, tries: 0, timer: null, last: null, busy: false };
function token() { try { return root.sessionStorage && root.sessionStorage.getItem('cbx_token'); } catch (e) { return null; } }
function doFetch(u, o) { return (root.__vtFetch || root.fetch)(u, o); }
function base() { return root.__vtApiBase || API; }
function banner(text) {
  var d = root.document; if (!d) return;
  var el = d.getElementById('vtDigestBanner');
  if (!text) { if (el) el.remove(); return; }
  if (!el) { el = d.createElement('div'); el.id = 'vtDigestBanner'; el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:12px;z-index:9998;background:#b42318;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    d.body.appendChild(el); }
  el.innerHTML = '<b>Vehicle Tracking figures not published to Agent Analytics.</b> ' + esc(text)
    + ' <button type="button" class="btn small" style="margin-left:8px" onclick="VTPublish.retry()">Publish now</button>';
}
function dirty(on) {
  if (on) { if (!root.__vtDigestDirtySince) root.__vtDigestDirtySince = Date.now(); }
  else { root.__vtDigestDirtySince = 0; root.__vtDigestOk = Date.now(); banner(null); }
}
function schedule() {
  if (S.timer) clearTimeout(S.timer);
  var ms = RETRY_MS[Math.min(S.tries - 1, RETRY_MS.length - 1)];
  S.timer = setTimeout(function () { S.timer = null; if (S.pending) send(S.pending); }, ms);
}
/** post one digest under every key it belongs to. Resolves {ok, results:[{key,status,error}]}. */
function send(d, nowMs) {
  var tk = token(), keys = keysFor(d, nowMs);
  if (!tk) return Promise.resolve({ ok: false, results: [], why: 'not signed in' });
  if (!keys.length) return Promise.resolve({ ok: true, results: [], why: 'no key: ' + ((d && d.period && d.period.key) || 'no period') + ' is not a business month this page may publish' });
  S.pending = d; dirty(true); S.busy = true;
  var body = JSON.stringify(d), H = { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + tk, 'X-Cbx-Client': 'v5' };
  return Promise.all(keys.map(function (k) {
    return doFetch(base() + '/api/kv?key=' + k, { method: 'POST', headers: H, body: body })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { key: k, status: r.status, error: j && j.error }; }); },
        function (e) { return { key: k, status: 0, error: String((e && e.message) || e) }; });
  })).then(function (results) {
    S.busy = false;
    /* a 409 is the fence's verdict, not a failed save: an older month offered to the live key, or an empty month over data —
       nothing to retry. Anything else that is not a 200 is a failed save and stays dirty. */
    var failed = results.filter(function (x) { return x.status !== 200 && x.status !== 409; });
    if (!failed.length) { S.pending = null; S.tries = 0; S.last = { at: Date.now(), results: results }; dirty(false); return { ok: true, results: results }; }
    S.tries++; schedule();
    banner('The server did not take ' + failed.map(function (x) { return x.key; }).join(' and ') + ' (' + (failed[0].error || 'HTTP ' + failed[0].status)
      + '). Agent Analytics still shows the previous figures. Retrying automatically.');
    return { ok: false, results: results };
  });
}
function retry() { S.tries = 0; return S.pending ? send(S.pending) : Promise.resolve({ ok: true, results: [] }); }

/* ---------------------------------------------------------------- the two triggers ---- */
function receiptsNow() {
  return doFetch(base() + '/api/vt/uploads?limit=100', { headers: { Authorization: 'Bearer ' + token(), 'X-Cbx-Client': 'v5' } })
    .then(function (r) { return r.ok ? r.json() : { uploads: [] }; }).then(function (j) { return j.uploads || []; }, function () { return []; });
}
/** VTStation.afterCommit(receipt, book, roster): publish the business month of the extract just committed */
function afterCommit(receipt, book, roster) {
  var cyc = E().periods.cycleOf(receipt.extractOn).key;
  return receiptsNow().then(function (rec) { return send(buildDigest(book, roster, cyc, rec)); });
}
/** a VT page is open on a ready model: republish when an upload landed after the live digest (one check per book) */
var checked = {};
function onPageReady(book, roster, cycleKey, receipts) {
  if (!book || checked[book.rev + '|' + cycleKey] || !token()) return Promise.resolve(null);
  checked[book.rev + '|' + cycleKey] = 1;
  return doFetch(base() + '/api/kv?key=vt-digest&meta=1', { headers: { Authorization: 'Bearer ' + token(), 'X-Cbx-Client': 'v5' } })
    .then(function (r) { return r.ok ? r.json() : { found: false }; }, function () { return null; })
    .then(function (m) { if (m == null) return null; if (!stale(receipts, m.found ? m.updated_at : null)) return null; return send(buildDigest(book, roster, cycleKey, receipts)); });
}
if (root.addEventListener) root.addEventListener('beforeunload', function (e) { if (root.__vtDigestDirtySince) { e.preventDefault(); e.returnValue = ''; } });
if (root.VTStation) root.VTStation.afterCommit = afterCommit;   // the station calls it after every commit

return { buildDigest: buildDigest, liveOk: liveOk, keysFor: keysFor, stale: stale, send: send, retry: retry, afterCommit: afterCommit, onPageReady: onPageReady,
  state: function () { return { pending: !!S.pending, tries: S.tries, last: S.last, busy: S.busy, dirtySince: root.__vtDigestDirtySince || 0 }; },
  _reset: function () { S.pending = null; S.tries = 0; S.last = null; S.busy = false; if (S.timer) clearTimeout(S.timer); S.timer = null; checked = {}; root.__vtDigestDirtySince = 0; banner(null); } };
});
