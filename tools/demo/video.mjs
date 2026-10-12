/**
 * AGENTOS VIDEO 1, REDONE — THE RECORDING KIT (spec 009).
 *
 * record(page)   — Chromium screencast (JPEG frames + their timestamps) for one clip → FFmpeg → H.264 MP4, 30 fps.
 * OVERLAY        — injected into every recorded page: an arrow pointer that glides to its target before the real click
 *                  (Playwright's own pointer is invisible on video), a green click ripple, and the brand caption card
 *                  (black, green accent bar, Montserrat) that slides in and out.
 * glide/click/caption/typeInto/scrollTo — the moves a clip is made of.
 * titleCard()    — the script's text-only moments as animated HTML, recorded the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'brand');
const logoWhite = () => 'data:image/png;base64,' + fs.readFileSync(path.join(BRAND, 'throughballs-logo-white.png')).toString('base64');
export const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap">';

/* ------------------------------------------------------------------ the overlay (runs inside the page) */
export const OVERLAY = `(() => {
  if (window.__tb) return;
  const css = '#tbCursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}'
    + '#tbRipple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #46B649;z-index:2147483646;pointer-events:none;opacity:0}'
    + '#tbRipple.go{animation:tbRip .5s ease-out}@keyframes tbRip{0%{transform:scale(.3);opacity:1}100%{transform:scale(1.5);opacity:0}}'
    + '#tbCap{position:fixed;left:36px;bottom:34px;max-width:600px;z-index:2147483645;pointer-events:none;background:rgba(0,0,0,.86);'
    + 'border-left:5px solid #46B649;border-radius:14px;padding:18px 26px 20px;font-family:Montserrat,Inter,sans-serif;'
    + 'box-shadow:0 18px 50px rgba(0,0,0,.35);opacity:0;transform:translateY(18px);transition:opacity .45s ease,transform .45s cubic-bezier(.2,.8,.2,1)}'
    + '#tbCap.on{opacity:1;transform:none}#tbCap .h{color:#fff;font-weight:700;font-size:27px;line-height:1.25;letter-spacing:-.2px;text-wrap:balance}'
    + '#tbCap .l{color:#CFCFCF;font-weight:500;font-size:17px;line-height:1.4;margin-top:6px;text-wrap:balance}#tbCap .k{color:#90C640}';   /* balance: no one-word second line */
  const mount = () => {
    if (!document.body || document.getElementById('tbCursor')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'tbCursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5l15.5 9.2-6.6 1.3-3.4 6.4z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const r = document.createElement('div'); r.id = 'tbRipple';
    const cap = document.createElement('div'); cap.id = 'tbCap'; cap.innerHTML = '<div class="h"></div><div class="l"></div>';
    document.documentElement.append(c, r, cap);
    c.style.left = (window.__tbX || innerWidth * 0.62) + 'px'; c.style.top = (window.__tbY || innerHeight * 0.55) + 'px';
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  window.__tb = {
    mount,
    moveTo(x, y, ms) {
      mount(); const c = document.getElementById('tbCursor');
      const x0 = parseFloat(c.style.left) || 0, y0 = parseFloat(c.style.top) || 0, t0 = performance.now();
      return new Promise((res) => { const step = (now) => { const k = Math.min(1, (now - t0) / ms), e = ease(k);
        c.style.left = x0 + (x - x0) * e + 'px'; c.style.top = y0 + (y - y0) * e + 'px'; window.__tbX = x; window.__tbY = y;
        if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    },
    ripple(x, y) { mount(); const r = document.getElementById('tbRipple'); r.style.left = x + 'px'; r.style.top = y + 'px';
      r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); },
    caption(h, l) { mount(); const cap = document.getElementById('tbCap');
      cap.querySelector('.h').innerHTML = h; cap.querySelector('.l').innerHTML = l || ''; cap.querySelector('.l').style.display = l ? '' : 'none';
      cap.classList.add('on'); },
    hide() { const cap = document.getElementById('tbCap'); if (cap) cap.classList.remove('on'); },
    scrollTo(y, ms) { const el = document.scrollingElement, y0 = el.scrollTop, t0 = performance.now();
      return new Promise((res) => { const step = (now) => { const k = Math.min(1, (now - t0) / ms);
        el.scrollTop = y0 + (y - y0) * ease(k); if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); }); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  new MutationObserver(() => { if (!document.getElementById('tbCursor')) mount(); }).observe(document.documentElement, { childList: true, subtree: false });
})();`;

