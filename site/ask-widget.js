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

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c }) }
  window.askEsc = esc;

  document.body.insertAdjacentHTML('beforeend', "<div id=\"askFab\" onclick=\"askToggle()\" title=\"Ask AgentOS\" style=\"position:fixed;right:22px;bottom:22px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#2E7CF6,#38C6F4);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:80;box-shadow:0 10px 28px rgba(46,124,246,.45)\"><svg viewBox=\"0 0 24 24\" width=\"25\" height=\"25\" fill=\"#04101F\"><path d=\"M4 4h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-8.5l-5 4v-4H4a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 4 4z\"/><circle cx=\"8.5\" cy=\"10.5\" r=\"1.2\" fill=\"#38C6F4\"/><circle cx=\"12\" cy=\"10.5\" r=\"1.2\" fill=\"#38C6F4\"/><circle cx=\"15.5\" cy=\"10.5\" r=\"1.2\" fill=\"#38C6F4\"/></svg></div>\n<div id=\"askPanel\" style=\"display:none;position:fixed;right:22px;bottom:84px;width:372px;max-width:calc(100vw - 30px);height:500px;max-height:calc(100vh - 120px);background:#0A1730;border:1px solid rgba(148,182,255,.18);border-radius:16px;z-index:81;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.55);overflow:hidden\"><div style=\"display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(148,182,255,.12);font-size:13.5px;color:#EAF1FB\"><b>Ask AgentOS</b><span id=\"askStatus\" style=\"margin-left:auto;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:rgba(52,211,153,.15);color:#34D399\">AI online</span><button onclick=\"askToggle()\" style=\"border:none;background:rgba(148,182,255,.12);color:#C6D3E8;width:26px;height:26px;border-radius:50%;cursor:pointer;font-weight:800\">✕</button></div><div id=\"askLog\" style=\"flex:1;overflow-y:auto;padding:14px;font-size:12.5px;color:#C6D3E8\"></div><div style=\"display:flex;gap:8px;padding:10px;border-top:1px solid rgba(148,182,255,.12)\"><input id=\"askIn\" type=\"text\" placeholder=\""+esc(C.placeholder||"")+"\" style=\"flex:1;border:1px solid rgba(148,182,255,.18);background:#081A31;color:#EAF1FB;border-radius:9px;padding:9px 12px;font-size:12.5px\" onkeydown=\"if(event.key==='Enter')askSend()\"><button onclick=\"askSend()\" style=\"border:none;border-radius:9px;padding:0 14px;font-weight:800;background:linear-gradient(135deg,#2E7CF6,#38C6F4);color:#04101F;cursor:pointer\">Ask</button></div></div>");

/* askFmt — safe markdown-lite for AI answers, shared verbatim by the Ops inline
   widget and site/ask-widget.js (kept duplicated on purpose — see the widget's
   footer note). ESCAPES FIRST, then adds only its own tags, so model output can
   never inject markup. Supports: **bold**, *italic*, `code`, # headings,
   -/•/1. lists, | tables, paragraph spacing. Styled for the dark chat bubbles. */
