/* VT APP — Vehicle Tracking as its own entry in the app switcher (Spec Kit 071, 2026-11-24).
 *
 * The owner, looking at the switcher (Ops Analytics / VAS Analytics): "where is the drop down for me to access the vehicles
 * tracking". The three VT pages were a nav group far down VAS Analytics' sidebar. They are now an app of their own in the
 * dropdown, like VAS Analytics, WITHOUT a second copy of the code: Vehicle Tracking is still served by the PULSE page
 * (/pulse/), opened in "VT mode". The address carries the mode, so it survives a reload, a sign-in and the back button:
 *
 *   /pulse/?app=vt                    Vehicle Tracking, Month to Date (the landing page)
 *   /pulse/?app=vt&page=vt_weekly     a deep link to a VT page (page=weekly works too)
 *   /pulse/?page=vt_daily             a VAS address naming a VT page: moves into VT mode (the address is rewritten)
 *
 * In VT mode the sidebar holds only what belongs to Vehicle Tracking — its three pages, the Upload Station (the same
 * station; the VT files are dropped there) and the Apps page — the VAS header filters and the VAS Data Trust strip stand
 * down, and the title reads Vehicle Tracking. VAS Analytics loses the VT group (one home for it). Nothing VAS is
 * recomputed: this file only decides which sidebar is shown and keeps the address in step.
 *
 * WHO SEES THE ENTRY: an account that can open at least one VT-mode page — a VT page (vt_mtd / vt_weekly / vt_daily) or
 * the Upload Station — under PULSE's own tabAllowed (admin, vas:['*'] or the id). That is worker/src/rules.mjs
 * vtReadAllowed for every account that can open PULSE at all. site/auth-gate.js mirrors the same rule (vtEntryOk) for the
 * Ops switcher, which is static HTML. No new app grant: VT stays pages of the `vas` app in app_users.tabs.vas.
 *
 * Loads like its siblings: <script src="vt-app.js" data-inline> in PULSE → window.VTApp; require() in Node (the pure
 * helpers are tested in verify-vt-app.mjs).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTApp = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

var NAME = 'Vehicle Tracking';
/* vt_report (spec 072 Phase C) is the consolidated VT Report dashboard and the FIRST item of the group (FR-001).
   LANDING stays vt_mtd: /pulse/?app=vt has meant Month to Date since 071 and a deep link is how the Report is
   reached (?app=vt&page=vt_report), so the address keeps its meaning. */
var VT_PAGES = ['vt_report', 'vt_mtd', 'vt_weekly', 'vt_daily'];
var SHARED = ['data', 'hubs'];                     // the same Upload Station and Apps page, in either app
var ENTRY_IDS = VT_PAGES.concat(['data']);         // what makes the entry worth showing (the Apps page alone is not VT)
var LANDING = 'vt_mtd';
var TITLE_VT = 'Chatterbox AgentOS · Vehicle Tracking';
var st = { vt: false, vasTitle: null, styled: false, wired: false, ui: null };

/* ---------------------------------------------------------------- pure (Node-tested) ---- */
function isVtPage(t) { return VT_PAGES.indexOf(t) > -1; }
function isShared(t) { return SHARED.indexOf(t) > -1; }
function parse(search) {
  var q = {};
  String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return; var i = kv.indexOf('=');
    try { q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* a malformed pair is ignored */ }
  });
  return q;
}
/** the address → {vt, page}: ?app=vt is VT mode; a page naming a VT page is VT mode too (a VAS deep link to it) */
function intentOf(search) {
  var q = parse(search), p = String(q.page || '');
  if (/^(report|mtd|weekly|daily)$/.test(p) && q.app === 'vt') p = 'vt_' + p;
  if (!/^[a-z_]{1,32}$/.test(p)) p = '';
  return { vt: q.app === 'vt' || isVtPage(p), page: p || null };
}
/** the address for a mode + page, keeping any other parameter; VAS mode carries no app/page (as before) */
function searchFor(vt, page, search) {
  var q = parse(search), parts = [];
  Object.keys(q).forEach(function (k) { if (k !== 'app' && k !== 'page') parts.push(encodeURIComponent(k) + (q[k] === '' ? '' : '=' + encodeURIComponent(q[k]))); });
  if (vt) parts.unshift('app=vt' + (page && page !== LANDING ? '&page=' + encodeURIComponent(page) : ''));
  return parts.length ? '?' + parts.join('&') : '';
}
/** which app a page belongs to: a VT page is VT, the shared pages stay where they are, every other page is VAS */
function modeFor(tab, cur) { return isVtPage(tab) ? true : isShared(tab) ? !!cur : false; }
/** the sidebar groups of a mode, from PULSE's one NAV (the VT group carries app:'vt'; audit-permissions reads NAV whole) */
function navFor(NAV, vt) {
  return (NAV || []).map(function (g) {
    var items = vt ? g.items.filter(function (i) { return g.app === 'vt' || isShared(i[0]); }) : (g.app === 'vt' ? [] : g.items);
    return { lab: g.lab, app: g.app, items: items };
  }).filter(function (g) { return g.items.length; });
}
/** the entry shows for an account that can open a VT page or the Upload Station (allowed = PULSE's tabAllowed) */
function entryAllowed(allowed) { return ENTRY_IDS.some(function (id) { return !allowed || allowed(id); }); }

