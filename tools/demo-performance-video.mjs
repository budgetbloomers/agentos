#!/usr/bin/env node
/**
 * AGENTOS VIDEO 2 — THE PERFORMANCE & COACHING ENGINE, NARRATED CLIPS (spec 026-performance-engine-video, 2026-10-11).
 *
 *   node tools/demo-performance-video.mjs
 *
 * Built exactly like video 1 (tools/demo-agent-video.mjs): spec 005's fictional floor through the REAL engines and the
 * REAL Worker, Agent Analytics in the ThroughBalls palette, used on camera — now narrated. The floor carries the video-2
 * profile (Megan Fourie: busy, conversion below target → the ladder's R7). Each scene's narration is spoken first
 * (tools/demo/voice.py, Kokoro, offline); its clip is recorded, held until the narration has finished, and the
 * narration laid under it. Output, in Downloads\AgentOS Video 2 - Performance Engine:
 *   clipNN-<name>.mp4  1920×1080 H.264 + AAC narration      review/clipNN-kNN.jpg  caption + opening frames
 * Checks as video 1 (errors, spinners, off-palette, Chatterbox, Wimpy, story steps, leak check); staged, published only
 * when the whole run is clean.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFloor, CLOCK, TODAY, STORY2_AGENT } from './demo/floor.mjs';
import { shootVas } from './demo/pulse.mjs';
import { brandServe } from './demo/story.mjs';
import { inspect, leakCheck } from './demo/checks.mjs';
import { OVERLAY, record, still, glide, click, scrollTo, caption, wait, linesCard, engineEndCard, muxAudio } from './demo/video.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.homedir(), 'Downloads', 'AgentOS Video 2 - Performance Engine');
const REVIEW = path.join(OUT, 'review');
const API = /chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/;
const LEADER = 'cb9002', MANAGER = 'imogen', AGENT_NAME = 'Megan Fourie', FIRST = 'Megan';
const LEAD_IN = 0.5, TAIL = 0.9;   // narration starts 0.5 s into its clip; the clip holds 0.9 s after it ends
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);

/* the narration, adapted from the script so every claim is on screen (spec 026 plan) */
const NARRATION = [
  ['s00', "Now let's look at AgentOS from the manager's perspective. A team leader might manage ten, fifteen or twenty people. A campaign manager may be responsible for hundreds. The problem isn't a lack of information. It's knowing who needs attention, why, and what should happen next."],
  ['s01', 'AgentOS continuously evaluates performance and surfaces the exceptions. Instead of reviewing every agent by hand, the team leader sees at once where intervention is needed, what is already in progress, and who has asked for help.'],
  /* the drill-in shows Megan at ~102% of target — "her performance has slipped" would be false; the script's point (the
     problem hides behind a healthy number) is what the screen shows */
  ['s02', "Let's take Megan. On the surface, her sales look fine. AgentOS shows the full picture, in context. Is it activity? Conversion? Quality? Attendance? Or a combination?"],
  ['s03', "This is where coaching changes. Rather than coaching on opinion, AgentOS uses the evidence. Megan's talk time and attendance are healthy. But her conversion is below target. So the problem isn't activity. It's what happens inside the conversation."],
  ['s04', "AgentOS then recommends the intervention, from the company's own operating rules. The team leader still makes the decision. AgentOS assists the manager. It does not remove accountability."],
  ['s05', 'The coaching is recorded and tracked: what was found, what was agreed, and who signed it. And if the same issue keeps coming back, AgentOS flags it. A measurable coaching system, not a coaching log.'],
  ['s06', 'The same applies when an agent asks for help. AgentOS records when the request was asked, when it was seen, and when it was closed. So leadership can measure what is normally invisible: how well managers support their people.'],
  ['s07', 'Campaign managers can then compare teams, team leaders and issues across the whole campaign. Instead of asking what happened yesterday, they can focus on what needs action today.'],
  ['s08', 'AgentOS Performance Engine. Data, diagnosis, coaching, accountability, improvement.'],
];

