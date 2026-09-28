/* verify-help-repeat.mjs — an agent can ask their team leader for help AGAIN (Nick, 2026-09-28:
 * "the ask for help was not working, in the agent view, if you ask for the second time").
 *
 * The Help location refuses a second opportunity for one contact in one pipeline (400
 * OPPORTUNITY_NO_DUPLICATE) while "Allow Duplicate Opportunity" is off, so every agent who had
 * ever asked got a 502 on every later ask. Drives worker/src/help.mjs against a fake HighLevel
 * that enforces that rule, and a fake DB:
 *   1 duplicates allowed: every ask is its own card, nothing reused (the original design)
 *   2 an OPEN card: the new ask joins it — renamed, back to the first stage, both notes readable
 *   3 a CLOSED card: archived, then reopened — the closed request still counts on the TL's record,
 *     and the reopened card shows only its own note
 *   4 the search has not caught up with the card: a 409 in words, never a 502
 *   5 the card cannot be moved: the archive and the card record are put back
 *   6 a create that fails for another reason still fails
 *   7 an archived id is refused by close/stage/detail without asking HighLevel
 *
 * Run: node verify-help-repeat.mjs   (no network, no credentials)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = await import(pathToFileURL(path.join(HERE, '..', '..', 'worker', 'src', 'help.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };

const env = { HL_HELP_API_KEY: 'k', HL_HELP_LOCATION_ID: 'loc1' };
const STAGES = [{ id: 's0', name: 'New', position: 0 }, { id: 's1', name: 'In progress', position: 1 },
  { id: 's2', name: 'Waiting on agent', position: 2 }, { id: 's3', name: 'Closed', position: 3 }];
const digest = { agents: [
  { code: 'CB162', name: 'Nothando Mntungwa', tl: 'Denise Haripersad', campaign: 'Courtesy' },
  { code: 'CB163', name: 'Other Agent', tl: 'Denise Haripersad', campaign: 'Courtesy' }] };
const agent = { role: 'agent', cb: 'CB162', full_name: 'Nothando Mntungwa', username: 'cb162' };
const tl = { role: 'team_leader', cb: 'CB267', team: 'Denise Haripersad', full_name: 'Denise Haripersad' };

function fakeDB() {
  const rows = {};
  const keyOf = (q) => { const m = /key=eq\.([^&]+)/.exec(q); return m ? decodeURIComponent(m[1]) : null; };
  const likeOf = (q) => { const m = /key=like\.([^&]+)/.exec(q); return m ? decodeURIComponent(m[1]).replace(/\*$/, '') : null; };
  return { rows,
    select: async (q) => {
      const k = keyOf(q); if (k != null) return rows[k] ? [{ key: k, value: rows[k] }] : [];
      const pre = likeOf(q); if (pre != null) return Object.keys(rows).filter((x) => x.startsWith(pre)).map((x) => ({ key: x, value: rows[x] }));
      return []; },
    insert: async (_t, list) => { for (const r of list) rows[r.key] = r.value; },
    del: async (q) => { const k = keyOf(q); if (k != null) delete rows[k]; } };
}

/* a HighLevel Help location: one pipeline, contacts, opportunities, notes */
function fakeHL(o) {
  const st = { opps: [], notes: {}, calls: [], n: 0, allowDup: !!o.allowDup, hide: new Set(), failPut: false, failCreate: null };
  const stamp = () => new Date(Date.now() + (st.n++)).toISOString();
  globalThis.__helpPipe = null;
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url); const method = (opts && opts.method) || 'GET'; const p = u.pathname;
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    st.calls.push({ method, path: p, body });
    const res = (status, b) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
    if (p === '/opportunities/pipelines') return res(200, { pipelines: [{ id: 'pipe1', name: 'Agent Help Center', stages: STAGES }] });
    if (p === '/opportunities/search') {
      const ops = st.opps.filter((x) => !st.hide.has(x.id)).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return res(200, { opportunities: ops, meta: { total: ops.length } });
    }
    if (p === '/opportunities/' && method === 'POST') {
      if (st.failCreate) return res(st.failCreate, { statusCode: st.failCreate, message: 'Internal error' });
      if (!st.allowDup && st.opps.some((x) => x.pipelineId === body.pipelineId && x.contactId === body.contactId))
        return res(400, { statusCode: 400, message: 'Can not create duplicate opportunity for the contact.', code: 'OPPORTUNITY_NO_DUPLICATE' });
      const t = stamp(); const op = { id: 'opp' + (st.opps.length + 1), ...body, createdAt: t, updatedAt: t };
      st.opps.push(op); return res(201, { opportunity: op });
    }
    let m = /^\/opportunities\/([^/]+)$/.exec(p);
    if (m) {
      const op = st.opps.find((x) => x.id === decodeURIComponent(m[1]));
      if (!op) return res(404, { message: 'not found' });
      if (method === 'GET') return res(200, { opportunity: op });
      if (method === 'PUT') { if (st.failPut) return res(500, { message: 'boom' });
        Object.assign(op, body, { updatedAt: stamp() }); return res(200, { opportunity: op }); }
    }
    m = /^\/contacts\/([^/]+)\/notes$/.exec(p);
    if (m) { const c = m[1]; st.notes[c] = st.notes[c] || [];
      if (method === 'POST') { if (st.failNote) return res(500, { message: 'note boom' });
        const nt = { id: 'n' + (st.n++), body: body.body, dateAdded: stamp() }; st.notes[c].push(nt); return res(201, { note: nt }); }
      return res(200, { notes: st.notes[c].slice().reverse() }); }
    if (p === '/contacts/' && method === 'POST') return res(201, { contact: { id: 'c-' + body.firstName } });
    return res(404, { message: 'unhandled ' + method + ' ' + p });
  };
  return st;
}
/* an agent who asked before the fix: a contact pointer, a card, a legacy note (no "Asked:" line) */
function seed(DB, hl, { closed }) {
  DB.rows['kv:help-contact:CB162'] = { id: 'c162' };
  hl.opps.push({ id: 'old1', pipelineId: 'pipe1', contactId: 'c162', name: '[Review my call] CB162 Nothando Mntungwa',
    pipelineStageId: closed ? 's3' : 's1', status: closed ? 'won' : 'open',
    createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z', lastStatusChangeAt: '2026-09-02T10:00:00.000Z' });
  hl.notes.c162 = [{ id: 'nold', body: 'Help request old1\nTopic: Review my call\nFrom: Nothando Mntungwa (CB162)\n\nFIRST ASK TEXT', dateAdded: '2026-09-01T08:00:01.000Z' }];
}
const ask = (DB, category, note) => H.helpRequest(env, DB, agent, digest, { category, note });
const T0 = new Date().toISOString();

console.log('\n1 · duplicates allowed: every ask is its own card');
{ const DB = fakeDB(); const hl = fakeHL({ allowDup: true });
  const a = await ask(DB, 'Review my call', 'first'); const b = await ask(DB, 'Explain the product', 'second');
  ok('both asks answer 200', a.status === 200 && b.status === 200, JSON.stringify([a, b]));
  ok('two different cards', a.body.id && b.body.id && a.body.id !== b.body.id && hl.opps.length === 2);
  ok('nothing merged or reopened', !b.body.merged && !b.body.reopened);
  ok('no archive rows', !Object.keys(DB.rows).some((k) => k.startsWith('kv:help-arch:'))); }

console.log('\n2 · the agent asks again while their card is OPEN');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: false });
  let r, threw = null; try { r = await ask(DB, 'Explain the product', 'SECOND ASK TEXT'); } catch (e) { threw = e; }
  ok('no error reaches the agent', !threw && r && r.status === 200, threw ? threw.message : JSON.stringify(r));
  ok('the ask joins the open card', r && r.body.id === 'old1' && r.body.merged === true, JSON.stringify(r && r.body));
  ok('no second card is minted', hl.opps.length === 1);
  const c = hl.opps[0];
  ok('the card carries the new topic', c.name === '[Explain the product] CB162 Nothando Mntungwa', c.name);
  ok('the card is back at the first stage, open', c.pipelineStageId === 's0' && c.status === 'open');
  const L = await H.helpList(env, DB, tl, digest);
  const row = (L.body.requests || []).find((x) => x.id === 'old1');
  ok('the team leader sees it open under the new topic', row && !row.closed && row.category === 'Explain the product', JSON.stringify(row));
  ok('dated by the new ask, so it sorts to the top', row && row.created >= T0, row && row.created);
  const d = await H.helpDetail(env, DB, tl, digest, 'old1');
  ok('the note shows the new ask', d.status === 200 && /SECOND ASK TEXT/.test(d.body.note), JSON.stringify(d.body));
  ok('…and the earlier ask on the same open card', /FIRST ASK TEXT/.test(d.body.note));
  ok('newest first', d.body.note.indexOf('SECOND ASK TEXT') < d.body.note.indexOf('FIRST ASK TEXT')); }