/* ---------------------------------------------------------------- the page (DOM) ---- */
function on() { return st.vt; }
function loc() { return root.location || { pathname: '', search: '', hash: '' }; }
function host() { return root.__mtd && root.__mtd.state ? root.__mtd.state() : null; }
function style() {
  var d = root.document; if (st.styled || !d || !d.head) return; st.styled = true;
  var s = d.createElement('style'); s.id = 'vtAppStyle';
  s.textContent = '.vt-app #vasTrust{display:none!important}';   // the VAS source chips are VAS's own; VT pages carry their own states
  d.head.appendChild(s);
}
/** paint the mode outside the page: title, the html class, and the address (replaced, never a new history entry) */
function apply(S) {
  var d = root.document; if (!d) return;
  style();
  if (st.vasTitle == null) st.vasTitle = d.title;
  d.title = st.vt ? TITLE_VT : st.vasTitle;
  if (d.documentElement) d.documentElement.classList.toggle('vt-app', st.vt);
  var L = loc(), want = searchFor(st.vt, st.vt && S && S.ui ? S.ui.tab : null, L.search);
  if (want !== (L.search || '') && root.history && root.history.replaceState) {
    try { root.history.replaceState(root.history.state, '', L.pathname + want + (L.hash || '')); } catch (e) { /* file:// may refuse; the mode still holds in memory */ }
  }
}
/** the address decides: at load, after sign-in swaps in the saved view, and on back/forward */
function boot(S) {
  if (!S || !S.ui) return;
  var it = intentOf(loc().search), saved = S.ui.tab;
  if (it.vt) {
    if (saved && !isVtPage(saved) && !isShared(saved)) S.ui.vasTab = saved;   // the VAS page to come back to
    S.ui.tab = it.page && (isVtPage(it.page) || isShared(it.page)) ? it.page : LANDING;
  } else if (it.page) {
    S.ui.tab = it.page;
  } else if (isVtPage(saved)) {
    S.ui.tab = S.ui.vasTab || 'dashboard';      // VAS opened plainly never lands on a VT page left in the saved view
  }
  st.vt = modeFor(S.ui.tab, it.vt); st.ui = S.ui;
  wire();
}
/** before a page renders: the page decides the mode. Returns true when the mode changed (the sidebar must repaint). */
function sync(S, allowed) {
  if (!S || !S.ui) return false;
  /* a view replaced wholesale (a fresh state on an empty cloud copy, say) carries no app: the address still does */
  if (st.ui && S.ui !== st.ui) boot(S);
  var want = modeFor(S.ui.tab, st.vt);
  if (want && !entryAllowed(allowed)) {
    /* NO ACCESS IS AN ANSWER: the account opens no VT page and no Upload Station — the same as any ungranted page, it
       lands on its first granted VAS page, and is told why */
    want = false; S.ui.tab = S.ui.vasTab || 'dashboard';
    if (typeof root.toast === 'function') { try { root.toast('This account has no Vehicle Tracking pages — ask Nick or Nicholas if you need them'); } catch (e) { /* a notice only */ } }
  }
  if (!want && !isShared(S.ui.tab)) S.ui.vasTab = S.ui.tab;
  var changed = want !== st.vt; st.vt = want;
  apply(S);
  return changed;
}
/** the switcher's options for PULSE (o = the option style attribute PULSE paints them with) */
function switcherOptions(allowed, o) {
  var a = o ? ' ' + o : '';
  return '<option value="../index.html"' + a + '>Ops Analytics</option>'
    + '<option value="vas"' + (st.vt ? '' : ' selected') + a + '>VAS Analytics</option>'
    + (entryAllowed(allowed) ? '<option value="vt" data-vt-entry' + (st.vt ? ' selected' : '') + a + '>' + NAME + '</option>' : '');
}
function go(vt) {
  var S = host(); if (!S) return;
  var L = loc(), url = L.pathname + searchFor(vt, null, L.search) + (L.hash || '');
  try { root.history.pushState(null, '', url); } catch (e) { root.location.href = url; return; }   // a new entry: Back returns to the other app
  boot(S);
  if (typeof root.saveUI === 'function') { try { root.saveUI(); } catch (e) { /* a view setting only */ } }
  if (typeof root.renderAll === 'function') root.renderAll();
}
/** the switcher's onchange: the two PULSE apps switch in place; any other app is a page load */
function onSwitch(sel) {
  var v = sel && sel.value; if (!v) return;
  if (v === 'vt' || v === 'vas') { if ((v === 'vt') !== st.vt) go(v === 'vt'); return; }
  root.location.href = v;
}
function wire() {
  if (st.wired || typeof root.addEventListener !== 'function') return; st.wired = true;
  root.addEventListener('popstate', function () { var S = host(); if (!S) return; boot(S); if (typeof root.renderAll === 'function') root.renderAll(); });
}

return { NAME: NAME, VT_PAGES: VT_PAGES, SHARED: SHARED, ENTRY_IDS: ENTRY_IDS, LANDING: LANDING,
  parse: parse, intentOf: intentOf, searchFor: searchFor, modeFor: modeFor, navFor: navFor, entryAllowed: entryAllowed,
  on: on, boot: boot, sync: sync, switcherOptions: switcherOptions, onSwitch: onSwitch, go: go };
});
