/* Chatterbox AgentOS — auth gate. Injected into both apps. Same-origin file
   (CSP 'self'). Controls access, session, forced password change, sign-out,
   and per-tab hiding. The Worker API is the real enforcer; this is the UX. */
(function () {
  var WORKER = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
  var APP = location.pathname.indexOf('/pulse') !== -1 ? 'vas' : (location.pathname.indexOf('/tracker') !== -1 ? 'tracker' : 'ops');
  var TKEY = 'cbx_token';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };


  /* ============ PER-ACCOUNT THEME (Nick, 2026-08-30) ============
     "there must be a toggle for peoples account, some people like to have dark
     theme and light theme, so when they click save that is the theme for their
     account."

     THE ACCOUNT IS THE RECORD, localStorage IS ONLY A CACHE. The saved value
     lives on app_users.theme, so it follows the person to any machine. The
     local copy exists for one reason: /api/me is a round trip, and without a
     cached value every dark-theme user would watch a white page repaint itself
     on every single load. It is written only from what the server confirmed,
     and a mismatch always resolves to the server's answer.

     WHY IT IS NOT prefers-color-scheme. A shared floor machine follows whoever
     set the OS, which is nobody's account. Two people signing in to the same
     desktop must each get their own skin, so the preference is a stored choice
     and never an inferred one.

     The suite still wears ONE SKIN — light is the default and stays the default
     for every account that never touches this. This is a personal override. */
  var THKEY = 'cbx_theme';
  function themeRead() { try { var t = localStorage.getItem(THKEY); return (t === 'dark' || t === 'light') ? t : null; } catch (e) { return null; } }
  function themeApply(t) { document.documentElement.dataset.theme = (t === 'dark') ? 'dark' : 'light'; }
  function themeCache(t) { try { (t === 'dark' || t === 'light') ? localStorage.setItem(THKEY, t) : localStorage.removeItem(THKEY); } catch (e) {} }
  /* Applied before the API answers so a dark account never flashes white. The
     inline snippet at the top of each app does the same thing one tick earlier,
     for the case where this file itself is still loading. */
  themeApply(themeRead());

  /* The account's answer wins over the cache, always — including when it is
     "no preference", which must clear a stale local copy rather than let a
     machine keep showing dark to somebody who turned it off elsewhere. */
  function themeSync(user) {
    var t = (user && user.theme === 'dark') ? 'dark' : (user && user.theme === 'light') ? 'light' : null;
    themeCache(t);
    themeApply(t);
  }

  /* The control itself. Two choices and an explicit Save, deliberately: clicking
     a swatch PREVIEWS the theme so the decision is made on the real page rather
     than on a word, and nothing is written to the account until Save is pressed.
     Closing without saving therefore costs nothing — a reload restores whatever
     the account actually holds. */
  function themePanel() {
    var saved = themeRead();
    var picked = saved || 'light';
    var wrap = document.createElement('div');
    wrap.id = 'cbxThemePanel';
    wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483600;background:rgba(10,23,48,.45);display:flex;align-items:center;justify-content:center;font-family:Inter,Segoe UI,system-ui,sans-serif');
    var card = 'background:var(--card,#FFFFFF);color:var(--ink,#0F1E36);border:1px solid var(--line,#E3E9F3);border-radius:16px;padding:22px 22px 18px;width:330px;max-width:92vw;box-shadow:0 10px 30px rgba(0,0,0,.28)';
    var swatch = function (v, label, bg, fg, bd) {
      return '<button data-th="' + v + '" style="flex:1;border-radius:12px;padding:0;overflow:hidden;cursor:pointer;background:none;border:2px solid ' + (v === picked ? '#2563EB' : 'var(--line,#E3E9F3)') + '">'
        + '<span style="display:block;height:52px;background:' + bg + ';border-bottom:1px solid ' + bd + '">'
        + '<span style="display:block;height:9px;margin:11px 10px 0;border-radius:3px;background:' + fg + ';opacity:.85"></span>'
        + '<span style="display:block;height:9px;margin:6px 22px 0 10px;border-radius:3px;background:' + fg + ';opacity:.45"></span></span>'
        + '<span style="display:block;padding:7px 0;font-size:12px;font-weight:800;color:var(--ink,#0F1E36)">' + label + '</span></button>';
    };
    wrap.innerHTML = '<div style="' + card + '">'
      + '<div style="font-size:15px;font-weight:800;margin-bottom:3px">Appearance</div>'
      + '<div style="font-size:12px;color:var(--muted,#71809B);margin-bottom:14px">Saved to your account, so it follows you to any machine you sign in on.</div>'
      + '<div id="cbxThRow" style="display:flex;gap:10px;margin-bottom:14px">'
      + swatch('light', 'Light', '#F2F5FA', '#0F1E36', '#E3E9F3')
      + swatch('dark', 'Dark', '#070F1F', '#E8EEF9', '#1E2A44')
      + '</div>'
      + '<div id="cbxThMsg" style="font-size:12px;color:var(--muted,#71809B);margin-bottom:12px;min-height:16px"></div>'
      + '<div style="display:flex;gap:8px">'
      + '<button id="cbxThSave" style="flex:1;border:none;border-radius:10px;padding:10px;font-weight:800;font-size:13px;background:linear-gradient(135deg,#2563EB,#38BDF8);color:#fff;cursor:pointer">Save</button>'
      + '<button id="cbxThCancel" style="border:1px solid var(--line,#E3E9F3);background:var(--card,#fff);color:var(--body,#3B4A63);border-radius:10px;padding:10px 14px;font-weight:700;font-size:13px;cursor:pointer">Cancel</button>'
      + '</div></div>';
    document.body.appendChild(wrap);

    var msg = wrap.querySelector('#cbxThMsg');
    var marks = function () {
      var bs = wrap.querySelectorAll('[data-th]');
      for (var i = 0; i < bs.length; i++)
        bs[i].style.borderColor = (bs[i].getAttribute('data-th') === picked) ? '#2563EB' : 'var(--line,#E3E9F3)';
    };
    /* Leaving without saving must not strand the page on a preview. */
    var close = function () { themeApply(themeRead()); wrap.remove(); };

    wrap.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-th]') : null;
      if (b) { picked = b.getAttribute('data-th'); themeApply(picked); marks();
        msg.textContent = 'Previewing ' + picked + ' — press Save to keep it.'; return; }
      if (e.target === wrap) close();
    });
    wrap.querySelector('#cbxThCancel').onclick = close;
    wrap.querySelector('#cbxThSave').onclick = function () {
      var btn = wrap.querySelector('#cbxThSave');
      btn.disabled = true; btn.textContent = 'Saving…';
      api('/api/theme', { theme: picked }).then(function (r) {
        if (r.ok) {
          themeCache(picked); themeApply(picked);
          if (window.CBX_USER) window.CBX_USER.theme = picked;
          btn.textContent = 'Saved'; msg.textContent = 'This is now your theme on every Chatterbox app.';
          setTimeout(function () { wrap.remove(); }, 750);
        } else {
          btn.disabled = false; btn.textContent = 'Save';
          msg.textContent = r.error || 'Could not save that — try again.';
        }
      });
    };
  }

  function overlay(inner) {
    var o = document.getElementById('cbxAuth');
    if (!o) { o = document.createElement('div'); o.id = 'cbxAuth'; document.documentElement.appendChild(o); }
    o.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:radial-gradient(1200px 700px at 75% -10%,rgba(37,99,235,.06),transparent 60%),#F2F5FA;display:flex;align-items:center;justify-content:center;font-family:Inter,Segoe UI,system-ui,sans-serif');
    o.innerHTML = '<div style="width:340px;max-width:92vw;background:#FFFFFF;border:1px solid #E3E9F3;border-radius:16px;padding:26px 24px;box-shadow:0 10px 30px rgba(15,30,54,.14)">' + inner + '</div>';
    return o;
  }
  function loginForm(msg, err) {
    overlay(
      '<div style="text-align:center;margin-bottom:18px"><div style="font-size:20px;font-weight:800;letter-spacing:-.4px;color:#0F1E36">CHATTER<span style="color:#2563EB">BOX</span></div><div style="font-size:11px;color:#71809B;margin-top:2px">The Chatterbox AgentOS</div></div>'
      + (err ? '<div style="background:rgba(251,113,133,.14);border:1px solid rgba(251,113,133,.3);color:#C42D2D;font-size:12px;padding:8px 11px;border-radius:9px;margin-bottom:12px">' + esc(err) + '</div>' : '')
      + (msg ? '<div style="font-size:12px;color:#71809B;margin-bottom:12px">' + esc(msg) + '</div>' : '')
      + '<input id="cbxU" placeholder="Username" autocomplete="username" style="width:100%;box-sizing:border-box;background:#F7FAFE;border:1px solid #E3E9F3;color:#0F1E36;border-radius:10px;padding:11px 13px;margin-bottom:9px;font-size:13px">'
      + '<input id="cbxP" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;box-sizing:border-box;background:#F7FAFE;border:1px solid #E3E9F3;color:#0F1E36;border-radius:10px;padding:11px 13px;margin-bottom:14px;font-size:13px">'
      + '<button id="cbxGo" style="width:100%;border:none;border-radius:10px;padding:11px;font-weight:800;font-size:13px;background:linear-gradient(135deg,#2563EB,#38BDF8);color:#FFFFFF;cursor:pointer">Sign in</button>'
    );
    var go = document.getElementById('cbxGo'), u = document.getElementById('cbxU'), p = document.getElementById('cbxP');
    var submit = function () { doLogin(u.value.trim(), p.value); };
    go.onclick = submit;
    p.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    u.focus();
  }
  function changeForm() {
    overlay(
      '<div style="font-size:15px;font-weight:800;color:#0F1E36;margin-bottom:6px">Set a new password</div>'
      + '<div style="font-size:12px;color:#71809B;margin-bottom:14px">First sign-in — choose a password (min 10 characters).</div>'
      + '<input id="cbxN1" type="password" placeholder="New password" style="width:100%;box-sizing:border-box;background:#F7FAFE;border:1px solid #E3E9F3;color:#0F1E36;border-radius:10px;padding:11px 13px;margin-bottom:9px;font-size:13px">'
      + '<input id="cbxN2" type="password" placeholder="Confirm new password" style="width:100%;box-sizing:border-box;background:#F7FAFE;border:1px solid #E3E9F3;color:#0F1E36;border-radius:10px;padding:11px 13px;margin-bottom:14px;font-size:13px">'
      + '<div id="cbxNe" style="color:#C42D2D;font-size:12px;margin-bottom:10px;display:none"></div>'
      + '<button id="cbxNg" style="width:100%;border:none;border-radius:10px;padding:11px;font-weight:800;font-size:13px;background:linear-gradient(135deg,#2563EB,#38BDF8);color:#FFFFFF;cursor:pointer">Set password &amp; continue</button>'
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
    var opt = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Cbx-Client': 'v5' } };
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
    themeSync(window.CBX_USER);
    applyPerms();
    addSignout();
    addThemeButton();
  }
  function allowedTabs() {
    var u = window.CBX_USER || {}; var t = (u.tabs || {})[APP] || [];
    return { all: u.role === 'admin' || t.indexOf('*') !== -1, list: t };
  }
  /* NO ACCESS TO THIS APP IS AN ANSWER, NOT AN EMPTY SCREEN.
     A user whose account carries no tabs for the app they opened used to authenticate
     successfully and then watch every nav item get hidden one by one, leaving a working
     shell with an empty sidebar. That reads as "the dashboard is broken" — it is how
     "the Upload Station isn't showing" was reported (Keshree, Ops-only, on /pulse/).
     Say so plainly, and point at the app they DO have. */
  function noAccessNotice() {
    var u = window.CBX_USER || {};
    var NAMES = { vas: 'VAS Analytics', ops: 'Ops Analytics', tracker: 'Tracker Analytics' };
    var PATHS = { vas: '/pulse/', ops: '/', tracker: '/tracker/' };
    var mine = (u.apps || []).filter(function (a) { return a !== APP && NAMES[a]; });
    overlay(
      '<div style="text-align:center"><div style="font-size:20px;font-weight:800;letter-spacing:-.4px;color:#0F1E36">CHATTER<span style="color:#2563EB">BOX</span></div>'
      + '<div style="font-size:15px;font-weight:700;color:#0F1E36;margin:16px 0 6px">No access to ' + esc(NAMES[APP] || APP) + '</div>'
      + '<div style="font-size:12.5px;color:#71809B;line-height:1.6">Signed in as <b style="color:#0F1E36">' + esc(u.username || '') + '</b>. '
      + 'This account has no tabs in this app, so there is nothing to show — the dashboard is working, your account simply is not on it.<br>'
      + 'Ask Nick or Nicholas if you need it.</div>'
      + (mine.length ? '<div style="margin-top:16px">' + mine.map(function (a) {
          return '<a href="' + PATHS[a] + '" style="display:inline-block;margin:4px;border-radius:10px;padding:10px 14px;font-weight:800;font-size:12.5px;background:linear-gradient(135deg,#2563EB,#38BDF8);color:#FFFFFF;text-decoration:none">Go to ' + esc(NAMES[a]) + '</a>';
        }).join('') + '</div>' : '')
      + '<div style="margin-top:14px"><button id="cbxNoAccOut" style="border:none;background:none;color:#71809B;font-size:12px;cursor:pointer;text-decoration:underline">Sign out</button></div></div>'
    );
    var b = document.getElementById('cbxNoAccOut');
    if (b) b.onclick = function () { api('/api/logout', {}); sessionStorage.removeItem(TKEY); location.reload(); };
  }
  function applyPerms() {
    var perm = allowedTabs(); if (perm.all) return;
    if (!perm.list.length) { noAccessNotice(); return; }
    var hide = function () {
      // Ops nav-items carry onclick="go('id')"; VAS navitems carry data-page
      document.querySelectorAll('.nav-item[onclick], .navitem[data-page]').forEach(function (el) {
        var id = el.getAttribute('data-page');
        if (!id) { var m = (el.getAttribute('onclick') || '').match(/go\(['"]([^'"]+)['"]\)/); id = m && m[1]; }
        if (id && id.indexOf('soon_') !== 0 && perm.list.indexOf(id) === -1) el.style.display = 'none';
      });
    };
    hide();
    var nav = document.getElementById('nav') || document.querySelector('.side') || document.body;
    new MutationObserver(hide).observe(nav, { childList: true, subtree: true });
  }
  /* The entry point. It sits beside sign-out rather than inside any one app's
     sidebar, because all three management apps share this file and none of them
     has a settings screen to put it in. */
  function addThemeButton() {
    if (document.getElementById('cbxTheme')) return;
    var b = document.createElement('button');
    b.id = 'cbxTheme';
    b.title = 'Appearance — light or dark';
    b.textContent = '◐';
    var low = document.getElementById('signOutBtn') || document.getElementById('cbxOut');
    b.setAttribute('style', 'position:fixed;left:' + (low ? '54px' : '14px') + ';bottom:14px;z-index:2147483000;width:34px;height:34px;border-radius:50%;border:1px solid var(--line,#E3E9F3);background:var(--card,#FFFFFF);color:var(--body,#3B4A63);cursor:pointer;font-size:15px;line-height:1');
    b.onclick = themePanel;
    document.body.appendChild(b);
  }

  function addSignout() {
    // If the page already provides its own sign-out (Ops has one in the sidebar
    // user card), don't add the floating fallback button.
    if (document.getElementById('signOutBtn')) return;
    if (document.getElementById('cbxOut')) return;
    var b = document.createElement('button'); b.id = 'cbxOut'; b.title = 'Sign out ' + (window.CBX_USER && window.CBX_USER.username || '');
    b.textContent = '⏻';
    b.setAttribute('style', 'position:fixed;left:14px;bottom:14px;z-index:2147483000;width:34px;height:34px;border-radius:50%;border:1px solid #E3E9F3;background:#FFFFFF;color:#3B4A63;cursor:pointer;font-size:15px');
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
  if (document.readyState === 'loading') { overlay('<div style="color:#71809B;font-size:13px;text-align:center">Loading…</div>'); document.addEventListener('DOMContentLoaded', boot); }
  else boot();
})();
