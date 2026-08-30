/* ask-widget.js - the "Ask AgentOS" chat widget, shared by the companion apps
   (Pulse/VAS at /pulse/, Tracker at /tracker/). Loaded same-origin exactly like
   auth-gate.js: <script src="/ask-widget.js"></script>.

   Each app keeps its OWN context builder (cbxVasContext / cbxTrackerContext) -
   those are genuinely different and are not part of this asset. The app sets a
   small config BEFORE loading this script:

     <script>window.CBX_ASK={
       ctx:        () => cbxVasContext(),   // LAZY: called at send/push time, so the
                                            // context fn may be defined later in the page
       placeholder:'Ask about VAS, the framework, or the numbers...',
       blurb:      'VAS numbers, the framework, or the KB.',
       sugg:       ['...','...','...'],
       digestKey:  'ai-digest-vas',
       guard:      () => Boolean(...)       // false = this session is empty; never
                                            // overwrite a rich digest in the cloud
     }</script>
     <script src="/ask-widget.js"></script>

   The Ops dashboard (Chatterbox_AgentOS_Analytics.html) deliberately does NOT use
   this file - see the note at the bottom. */
(function () {
  var C = window.CBX_ASK || {};
  var API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';

  window.askMsgs = window.askMsgs || [];
  window.askOpen = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] || c }) }
  window.askEsc = esc;

  document.body.insertAdjacentHTML('beforeend', "<div id=\"askFab\" onclick=\"askToggle()\" title=\"Ask AgentOS\" style=\"position:fixed;right:22px;bottom:22px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#38BDF8);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:80;box-shadow:0 10px 28px rgba(46,124,246,.45)\"><svg viewBox=\"0 0 24 24\" width=\"25\" height=\"25\" fill=\"#FFFFFF\"><path d=\"M4 4h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-8.5l-5 4v-4H4a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 4 4z\"/><circle cx=\"8.5\" cy=\"10.5\" r=\"1.2\" fill=\"#38BDF8\"/><circle cx=\"12\" cy=\"10.5\" r=\"1.2\" fill=\"#38BDF8\"/><circle cx=\"15.5\" cy=\"10.5\" r=\"1.2\" fill=\"#38BDF8\"/></svg></div>\n<div id=\"askPanel\" style=\"display:none;position:fixed;right:22px;bottom:84px;width:372px;max-width:calc(100vw - 30px);height:500px;max-height:calc(100vh - 120px);background:#FFFFFF;border:1px solid #C7D2E4;border-radius:16px;z-index:81;flex-direction:column;box-shadow:0 24px 60px rgba(15,30,54,.35);overflow:hidden\"><div style=\"display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #E3E9F3;font-size:13.5px;color:#0F1E36\"><b>Ask AgentOS</b><span id=\"askStatus\" style=\"margin-left:auto;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:rgba(52,211,153,.15);color:#34D399\">AI online</span><button onclick=\"askToggle()\" style=\"border:none;background:#E3E9F3;color:#3B4A63;width:26px;height:26px;border-radius:50%;cursor:pointer;font-weight:800\">✕</button></div><div id=\"askLog\" style=\"flex:1;overflow-y:auto;padding:14px;font-size:12.5px;color:#3B4A63\"></div><div style=\"display:flex;gap:8px;padding:10px;border-top:1px solid #E3E9F3\"><input id=\"askIn\" type=\"text\" placeholder=\""+esc(C.placeholder||"")+"\" style=\"flex:1;border:1px solid #C7D2E4;background:#F7FAFE;color:#0F1E36;border-radius:9px;padding:9px 12px;font-size:12.5px\" onkeydown=\"if(event.key==='Enter')askSend()\"><button onclick=\"askSend()\" style=\"border:none;border-radius:9px;padding:0 14px;font-weight:800;background:linear-gradient(135deg,#2563EB,#38BDF8);color:#FFFFFF;cursor:pointer\">Ask</button></div></div>");

  window.askToggle = function () { window.askOpen = !window.askOpen; var p = document.getElementById("askPanel"); p.style.display = window.askOpen ? "flex" : "none"; if (window.askOpen) { askRender(); var s0 = document.getElementById("askStatus"); if (s0 && sessionStorage.getItem("cbx_token")) { s0.textContent = "AI online"; s0.style.background = "rgba(52,211,153,.15)"; s0.style.color = "#34D399" } setTimeout(function () { var i = document.getElementById("askIn"); if (i) i.focus() }, 0) } };

  window.askFill = function (t) { var i = document.getElementById("askIn"); if (i) { i.value = t; i.focus() } };

  function askRender() { var l = document.getElementById("askLog"); if (!l) return; var sug = C.sugg || []; if (!window.askMsgs.length) { l.innerHTML = "<div style='text-align:center;color:#71809B;padding:22px 8px'><div style='font-size:14px;font-weight:800;color:#3B4A63;margin-bottom:5px'>Ask your operation anything</div><p style='font-size:12px'>" + esc(C.blurb || "") + "</p><div style='margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center'>" + sug.map(function (s) { return "<button onclick='askFill(this.textContent)' style='border:1px solid #C7D2E4;background:#F1F5FB;color:#3B4A63;border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer'>" + esc(s) + "</button>" }).join("") + "</div></div>"; return } l.innerHTML = window.askMsgs.map(function (m) { return "<div style='display:flex;" + (m.role === "user" ? "justify-content:flex-end" : "") + ";margin-bottom:9px'><div style='max-width:84%;padding:9px 12px;border-radius:13px;line-height:1.5;" + (m.role === "user" ? "background:linear-gradient(135deg,#2563EB,#38BDF8);color:#FFFFFF" : "background:#0E2244;border:1px solid #E3E9F3") + "'>" + m.html + "</div></div>" }).join(""); l.scrollTop = l.scrollHeight }
  window.askRender = askRender;

  window.askSend = async function () {
    var inp = document.getElementById("askIn"); var q = (inp && inp.value || "").trim(); if (!q) return;
    inp.value = ""; window.askMsgs.push({ role: "user", html: esc(q) }); askRender();
    var st = document.getElementById("askStatus"); var html;
    try {
      var r = await fetch(API + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (sessionStorage.getItem("cbx_token") || "") }, body: JSON.stringify({ question: q, context: C.ctx ? C.ctx() : "" }) });
      if (!r.ok) throw 0;
      var j = await r.json();
      html = esc(j.answer || "(empty)");
      if (st) { st.textContent = "AI online"; st.style.background = "rgba(52,211,153,.15)"; st.style.color = "#34D399" }
    } catch (e) {
      if (st) { st.textContent = "AI offline"; st.style.background = "rgba(251,191,36,.15)"; st.style.color = "#FBBF24" }
      html = "Could not reach the AI just now \u2014 please try again in a moment.";
    }
    window.askMsgs.push({ role: "assistant", html: html }); askRender();
  };

  /* cbx-digest-push: keep this app's AI digest current in the cloud. The guard is
     app-specific (what counts as "this session actually has data") and is passed in;
     an empty session must never overwrite a rich digest. */
  if (C.digestKey && C.ctx) {
    var last = '';
    var push = function () {
      try {
        var tk = sessionStorage.getItem('cbx_token'); if (!tk) return;
        if (C.guard && !C.guard()) return;
        var t = C.ctx(); if (!t || t === last) return; last = t;
        fetch(API + '/api/kv?key=' + encodeURIComponent(C.digestKey), { method: 'POST', headers: { 'Content-Type': 'text/plain', 'Authorization': 'Bearer ' + tk, 'X-Cbx-Client': 'v5' }, body: t }).catch(function () { });
      } catch (e) { }
    };
    setInterval(push, 90000);
    document.addEventListener('cbx-authed', function () { setTimeout(push, 7000); });
    setTimeout(push, 10000);
  }
})();

/* NOT shared with the Ops dashboard, deliberately. Chatterbox_AgentOS_Analytics.html
   has its own Ask widget that only LOOKS like this one: it renders from class-based
   markup (.ask-fab/.ask-panel) instead of inline styles, keeps its log in state.askLog
   rather than window.askMsgs, renders into #askLogBox via renderAskLog(), drives an
   askOnline chip, converts newlines to <br>, resolves its endpoint from the askEndpoint
   rule, and pushes its digest through window.storage (the prepare-site shim) gated on
   _dataVer. Nothing but the SVG icon is copy-paste. Folding it in would mean
   parameterising every line - more complexity than the duplication removes. */
