#!/usr/bin/env node
/**
 * AGENTOS VIDEO 1, REDONE — THE AGENT ANALYTICS WALKTHROUGH CLIPS (spec 009-agent-analytics-walkthrough, 2026-10-07).
 *
 *   node tools/demo-agent-video.mjs
 *
 * Spec 005's fictional floor through the REAL engines and the REAL Worker (in-process; nothing live is contacted). Agent
 * Analytics is served in the ThroughBalls palette (tools/demo/story.mjs, demo only) and USED on camera — pointer, clicks,
 * scrolling, typing — following the script, then toured as the team leader and the campaign manager. Captions are the
 * approved wording. Output, in Downloads\AgentOS Agent Analytics Video:
 *   clipNN-<name>.mp4     1920×1080 H.264, 30 fps — Raylight assembles these in order
 *   review/clipNN-kNN.jpg one frame per caption / card beat, for the frame-by-frame review
 * Every caption moment is checked (errors, spinners, Chatterbox, Wimpy, unpainted tables, off-palette colours), every
 * story step is asserted against the backend, and the leak check runs at the end. A rerun replaces only those files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFloor, CLOCK, TODAY } from './demo/floor.mjs';
import { shootVas } from './demo/pulse.mjs';
import { brandServe } from './demo/story.mjs';
import { inspect, leakCheck } from './demo/checks.mjs';
import { OVERLAY, record, still, glide, click, typeInto, scrollTo, caption, hideCaption, wait, titleCard } from './demo/video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.homedir(), 'Downloads', 'AgentOS Agent Analytics Video');
const REVIEW = path.join(OUT, 'review');
const API = /chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/;
const AGENT = 'cb9112', AGENT_NAME = 'Nomvula Dube', LEADER = 'cb9002', MANAGER = 'imogen';
const NOTE = 'My sales are behind target. Can we listen to two of my calls together and work on how I handle objections?';
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);

/* everything is made in a staging folder and replaces the set in Downloads only when the whole run is clean — a failed
   run must never leave a half set where the final clips were (review, spec 009) */
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-video-'));
const STAGE_REVIEW = path.join(STAGE, 'review');
fs.mkdirSync(STAGE_REVIEW, { recursive: true });
const CLIP = /^clip\d{2}-[a-z0-9-]+\.mp4$/, FRAME = /^clip\d{2}-k\d{2}\.jpg$/;
function publish() {
  for (const d of [OUT, REVIEW]) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (CLIP.test(f)) fs.unlinkSync(path.join(OUT, f));
  for (const f of fs.readdirSync(REVIEW)) if (FRAME.test(f)) fs.unlinkSync(path.join(REVIEW, f));
  for (const f of fs.readdirSync(STAGE)) if (CLIP.test(f)) fs.copyFileSync(path.join(STAGE, f), path.join(OUT, f));
  for (const f of fs.readdirSync(STAGE_REVIEW)) if (FRAME.test(f)) fs.copyFileSync(path.join(STAGE_REVIEW, f), path.join(REVIEW, f));
  fs.rmSync(STAGE, { recursive: true, force: true });
}
/** the captions and cards are set in Montserrat — a blocked font would silently fall back */
async function fontCheck(page, where) {
  const ok = await page.evaluate(async () => { try { await document.fonts.load('700 20px Montserrat'); } catch (e) {} return document.fonts.check('700 20px Montserrat'); });
  if (!ok) problems.push({ file: where, issues: ['the Montserrat brand font did not load'] });
}

const problems = [], texts = [], clips = [];
const must = (ok, what) => { if (!ok) throw new Error('story step not reached: ' + what); };