console.log('\n3 · the agent asks again after their card was CLOSED');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: true });
  let r, threw = null; try { r = await ask(DB, 'Help with the system', 'THIRD ASK TEXT'); } catch (e) { threw = e; }
  ok('no error reaches the agent', !threw && r && r.status === 200, threw ? threw.message : JSON.stringify(r));
  ok('the closed card is reopened for the new ask', r && r.body.id === 'old1' && r.body.reopened === true, JSON.stringify(r && r.body));
  const c = hl.opps[0];
  ok('renamed, first stage, open', c.name === '[Help with the system] CB162 Nothando Mntungwa' && c.pipelineStageId === 's0' && c.status === 'open', JSON.stringify(c));
  const arch = Object.entries(DB.rows).filter(([k]) => k.startsWith('kv:help-arch:old1:'));
  ok('the closed request is archived once', arch.length === 1, Object.keys(DB.rows).join(','));
  const av = arch[0] && arch[0][1];
  ok('…with its topic, asked and closed times', av && av.category === 'Review my call' && av.created === '2026-09-01T08:00:00.000Z' && av.closed_at === '2026-09-02T10:00:00.000Z', JSON.stringify(av));
  const L = await H.helpList(env, DB, tl, digest);
  const rows = (L.body.requests || []).filter((x) => x.cb === 'CB162');
  ok('the team leader record keeps both: one open, one closed', rows.filter((x) => !x.closed).length === 1 && rows.filter((x) => x.closed).length === 1, JSON.stringify(rows));
  const openRow = rows.find((x) => !x.closed), oldRow = rows.find((x) => x.closed);
  ok('the open one is dated by the new ask', openRow && openRow.created >= T0, openRow && openRow.created);
  ok('the archived one keeps its close time for the average', oldRow && oldRow.archived && oldRow.created === '2026-09-01T08:00:00.000Z' && oldRow.updated === '2026-09-02T10:00:00.000Z', JSON.stringify(oldRow));
  const d = await H.helpDetail(env, DB, tl, digest, 'old1');
  ok('the reopened card shows the new ask', /THIRD ASK TEXT/.test(d.body.note || ''), JSON.stringify(d.body));
  ok('…and NOT the closed request\'s note', !/FIRST ASK TEXT/.test(d.body.note || ''));
  const M = await H.helpMine(env, DB, agent, digest);
  ok('the agent sees their open request', (M.body.requests || []).some((x) => x.id === 'old1' && !x.closed && x.category === 'Help with the system'), JSON.stringify(M.body.requests));
  const r2 = await ask(DB, 'Explain what to say', 'FOURTH ASK TEXT');
  ok('a further ask joins the reopened card', r2.status === 200 && r2.body.id === 'old1' && r2.body.merged === true, JSON.stringify(r2.body));
  ok('…without a second archive', Object.keys(DB.rows).filter((k) => k.startsWith('kv:help-arch:old1:')).length === 1);
  const d2 = await H.helpDetail(env, DB, tl, digest, 'old1');
  ok('both asks of this round are readable, not the closed one', /FOURTH ASK TEXT/.test(d2.body.note) && /THIRD ASK TEXT/.test(d2.body.note) && !/FIRST ASK TEXT/.test(d2.body.note), d2.body.note); }