const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-video2-'));
const STAGE_REVIEW = path.join(STAGE, 'review'), VOICE = path.join(STAGE, 'voice');
fs.mkdirSync(STAGE_REVIEW, { recursive: true });
const CLIP = /^clip\d{2}-[a-z0-9-]+\.mp4$/, FRAME = /^clip\d{2}-k\d{2}\.jpg$/;
const problems = [], texts = [], clips = [];
const must = (ok, what) => { if (!ok) throw new Error('story step not reached: ' + what); };

function speak() {
  fs.writeFileSync(path.join(STAGE, 'lines.json'), JSON.stringify(NARRATION.map(([id, text]) => ({ id, text }))));
  const r = spawnSync('py', [path.join(ROOT, 'tools', 'demo', 'voice.py'), path.join(STAGE, 'lines.json'), VOICE, 'bm_george'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error('narration failed: ' + (r.stderr || '').slice(-400));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
function publish() {
  for (const d of [OUT, REVIEW]) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (CLIP.test(f)) fs.unlinkSync(path.join(OUT, f));
  for (const f of fs.readdirSync(REVIEW)) if (FRAME.test(f)) fs.unlinkSync(path.join(REVIEW, f));
  for (const f of fs.readdirSync(STAGE)) if (CLIP.test(f)) fs.copyFileSync(path.join(STAGE, f), path.join(OUT, f));
  for (const f of fs.readdirSync(STAGE_REVIEW)) if (FRAME.test(f)) fs.copyFileSync(path.join(STAGE_REVIEW, f), path.join(REVIEW, f));
  for (const f of fs.readdirSync(VOICE)) fs.copyFileSync(path.join(VOICE, f), path.join(OUT, 'narration-' + f));
  fs.rmSync(STAGE, { recursive: true, force: true });
}
async function fontCheck(page, where) {
  const ok = await page.evaluate(async () => { try { await document.fonts.load('700 20px Montserrat'); } catch (e) {} return document.fonts.check('700 20px Montserrat'); });
  if (!ok) problems.push({ file: where, issues: ['the Montserrat brand font did not load'] });
}

/* ------------------------------------------------------------------ one narrated clip */
async function clip(n, name, page, errors, voId, voSeconds, body) {
  const stem = 'clip' + String(n).padStart(2, '0'), file = stem + '-' + name + '.mp4', silent = path.join(STAGE, stem + '-silent.mp4');
  const marks = [];
  await page.evaluate(() => window.__tb && window.__tb.hide());
  await wait(page, 600);
  const rec = await record(page);
  const mark = () => marks.push(rec.elapsed());
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
  const need = LEAD_IN + voSeconds + TAIL;                 // never cut a sentence (spec 026 edge case)
  if (rec.elapsed() < need) await wait(page, (need - rec.elapsed()) * 1000);
  const seconds = await rec.stop(silent);
  muxAudio(silent, path.join(VOICE, voId + '.wav'), path.join(STAGE, file), LEAD_IN);
  fs.unlinkSync(silent);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(STAGE, file)], { encoding: 'utf8' });
  const encoded = parseFloat(probe.stdout);
  if (!(Math.abs(encoded - seconds) <= 0.5)) problems.push({ file, issues: ['encoded ' + encoded + ' s but recorded ' + seconds.toFixed(1) + ' s'] });
  if (seconds < need - 0.05) problems.push({ file, issues: ['narration (' + voSeconds + ' s) would be cut'] });
  still(path.join(STAGE, file), 0.4, path.join(STAGE_REVIEW, stem + '-k00.jpg'));
  marks.forEach((t, i) => still(path.join(STAGE, file), t, path.join(STAGE_REVIEW, stem + '-k' + String(i + 1).padStart(2, '0') + '.jpg')));
  clips.push({ file, seconds: +seconds.toFixed(1), narration: voSeconds });
  console.log('  ok ' + file + ' · ' + seconds.toFixed(1) + ' s · narration ' + voSeconds + ' s · ' + marks.length + ' caption(s)');
}

async function openApp(browser, base, backend, username) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(CLOCK));
  await page.addInitScript(([t, today]) => { try { if (t) sessionStorage.setItem('cbx_agent_token', t); } catch (e) {} window.__agentToday = today; }, [backend.tokens[username], TODAY]);
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
  await fontCheck(page, '(fonts, ' + username + ')');
  const nav = async (label) => { await click(page, page.locator('.nav-item', { hasText: label }).first()); await idle(); };
  const view = async (v) => { await page.evaluate((x) => { VIEW = x; render(); }, v); await idle(); };
  return { ctx, page, errors, idle, nav, view };
}

