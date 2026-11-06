// A team leader can go back through past months on Month to date (6 Nov 2026, "denise on the floor saying she cant filter
// passed months for the month to date"). Real page, real Worker overview(), real published digests, a real team leader.
// Read only, and the browser is cut off from the network: every API answer comes from this file.
//   node nicks_code/diagnostics/verify-tl-past-months.mjs [cb267]
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = process.env.AGENTOS || path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const { overview } = await import(pathToFileURL(path.join(REPO, 'worker', 'src', 'portal.mjs')).href);
const env = {}; for (const l of fs.readFileSync(path.resolve(HERE, '..', '..', 'supabase.env'), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const who = process.argv[2] || 'cb267';
const user = (await (await fetch(`${env.SUPABASE_URL}/rest/v1/app_users?username=eq.${who}&select=id,username,role,cb,full_name,apps,team`, { headers: H })).json())[0];
if (!user) { console.error('no such account'); process.exit(2); }
const rows = await (await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=like.${encodeURIComponent('kv:agent-digest-%')}&select=key`, { headers: H })).json();
const months = rows.map((r) => r.key.slice('kv:agent-digest-'.length)).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
const getDigest = async (key) => { const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: H }); if (!r.ok) return null; let b = Buffer.from(await r.arrayBuffer()); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); return JSON.parse(b.toString()); };
const digests = { '': await getDigest('agent-digest') }; for (const m of months) digests[m] = await getDigest('agent-digest-' + m);
const fakeDB = { select: async () => [], insert: async () => {}, update: async () => {}, rpc: async () => [] };
const answer = async (month) => { const d = digests[month || '']; if (!d) return { status: 404, body: { error: 'No figures were published for ' + month + '.' } }; return overview({}, fakeDB, user, d, months, undefined); };

const PAGE = path.join(REPO, 'agent', 'index.html');
const server = http.createServer((q, s) => { if (q.url.split('?')[0] !== '/') { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(PAGE).pipe(s); });
await new Promise((r) => server.listen(8195, '127.0.0.1', r));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let holdLive = null;
await page.addInitScript(() => { try { sessionStorage.setItem('cbx_agent_token', 'harness'); } catch (e) {} });
await page.route('**/*', async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.hostname === '127.0.0.1') return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/portal/me') return json(200, { user: { username: user.username, role: user.role, cb: user.cb, full_name: user.full_name } });
  if (u.pathname === '/api/portal/overview') { const mo = u.searchParams.get('month') || ''; if (!mo && holdLive) await holdLive; const a = await answer(mo); return json(a.status, a.body); }
  return json(404, { error: 'not stubbed' });
});
await page.goto('http://127.0.0.1:8195/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof D !== 'undefined' && D && D.scope, null, { timeout: 30000 });
console.log(`\n${user.full_name} (${user.username}, ${user.role}) · published months: ${months.join(', ')}`);
await page.evaluate(() => { VIEW = 'mtd_team'; render(); });
await page.waitForTimeout(300);

const live = await page.evaluate(() => nowDay().slice(0, 7));
const past = months.filter((m) => m < live);
const options = await page.evaluate(() => [...document.querySelectorAll('#repMonth option')].map((o) => o.value));
ok('the Reports bar has a month picker', options.length > 0, 'options=' + options.length);
ok('it offers this month and every published past month', JSON.stringify(options) === JSON.stringify(['', ...past]), JSON.stringify(options));

for (const m of past) {
  const a = await answer(m);
  const team = (a.body.agents || []).filter((r) => r.covered !== false);   // a not-covered agent is named, never reported (VT)
  const expected = team.reduce((t, r) => t + (+r.sales || 0), 0);
  if (a.status !== 200) {
    /* a leader with no team that month: the Worker refuses, and the picker must go back to what is on screen */
    await page.selectOption('#repMonth', m).catch(() => {});
    await page.waitForTimeout(400);
    const stay = await page.evaluate(() => ({ month: VIEWMONTH, picked: (document.getElementById('repMonth') || {}).value }));
    ok(m + ': refused (' + String(a.body.error).slice(0, 40) + '…), and the picker does not claim that month', stay.month !== m && stay.picked === stay.month, JSON.stringify(stay));
    continue;
  }
  await page.selectOption('#repMonth', m).catch(() => {});
  await page.waitForFunction((k) => VIEWMONTH === k && D && String(D.period && D.period.from).slice(0, 7) === k, m, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const seen = await page.evaluate(() => ({ view: VIEW, month: VIEWMONTH, rows: document.querySelectorAll('table tbody tr').length, final: /\(final\)/.test(document.body.innerText), picked: (document.getElementById('repMonth') || {}).value, sales: (D.agents || []).reduce((t, r) => t + (+r.sales || 0), 0) }));
  ok(m + ': opens on Month to date, marked final, with the picker still on it', seen.view === 'mtd_team' && seen.month === m && seen.final && seen.picked === m, JSON.stringify(seen));
  if (team.length) ok(m + ': shows the team (' + team.length + ' agents, ' + expected + ' sales in the digest)', seen.rows >= team.length && seen.sales === expected, JSON.stringify(seen));
  else console.log('  --    ' + m + ': no covered agents that month, nothing to total');
  for (const tab of ['daily_team', 'weekly_team', 'variance_team', 'leads_team']) {
    await page.evaluate((t) => { VIEW = t; render(); }, tab); await page.waitForTimeout(80);
  }
  await page.evaluate(() => { VIEW = 'mtd_team'; render(); }); await page.waitForTimeout(80);
}
if (past.length) {
  await page.selectOption('#repMonth', '').catch(() => {});
  await page.waitForFunction(() => VIEWMONTH === '', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => ({ month: VIEWMONTH, period: D.period && D.period.from, picked: (document.getElementById('repMonth') || {}).value }));
  ok('choosing this month comes back to the live month', back.month === '' && String(back.period).slice(0, 7) === live && back.picked === '', JSON.stringify(back));
}
if (past.length) {
  /* The review's race: a live refresh is in flight when the person picks a month. Its answer must not land on that month. */
  let release; holdLive = new Promise((r) => { release = r; });
  await page.evaluate(() => { refreshPortal(false); });
  await page.waitForTimeout(100);
  await page.selectOption('#repMonth', past[0]);
  await page.waitForFunction((k) => VIEWMONTH === k && String(D.period && D.period.from).slice(0, 7) === k, past[0], { timeout: 5000 }).catch(() => {});
  release(); holdLive = null;
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ month: VIEWMONTH, period: String(D.period && D.period.from).slice(0, 7), picked: (document.getElementById('repMonth') || {}).value }));
  ok('a refresh already on its way cannot land on the month just picked', after.month === past[0] && after.period === past[0] && after.picked === past[0], JSON.stringify(after));
}
ok('no page errors on any month or tab', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
