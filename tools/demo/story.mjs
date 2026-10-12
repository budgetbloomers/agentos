/**
 * AGENTOS VIDEO 1 — THE AGENT EXPERIENCE: THE STORY, THROUGH THE PRODUCT (spec 008, user story 1).
 *
 * brandServe() serves agent/index.html rewritten AS IT IS SERVED into the ThroughBalls brand — palette, logo, product
 * name — for this demo only; the file on disk and the live app are never touched (FR-001). Every rewrite must hit, so a
 * product change that moves one fails the run instead of quietly leaving Chatterbox branding on screen (FR-002).
 *
 * shootStory() performs the story with the product's own buttons, over spec 005's fictional floor and the in-process
 * Worker: Nomvula Dube (CB9112, behind target) opens the tile that is behind and reads what to do, sees her priorities,
 * asks Tumi Khoza for help; Tumi opens it and moves it to "Waiting on agent"; Nomvula answers "Yes, I was helped".
 * Each state is asserted against the backend, not just photographed (FR-003).
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { CLOCK, TODAY } from './floor.mjs';

const API = /chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/;
const BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'brand');
const AGENT = 'cb9112', AGENT_NAME = 'Nomvula Dube', LEADER = 'cb9002', LEADER_FIRST = 'Tumi';
const NOTE = 'My sales are behind target. Can we listen to two of my calls together and work on how I handle objections?';
/* toasts stay visible here — "Sent to Tumi" is part of the story */
const PAGE_CSS = '*{animation:none!important;transition:none!important;caret-color:transparent!important}';

/* THE THROUGHBALLS PALETTE BY RULE (spec 009 FR-001): black #000000, dark green #007338 (carries white text), green
   #46b649, lime #90c640, plus neutral greys/whites. Every colour in the served page is mapped by hue/saturation/
   lightness — blue, navy, indigo, violet and sky become greens or neutral greys; greens snap onto the brand greens;
   reds, ambers and yellows keep their meaning; greys stay. */
const BRAND_DARK = [0, 115, 56], BRAND_GREEN = [70, 182, 73], BRAND_LIME = [144, 198, 64];
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
const grey = (l) => { const v = Math.round(Math.max(0, Math.min(1, l)) * 255); return [v, v, v]; };
/* a pale brand-green tint with (about) the given lightness: #46b649 mixed with white */
const tint = (l) => { const a = Math.max(0, Math.min(1, (1 - l) / 0.505)); return BRAND_GREEN.map((c) => Math.round(255 * (1 - a) + c * a)); };
/** @returns {number[]|null} the brand colour for r,g,b — or null when it stays as it is */
export function brandColour(r, g, b) {
  const [h, s, l] = hsl(r, g, b);
  const coolHue = h >= 180 && h <= 335;                       // sky · blue · navy · indigo · violet · magenta
  if (coolHue && s > 0.12) {
    if (l >= 0.80) return s > 0.6 ? tint(l) : grey(l);        // clearly-tinted pale = "selected" → green tint; else grey
    if (l < 0.14) return [0, 0, 0];                           // navy → black
    if (l < 0.25) return grey(l - 0.06);                      // dark navy → near-black
    if (s > 0.45) return l < 0.62 ? BRAND_DARK : l < 0.75 ? BRAND_GREEN : BRAND_LIME;   // strong blues → greens
    return grey(l);                                           // slate greys → neutral
  }
  if (h >= 80 && h < 180 && s > 0.2) {
    if (l >= 0.80) return tint(l);
    return l < 0.42 ? BRAND_DARK : l < 0.62 ? BRAND_GREEN : BRAND_LIME;
  }
  return null;
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const BRAND_CSS = '<style id="tbBrand">.logo-card{background:transparent!important;padding:10px 6px 12px!important}'
  + '.logo-img{max-width:196px!important}.logo-sub{color:#B5B5B5!important}'
  + '.nav-item .ic{filter:grayscale(1) brightness(1.7)}</style>';   // emoji icons in one neutral tone (spec 009 edge case)

const dataUrl = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(BRAND, f)).toString('base64');

/** one exact rewrite that MUST land `times` times (or at least once when times is 0) */
function swap(src, from, to, times = 1) {
  const n = src.split(from).length - 1;
  if (times ? n !== times : !n) throw new Error('brand rewrite missed: ' + String(from).slice(0, 60) + ' (found ' + n + ')');
  return src.split(from).join(to);
}

