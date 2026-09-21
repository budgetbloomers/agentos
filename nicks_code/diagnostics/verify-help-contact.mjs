/* verify-help-contact.mjs — the Help Center never fails an agent over a contact that
 * already exists (Nick, 2026-09-21: "asking my team leader for help is giving 400 …
 * something for duplications — this must not happen").
 *
 * Drives worker/src/help.mjs contactFor() against a fake HighLevel and a fake DB:
 *   1 a fresh agent: one POST /contacts, id stored under kv:help-contact:<CB>
 *   2 the location refuses a duplicate and names the contact: that id is adopted, stored, no throw
 *   3 the refusal names nobody: the location is searched and the contact tagged with the CB wins
 *   4 a genuine 400 (not a duplicate) still fails — the recovery is narrow
 *   5 a stored pointer is used as-is: no HighLevel call at all
 *
 * Run: node verify-help-contact.mjs   (no network, no credentials)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { contactFor } = await import(pathToFileURL(path.join(HERE, '..', '..', 'worker', 'src', 'help.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };

const env = { HL_HELP_API_KEY: 'k', HL_HELP_LOCATION_ID: 'loc1' };
function fakeDB() {
  const rows = {};
  return { rows,
    select: async (q) => { const m = /key=eq\.([^&]+)/.exec(q); const k = m ? decodeURIComponent(m[1]) : ''; return rows[k] ? [{ value: rows[k] }] : []; },
    insert: async (_t, list) => { for (const r of list) rows[r.key] = r.value; } };
}
function fakeHL(script) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url); const method = (opts && opts.method) || 'GET';
    calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: opts && opts.body ? JSON.parse(opts.body) : null });
    const res = script(method, u.pathname, calls[calls.length - 1]);
    return { ok: res.status < 400, status: res.status, text: async () => JSON.stringify(res.body) };
  };
  return calls;
}

console.log('\n1 · a fresh agent is created once and remembered');
{ const DB = fakeDB();
  const calls = fakeHL(() => ({ status: 201, body: { contact: { id: 'new-1' } } }));
  const id = await contactFor(env, DB, 'CB900', 'Thandi Mokoena');
  ok('the new contact id comes back', id === 'new-1', id);
  ok('one POST /contacts/', calls.filter((c) => c.method === 'POST' && c.path === '/contacts/').length === 1);
  ok('the pointer is stored', DB.rows['kv:help-contact:CB900'] && DB.rows['kv:help-contact:CB900'].id === 'new-1');
  ok('the CB rides as a tag', calls[0].body.tags.includes('cb900')); }

console.log('\n2 · the location refuses a duplicate and names the existing contact');
{ const DB = fakeDB();
  const calls = fakeHL(() => ({ status: 400, body: { statusCode: 400, message: 'This location does not allow duplicated contacts.', meta: { contactId: 'old-7', matchingField: 'name' } } }));
  let id = null, threw = null; try { id = await contactFor(env, DB, 'CB901', 'Sipho Dlamini'); } catch (e) { threw = e; }
  ok('no error reaches the agent', !threw, threw && threw.message);
  ok('the existing contact is adopted', id === 'old-7', id);
  ok('the pointer is stored so it never happens again', DB.rows['kv:help-contact:CB901'] && DB.rows['kv:help-contact:CB901'].id === 'old-7');
  ok('no search was needed', !calls.some((c) => c.method === 'GET')); }

console.log('\n3 · the refusal names nobody: search the location, the CB tag decides');
{ const DB = fakeDB();
  const calls = fakeHL((method, p) => method === 'POST' && p === '/contacts/'
    ? { status: 400, body: { statusCode: 400, message: 'This location does not allow duplicated contacts.' } }
    : { status: 200, body: { contacts: [
        { id: 'namesake', firstName: 'Sipho', lastName: 'Dlamini', tags: ['agentos-help', 'cb555'] },
        { id: 'mine', firstName: 'Sipho', lastName: 'Dlamini', tags: ['agentos-help', 'cb902'] }] } });
  let id = null, threw = null; try { id = await contactFor(env, DB, 'CB902', 'Sipho Dlamini'); } catch (e) { threw = e; }
  ok('no error reaches the agent', !threw, threw && threw.message);
  ok('the contact tagged with THIS CB is chosen over a namesake', id === 'mine', id);
  const s = calls.find((c) => c.method === 'GET');
  ok('the search is scoped to the help location', s && s.query.locationId === 'loc1');
  ok('the pointer is stored', DB.rows['kv:help-contact:CB902'] && DB.rows['kv:help-contact:CB902'].id === 'mine'); }

console.log('\n4 · a 400 that is not a duplicate still fails — the recovery is narrow');
{ const DB = fakeDB();
  fakeHL(() => ({ status: 400, body: { statusCode: 400, message: 'firstName must be a string' } }));
  let threw = null; try { await contactFor(env, DB, 'CB903', 'X'); } catch (e) { threw = e; }
  ok('the error is raised', !!threw);
  ok('with the status on it', threw && threw.status === 400);
  ok('nothing is stored', !DB.rows['kv:help-contact:CB903']); }

console.log('\n5 · a stored pointer costs no HighLevel call');
{ const DB = fakeDB(); DB.rows['kv:help-contact:CB904'] = { id: 'kept' };
  const calls = fakeHL(() => ({ status: 500, body: {} }));
  const id = await contactFor(env, DB, 'CB904', 'Any Body');
  ok('the stored id is used', id === 'kept');
  ok('HighLevel is not called', calls.length === 0); }

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
