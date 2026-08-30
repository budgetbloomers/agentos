#!/usr/bin/env node
/**
 * time-portal.mjs — where the Agent Analytics portal actually spends its time.
 *
 *   node nicks_code/diagnostics/time-portal.mjs --live
 *
 * Times the real endpoints for all three views against production, cold and warm,
 * so a "it feels slow" becomes a number with a cause. Mints a five-minute session
 * per account the way verify-cm-live.mjs does and deletes every one in a finally.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--live')) { console.log('Times PRODUCTION. Re-run with --live.'); process.exit(0); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const minted = [];
const signIn = async (where) => {
  const users = await (await fetch(REST + where + '&select=id,username,full_name,role,cb&limit=1', { headers: H })).json();
  const u = users[0]; if (!u) return null;
  const token = crypto.randomBytes(32).toString('hex'); const th = sha(token);
  const r = await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ token_hash: th, user_id: u.id, expires_at: new Date(Date.now() + 5 * 60000).toISOString(), user_agent: 'time-portal' }]) });
  if (!r.ok) return null;
  minted.push(th);
  return { u, token };
};
const time = async (token, p, n = 3) => {
  const ms = [];
  let bytes = 0, status = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fetch(API + p, { headers: { 'X-Cbx-Client': 'v5', Authorization: 'Bearer ' + token } });
    const b = await r.text();
    ms.push(performance.now() - t0); bytes = b.length; status = r.status;
  }
  return { cold: Math.round(ms[0]), warm: Math.round(Math.min(...ms.slice(1))), kb: Math.round(bytes / 102.4) / 10, status };
};
const row = (label, t) => console.log('  ' + label.padEnd(34)
  + String(t.cold + ' ms').padStart(9) + ' cold' + String(t.warm + ' ms').padStart(9) + ' warm'
  + String(t.kb + ' KB').padStart(11) + '   ' + (t.status === 200 ? '' : '[' + t.status + ']'));

try {
  for (const [label, where, paths] of [
    ['CAMPAIGN MANAGER (dalwin)', 'app_users?username=eq.dalwin',
      ['/api/portal/me', '/api/portal/overview', '/api/portal/cm/assist', '/api/portal/cm/eod']],
    ['TEAM LEADER', 'app_users?role=eq.team_leader&active=is.true',
      ['/api/portal/me', '/api/portal/overview', '/api/portal/hub/kpi']],
    ['AGENT', 'app_users?role=eq.agent&active=is.true',
      ['/api/portal/me', '/api/portal/overview', '/api/portal/wimpy/menu']],
  ]) {
    const s = await signIn(where);
    if (!s) { console.log('\n' + label + ' — no account'); continue; }
    console.log('\n' + label + '  →  ' + s.u.username + ' (' + s.u.role + ')');
    for (const p of paths) row(p, await time(s.token, p));
  }
} finally {
  for (const th of minted) await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H });
  console.log('\n(' + minted.length + ' temporary sessions deleted)');
}