export function brandHtml(src) {
  let s = src;
  /* every rewrite must land — a product change would otherwise leave stray Chatterbox colours on a green run */
  const recolour = (re, to) => { if (!re.test(s)) throw new Error('brand rewrite missed: ' + re); re.lastIndex = 0; s = s.replace(re, to); };
  let mapped = 0;
  /* a colour, never an HTML entity: "&#128276;" (the Help Center bell) once became "&#007338;" (review, spec 009) */
  const bells = (s.match(/&#\d+;/g) || []).length;
  s = s.replace(/(?<![&\w])#([0-9a-f]{6})(?![0-9a-z])/gi, (all, h6) => {
    const c = brandColour(parseInt(h6.slice(0, 2), 16), parseInt(h6.slice(2, 4), 16), parseInt(h6.slice(4, 6), 16));
    if (!c) return all; mapped++; return hex(c);
  });
  s = s.replace(/rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/g, (all, r, g, b) => {
    const c = brandColour(+r, +g, +b);
    if (!c) return all; mapped++; return all.slice(0, all.indexOf('(') + 1) + c.join(',');
  });
  if (mapped < 100) throw new Error('brand palette mapped only ' + mapped + ' colours — the page changed shape');
  if ((s.match(/&#\d+;/g) || []).length !== bells || /&#0\d{5};/.test(s)) throw new Error('brand palette touched an HTML entity');
  /* avatars are coloured per person with hsl(hue(name)…) — a rainbow; give them the brand colours instead */
  recolour(/hsl\('\+hue\(([^)]*)\)\+',\s*\d+%,\s*\d+%\)/g, "'+tbAv($1)+'");
  s = swap(s, '<head>', '<head><script>function tbAv(k){var p=["#007338","#46B649"],h=0;k=String(k||"");'   /* no black: avatars sit on the black menu */
    + 'for(var i=0;i<k.length;i++)h=(h*31+k.charCodeAt(i))>>>0;return p[h%p.length];}</script>');
  const logo = /var LOGO="data:image\/png;base64,[^"]*";/;
  if (!logo.test(s)) throw new Error('brand rewrite missed: var LOGO');
  s = s.replace(logo, () => 'var LOGO="' + dataUrl('throughballs-logo.png') + '",LOGO_DARK="' + dataUrl('throughballs-logo-white.png') + '";');
  /* the sidebar is black now — it gets the white-wordmark copy; the sign-in card stays light and keeps the black one */
  s = swap(s, '<img class="logo-img" src="\'+LOGO+\'"', '<img class="logo-img" src="\'+LOGO_DARK+\'"');
  s = swap(s, 'alt="The Chatterbox"', 'alt="ThroughBalls"', 0);
  recolour(/<title>[^<]*<\/title>/, '<title>AgentOS — Agent Analytics</title>');
  s = swap(s, 'THE CHATTERBOX</div>', 'AGENTOS</div>', 0);
  s = swap(s, '</head>', BRAND_CSS + '</head>');
  return s;
}

export function brandServe(root) {
  const html = brandHtml(fs.readFileSync(path.join(root, 'agent', 'index.html'), 'utf8'));
  const server = http.createServer((q, s) => {
    const u = q.url.split('?')[0];
    if (u !== '/' && u !== '/index.html') { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    s.end(html);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function must(ok, what) { if (!ok) throw new Error('story step not reached: ' + what); }

export async function shootStory({ browser, root, backend, shot }) {
  const server = await brandServe(root);
  const base = 'http://127.0.0.1:' + server.address().port;
  const open = [];
  /* one page per person, at twice the display density so the video can zoom in sharply (FR-009) */
  async function signIn(username) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    open.push(ctx);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(CLOCK));
    const tok = username ? backend.tokens[username] : null;
    await page.addInitScript(([t, today]) => { try { if (t) sessionStorage.setItem('cbx_agent_token', t); } catch (e) {} window.__agentToday = today; }, [tok, TODAY]);
    let inflight = 0;
    await page.route('**/*', (r) => {
      const u = r.request().url();
      if (u.startsWith(base) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return r.continue();
      if (API.test(u)) { inflight++; return backend.route(r).finally(() => { inflight--; }); }
      return r.abort();
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: PAGE_CSS });
    const idle = async () => {
      for (let i = 0; i < 80; i++) {
        await page.waitForTimeout(150);
        if (!inflight) { await page.waitForTimeout(250); if (!inflight) break; }
      }
      if (inflight) throw new Error('page never went idle (' + inflight + ' API call(s) still open)');   // never photograph a half-loaded screen
      await page.evaluate(() => document.fonts && document.fonts.ready);
    };
    await idle();
    const take = async (name) => { const before = errors.length; await idle(); await shot(page, name, errors.slice(before)); };
    const view = async (v) => { await page.evaluate((x) => { VIEW = x; render(); }, v); await idle(); };
    const centre = async (sel) => { const el = page.locator(sel).first(); must(await el.count(), sel + ' on screen'); await el.evaluate((n) => n.scrollIntoView({ block: 'center' })); await idle(); };
    const myHelp = async () => (await backend.call('GET', '/api/portal/help/mine', { as: AGENT })).json || {};
    return { page, idle, take, view, centre, myHelp };
  }

  try {
    /* s01 — the sign-in screen, nobody signed in */
    {
      const { page, take } = await signIn(null);
      must(await page.locator('.login').count(), 'the sign-in screen');
      await take('sign-in');
    }

    const agent = await signIn(AGENT);
    const tl = await signIn(LEADER);

    /* s02–s03 — her month against target; the tile that is behind, and what to do about it */
    await agent.view('month');
    await agent.take('agent-today');
    const tiles = await agent.page.$$eval('.ac-tile[data-drill]', (ts) => ts.map((t) => t.getAttribute('data-drill')));
    must(tiles.length, 'a behind-target tile to tap');
    await agent.page.click('.ac-tile[data-drill="' + (tiles.includes('ta') ? 'ta' : tiles[0]) + '"]');
    await agent.idle();
    must(await agent.page.locator('#drillOv .drill-box').count(), 'the "what to do" panel');
    await agent.take('agent-what-to-do');
    await agent.page.click('#drillX');

    /* s04 — her priorities: rating, the drivers still to go, the advice cards, the ask button */
    await agent.view('progress');
    await agent.centre('.pg-cards');
    await agent.take('agent-priorities');

    /* s05–s07 — she asks Tumi: the six reasons, her note, sent */
    await agent.page.click('.pg-btns .btn2.primary');
    await agent.idle();
    must(await agent.page.locator('#helpCats .help-cat').count() === 6, 'the six help reasons');
    await agent.take('agent-ask-pick-a-reason');
    await agent.page.click('#helpCats .help-cat[data-c="Review my call"]');
    await agent.page.fill('#helpNote', NOTE);
    await agent.take('agent-ask-write-the-note');
    await agent.page.click('#helpSend');
    await agent.idle();
    const sent = (await agent.myHelp()).requests || [];
    must(sent.some((r) => !r.closed && r.category === 'Review my call'), 'the request on the record');
    await agent.page.evaluate(() => { MYHELP = null; MYHELP_AT = 0; myHelpLoad(); });
    await agent.idle();
    await agent.centre('.hc-row');
    await agent.take('agent-request-sent');

    /* s08–s10 — Tumi's Help Center: new → opened (seen) → waiting on the agent */
    await tl.view('help');
    const row = tl.page.locator('.hc-name[data-hid]', { hasText: AGENT_NAME });
    must(await row.count() === 1, AGENT_NAME + ' in the Help Center');
    const hid = await row.getAttribute('data-hid');
    await tl.centre('.hc-name[data-hid="' + hid + '"]');
    await tl.take('tl-help-center-new');
    await row.click();
    await tl.idle();
    must((await tl.page.locator('#hcn-' + hid).innerText()).includes('two of my calls'), 'her note opened');
    await tl.take('tl-note-opened');
    const waiting = tl.page.locator('.hc-st[data-hid="' + hid + '"]', { hasText: 'Waiting on agent' });
    must(await waiting.count() === 1, 'the "Waiting on agent" stage');
    await waiting.click();
    await tl.idle();
    /* the page clock is pinned, so the Help Center's own staleness timer never runs out — ask it for the list again */
    const tlRefresh = async () => { await tl.page.evaluate(() => { HELPD = null; HELPD_AT = 0; HELP_BUSY = false; helpLoad(); }); await tl.idle(); };
    await tlRefresh();
    await tl.view('help');
    await tl.centre('.hc-name[data-hid="' + hid + '"]');
    await tl.take('tl-waiting-on-agent');

    /* s11–s12 — Nomvula is asked whether it was sorted, and says yes */
    await agent.page.evaluate(() => { MYHELP = null; MYHELP_AT = 0; myHelpLoad(); });
    await agent.view('progress');
    await agent.centre('.myhelp-ask');
    must(await agent.page.locator('.myhelp-yes').count(), 'the "Did ' + LEADER_FIRST + ' sort it out?" question');
    await agent.take('agent-did-tumi-sort-it-out');
    await agent.page.click('.myhelp-yes');
    await agent.idle();
    const after = (await agent.myHelp()).requests || [];
    must(!after.some((r) => !r.closed && r.category === 'Review my call'), 'the request closed by her confirmation');
    await agent.take('agent-confirmed');

    /* s13–s14 — the record on Tumi's side (closed, off her open list), and the team view she leads from */
    await tlRefresh();
    await tl.view('help');
    must(!(await tl.page.locator('.hc-name[data-hid="' + hid + '"]').count()), 'the request off Tumi\'s open list');
    await tl.take('tl-request-closed');
    await tl.view('team');
    await tl.take('tl-my-team');
  } finally {
    for (const c of open) await c.close().catch(() => {});
    server.close();
  }
}
