// verify-kv-cas-live.mjs — the /api/kv compare-and-set, proved against the DEPLOYED Worker on a zz- probe key (cleaned by hygiene). Run after any Worker deploy: node nicks_code/diagnostics/verify-kv-cas-live.mjs
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/'; const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const admin = (await (await fetch(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json())[0];
const token = crypto.randomBytes(32).toString('hex'); const th = crypto.createHash('sha256').update(token).digest('hex');
await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([{ token_hash: th, user_id: admin.id, expires_at: new Date(Date.now() + 600000).toISOString(), user_agent: 'cas-probe' }]) });
const A = { Authorization: 'Bearer ' + token, 'X-Cbx-Client': 'v5', 'Content-Type': 'text/plain' };
const key = 'zz-cas-probe-' + Date.now();
const put = (body, base) => fetch(API + '/api/kv?key=' + key, { method: 'POST', headers: base == null ? A : { ...A, 'X-Cbx-Base': base }, body });
const get = () => fetch(API + '/api/kv?key=' + key, { headers: { Authorization: A.Authorization } });
let ok = 0, bad = 0; const t = (m, c, d) => { if (c) { ok++; console.log('  ok   ' + m); } else { bad++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); } };
try {
  let r = await put('{"v":1}', 'none'); let j = await r.json();
  t('first write with base "none" lands', r.status === 200 && j.version, JSON.stringify(j));
  const v1 = j.version;
  r = await get(); t('GET carries X-Cbx-Version = the version the write returned', r.headers.get('x-cbx-version') === v1, r.headers.get('x-cbx-version') + ' vs ' + v1);
  r = await put('{"v":2}', v1); j = await r.json(); const v2 = j.version;
  t('a write on the current base lands and returns a new version', r.status === 200 && v2 && v2 !== v1, JSON.stringify(j));
  r = await put('{"v":3}', v1); j = await r.json();
  t('a write on the STALE base is refused with 409 version_conflict', r.status === 409 && j.error === 'version_conflict' && j.current === v2, r.status + ' ' + JSON.stringify(j));
  r = await get(); t('…and the stored value is still the winner\'s', (await r.text()) === '{"v":2}');
  r = await put('{"v":4}', 'none'); j = await r.json();
  t('a write claiming "no row" when one exists is refused', r.status === 409, r.status + ' ' + JSON.stringify(j));
  r = await put('{"v":5}'); t('a legacy write with no base still lands (PULSE, tools)', r.status === 200);
  r = await get(); const v5 = r.headers.get('x-cbx-version');
  r = await put('{"v":6}', v2); j = await r.json();
  t('a base older than the legacy write is refused too', r.status === 409 && j.current === v5, r.status + ' ' + JSON.stringify(j));
  /* two racing writers on the same base: exactly one wins */
  r = await get(); const vb = r.headers.get('x-cbx-version');
  const [ra, rb] = await Promise.all([put('{"v":"A"}', vb), put('{"v":"B"}', vb)]);
  const wins = [ra.status, rb.status].filter((s) => s === 200).length;
  t('two simultaneous writes on the same base: exactly one wins, one gets 409', wins === 1 && [ra.status, rb.status].includes(409), ra.status + '/' + rb.status);
  const pr = (await (await fetch(REST + 'rules?key=eq.' + encodeURIComponent('kv:' + key) + '&select=value', { headers: H })).json())[0];
  t('no writing claim is left on the pointer', pr && pr.value && !pr.value.writing, JSON.stringify(pr && pr.value));
} finally {
  await fetch(API + '/api/kv?key=' + key, { method: 'DELETE', headers: { Authorization: A.Authorization, 'X-Cbx-Client': 'v5' } }).catch(() => {});
  await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
}
console.log('\n' + ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
