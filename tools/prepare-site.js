#!/usr/bin/env node
/**
 * prepare-site.js — build step for Cloudflare Pages.
 * Copies the source dashboard to site/index.html and injects a localStorage
 * persistence shim (the app targets an async window.storage API that doesn't
 * exist in a normal browser; without the shim, nothing persists on Cloudflare).
 *
 * Usage: node tools/prepare-site.js [path-to-dashboard.html]
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'Chatterbox_AgentOS_Analytics.html');
const outDir = path.join(root, 'site');
const out = path.join(outDir, 'index.html');

if (!fs.existsSync(src)) {
  console.error('Source dashboard not found: ' + src);
  console.error('Place Chatterbox_AgentOS_Analytics.html in the project root.');
  process.exit(1);
}

let html = fs.readFileSync(src, 'utf8');

const SHIM = `<script id="cbx-storage-shim">
/* cbx-storage-shim v4: CLOUD-AUTHORITATIVE. The Supabase cloud is the single
   source of truth. Reads ALWAYS trust the cloud when reachable: if the cloud
   has no value for a key (404), the local copy is DROPPED and null returned —
   so a device with a stale cache can never repopulate wiped/changed data.
   Local storage is only a read-through cache and an offline fallback; it is
   NEVER auto-pushed up. Only an explicit write (set/delete = a user action)
   sends data to the cloud. This keeps every device in sync with the database. */
