// An agent can open EVERY coaching session recorded for them and read all of it (10 Nov 2026: "allow them to open and
// view only what they were coached on etc"). The Worker already scopes the payload to the agent and strips other
// attendees from group sessions; this proves the page shows every session and every written field, labelled and escaped.
// Real page, a real agent's published payload for the shape, invented sessions for the content. Nothing leaves the machine.
//   node nicks_code/diagnostics/verify-agent-coaching-open.mjs [cb385]
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = process.env.AGENTOS || path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const { overview } = await import(pathToFileURL(path.join(REPO, 'worker', 'src', 'portal.mjs')).href);
const env = {}; for (const l of fs.readFileSync(path.resolve(HERE, '..', '..', 'supabase.env'), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const sget = async (k) => { const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/' + k, { headers: H }); if (!r.ok) return null; let b = Buffer.from(await r.arrayBuffer()); if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b); return b.toString(); };
const who = process.argv[2] || 'cb385';
const user = (await (await fetch(`${env.SUPABASE_URL}/rest/v1/app_users?username=eq.${who}&select=id,username,role,cb,full_name,apps`, { headers: H })).json())[0];
const digest = JSON.parse(await sget('kv/agent-digest'));
const DB = { select: async (q) => (/kv%3Acoaching|kv:coaching/.test(q) ? [{ value: { store: 'raw/kv/coaching' } }] : []), storageGet: async (b, k) => sget(k), insert: async () => {}, update: async () => {} };
const real = await overview({}, DB, user, digest, [], undefined);
const realSessions = ((real.body.coaching || {}).agents || [{}])[0].sessions || [];

const XSS = '<img src=x onerror="window.__pwned=1">';
const base = { cb: user.cb, agentName: 'Test Agent', campaign: 'Courtesy', hubTeamLeader: 'Test Leader', coach: 'Test Leader', coachIsTl: true, clusters: [] };
const SESS = [
  { ...base, id: 'qa1', collection: 'qualityAssuranceCoaching', typeLabel: 'QA Coaching', date: '2026-11-07', callDate: '2026-11-05', qaScore: 82, developmentAreas: 'DEV-AREAS-QA', teamLeaderComments: 'TL-COMMENTS-QA ' + XSS, agentFeedback: 'AGENT-FEEDBACK-QA' },
  { ...base, id: 'f1', collection: 'formalCoachingCalls', typeLabel: 'Formal Coaching', date: '2026-11-06', callNotes: ['CALL-NOTE-1', 'CALL-NOTE-2'], supportProvided: 'SUPPORT-PROVIDED', agreedPlanAgentFeedback: 'AGREED-PLAN' },
  { ...base, id: 'i1', collection: 'informalCoaching', typeLabel: 'Informal Coaching', date: '2026-11-05', teamLeaderFeedback: 'TL-FEEDBACK-INF', wayForward: 'WAY-FORWARD', agentFeedback: 'AGENT-FEEDBACK-INF' },
  { ...base, id: 'g1', collection: 'groupCoaching', typeLabel: 'Group Coaching', date: '2026-11-04', coachingDetails: 'GROUP-DETAILS', groupSession: true },
  { ...base, id: 'l1', collection: 'leadManagementCoaching', typeLabel: 'Lead Management Coaching', date: '2026-11-03', developmentAreas: 'DEV-AREAS-LM', sosComments: 'SOS-COMMENTS', agentFeedback: 'AGENT-FEEDBACK-LM' },
  ...[1, 2, 3, 4].map((n) => ({ ...base, id: 'old' + n, collection: 'qualityAssuranceCoaching', typeLabel: 'QA Coaching', date: '2026-10-0' + n, qaScore: 90, developmentAreas: 'OLDER-' + n })),
];

const server = http.createServer((q, s) => { if (q.url.split('?')[0] !== '/') { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(path.join(REPO, 'agent', 'index.html')).pipe(s); });
await new Promise((r) => server.listen(8194, '127.0.0.1', r));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { try { sessionStorage.setItem('cbx_agent_token', 'harness'); } catch (e) {} });
await page.route('**/*', async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.hostname === '127.0.0.1') return route.continue();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/portal/me') return json(200, { user: { username: user.username, role: user.role, cb: user.cb, full_name: user.full_name } });
  if (u.pathname === '/api/portal/overview') return json(real.status, real.body);
  return json(404, { error: 'not stubbed' });
});
await page.goto('http://127.0.0.1:8194/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof D !== 'undefined' && D && D.coaching, null, { timeout: 30000 });
console.log(`\n${user.username} (${user.role}) · real payload: ${realSessions.length} sessions`);

const show = async (sessions, view = 'coaching') => page.evaluate(({ s, v }) => { D.coaching.agents[0].sessions = s; VIEW = v; render(); }, { s: sessions, v: view });

// 1 · the real payload: every session is listed, not the newest six
await show(realSessions);
const realRows = await page.evaluate(() => document.querySelectorAll('#root .sess').length);
ok('the Coaching tab lists every session in the payload (' + realSessions.length + '), not the newest six', realRows === realSessions.length, 'rows=' + realRows);

// 2 · invented sessions: every written field of every type, labelled
await show(SESS);
const rows = await page.evaluate(() => document.querySelectorAll('#root .sess').length);
ok('all ' + SESS.length + ' sessions are listed', rows === SESS.length, 'rows=' + rows);
await page.evaluate(() => document.querySelectorAll('#root details.sess').forEach((d) => { d.open = true; }));
const txt = await page.evaluate(() => document.getElementById('root').innerText);
const must = {
  'QA': ['DEV-AREAS-QA', 'TL-COMMENTS-QA', 'AGENT-FEEDBACK-QA', '82', 'Development areas', 'Team leader comments'],
  'Formal': ['CALL-NOTE-1', 'CALL-NOTE-2', 'SUPPORT-PROVIDED', 'AGREED-PLAN', 'Call notes', 'Support provided', 'Agreed plan'],
  'Informal': ['TL-FEEDBACK-INF', 'WAY-FORWARD', 'AGENT-FEEDBACK-INF', 'Way forward'],
  'Group': ['GROUP-DETAILS'],
  'Lead management': ['DEV-AREAS-LM', 'SOS-COMMENTS', 'AGENT-FEEDBACK-LM'],
  'Older sessions': ['OLDER-1', 'OLDER-4'],
};
const low = txt.toLowerCase();   // .sblk label is text-transform: uppercase, so innerText reads labels in capitals
for (const [k, words] of Object.entries(must)) { const miss = words.filter((w) => !low.includes(w.toLowerCase())); ok(k + ': every written field is shown, labelled', !miss.length, 'missing ' + miss.join(', ')); }
ok('the QA call date is shown', /5 Nov/.test(txt) || txt.includes('2026-11-05'), '');
ok('what a person typed is escaped, never run', !(await page.evaluate(() => window.__pwned === 1)) && txt.includes('<img src=x'), '');

// 3 · a session with no written content (what a team leader's drill-in carries) is a line, not an empty expander
const bare = SESS.slice(0, 3).map((s) => { const o = {}; for (const k of ['id', 'collection', 'typeLabel', 'date', 'cb', 'qaScore', 'coach', 'coachIsTl']) if (s[k] !== undefined) o[k] = s[k]; return o; });
await show(bare);
ok('a session without text is a line, not an expander with nothing in it', (await page.evaluate(() => document.querySelectorAll('#root details.sess').length)) === 0);

// 4 · the quiet preview (the not-yet-reported page) keeps its six lines and its two-field wording
const prev = await page.evaluate((s) => { D.coaching.agents[0].sessions = s; const d = document.createElement('div'); d.innerHTML = coachHTML(D.coaching, true); return { rows: d.querySelectorAll('.sess').length, said: /What was discussed/.test(d.textContent) }; }, SESS);
ok('the quiet preview still shows at most six, with its own wording', prev.rows === 6 && prev.said, JSON.stringify(prev));
ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
