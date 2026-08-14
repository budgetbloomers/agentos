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
    window.storage = {
      async get(k) {
        await tokenWait;
        var h = authHdr();
        if (h) {
          try {
            var r = await fetch(API + '?key=' + encodeURIComponent(k), { headers: h });
            if (r.status === 404) {
              // Cloud is authoritative and has nothing here — purge any stale
              // local copy so this device can NEVER push old data back up.
              delete mem[k];
              try { localStorage.removeItem('cbx:' + k); } catch (e) {}
              return null;
            }
            if (r.ok) {
              var data = await r.text();
              mem[k] = data;
              try { localStorage.setItem('cbx:' + k, data); } catch (e) { /* quota — mem cache still holds it */ }
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
        if (!h) { cbxSaveWarn('Not signed in — this data was NOT saved to the database.'); return; }
        try {
          var r = await fetch(API + '?key=' + encodeURIComponent(k), { method: 'POST', headers: { 'Authorization': h.Authorization, 'Content-Type': 'text/plain', 'X-Cbx-Client': 'v5' }, body: v });
          if (!r.ok) cbxSaveWarn('Cloud save failed (' + r.status + ') — this data is NOT in the database. Try again or re-login.');
        } catch (e) { cbxSaveWarn('Cloud save failed (network) — this data is NOT in the database. Check your connection and retry.'); }
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
for (const [srcDir, urlDir, label] of [['nicks_code', 'pulse', 'VAS'], ['tracker', 'tracker', 'Tracker Analytics']]) {
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

console.log('Next: /deploy  (npx wrangler pages deploy site --project-name chatterbox-agentos)');