/* ------------------------------------------------------------------ one recorded clip */
async function clip(n, name, page, errors, body) {
  const file = 'clip' + String(n).padStart(2, '0') + '-' + name + '.mp4';
  const marks = [];
  /* a page used for several clips keeps its last caption — clear it (and let the fade finish) before recording;
     the team leader's tour opened on "Tumi marks it done." in the first assembled cut */
  await page.evaluate(() => window.__tb && window.__tb.hide());
  await wait(page, 600);
  const rec = await record(page);
  const mark = () => marks.push(rec.elapsed());
  /* say(): show a caption, let it land, check the screen, note the moment for the review frame, hold */
  const say = async (head, line, hold = 2600) => {
    await caption(page, head, line);
    await wait(page, 700);
    const before = errors.length;
    const { text, issues } = await inspect(page, { brand: true });
    if (errors.length > before) issues.unshift('page error: ' + errors.slice(before).join(' | '));
    texts.push({ file: file + ' @ ' + head, text });
    if (issues.length) problems.push({ file: file + ' @ “' + head + '”', issues });
    mark();
    await wait(page, Math.max(0, hold - 700));
  };
  await body(say, mark);
  const seconds = await rec.stop(path.join(STAGE, file));
  /* the encoded clip must last as long as the recording — the first encoder halved them and the captions drifted */
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(STAGE, file)], { encoding: 'utf8' });
  const encoded = parseFloat(probe.stdout);
  if (!(Math.abs(encoded - seconds) <= 0.5)) problems.push({ file, issues: ['encoded ' + encoded + ' s but recorded ' + seconds.toFixed(1) + ' s'] });
  const stem = 'clip' + String(n).padStart(2, '0');
  still(path.join(STAGE, file), 0.4, path.join(STAGE_REVIEW, stem + '-k00.jpg'));   // how the clip OPENS (a stale caption shows here)
  marks.forEach((t, i) => still(path.join(STAGE, file), t, path.join(STAGE_REVIEW, stem + '-k' + String(i + 1).padStart(2, '0') + '.jpg')));
  clips.push({ file, seconds: +seconds.toFixed(1), beats: marks.length });
  console.log('  ok ' + file + ' · ' + seconds.toFixed(1) + ' s · ' + marks.length + ' review frame(s)');
}

/* ------------------------------------------------------------------ pages */
async function openApp(browser, base, backend, username) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(CLOCK));
  const tok = username ? backend.tokens[username] : null;
  await page.addInitScript(([t, today]) => { try { if (t) sessionStorage.setItem('cbx_agent_token', t); } catch (e) {} window.__agentToday = today; }, [tok, TODAY]);
  await page.addInitScript(OVERLAY);
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
  await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap' }).catch(() => {});
  const idle = async () => {
    for (let i = 0; i < 80; i++) { await page.waitForTimeout(150); if (!inflight) { await page.waitForTimeout(250); if (!inflight) break; } }
    if (inflight) throw new Error('page never went idle');
    await page.evaluate(() => document.fonts && document.fonts.ready);
  };
  await idle();
  await fontCheck(page, '(fonts, ' + (username || 'sign-in') + ')');
  const nav = async (label) => { await click(page, page.locator('.nav-item', { hasText: label }).first()); await idle(); };
  return { ctx, page, errors, idle, nav };
}

/** a title card: the script's text-only moments, animated in the brand */
async function card(browser, n, name, kind, beats) {
  const { html, seconds } = titleCard(kind);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await fontCheck(page, '(fonts, card ' + kind + ')');
  await clip(n, name, page, [], async (say, mark) => {
    await page.evaluate(() => document.body.classList.add('go'));
    let at = 0;
    for (const b of beats) { await wait(page, (b - at) * 1000); mark(); at = b; }
    await wait(page, Math.max(0, seconds - at) * 1000);
  });
  await ctx.close();
}

/* ------------------------------------------------------------------ the story */
async function signInClip(browser, base, backend) {
  const S = await openApp(browser, base, backend, null);
  must(await S.page.locator('.login').count(), 'the sign-in screen');
  await clip(1, 'sign-in', S.page, S.errors, async (say, mark) => {
    await wait(S.page, 700);
    await typeInto(S.page, S.page.locator('.login input').first(), 'CB9112', 90); await wait(S.page, 400);
    mark();
    await glide(S.page, S.page.locator('.login button').first(), 800); await wait(S.page, 1300);
  });
  await S.ctx.close();
}