console.log('\n3b · the agent closes their own request ("Close it off"), then asks again');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: false });
  const c = await H.helpCloseOwn(env, DB, agent, digest, { id: 'old1' });
  ok('the agent closes their own request', c.status === 200 && hl.opps[0].status === 'won' && hl.opps[0].pipelineStageId === 's3', JSON.stringify(c));
  let r, threw = null; try { r = await ask(DB, 'Explain my quality result', 'AFTER CLOSE TEXT'); } catch (e) { threw = e; }
  ok('the next ask goes through', !threw && r && r.status === 200 && r.body.reopened === true && r.body.id === 'old1', threw ? threw.message : JSON.stringify(r && r.body));
  ok('the closed request is kept as history', Object.keys(DB.rows).filter((k) => k.startsWith('kv:help-arch:old1:')).length === 1);
  const M = await H.helpMine(env, DB, agent, digest);
  const mine = (M.body.requests || []).filter((x) => x.cb === 'CB162');
  ok('the agent sees exactly one open request, under the new topic', mine.filter((x) => !x.closed).length === 1
    && mine.find((x) => !x.closed).category === 'Explain my quality result', JSON.stringify(mine)); }

console.log('\n3c · the card is reopened but the note does not save: the agent is told, and Send again lands it');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: true }); hl.failNote = true;
  let r, threw = null; try { r = await ask(DB, 'Review my call', 'NOTE THAT FAILED'); } catch (e) { threw = e; }
  ok('no bare "HighLevel did not answer" — an answer in words', !threw && r && r.status === 502 && r.body.note_failed === true && /send again/i.test(r.body.error || ''), threw ? threw.message : JSON.stringify(r));
  hl.failNote = false;
  const r2 = await ask(DB, 'Review my call', 'NOTE THAT FAILED');
  ok('Send again joins the same request', r2.status === 200 && r2.body.id === 'old1' && r2.body.merged === true, JSON.stringify(r2.body));
  ok('the closed request was archived once, not twice', Object.keys(DB.rows).filter((k) => k.startsWith('kv:help-arch:old1:')).length === 1);
  const d = await H.helpDetail(env, DB, tl, digest, 'old1');
  ok('the team leader reads the note', /NOTE THAT FAILED/.test(d.body.note || ''), JSON.stringify(d.body)); }