async function card(browser, n, name, made, voId, vo) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const page = await ctx.newPage();
  await page.setContent(made.html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await fontCheck(page, '(fonts, card ' + name + ')');
  await clip(n, name, page, [], voId, vo, async (say, mark) => {
    await page.evaluate(() => document.body.classList.add('go'));
    for (let t = 2; t < made.seconds; t += 3.5) { await wait(page, 3500); mark(); }
  });
  await ctx.close();
}

/* ------------------------------------------------------------------ before the cameras: help requests on Tumi's team */
async function seedHelp(backend) {
  const asks = [['cb9110', 'Explain the product', 'A customer asked whether the family bundle covers a parent living with them.'],
    ['cb9111', 'Help with the system', 'The dialler drops me after every second call this morning.'],
    ['cb9108', 'Review my call', 'Can we listen to my 11:20 call — I lost the customer at the price.'],
    ['cb9107', 'Explain what to say', 'What do I say when the customer says they will think about it?']];
  for (const [as, category, note] of asks) {
    const r = await backend.call('POST', '/api/portal/help/request', { as, body: { category, note } });
    must(r.status === 200, 'help request from ' + as);
  }
  const list = (await backend.call('GET', '/api/portal/help/list', { as: LEADER })).json || {};
  const reqs = list.requests || [], stages = list.stages || [];
  must(reqs.length >= 4 && stages.length >= 3, 'the seeded requests in Tumi\'s Help Center');
  /* two opened (seen), one sorted and closed — so the record shows every state */
  for (const r of reqs.slice(0, 2)) await backend.call('POST', '/api/portal/help/detail', { as: LEADER, body: { id: r.id } });
  const closedStage = stages[stages.length - 1];
  await backend.call('POST', '/api/portal/help/stage', { as: LEADER, body: { id: reqs[0].id, stageId: closedStage.id } });
}

/* ------------------------------------------------------------------ the story */
async function teamClip(T, lens) {
  const { page, nav, errors } = T;
  await clip(1, 'team-exceptions', page, errors, 's01', lens.s01, async (say) => {
    await nav('My Team');
    await say('Exceptions, not everyone.', 'Who needs help — and what’s already in progress.', 1800);
    await glide(page, page.locator('text=Who needs help').first(), 800); await wait(page, 900);
    await scrollTo(page, 650, 2200); await wait(page, 1200);
    await glide(page, page.locator('.nav-item', { hasText: 'Help Center' }).first(), 800); await wait(page, 1200);
    await scrollTo(page, 0, 1400);
    await nav('Team Results');
    await scrollTo(page, 300, 1600); await wait(page, 1500);
  });
}

async function drillClip(T, lens) {
  const { page, nav, idle, errors } = T;
  await clip(2, 'agent-in-context', page, errors, 's02', lens.s02, async (say) => {
    await nav('My Team');
    const row = page.locator('text=' + AGENT_NAME).first();
    must(await row.count(), AGENT_NAME + ' on My Team');
    await click(page, row); await idle();
    await say('Let’s take ' + FIRST + '.', 'Her month, in context.', 1600);
    const open = page.locator('button', { hasText: 'Open ' + FIRST }).first();
    must(await open.count(), 'the Open ' + FIRST + ' button');
    await click(page, open); await idle();
    await wait(page, 1200);
    await scrollTo(page, 9999, 3000); await wait(page, 1500); await scrollTo(page, 0, 1600);
  });
}