async function agentClip(A, backend) {
  const { page, idle, nav, errors } = A;
  await clip(2, 'agent-her-day', page, errors, async (say) => {
    await wait(page, 600);
    await say('Not twenty dashboards. One view.', 'Her numbers, against the targets that matter.', 1200);
    for (const t of ['.ac-tile[data-drill="ta"]', '.ac-tile:nth-child(2)', '.ac-tile:nth-child(4)', '.ac-tile:nth-child(5)']) { await glide(page, t, 650); await wait(page, 350); }
    await scrollTo(page, 9999, 2200); await wait(page, 900); await scrollTo(page, 0, 1600); await wait(page, 300);
    await say('Dialler · CRM · QA · Attendance · Coaching', 'All in one place.', 3200);
    await glide(page, '.ac-tile[data-drill="ta"]', 800);
    await say('Target achieved: 52%.', 'A red number on its own changes nothing.', 3200);
    await say('So AgentOS goes one step further.', '', 2200);
    await click(page, '.ac-tile[data-drill="ta"]'); await idle();
    must(await page.locator('#drillOv .drill-box').count(), 'the "what to do" panel');
    await say('Not “improve your numbers.”', '', 1900);
    await glide(page, page.locator('#drillOv .drill-sec', { hasText: 'What to do' }).first(), 700);
    await say('“Here’s what to do next.”', 'Built from your operating rules and her own data.', 3600);
    await click(page, '#drillX'); await wait(page, 500);
    await nav('My Progress');
    await scrollTo(page, '.pg-cards', 1500); await wait(page, 300);
    await say('The highest-impact actions, *first.*', 'Ranked by points available. No twenty-point plan.', 1500);
    for (let i = 1; i <= 3; i++) { await glide(page, '.pg-cards .pg-card:nth-child(' + i + ')', 650); await wait(page, 700); }
    await say('Need help? Ask Tumi, right inside AgentOS.', 'Pick a reason. Say what you need.', 1200);
    await click(page, '.pg-btns .btn2.primary'); await idle();
    must(await page.locator('#helpCats .help-cat').count() === 6, 'the six help reasons');
    await wait(page, 900);
    await click(page, '#helpCats .help-cat[data-c="Review my call"]'); await wait(page, 500);
    await typeInto(page, '#helpNote', NOTE, 38); await wait(page, 600);
    await hideCaption(page);                       // the "Sent to Tumi" toast must read on its own
    await click(page, '#helpSend'); await idle();
    const sent = ((await backend.call('GET', '/api/portal/help/mine', { as: AGENT })).json || {}).requests || [];
    must(sent.some((r) => !r.closed && r.category === 'Review my call'), 'the request on the record');
    await page.evaluate(() => { MYHELP = null; MYHELP_AT = 0; myHelpLoad(); }); await idle();
    await scrollTo(page, '.hc-row', 1200); await wait(page, 1800);
  });
}

async function leaderHelpClip(T) {
  const { page, idle, nav, errors } = T;
  await clip(3, 'team-leader-help-center', page, errors, async (say) => {
    await nav('Help Center');
    const row = page.locator('.hc-name[data-hid]', { hasText: AGENT_NAME });
    must(await row.count() === 1, AGENT_NAME + ' in the Help Center');
    const hid = await row.getAttribute('data-hid');
    await glide(page, row, 800);
    await say('It lands in Tumi’s Help Center.', 'Time-stamped. Visible. Accountable.', 3000);
    await click(page, row); await idle();
    must((await page.locator('#hcn-' + hid).innerText()).includes('two of my calls'), 'her note opened');
    await glide(page, '#hcn-' + hid, 700);
    await say('Not lost in a WhatsApp message.', '', 2800);
    await click(page, page.locator('.hc-st[data-hid="' + hid + '"]', { hasText: 'Waiting on agent' })); await idle();
    await say('Tumi marks it done.', '', 2600);
  });
}

async function agentConfirmClip(A, backend) {
  const { page, idle, errors } = A;
  await page.evaluate(() => { MYHELP = null; MYHELP_AT = 0; myHelpLoad(); }); await idle();
  await clip(4, 'agent-confirms', page, errors, async (say) => {
    await scrollTo(page, '.myhelp-ask', 1200); await wait(page, 400);
    must(await page.locator('.myhelp-yes').count(), 'the "Did Tumi sort it out?" question');
    await glide(page, '.myhelp-ask', 700);
    await say('Nomvula confirms.', 'Every request stays on the record.', 1600);
    await click(page, '.myhelp-yes'); await idle();
    const after = ((await backend.call('GET', '/api/portal/help/mine', { as: AGENT })).json || {}).requests || [];
    must(!after.some((r) => !r.closed && r.category === 'Review my call'), 'the request closed by her confirmation');
    await wait(page, 2600);
  });
}