console.log('\n4 · HighLevel refuses but its search has not caught up with the card');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: false }); hl.hide.add('old1');
  let r, threw = null; try { r = await ask(DB, 'Something else', 'x'); } catch (e) { threw = e; }
  ok('no 502', !threw, threw && threw.message);
  ok('a 409 in words', r && r.status === 409 && /few seconds/i.test(r.body.error || ''), JSON.stringify(r)); }

console.log('\n5 · the closed card cannot be moved: everything is put back');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: true }); hl.failPut = true;
  let threw = null; try { await ask(DB, 'Something else', 'x'); } catch (e) { threw = e; }
  ok('the failure is raised', !!threw);
  ok('no archive row is left behind', !Object.keys(DB.rows).some((k) => k.startsWith('kv:help-arch:')), Object.keys(DB.rows).join(','));
  ok('no card record is left behind', !DB.rows['kv:help-card:old1'], JSON.stringify(DB.rows['kv:help-card:old1']));
  ok('the card is untouched', hl.opps[0].status === 'won' && hl.opps[0].pipelineStageId === 's3'); }

console.log('\n6 · a create that fails for another reason still fails');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: true }); hl.failCreate = 500;
  let threw = null; try { await ask(DB, 'Something else', 'x'); } catch (e) { threw = e; }
  ok('the error is raised', !!threw && threw.status === 500, threw && threw.message);
  ok('nothing reused', hl.opps[0].status === 'won' && !Object.keys(DB.rows).some((k) => k.startsWith('kv:help-arch:'))); }

console.log('\n7 · an archived request id never reaches HighLevel');
{ const DB = fakeDB(); const hl = fakeHL({}); seed(DB, hl, { closed: true });
  await ask(DB, 'Something else', 'x');
  const L = await H.helpList(env, DB, tl, digest);
  const aid = ((L.body.requests || []).find((x) => x.archived) || {}).id || '';
  ok('the archived row has its own id', aid && aid !== 'old1', aid);
  const before = hl.calls.length;
  const c = await H.helpCloseOwn(env, DB, agent, digest, { id: aid });
  const s = await H.helpStage(env, DB, tl, digest, { id: aid, stageId: 's0' });
  const d = await H.helpDetail(env, DB, tl, digest, aid);
  ok('close / stage / detail answer 404', c.status === 404 && s.status === 404 && d.status === 404, [c.status, s.status, d.status].join(','));
  ok('no HighLevel opportunity was fetched for it', !hl.calls.slice(before).some((x) => x.path.includes(aid))); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