async function diagnosisClip(T, lens) {
  const { page, view, idle, errors } = T;
  /* Megan's drill-in panel (still open from clip 02): her talk time and attendance tiles, then the engine's own next best
     action — "Why it fired: Conversion … below the 10% tenure target" */
  await clip(3, 'diagnosis', page, errors, 's03', lens.s03, async (say) => {
    for (const label of [/talk \/ day/i, /^attendance$/i]) {
      const t = page.getByText(label).first();
      if (await t.count()) { await glide(page, t, 700); await wait(page, 900); }
    }
    await say('Activity is healthy.', 'Talk time and attendance on target.', 2600);
    const why = page.getByText('Why it fired').first();
    must(await why.count(), 'the R7 diagnosis in the drill-in');
    await glide(page, why, 800);
    await say('Conversion is not.', 'Below the 10% target — the constraint is in the conversation.', 3000);
    await say('Critical Conversion Failure', 'The engine names it — from the evidence.', 3000);
  });
}

async function interventionClip(T, lens) {
  const { page, idle, errors } = T;
  await clip(4, 'intervention', page, errors, 's04', lens.s04, async (say) => {
    const action = page.getByText('What happens next').first();
    must(await action.count(), 'the R7 action');
    await glide(page, action, 800);
    await say('The next step, from your own rules.', 'Conversion masterclass within 5 days.', 3000);
    const back = page.locator('button', { hasText: 'Back' }).first();
    if (await back.count()) { await click(page, back); await idle(); }
    const card = page.locator('div', { has: page.locator('text=' + AGENT_NAME) }).filter({ has: page.locator('button', { hasText: 'In progress' }) }).last();
    if (await card.count()) { await click(page, card.locator('button', { hasText: 'In progress' }).first()); await idle(); }
    await say('The team leader decides.', 'Marked in progress — on the record.', 3000);
  });
}

async function coachingClip(T, lens) {
  const { page, nav, idle, errors } = T;
  await clip(5, 'coaching-hub', page, errors, 's05', lens.s05, async (say) => {
    await nav('Coaching Hub');
    await say('Recorded. Signed. Tracked.', 'A coaching system, not a coaching log.', 1600);
    await page.evaluate(() => coachOpen('formalCoachingCalls')); await idle();
    await page.selectOption('#cfAgent', AGENT_NAME); await wait(page, 500);
    const fill = async (cp, v) => { const el = page.locator('[data-cp="' + cp + '"]').first(); if (await el.count()) { await el.scrollIntoViewIfNeeded(); if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption(v); else await el.fill(v); await wait(page, 350); } };
    await fill('campaign', 'Courtesy');
    await fill('calls.0.contactNumber', '0800 000 318');
    await fill('calls.0.developmentAreas', 'Strong opening and needs analysis; moved to price before building value — lost the close at the cost objection.');
    await fill('supportProvided', 'Role-played the price objection and the close on two of her calls.');
    await fill('agreedPlanAgentFeedback', 'Megan will build value before quoting and ask for the sale twice.');
    await fill('clusterGap', 'gap.pitch_value_creation');
    await click(page, '#cfDraft'); await idle();
    /* back to the Hub's drafts list (as spec 005's walk does), then open the draft to sign it */
    await page.evaluate(() => { CFORM = cformBlank(); hubStale('drafts'); render(); }); await idle();
    await click(page, page.locator('[data-draft-open]').first()); await idle();
    for (const sig of ['agentSignature', 'teamLeaderSignature']) {
      const c = page.locator('.sig[data-sig="' + sig + '"] canvas');
      await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox(); if (!b) continue;
      const y = b.y + b.height / 2; await page.mouse.move(b.x + 20, y + 8); await page.mouse.down();
      for (let i = 1; i <= 24; i++) await page.mouse.move(b.x + 20 + i * 9, y + Math.sin(i / 2.2) * 14 * (sig === 'agentSignature' ? 1 : -1));
      await page.mouse.up(); await wait(page, 300);
    }
    await click(page, '#cfSubmit'); await idle();
    const fails = page.locator('text=Coaching fails').first();
    if (await fails.count()) { await scrollTo(page, 'text=Coaching fails', 1400); }
    await wait(page, 1500);
  });
}

