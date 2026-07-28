/* Chatterbox AgentOS — auth gate. Injected into both apps. Same-origin file
   (CSP 'self'). Controls access, session, forced password change, sign-out,
   and per-tab hiding. The Worker API is the real enforcer; this is the UX. */
(function () {
  var WORKER = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
  var APP = location.pathname.indexOf('/pulse') !== -1 ? 'vas' : (location.pathname.indexOf('/tracker') !== -1 ? 'tracker' : 'ops');
  var TKEY = 'cbx_token';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function overlay(inner) {
    var o = document.getElementById('cbxAuth');
    if (!o) { o = document.createElement('div'); o.id = 'cbxAuth'; document.documentElement.appendChild(o); }
    o.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:radial-gradient(1200px 700px at 75% -10%,rgba(46,124,246,.16),transparent 60%),#050D1C;display:flex;align-items:center;justify-content:center;font-family:Inter,Segoe UI,system-ui,sans-serif');
    o.innerHTML = '<div style="width:340px;max-width:92vw;background:linear-gradient(180deg,rgba(148,182,255,.05),rgba(148,182,255,.02)),#0A1730;border:1px solid rgba(148,182,255,.14);border-radius:16px;padding:26px 24px;box-shadow:0 24px 60px rgba(0,0,0,.6)">' + inner + '</div>';
    return o;
  }
  function loginForm(msg, err) {
    overlay(
      '<div style="text-align:center;margin-bottom:18px"><div style="font-size:20px;font-weight:800;letter-spacing:-.4px;color:#EAF1FB">CHATTER<span style="color:#3D9BFF">BOX</span></div><div style="font-size:11px;color:#8296B5;margin-top:2px">The Chatterbox AgentOS</div></div>'
      + (err ? '<div style="background:rgba(251,113,133,.14);border:1px solid rgba(251,113,133,.3);color:#FB7185;font-size:12px;padding:8px 11px;border-radius:9px;margin-bottom:12px">' + esc(err) + '</div>' : '')
      + (msg ? '<div style="font-size:12px;color:#8296B5;margin-bottom:12px">' + esc(msg) + '</div>' : '')
      + '<input id="cbxU" placeholder="Username" autocomplete="username" style="width:100%;box-sizing:border-box;background:#081A31;border:1px solid rgba(148,182,255,.18);color:#EAF1FB;border-radius:10px;padding:11px 13px;margin-bottom:9px;font-size:13px">'
      + '<input id="cbxP" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;box-sizing:border-box;background:#081A31;border:1px solid rgba(148,182,255,.18);color:#EAF1FB;border-radius:10px;padding:11px 13px;margin-bottom:14px;font-size:13px">'
      + '<button id="cbxGo" style="width:100%;border:none;border-radius:10px;padding:11px;font-weight:800;font-size:13px;background:linear-gradient(135deg,#2E7CF6,#38C6F4);color:#04101F;cursor:pointer">Sign in</button>'
    );
    var go = document.getElementById('cbxGo'), u = document.getElementById('cbxU'), p = document.getElementById('cbxP');
    var submit = function () { doLogin(u.value.trim(), p.value); };
    go.onclick = submit;
    p.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    u.focus();
  }
  function changeForm() {
    overlay(
      '<div style="font-size:15px;font-weight:800;color:#EAF1FB;margin-bottom:6px">Set a new password</div>'
      + '<div style="font-size:12px;color:#8296B5;margin-bottom:14px">First sign-in — choose a password (min 10 characters).</div>'
      + '<input id="cbxN1" type="password" placeholder="New password" style="width:100%;box-sizing:border-box;background:#081A31;border:1px solid rgba(148,182,255,.18);color:#EAF1FB;border-radius:10px;padding:11px 13px;margin-bottom:9px;font-size:13px">'
      + '<input id="cbxN2" type="password" placeholder="Confirm new password" style="width:100%;box-sizing:border-box;background:#081A31;border:1px solid rgba(148,182,255,.18);color:#EAF1FB;border-radius:10px;padding:11px 13px;margin-bottom:14px;font-size:13px">'
      + '<div id="cbxNe" style="color:#FB7185;font-size:12px;margin-bottom:10px;display:none"></div>'
      + '<button id="cbxNg" style="width:100%;border:none;border-radius:10px;padding:11px;font-weight:800;font-size:13px;background:linear-gradient(135deg,#2E7CF6,#38C6F4);color:#04101F;cursor:pointer">Set password &amp; continue</button>'
    );
    document.getElementById('cbxNg').onclick = function () {
      var a = document.getElementById('cbxN1').value, b = document.getElementById('cbxN2').value, e = document.getElementById('cbxNe');
      if (a.length < 10) { e.style.display = 'block'; e.textContent = 'At least 10 characters.'; return; }
      if (a !== b) { e.style.display = 'block'; e.textContent = 'Passwords do not match.'; return; }
      api('/api/password', { new_password: a }).then(function (r) {
        if (r.ok) authed(); else { e.style.display = 'block'; e.textContent = r.error || 'Could not set password.'; }
      });
    };
  }
  function api(path, body) {
    var opt = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Cbx-Client': 'v4' } };
    var tok = sessionStorage.getItem(TKEY); if (tok) opt.headers.Authorization = 'Bearer ' + tok;
    if (body) opt.body = JSON.stringify(body);
    return fetch(WORKER + path, opt).then(function (r) { return r.json().then(function (j) { return Object.assign({ _status: r.status, ok: r.ok }, j); }); })
      .catch(function () { return { ok: false, error: 'Cannot reach the server.' }; });
  }
  function doLogin(username, password) {
    if (!username || !password) return;
    api('/api/login', { username: username, password: password }).then(function (r) {
      if (r._status === 200 && r.token) {
        sessionStorage.setItem(TKEY, r.token);
        window.CBX_USER = r.user;
        if (r.user.must_change_password) changeForm(); else authed();
      } else loginForm(null, r.error || 'Sign in failed.');
    });
  }
  function authed() {
    var o = document.getElementById('cbxAuth'); if (o) o.remove();
    window.CBX_AUTH = { user: window.CBX_USER, token: sessionStorage.getItem(TKEY), api: api, app: APP,
      logout: function () { api('/api/logout', {}); sessionStorage.removeItem(TKEY); location.reload(); } };
    document.dispatchEvent(new CustomEvent('cbx-authed', { detail: window.CBX_USER }));
    applyPerms();
    addSignout();
  }
  function allowedTabs() {
    var u = window.CBX_USER || {}; var t = (u.tabs || {})[APP] || [];
    return { all: u.role === 'admin' || t.indexOf('*') !== -1, list: t };
  }
  function applyPerms() {
    var perm = allowedTabs(); if (perm.all) return;
    var SEL = '.nav-item[onclick], .navitem[data-page], .tab-btn[data-page]'; // Ops go('id') · VAS data-page · Tracker tab-btn data-page
    var hide = function () {
      document.querySelectorAll(SEL).forEach(function (el) {
        var id = el.getAttribute('data-page');
        if (!id) { var m = (el.getAttribute('onclick') || '').match(/go\(['"]([^'"]+)['"]\)/); id = m && m[1]; }
        if (id && id.indexOf('soon_') !== 0 && perm.list.indexOf(id) === -1) el.style.display = 'none';
      });
      // If the ACTIVE tab just got hidden (e.g. the app boots on a tab this user
      // may not see), route to the first tab they ARE allowed — otherwise they
      // land on content their mapping excludes, or on a blank shell.
      var act = document.querySelector('.nav-item.active[onclick], .navitem.on[data-page], .tab-btn[data-page][aria-selected="true"]');
      if (act && act.style.display === 'none') {
        var first = Array.prototype.find.call(document.querySelectorAll(SEL), function (el) { return el.style.display !== 'none'; });
        if (first) first.click();
      }
    };
    hide();
    var nav = document.getElementById('nav') || document.querySelector('.side') || document.body;
    new MutationObserver(hide).observe(nav, { childList: true, subtree: true });
  }
  function addSignout() {
    // If the page already provides its own sign-out (Ops has one in the sidebar
    // user card), don't add the floating fallback button.
    if (document.getElementById('signOutBtn')) return;
    if (document.getElementById('cbxOut')) return;
    var b = document.createElement('button'); b.id = 'cbxOut'; b.title = 'Sign out ' + (window.CBX_USER && window.CBX_USER.username || '');
    b.textContent = '⏻';
    b.setAttribute('style', 'position:fixed;left:14px;bottom:14px;z-index:2147483000;width:34px;height:34px;border-radius:50%;border:1px solid rgba(148,182,255,.2);background:rgba(148,182,255,.1);color:#C6D3E8;cursor:pointer;font-size:15px');
    b.onclick = function () { if (window.CBX_AUTH) window.CBX_AUTH.logout(); };
    document.body.appendChild(b);
  }

  function boot() {
    var tok = sessionStorage.getItem(TKEY);
    if (!tok) { loginForm(); return; }
    api('/api/me').then(function (r) {
      if (r._status === 200 && r.user) { window.CBX_USER = r.user; if (r.user.must_change_password) changeForm(); else authed(); }
      else { sessionStorage.removeItem(TKEY); loginForm(); }
    });
  }
  // cover immediately (pre-DOM) so nothing flashes, then boot when DOM ready
  if (document.readyState === 'loading') { overlay('<div style="color:#8296B5;font-size:13px;text-align:center">Loading…</div>'); document.addEventListener('DOMContentLoaded', boot); }
  else boot();
})();