if (!window.storage) {
  (function () {
    var API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev/api/kv';
    var tokenWait = new Promise(function (res) {
      if (sessionStorage.getItem('cbx_token')) return res();
      document.addEventListener('cbx-authed', function () { res(); }, { once: true });
      setTimeout(res, 8000); // offline / file:// fallback — don't block forever
    });
    var authHdr = function () { var t = sessionStorage.getItem('cbx_token'); return t ? { 'Authorization': 'Bearer ' + t } : null; };
    var mem = {}; // in-memory read cache (survives localStorage quota misses on big sources)
    // Loud, unmissable banner when a cloud save fails — silent failure here
    // means a user thinks their upload persisted when the database never got it.
    function cbxSaveWarn(msg) {
      try {
        var b = document.getElementById('cbxSaveWarn');
        if (!b) { b = document.createElement('div'); b.id = 'cbxSaveWarn'; document.body.appendChild(b); }
        b.setAttribute('style', 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#7F1D1D;color:#FECACA;border:1px solid #F87171;border-radius:10px;padding:10px 18px;font:700 13px Inter,system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.5);max-width:90vw');
        b.textContent = '⚠ ' + msg;
        clearTimeout(b._t); b._t = setTimeout(function () { b.remove(); }, 12000);
      } catch (e) {}
    }
    /* ---- SAVE ACKNOWLEDGEMENT (save-reliability-plan P1; Ops' copy of the
       28-31 Aug lesson). A failed cloud write is QUEUED with its exact payload
       and retried with backoff (30s -> 2m -> 5m); a persistent banner stands
       until the queue drains; closing the tab while anything is queued warns.
       cbxSaveWarn above stays for the moment of failure - this is for the
       state of being unsaved, which outlives any toast. */
    var cbxFailed = {}, cbxFailN = 0, cbxRetryT = null;
    /* TELL THE SERVER WHAT DID NOT ARRIVE (2026-09-07). A refused save leaves no trace in the
       write log, so the reason lived only in a twelve-second toast. Fire-and-forget, tiny,
       never awaited; the retry loop does not depend on it. */
    /* (a plain string replace below, not a regex: this shim is a template string and a regex's
       backslashes are lost when it is generated) */
    function cbxSaveReport(k, why, v) {
      try { var h = authHdr(); if (!h) return;
        fetch(API.replace('/api/kv', '/api/save-fail'), { method: 'POST', keepalive: true,
          headers: { 'Authorization': h.Authorization, 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5' },
          body: JSON.stringify({ app: 'ops', key: k, status: String(why || '?'), build: window.CBX_BUILD || '', bytes: (v || '').length }) }).catch(function () {});
      } catch (e) {}
    }
    function cbxSaveFail(k, v, why) {
      cbxFailed[k] = v; cbxUnsavedBanner(); cbxSaveReport(k, why, v);
      if (cbxRetryT) return;
      cbxFailN++;
      var d = window.__cbxRetryMs || [30000, 120000, 300000][Math.min(cbxFailN - 1, 2)];   // override = test hook
      cbxRetryT = setTimeout(function () {
        cbxRetryT = null;
        Object.keys(cbxFailed).forEach(function (k2) {
          var v2 = cbxFailed[k2]; delete cbxFailed[k2];   // set() re-queues it if it fails again
          window.storage.set(k2, v2);
        });
      }, d);
    }
    function cbxSaveOkFor(k) {
      delete cbxFailed[k]; window.__cbxSaveOk = Date.now();
      if (!Object.keys(cbxFailed).length) cbxFailN = 0;
      cbxUnsavedBanner();
    }
    function cbxUnsavedBanner() {
      var n = Object.keys(cbxFailed).length;
      var el = document.getElementById('cbxUnsaved');
      if (!n) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('div'); el.id = 'cbxUnsaved'; (document.body || document.documentElement).appendChild(el); }
      el.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#7F1D1D;color:#FECACA;border-bottom:1px solid #EF4444;padding:9px 16px;text-align:center;font:700 13px Inter,system-ui,sans-serif');
      el.textContent = '\u26a0 ' + n + ' item' + (n === 1 ? '' : 's') + ' NOT saved to the database - retrying automatically. Keep this tab open; if this stays red, your uploads are not being stored.';
    }
    window.addEventListener('beforeunload', function (e) {
      if (Object.keys(cbxFailed).length) { e.preventDefault(); e.returnValue = ''; }
    });
    window.__cbxFailedSaves = cbxFailed;   // test hook - verify-save-acks.mjs
    /* DID THIS VALUE COME FROM THE CLOUD, OR FROM THE CACHE? A get() that cannot
       reach the cloud deliberately falls back to the local copy so the app keeps
       working offline — but the CALLER cannot see the difference, and one caller
       must: Ops' conditional boot records "this device holds version X" and would
       otherwise stamp a cache-fallback as a fresh download, then serve that stale
       copy as current on every later boot (audit round 3, 2026-08-27). Per key,
       because boot reads run in parallel. */
    var fresh = {};
    window.storage = {
      fresh: fresh,
      async get(k) {
        await tokenWait;
        fresh[k] = false;
        var h = authHdr();
        if (h) {
          try {
            var r = await fetch(API + '?key=' + encodeURIComponent(k), { headers: h });
            if (r.status === 404) {
              // Cloud is authoritative and has nothing here — purge any stale
              // local copy so this device can NEVER push old data back up.
              delete mem[k];
              try { localStorage.removeItem('cbx:' + k); } catch (e) {}
              fresh[k] = true;                 // an authoritative "nothing here" IS a cloud answer
              return null;
            }
            if (r.ok) {
              var data = await r.text();
              mem[k] = data;
              try { localStorage.setItem('cbx:' + k, data); } catch (e) { /* quota — mem cache still holds it */ }
              fresh[k] = true;
              return { value: data };
            }
            // 401/5xx etc: don't treat as authoritative-empty; fall through to cache (no push)
          } catch (e) { /* network error — offline read from cache below, never push */ }
        }
        if (mem[k] != null) return { value: mem[k] };
        try { var v = localStorage.getItem('cbx:' + k); return v == null ? null : { value: v }; } catch (e) { return null; }
      },
      async set(k, v) {
        // user-initiated write: cache locally + push to the cloud (the truth)
        window.__cbxLastWrite = Date.now(); // freshness watcher: skip self-triggered re-inits
        mem[k] = v;
        try { localStorage.setItem('cbx:' + k, v); } catch (e) { /* quota — cloud still saves below */ }
        var h = authHdr();
        if (!h) { cbxSaveWarn('Not signed in — this data was NOT saved to the database.'); cbxSaveFail(k, v, 'no-token'); return; }
        try {
          var hdrs = { 'Authorization': h.Authorization, 'Content-Type': 'text/plain', 'X-Cbx-Client': 'v5' };
          var payload = v;
          /* Gzip the body when the browser can (perf, 2026-08-28) — fact blobs are tens of MB
             and compress about ten to one. NO Content-Encoding HEADER: it is not a CORS-
             safelisted request header, and setting it here is what silently blocked every
             big Ops save from 28–31 Aug — the browser refused to SEND the request, the
             same bug that froze PULSE's whole state for four days. The Worker detects
             gzip by the magic bytes (1f 8b) and ignores the header on purpose. */
          if (typeof CompressionStream === 'function' && v.length > 65536) {
            try { payload = await new Response(new Blob([v]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); }
            catch (e) { payload = v; }
          }
          var r = await fetch(API + '?key=' + encodeURIComponent(k), { method: 'POST', headers: hdrs, body: payload });
          if (!r.ok) { var why = r.status + ''; try { why += ' ' + (await r.text()).slice(0, 160); } catch (e2) {}
            cbxSaveWarn('Cloud save failed (' + r.status + ') — "' + k + '" is NOT in the database yet. Keep this tab open; it is retrying.'); cbxSaveFail(k, v, why); return; }
          cbxSaveOkFor(k);
        } catch (e) { cbxSaveWarn('Cloud save failed (network) — "' + k + '" is NOT in the database yet. Keep this tab open; it is retrying.'); cbxSaveFail(k, v, 'network ' + String(e && e.message || e).slice(0, 120)); }
      },
      async delete(k) {
        // real delete: drop the local copy AND remove it from the database (Storage
        // object + pointer row) so a deleted file does not linger in Supabase as empty.
        delete mem[k];
        try { localStorage.removeItem('cbx:' + k); } catch (e) {}
        window.__cbxLastWrite = Date.now();
        await tokenWait;
        var h = authHdr();
        if (!h) { cbxSaveWarn('Not signed in — delete was NOT applied to the database.'); return; }
        try {
          var r = await fetch(API + '?key=' + encodeURIComponent(k), { method: 'DELETE', headers: { 'Authorization': h.Authorization, 'X-Cbx-Client': 'v5' } });
          if (!r.ok) cbxSaveWarn('Delete not synced to the database (' + r.status + ') — the file may still be there. Retry or re-login.');
        } catch (e) { cbxSaveWarn('Delete not synced to the database (network) — retry when back online.'); }
      }
    };
  })();
}
</script>`;

// Stale-tab guard: every build gets a unique id, written to /build.txt (no-store).
// Open tabs poll it every 5 minutes; on mismatch they show an unmissable
// "outdated version — refresh" banner. Kills the ghost-data-in-old-tabs problem.
const BUILD = Date.now().toString(36);
const STALE_GUARD = `<script id="cbx-build">window.CBX_BUILD='${BUILD}';
(function(){function chk(){fetch('/build.txt?x='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.text():null}).then(function(b){
  if(!b||b.trim()===window.CBX_BUILD)return;
  var el=document.getElementById('cbxStale');
  if(!el){el=document.createElement('div');el.id='cbxStale';document.body.appendChild(el);}
  el.setAttribute('style','position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7C2D12;color:#FED7AA;border-bottom:1px solid #FB923C;padding:10px 16px;text-align:center;font:700 13px Inter,system-ui,sans-serif');
  el.innerHTML='⚠ This tab is running an OUTDATED version of AgentOS — data shown may be stale. <button onclick="location.reload()" style="margin-left:10px;border:none;border-radius:7px;padding:5px 12px;font-weight:800;background:#FB923C;color:#431407;cursor:pointer">Reload now</button>';
}).catch(function(){})}
setInterval(chk,300000);setTimeout(chk,15000);})();</script>`;

const anchor = '<head>';
const headAt = html.indexOf(anchor);
if (headAt === -1) { console.error('Could not find <head> to inject the shim.'); process.exit(1); }
html = html.slice(0, headAt + anchor.length) + '\n' + SHIM + '\n' + STALE_GUARD + html.slice(headAt + anchor.length);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, html);
fs.writeFileSync(path.join(outDir, 'build.txt'), BUILD);
console.log('Wrote ' + out + ' (' + (html.length / 1024).toFixed(0) + ' KB), shim + stale-guard injected, build ' + BUILD + '.');

// Companion apps, copied verbatim (self-contained; these files have no <head>,
// so the stale-guard anchors on <title>). Pulse serves at /pulse/, Tracker at /tracker/.
/* agent-preview is the Chatterbox AgentOS PROTOTYPE served behind the same CB
   login, for review only. It runs on the prototype's own fourteen sample people,
   so it is deliberately NOT at /agent/ — putting invented commission figures in
   front of 130 real agents would be worse than showing them nothing. */
/* wimpy is the lunch-ordering app (2026-09-10): its own CB-number sign-in, no auth-gate — the
   Worker's session scope is its lock. Served at /wimpy/, linked from the VAS Apps page. */
for (const [srcDir, urlDir, label] of [['nicks_code', 'pulse', 'VAS'], ['tracker', 'tracker', 'Tracker Analytics'], ['agent', 'agent', 'Agent Analytics'], ['agent-preview', 'agent-preview', 'Agent Analytics (prototype)'], ['wimpy', 'wimpy', 'Wimpy Order']]) {
  const src = path.join(root, srcDir, 'index.html');
  if (!fs.existsSync(src)) { console.warn('NOTE: ' + srcDir + '/index.html not found — suite deploys without ' + label + '.'); continue; }
  fs.mkdirSync(path.join(outDir, urlDir), { recursive: true });
  let app = fs.readFileSync(src, 'utf8');
  const i = app.indexOf('<title>');
  if (i !== -1) app = app.slice(0, i) + STALE_GUARD + '\n' + app.slice(i);
  fs.writeFileSync(path.join(outDir, urlDir, 'index.html'), app);
  console.log('Wrote site/' + urlDir + '/index.html (' + label + ') with stale-guard.');
}

// Extra self-contained pages served alongside a companion app (e.g. the VT MTD report
// embedded as the Tracker's third tab via <iframe src="vt-mtd-report.html">). Copied
// verbatim — no shim, no gate; access is controlled by the parent (already-gated) tab.
const VT_REL = 'tracker/vt-mtd-report.html';
fs.mkdirSync(path.join(outDir, 'tracker'), { recursive: true });
fs.copyFileSync(path.join(root, VT_REL), path.join(outDir, VT_REL));
console.log('Wrote site/' + VT_REL + ' (embedded page).');

// BUILD CONSISTENCY IS VERIFIED, NOT ASSUMED (2026-09-02). A run that died between
// writing build.txt and rewriting an app shell left site/agent on the previous build
// while build.txt moved on — deployed, that made EVERY agent tab, even freshly
// reloaded, fail the stale check and show the "outdated version" banner forever
// ("the reload keeps coming"). The failure was invisible because the caller piped
// the output away and shell-chained to the deploy regardless. So the tool now reads
// back everything it wrote and refuses to finish unless every shell carries THIS
// run's build id — a partial site/ exits nonzero and names the file.
{
  const shells = ['index.html', 'pulse/index.html', 'tracker/index.html',
    'agent/index.html', 'agent-preview/index.html', 'wimpy/index.html'];
  const bad = [];
  for (const rel of shells) {
    const p = path.join(outDir, rel);
    if (!fs.existsSync(p)) { bad.push(rel + ' (missing)'); continue; }
    const m = fs.readFileSync(p, 'utf8').match(/CBX_BUILD='([^']+)'/);
    if (!m || m[1] !== BUILD) bad.push(rel + ' (carries ' + (m ? m[1] : 'no build id') + ', want ' + BUILD + ')');
  }
  const bt = fs.readFileSync(path.join(outDir, 'build.txt'), 'utf8').trim();
  if (bt !== BUILD) bad.push('build.txt (says ' + bt + ', want ' + BUILD + ')');
  if (bad.length) {
    console.error('BUILD INCONSISTENT — deploying this site/ would trap every tab in the stale banner:');
    for (const b of bad) console.error('  ' + b);
    process.exit(1);
  }
  console.log('Build consistency verified: all ' + shells.length + ' shells + build.txt carry ' + BUILD + '.');
}

console.log('Next: /deploy  (npx wrangler pages deploy site --project-name chatterbox-agentos)');