/* ------------------------------------------------------------------ moves */
export const wait = (page, ms) => page.waitForTimeout(ms);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** caption: a headline (*word* = lime) and an optional line */
export async function caption(page, head, line) {
  const h = esc(head).replace(/\*([^*]+)\*/g, '<span class="k">$1</span>');
  await page.evaluate(([a, b]) => window.__tb.caption(a, b), [h, line ? esc(line) : '']);
}
export async function hideCaption(page) { await page.evaluate(() => window.__tb.hide()); }

async function centreOf(page, target) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  if (!(await loc.count())) throw new Error('not on screen: ' + (typeof target === 'string' ? target : 'locator'));
  await loc.evaluate((n) => { const r = n.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 70) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  /* a long smooth scroll can outlast any fixed wait — read the box until it stops moving, so a click never lands on a
     neighbour the target has already scrolled past (review, spec 009) */
  let b = await loc.boundingBox(), prev = null;
  for (let i = 0; i < 50 && (!prev || !b || Math.abs(b.y - prev.y) > 0.5 || Math.abs(b.x - prev.x) > 0.5); i++) {
    await page.waitForTimeout(70); prev = b; b = await loc.boundingBox();
  }
  if (!b) throw new Error('no box for target');
  return [b.x + b.width / 2, b.y + b.height / 2];
}
/** move the visible pointer onto a target (and the real mouse with it) */
export async function glide(page, target, ms = 700) {
  const [x, y] = await centreOf(page, target);
  await page.evaluate(([a, b, m]) => window.__tb.moveTo(a, b, m), [x, y, ms]);
  await page.mouse.move(x, y);
  return [x, y];
}
/** glide, ripple, then a REAL click at that spot */
export async function click(page, target, ms = 700) {
  const [x, y] = await glide(page, target, ms);
  await page.waitForTimeout(140);
  await page.evaluate(([a, b]) => window.__tb.ripple(a, b), [x, y]);
  await page.mouse.click(x, y);
}
export async function typeInto(page, target, text, delay = 42) {
  await click(page, target);
  await page.keyboard.type(text, { delay });
}
export async function scrollTo(page, target, ms = 1400) {
  const y = typeof target === 'number' ? target
    : await page.locator(target).first().evaluate((n) => Math.max(0, n.getBoundingClientRect().top + document.scrollingElement.scrollTop - innerHeight * 0.22));
  await page.evaluate(([a, m]) => window.__tb.scrollTo(a, m), [y, ms]);
}

/* ------------------------------------------------------------------ the recorder */
/**
 * Start a screencast of `page`; `stop(file)` encodes what was captured to an MP4 and returns its length in seconds.
 * Frames arrive only when the screen changes. Each is stamped on ARRIVAL (the same clock as elapsed(), so caption marks
 * and video time agree) and the encoder is fed a strict 30 fps stream — every output frame is the latest captured frame
 * at that instant. (The concat-demuxer route ignored per-frame durations and halved the clips — spec 009 review.)
 */
const FPS = 30;
export async function record(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const t0 = Date.now() / 1000;
  /* a busy page delivers frames LATE (the first title card lagged ~2 s): stamp each frame with when the browser DREW
     it (metadata.timestamp), moved onto our clock by the smallest arrival delay seen */
  cdp.on('Page.screencastFrame', (f) => {
    const arrived = Date.now() / 1000, drawn = f.metadata && f.metadata.timestamp > 1e9 ? f.metadata.timestamp : null;
    const frame = { arrived, drawn, slot: Math.floor((drawn || arrived) * FPS), buf: Buffer.from(f.data, 'base64') };
    /* the output is 30 fps: keep only the newest frame per 1/30 s slot, so an animated card cannot fill the memory */
    if (frames.length && frames[frames.length - 1].slot === frame.slot) frames[frames.length - 1] = frame; else frames.push(frame);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  return {
    elapsed: () => Date.now() / 1000 - t0,
    async stop(outFile) {
      const tEnd = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      if (!frames.length) throw new Error('no frames captured for ' + path.basename(outFile));
      const timed = frames.filter((f) => f.drawn !== null);
      const lag = timed.length === frames.length ? Math.min(...timed.map((f) => f.arrived - f.drawn)) : null;
      for (const f of frames) f.t = lag === null ? f.arrived : f.drawn + lag;
      frames.sort((a, b) => a.t - b.t);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
        '-r', String(FPS), '-movflags', '+faststart', outFile], { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '', dead = null;
      ff.stderr.on('data', (d) => { err += d; });
      ff.on('error', (e) => { dead = dead || e; });            // e.g. ffmpeg missing — must fail the clip, not crash the run
      ff.stdin.on('error', (e) => { dead = dead || e; });      // EPIPE when ffmpeg dies mid-encode
      const done = new Promise((res) => { ff.on('close', res); ff.on('error', () => res(-1)); });
      const n = Math.max(1, Math.round((tEnd - t0) * FPS));
      try {
        for (let i = 0, j = 0; i < n && !dead; i++) {
          const t = t0 + i / FPS;
          while (j + 1 < frames.length && frames[j + 1].t <= t) j++;   // the newest frame already on screen at t
          if (!ff.stdin.write(frames[j].buf)) await Promise.race([once(ff.stdin, 'drain').catch(() => {}), done]);
        }
      } finally {
        ff.stdin.end();
      }
      const code = await done;
      if (dead || code !== 0) throw new Error('ffmpeg failed for ' + path.basename(outFile) + ': ' + (dead ? dead.message : err.slice(0, 400)));
      return tEnd - t0;
    },
  };
}
/** one still from a finished clip, for review */
export function still(mp4, seconds, outJpg) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, seconds)), '-i', mp4, '-frames:v', '1', '-q:v', '3', outJpg], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg still failed: ' + (r.stderr || '').slice(0, 200));
}

