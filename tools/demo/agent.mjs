/**
 * AGENT ANALYTICS FOR THE DEMO (spec 005, user story 2).
 *
 * Serves the SOURCE page (agent/index.html) and answers every API call with the real Worker running in-process
 * (backend.mjs) over the same fictional floor VAS Analytics showed. A few things are first done THROUGH the product, the
 * way the floor would do them, so the screens have something to show: three agents ask their team leader for help, a
 * team leader asks the campaign manager for assistance, and a coaching document is already waiting as a draft.
 *
 * Then three walks, each signed in as one fictional person, in navigation order:
 *   team leader (Leah Marais) — My Team, an agent drill-in, Help Center, KPI Hub, Coaching Hub and the coaching flow
 *     (new document → filled → draft saved → in Drafts → signed → submitted and locked), Team Results, the five reports,
 *     Nikola, All forms
 *   agent (Kabelo Mthembu)    — Today, Projected Commission, My Progress, Coaching, Links
 *   campaign manager (Imogen Botha) — Campaign, Teams, Assistance, the five reports, Coaching, Nikola, Settings
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { CLOCK, TODAY } from './floor.mjs';

const API = /chatterbox-agentos-api\.chatterbox-agentos\.workers\.dev/;
const PAGE_CSS = '*{animation:none!important;transition:none!important;caret-color:transparent!important}#toast,.toast{display:none!important}';

function serve(root) {
  const file = path.join(root, 'agent', 'index.html');
  const server = http.createServer((q, s) => {
    const u = q.url.split('?')[0];
    if (u !== '/' && u !== '/index.html') { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(s);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function seedThroughTheProduct(backend, root) {
  const asks = [['cb9105', 'Review my call', 'The customer on my 10:40 call asked about the waiting period and I froze. Can we listen to it together?'],
    ['cb9103', 'Explain the product', 'What is the difference between the family and the single bundle when the customer already has a policy?'],
    ['cb9104', 'Help with the system', 'Salesforce logs me out every time I open a second case.']];
  for (const [as, category, note] of asks) {
    const r = await backend.call('POST', '/api/portal/help/request', { as, body: { category, note } });
    if (r.status !== 200) console.log('  (seed) help request ' + as + ' → ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160));
  }
  const { CM_BLOCKAGES_DEFAULTS } = await import(pathToFileURL(path.join(root, 'worker', 'src', 'campaign.mjs')).href);
  const blk = ((CM_BLOCKAGES_DEFAULTS.find((b) => b.key === 'crm') || CM_BLOCKAGES_DEFAULTS[0]) || {}).key;   // a Salesforce fault is a CRM blockage
  const cm = await backend.call('POST', '/api/portal/cm/request', { as: 'cb9001', body: { blockage: blk, priority: 'P2', campaign: 'Courtesy',
    description: 'Four agents cannot see the new bundle price in Salesforce since this morning.', impact: 'Quotes are being sent at the old price.', affected: 4 } });
  if (cm.status !== 200) console.log('  (seed) assistance request → ' + cm.status + ' ' + JSON.stringify(cm.json).slice(0, 160));
  const dr = await backend.call('POST', '/api/portal/hub/coaching/drafts', { as: 'cb9001', body: { action: 'save', type: 'informalCoaching', data: {
    agentName: 'Jared Pillay', employeeNumber: 'CB9104', date: '2026-09-28', campaign: 'Courtesy',
    teamLeaderFeedback: 'Good recovery on the second call after a slow start.', agentFeedback: '', wayForward: '' } } });
  if (dr.status !== 200) console.log('  (seed) coaching draft → ' + dr.status + ' ' + JSON.stringify(dr.json).slice(0, 160));
}

export async function shootAgent({ browser, root, backend, shot }) {
  await seedThroughTheProduct(backend, root);
  const server = await serve(root);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    /* ------------------------------------------------------------- one signed-in page per person */
    async function signIn(username) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(CLOCK));
      await page.addInitScript(([tok, today]) => { try { sessionStorage.setItem('cbx_agent_token', tok); } catch (e) {} window.__agentToday = today; }, [backend.tokens[username], TODAY]);
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
        await page.evaluate(() => document.fonts && document.fonts.ready);
      };
      await page.waitForFunction(() => document.querySelector('#side .nav-item, .nav-item'), null, { timeout: 30000 }).catch(() => {});
      await idle();
      const take = async (name) => { const before = errors.length; await idle(); await shot(page, name, errors.slice(before)); };
      const view = async (v) => { await page.evaluate((x) => { VIEW = x; render(); }, v); await idle(); };
      return { ctx, page, idle, take, view };
    }

    /* ------------------------------------------------------------- the team leader */
    {
      const { ctx, page, idle, take, view } = await signIn('cb9001');
      await view('team'); await take('agent-analytics-tl-my-team');
      await page.evaluate(() => openAgent('CB9105')); await idle(); await take('agent-analytics-tl-agent-drill-in');
      /* the drill-in is the agent's own page inside the team view — come back the way a team leader does */
      if (await page.locator('#backTop').count()) await page.click('#backTop'); else await page.evaluate(() => { if (D && D.__back) { D = D.__back; teamView(); } });
      await idle();
      await view('help'); await take('agent-analytics-tl-help-center');
      await view('kpihub'); await take('agent-analytics-tl-kpi-hub');
      await view('coach_team'); await take('agent-analytics-tl-coaching-hub');

      /* the coaching flow, step by step — filled in the way a team leader does it */
      await page.evaluate(() => coachOpen('formalCoachingCalls')); await idle();
      await page.selectOption('#cfAgent', 'Zanele Mahlangu');
      const fill = async (cp, v) => { const el = page.locator('[data-cp="' + cp + '"]'); if (await el.count()) { const tag = await el.first().evaluate((n) => n.tagName); if (tag === 'SELECT') await el.first().selectOption(v); else await el.first().fill(v); } };
      await fill('campaign', 'Courtesy');
      await fill('calls.0.contactNumber', '0800 000 145');
      await fill('calls.0.developmentAreas', 'Quoted the price before the customer understood the cover — the objection followed.');
      await fill('calls.1.contactNumber', '0800 000 212');
      await fill('calls.1.developmentAreas', 'Good verification; missed the second ask for the sale.');
      await fill('supportProvided', 'Listened to both calls together and role-played building value before the price.');
      await fill('agreedPlanAgentFeedback', 'Zanele will confirm the need, explain the cover, then quote — and ask for the sale twice.');
      await fill('clusterGap', 'gap.pitch_value_creation');
      await fill('clusterAgentCommitment', 'commitment.strengthen_product_pitch');
      await fill('clusterSupportProvided', 'support.role_play_practice');
      await take('agent-analytics-tl-coaching-new-formal-document');
      await page.click('#cfDraft'); await idle();
      await take('agent-analytics-tl-coaching-draft-saved');
      await page.evaluate(() => { CFORM = cformBlank(); hubStale('drafts'); render(); }); await idle();
      await take('agent-analytics-tl-coaching-drafts-list');
      const draftBtn = page.locator('[data-draft-open]').first();
      await draftBtn.click(); await idle();
      for (const sigField of ['agentSignature', 'teamLeaderSignature']) {
        const c = page.locator('.sig[data-sig="' + sigField + '"] canvas');
        await c.scrollIntoViewIfNeeded();
        const b = await c.boundingBox();
        if (!b) continue;
        const y = b.y + b.height / 2;
        await page.mouse.move(b.x + 20, y + 8); await page.mouse.down();
        for (let i = 1; i <= 24; i++) await page.mouse.move(b.x + 20 + i * 9, y + Math.sin(i / 2.2) * 14 * (sigField === 'agentSignature' ? 1 : -1));
        await page.mouse.up();
      }
      await take('agent-analytics-tl-coaching-signed');
      await page.click('#cfSubmit'); await idle();
      await take('agent-analytics-tl-coaching-submitted-and-locked');

      await view('results'); await take('agent-analytics-tl-team-results');
      for (const [v, n] of [['mtd_team', 'month-to-date'], ['daily_team', 'daily'], ['weekly_team', 'weekly'], ['variance_team', 'variance'], ['leads_team', 'lead-management']]) {
        await view(v); await take('agent-analytics-tl-report-' + n);
      }
      await view('nik_team');
      if (await page.locator('#nikIn').count()) { await page.fill('#nikIn', 'Who on my team needs me most this week?'); await page.click('#nikGo'); await idle(); }
      await take('agent-analytics-tl-nikola');
      await view('forms'); await take('agent-analytics-tl-all-forms');
      await ctx.close();
    }

    /* ------------------------------------------------------------- the agent */
    {
      const { ctx, take, view } = await signIn('cb9101');
      await view('month'); await take('agent-analytics-agent-today');
      await view('calc'); await take('agent-analytics-agent-projected-commission');
      await view('progress'); await take('agent-analytics-agent-my-progress');
      await view('coaching'); await take('agent-analytics-agent-coaching');
      await view('links'); await take('agent-analytics-agent-links');
      await ctx.close();
    }

    /* ------------------------------------------------------------- the campaign manager */
    {
      const { ctx, take, view } = await signIn('imogen');
      await view('cm'); await take('agent-analytics-cm-campaign');
      await view('cm_teams'); await take('agent-analytics-cm-teams');
      await view('cm_assist'); await take('agent-analytics-cm-assistance');
      for (const [v, n] of [['cm_mtd', 'month-to-date'], ['cm_daily', 'daily'], ['cm_weekly', 'weekly'], ['cm_variance', 'variance'], ['cm_leads', 'lead-management']]) {
        await view(v); await take('agent-analytics-cm-report-' + n);
      }
      await view('cm_coach'); await take('agent-analytics-cm-coaching');
      await view('cm_nik'); await take('agent-analytics-cm-nikola');
      await view('cm_set'); await take('agent-analytics-cm-settings');
      await ctx.close();
    }
  } finally {
    server.close();
  }
}