async function helpClip(T, lens) {
  const { page, nav, idle, errors } = T;
  await page.evaluate(() => { HELPD = null; HELPD_AT = 0; HELP_BUSY = false; helpLoad(); }); await idle();
  await clip(6, 'help-requests', page, errors, 's06', lens.s06, async (say) => {
    await nav('Help Center');
    await say('Every request, time-stamped.', 'Asked, seen, closed.', 2400);
    const rows = page.locator('.hc-name[data-hid]');
    for (let i = 0; i < Math.min(3, await rows.count()); i++) { await glide(page, rows.nth(i), 650); await wait(page, 700); }
    await glide(page, page.locator('text=Your help record').first(), 800);
    await say('How well managers support their people.', 'Measured — not guessed.', 3000);
  });
}

async function managerClip(M, lens) {
  const { page, nav, errors } = M;
  await clip(7, 'campaign-manager', page, errors, 's07', lens.s07, async (say) => {
    await nav('Campaign');
    await say('Compare every team.', 'Teams, team leaders and issues — across the campaign.', 2400);
    await scrollTo(page, 600, 1800); await wait(page, 600); await scrollTo(page, 0, 1000);
    await nav('Team Leaders');
    await say('What needs action today?', 'Not what happened yesterday.', 2600);
    await nav('Reports'); await scrollTo(page, 500, 1600); await wait(page, 800);
  });
}

/* ------------------------------------------------------------------ run */
const browser = await chromium.launch();
let srv = null;
const opened = [];
try {
  console.log('Speaking the narration (Kokoro, offline)…');
  const lens = speak();
  console.log('  ' + Object.entries(lens).map(([k, v]) => k + ' ' + v + ' s').join(' · '));
  const floor = buildFloor({ story: 'v2' });
  const closed = Object.values(floor.state.closedcases.rows), conv = {};
  for (const c of closed) { const e = (conv[c.owner] = conv[c.owner] || [0, 0]); e[1]++; if (c.status === 'Closed - Sale') e[0]++; }
  for (const k of Object.keys(conv)) conv[k] = conv[k][1] ? conv[k][0] / conv[k][1] : null;
  console.log('Building the fictional month (video-2 profile: ' + STORY2_AGENT + ' conversion ' + (Math.round(conv[STORY2_AGENT] * 1000) / 10) + '%)…');
  let backend = null;
  await shootVas({ browser, root: ROOT, floor, shot: async () => {}, ready: async (published) => {
    const { createBackend } = await import('./demo/backend.mjs');
    backend = await createBackend({ root: ROOT, vas: published, story: 'v2', conv });
    return (route) => backend.route(route, { as: 'demo-admin' });
  } });
  await seedHelp(backend);
  srv = await brandServe(ROOT);
  const base = 'http://127.0.0.1:' + srv.address().port;
  console.log('\nRecording');
  const v0 = lens.s00;
  await card(browser, 0, 'title-managing-exceptions', linesCard([
    ['From managing people to managing *exceptions.*', 0.3, 3.9],
    ['A team leader: ten, fifteen or twenty people.', 4.0, 7.7],
    ['A campaign manager: hundreds.', 7.8, 10.7],
    ['The problem isn’t information.', 10.8, 13.4],
    ['Who needs attention? *Why?* What next?', 13.5, 99]], v0 + LEAD_IN + TAIL), 's00', v0);
  const T = await openApp(browser, base, backend, LEADER); opened.push(T);
  const M = await openApp(browser, base, backend, MANAGER); opened.push(M);
  await teamClip(T, lens);
  await drillClip(T, lens);
  await diagnosisClip(T, lens);
  await interventionClip(T, lens);
  await coachingClip(T, lens);
  await helpClip(T, lens);
  await managerClip(M, lens);
  await card(browser, 8, 'end-card', engineEndCard(lens.s08 + LEAD_IN + TAIL + 1.5), 's08', lens.s08);
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
console.log('\n' + clips.length + ' clips, ' + total.toFixed(1) + ' s in total' + (problems.length ? ' — ' + problems.length + ' problem(s):' : ' — all clean.'));
for (const p of problems) console.log('  ' + p.file + ': ' + p.issues.join('; '));
process.exit(problems.length ? 1 : 0);