/* ------------------------------------------------------------------ title cards (the script's text-only moments) */
const CARD_CSS = `*{margin:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden;font-family:Montserrat,sans-serif;color:#fff}
.glow{position:absolute;width:1100px;height:1100px;border-radius:50%;opacity:.42;background:radial-gradient(circle,#007338 0%,rgba(0,115,56,.35) 30%,transparent 68%)}
.g1{left:-220px;top:-260px;animation:d1 16s ease-in-out infinite alternate}.g2{right:-260px;bottom:-320px;background:radial-gradient(circle,#46B649 0%,transparent 70%);opacity:.26;animation:d2 18s ease-in-out infinite alternate}
@keyframes d1{to{transform:translate(160px,120px)}}@keyframes d2{to{transform:translate(-180px,-90px)}}
.stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:0 120px;text-align:center}
.line{position:absolute;font-weight:700;font-size:58px;line-height:1.2;letter-spacing:-.5px;max-width:1300px;opacity:0}
.w{display:inline-block;opacity:0;filter:blur(12px);transform:translateY(22px)}.k{color:#90C640}
body:not(.go) *{animation-play-state:paused!important}`;
function words(text, start, stagger) {
  return text.split(' ').map((w, i) => {
    const k = /^\*.*\*[.?!,]*$/.test(w);
    const clean = esc(w.replace(/\*/g, ''));
    return '<span class="w' + (k ? ' k' : '') + '" style="animation:win .6s cubic-bezier(.2,.8,.2,1) ' + (start + i * stagger).toFixed(2) + 's forwards">' + clean + '</span>';
  }).join(' ');
}
/** @returns {{html: string, seconds: number}} */
export function titleCard(kind) {
  const base = (body, extra) => '<!doctype html><html><head><meta charset="utf-8">' + FONTS + '<style>' + CARD_CSS
    + '@keyframes win{to{opacity:1;filter:none;transform:none}}' + (extra || '') + '</style></head><body><div class="glow g1"></div><div class="glow g2"></div><div class="stage">' + body + '</div></body></html>';
  if (kind === 'problem') {
    const L = [['Most agents work across multiple systems.', 0.3, 3.4], ['They know their target. They can see their numbers.', 3.7, 3.6],
      ['But what should they do differently *today?*', 7.3, 3.5], ['That’s what AgentOS solves.', 10.8, 3.4]];
    const extra = L.map((l, i) => '.l' + i + '{animation:show ' + l[2] + 's linear ' + l[1] + 's forwards}').join('')
      + '@keyframes show{0%{opacity:1}88%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-18px)}}'
      + '.l3{animation:showk ' + L[3][2] + 's linear ' + L[3][1] + 's forwards}@keyframes showk{0%,100%{opacity:1}}';
    return { seconds: 14.4, html: base(L.map((l, i) => '<div class="line l' + i + '">' + words(l[0], l[1] + 0.05, 0.07) + '</div>').join(''), extra) };
  }
  if (kind === 'loop') {
    const W = ['Measure', 'Identify', 'Recommend', 'Act', 'Confirm', 'Improve'];
    const chips = W.map((w, i) => '<span class="chip" style="animation:lit .5s ease ' + (0.4 + i * 0.55).toFixed(2) + 's forwards">' + w + '.</span>'
      + (i < W.length - 1 ? '<span class="ar" style="animation:arr .4s ease ' + (0.62 + i * 0.55).toFixed(2) + 's forwards">→</span>' : '')).join('');
    /* six chips + five arrows must fit the 1600 px stage with margin (the first cut clipped "Measure." and "Improve.") */
    const extra = '.row{display:flex;align-items:center;gap:12px;flex-wrap:nowrap}.chip{font-weight:700;font-size:28px;padding:12px 20px;border-radius:999px;border:2px solid #1f1f1f;color:#5a5a5a;opacity:.35}'
      + '@keyframes lit{to{opacity:1;color:#fff;border-color:#46B649;background:rgba(0,115,56,.35)}}.ar{font-size:30px;color:#46B649;opacity:0}@keyframes arr{to{opacity:1}}'
      + '.loop{margin-top:46px;font-weight:600;font-size:22px;color:#90C640;letter-spacing:3px;opacity:0;animation:arr .6s ease 4.1s forwards}';
    return { seconds: 8.2, html: base('<div class="row">' + chips + '</div><div class="loop">THE AGENTOS PERFORMANCE LOOP</div>', extra) };
  }
  if (kind === 'end') {
    const extra = '.logo{width:520px;opacity:0;animation:win 1s cubic-bezier(.2,.8,.2,1) .3s forwards;filter:blur(10px);transform:translateY(16px)}'
      + '.name{margin-top:54px;font-weight:800;font-size:96px;letter-spacing:-2px}.tag{margin-top:14px;font-weight:500;font-size:30px;color:#CFCFCF}';
    return { seconds: 6.5, html: base('<img class="logo" src="' + logoWhite() + '"><div class="name">' + words('AgentOS', 1.1, 0.1) + '</div><div class="tag">'
      + words('Turn performance data into action.', 1.7, 0.08) + '</div>', extra) };
  }
  throw new Error('unknown card ' + kind);
}