window.askFmt = function askFmt(t){
  t=String(t==null?'':t).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]});
  var lines=t.replace(/\r\n?/g,'\n').split('\n');
  var out=[],list=null;
  var flush=function(){if(!list)return;out.push('<'+list.t+' style="margin:4px 0 4px 17px;padding:0">'+list.items.map(function(i){return '<li style="margin:2px 0">'+i+'</li>'}).join('')+'</'+list.t+'>');list=null};
  var inline=function(s){return s
    .replace(/`([^`]+)`/g,'<code style="background:rgba(148,182,255,.16);border-radius:4px;padding:0 4px;font-size:11.5px">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g,'$1<i>$2</i>')};
  var isRow=function(s){return /^\s*\|.*\|\s*$/.test(s)};
  var i=0;
  while(i<lines.length){
    var ln=lines[i];
    if(isRow(ln)&&i+1<lines.length&&isRow(lines[i+1])){
      flush();var rows=[];
      while(i<lines.length&&isRow(lines[i])){rows.push(lines[i]);i++}
      var cells=function(r){return r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(function(c){return inline(c.trim())})};
      var body=rows.filter(function(r){return !/^\s*\|[\s\-:|]+\|\s*$/.test(r)});
      if(body.length){
        var head=cells(body[0]);
        out.push('<div style="overflow-x:auto"><table style="border-collapse:collapse;margin:6px 0;font-size:11.5px;min-width:60%">'
          +'<tr>'+head.map(function(c){return '<th style="text-align:left;padding:3px 8px;border-bottom:1.5px solid rgba(148,182,255,.4)">'+c+'</th>'}).join('')+'</tr>'
          +body.slice(1).map(function(r){return '<tr>'+cells(r).map(function(c){return '<td style="padding:3px 8px;border-bottom:1px solid rgba(148,182,255,.14)">'+c+'</td>'}).join('')+'</tr>'}).join('')
          +'</table></div>');
      }
      continue;
    }
    var mUl=ln.match(/^\s*[-•*]\s+(.*)/),mOl=ln.match(/^\s*\d+[.)]\s+(.*)/);
    if(mUl){if(!list||list.t!=='ul'){flush();list={t:'ul',items:[]}}list.items.push(inline(mUl[1]));i++;continue}
    if(mOl){if(!list||list.t!=='ol'){flush();list={t:'ol',items:[]}}list.items.push(inline(mOl[1]));i++;continue}
    flush();
    var mH=ln.match(/^\s*#{1,4}\s+(.*)/);
    if(mH){out.push('<div style="font-weight:800;margin:7px 0 3px">'+inline(mH[1])+'</div>');i++;continue}
    if(!ln.trim()){if(out.length&&out[out.length-1]!=='<div style="height:6px"></div>')out.push('<div style="height:6px"></div>');i++;continue}
    out.push('<div style="margin:2px 0">'+inline(ln)+'</div>');i++;
  }
  flush();
  return out.join('');
}

  window.askToggle = function () { window.askOpen = !window.askOpen; var p = document.getElementById("askPanel"); p.style.display = window.askOpen ? "flex" : "none"; if (window.askOpen) { askRender(); var s0 = document.getElementById("askStatus"); if (s0 && sessionStorage.getItem("cbx_token")) { s0.textContent = "AI online"; s0.style.background = "rgba(52,211,153,.15)"; s0.style.color = "#34D399" } setTimeout(function () { var i = document.getElementById("askIn"); if (i) i.focus() }, 0) } };

  window.askFill = function (t) { var i = document.getElementById("askIn"); if (i) { i.value = t; i.focus() } };

  function askRender() { var l = document.getElementById("askLog"); if (!l) return; var sug = C.sugg || []; if (!window.askMsgs.length) { l.innerHTML = "<div style='text-align:center;color:#8296B5;padding:22px 8px'><div style='font-size:14px;font-weight:800;color:#C6D3E8;margin-bottom:5px'>Ask your operation anything</div><p style='font-size:12px'>" + esc(C.blurb || "") + "</p><div style='margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center'>" + sug.map(function (s) { return "<button onclick='askFill(this.textContent)' style='border:1px solid rgba(148,182,255,.18);background:rgba(148,182,255,.07);color:#C6D3E8;border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer'>" + esc(s) + "</button>" }).join("") + "</div></div>"; return } l.innerHTML = window.askMsgs.map(function (m) { return "<div style='display:flex;" + (m.role === "user" ? "justify-content:flex-end" : "") + ";margin-bottom:9px'><div style='max-width:84%;padding:9px 12px;border-radius:13px;line-height:1.5;" + (m.role === "user" ? "background:linear-gradient(135deg,#2E7CF6,#38C6F4);color:#04101F" : "background:#0E2244;border:1px solid rgba(148,182,255,.14)") + "'>" + m.html + "</div></div>" }).join(""); l.scrollTop = l.scrollHeight }
  window.askRender = askRender;

  window.askSend = async function () {
    var inp = document.getElementById("askIn"); var q = (inp && inp.value || "").trim(); if (!q) return;
    inp.value = ""; window.askMsgs.push({ role: "user", html: esc(q) }); askRender();
    var st = document.getElementById("askStatus"); var html;
    try {
      var r = await fetch(API + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (sessionStorage.getItem("cbx_token") || "") }, body: JSON.stringify({ question: q, context: C.ctx ? C.ctx() : "" }) });
      if (!r.ok) throw 0;
      var j = await r.json();
      html = askFmt(j.answer || "(empty)");   // markdown-lite: bold, lists, tables — escape-first, injection-safe
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
        fetch(API + '/api/kv?key=' + encodeURIComponent(C.digestKey), { method: 'POST', headers: { 'Content-Type': 'text/plain', 'Authorization': 'Bearer ' + tk, 'X-Cbx-Client': 'v4' }, body: t }).catch(function () { });
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