async function leaderTourClip(T) {
  const { page, idle, nav, errors } = T;
  await page.evaluate(() => { HELPD = null; HELPD_AT = 0; HELP_BUSY = false; helpLoad(); }); await idle();
  await clip(6, 'team-leader-view', page, errors, async (say) => {
    await nav('My Team');
    await say('The team leader’s view', 'Who needs help — and the next step for each person.', 1500);
    await glide(page, page.locator('text=Do this').first(), 800); await wait(page, 1600);
    await scrollTo(page, 700, 1800); await wait(page, 800); await scrollTo(page, 0, 1200);
    await nav('Team Results');
    await say('Team results', 'Every agent, every measure, side by side.', 2400);
    await scrollTo(page, 600, 1800); await wait(page, 600); await scrollTo(page, 0, 1000);
    await nav('Reports');
    await say('Reports', 'Month to date, ready to export.', 2400);
    await scrollTo(page, 500, 1600); await wait(page, 1000);
  });
}

async function managerTourClip(M) {
  const { page, nav, errors } = M;
  await clip(7, 'campaign-manager-view', page, errors, async (say) => {
    await nav('Campaign');
    await say('The campaign manager’s view', 'Every campaign in one place.', 2600);
    await scrollTo(page, 600, 1800); await wait(page, 700); await scrollTo(page, 0, 1000);
    await nav('Team Leaders');
    await say('Team leaders', 'Every team, side by side.', 2600);
    await nav('Reports');
    await say('Campaign reports', 'The same numbers, for the whole operation.', 2600);
    await scrollTo(page, 500, 1600); await wait(page, 1000);
  });
}

/* ------------------------------------------------------------------ run */
const floor = buildFloor();
const browser = await chromium.launch();
let srv = null;
const opened = [];
try {
  console.log('Building the fictional month (VAS Analytics, no screenshots)…');
  let backend = null;
  await shootVas({ browser, root: ROOT, floor, shot: async () => {}, ready: async (published) => {
    const { createBackend } = await import('./demo/backend.mjs');
    backend = await createBackend({ root: ROOT, vas: published });
    return (route) => backend.route(route, { as: 'demo-admin' });
  } });
  srv = await brandServe(ROOT);
  const base = 'http://127.0.0.1:' + srv.address().port;
  console.log('\nRecording');
  await card(browser, 0, 'title-the-problem', 'problem', [2.2, 5.8, 9.4, 12.6]);
  await signInClip(browser, base, backend);
  const A = await openApp(browser, base, backend, AGENT); opened.push(A);
  const T = await openApp(browser, base, backend, LEADER); opened.push(T);
  const M = await openApp(browser, base, backend, MANAGER); opened.push(M);
  await agentClip(A, backend);
  await leaderHelpClip(T);
  await agentConfirmClip(A, backend);
  await card(browser, 5, 'title-the-loop', 'loop', [2.0, 4.6, 7.4]);
  await leaderTourClip(T);
  await managerTourClip(M);
  await card(browser, 8, 'end-card', 'end', [2.6, 5.8]);
} catch (e) {
  problems.push({ file: '(recording)', issues: [e.message] });
} finally {
  for (const p of opened) await p.ctx.close().catch(() => {});
  if (srv) srv.close();
  await browser.close();
}

const leak = await leakCheck(ROOT, texts);
problems.push(...leak.problems);
const total = clips.reduce((s, c) => s + c.seconds, 0);
console.log('\nLeak check against the real Agent List: ' + leak.summary);
if (!problems.length) publish();
else console.log('\nNOT published — the previous set in ' + OUT + ' is untouched; this run is in ' + STAGE);
console.log('\n' + clips.length + ' clips, ' + total.toFixed(1) + ' s in total, in ' + OUT + (problems.length ? ' — ' + problems.length + ' problem(s):' : ' — all clean.'));
for (const p of problems) console.log('  ' + p.file + ': ' + p.issues.join('; '));
process.exit(problems.length ? 1 : 0);