const cardPage = (body, extra) => '<!doctype html><html><head><meta charset="utf-8">' + FONTS + '<style>' + CARD_CSS
  + '@keyframes win{to{opacity:1;filter:none;transform:none}}' + (extra || '') + '</style></head><body><div class="glow g1"></div><div class="glow g2"></div><div class="stage">' + body + '</div></body></html>';

/**
 * spec 026: a title card whose lines follow the narration — [[text, start s, until s], …]; the last line stays.
 * @returns {{html: string, seconds: number}}
 */
export function linesCard(lines, seconds) {
  const extra = lines.map(([, from, until], i) => i === lines.length - 1
    ? '.l' + i + '{animation:keep 1s linear ' + from + 's forwards}'
    : '.l' + i + '{animation:show ' + (until - from).toFixed(2) + 's linear ' + from + 's forwards}').join('')
    + '@keyframes show{0%{opacity:1}88%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-18px)}}@keyframes keep{0%,100%{opacity:1}}';
  return { seconds, html: cardPage(lines.map(([t, from], i) => '<div class="line l' + i + '">' + words(t, from + 0.05, 0.07) + '</div>').join(''), extra) };
}

/** spec 026: the Performance Engine end card — logo, name, and the five-step chain lit in turn */
export function engineEndCard(seconds) {
  const W = ['Data', 'Diagnosis', 'Coaching', 'Accountability', 'Improvement'];
  const chips = W.map((w, i) => '<span class="chip" style="animation:lit .5s ease ' + (1.6 + i * 0.45).toFixed(2) + 's forwards">' + w + '</span>'
    + (i < W.length - 1 ? '<span class="ar" style="animation:arr .4s ease ' + (1.8 + i * 0.45).toFixed(2) + 's forwards">→</span>' : '')).join('');
  const extra = '.logo{width:430px;opacity:0;animation:win 1s cubic-bezier(.2,.8,.2,1) .2s forwards;filter:blur(10px);transform:translateY(16px)}'
    + '.name{margin-top:40px;font-weight:800;font-size:68px;letter-spacing:-1.5px}.row{margin-top:34px;display:flex;align-items:center;gap:12px}'
    + '.chip{font-weight:700;font-size:26px;padding:11px 20px;border-radius:999px;border:2px solid #1f1f1f;color:#5a5a5a;opacity:.35}'
    + '@keyframes lit{to{opacity:1;color:#fff;border-color:#46B649;background:rgba(0,115,56,.35)}}.ar{font-size:26px;color:#46B649;opacity:0}@keyframes arr{to{opacity:1}}';
  return { seconds, html: cardPage('<img class="logo" src="' + logoWhite() + '"><div class="name">' + words('AgentOS Performance *Engine*', 0.8, 0.1)
    + '</div><div class="row">' + chips + '</div>', extra) };
}

/** lay a narration WAV under a clip, starting `delay` seconds in; the clip's length is kept */
export function muxAudio(clipMp4, wav, outMp4, delay = 0.5) {
  const ms = Math.round(delay * 1000);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clipMp4, '-i', wav, '-filter_complex', '[1:a]adelay=' + ms + '|' + ms + ',apad,aresample=48000[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outMp4], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg mux failed for ' + path.basename(outMp4) + ': ' + (r.stderr || '').slice(0, 300));
}
