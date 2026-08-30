/* PROVISION AGENT ANALYTICS LOGINS — agents and team leaders, from the roster.
 *
 * Agent Analytics signs people in with their CB NUMBER and a password. Those
 * accounts are ordinary `app_users` rows using the existing auth stack — same
 * PBKDF2 hasher, same lockout, same sessions, same audit log. There is no second
 * user table and no second login system.
 *
 *   node tools/provision-agent-logins.mjs            # report only, writes nothing
 *   node tools/provision-agent-logins.mjs --apply    # create/refresh accounts
 *   node tools/provision-agent-logins.mjs --apply --reset-passwords
 *   node tools/provision-agent-logins.mjs --apply --force-change
 *
 * THE ROSTER IS THE SOURCE OF TRUTH. Who is an agent, what their CB number is and
 * which team leader they sit under all come from the Agent List, via the roster
 * PULSE persists in `kv:vas-state`. This tool never invents a person and never
 * invents a CB number.
 *
 * THE PASSWORD. Nick's call, 2026-08-24: every agent and every team leader starts
 * on the same password, `agentos123`, so it can be handed out at a floor briefing.
 * Understand what that means before changing anything here: while two people share
 * a password, knowing it plus any CB number is enough to sign in as that person —
 * the per-account isolation the Worker enforces is only as strong as the secret in
 * front of it. `--force-change` flips must_change_password on, which makes the
 * existing first-login "Set a new password" screen close that window the first
 * time each person signs in. It is OFF by default because Nick specified a
 * password that simply works, not a temporary one.
 *
 * TEAM LEADERS. A team leader has no roster row of their own — they exist only as
 * the `Team Leader` string on their agents' rows — so their CB number cannot be
 * derived from the roster. It is read from specs/team_leader_cbs.json, which this
 * tool seeds from the Agent List workbook's own name→code tabs and then leaves for
 * a human to complete. A leader with no CB number is REPORTED AND SKIPPED, never
 * given a made-up one: a wrong CB number on a team leader account is a person
 * looking at somebody else's team.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset-passwords');
const FORCE_CHANGE = process.argv.includes('--force-change');
const START_PASSWORD = 'agentos123';
const TL_MAP_FILE = path.join(ROOT, 'specs', 'team_leader_cbs.json');

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const api = async (m, p, body, extra = {}) => {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + p, { method: m, headers: { ...H, ...extra }, body: body == null ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${p.split('?')[0]} → ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

/* PBKDF2-SHA256, 100k iterations, hex — byte-identical to worker/src/auth.mjs
   hashPassword(). It has to be: the Worker is what verifies these. */
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pw, salt, 100000, 32, 'sha256');
  return `pbkdf2h$100000$${salt.toString('hex')}$${hash.toString('hex')}`;
};

const normCb = (v) => { const d = String(v == null ? '' : v).toUpperCase().replace(/[^0-9]/g, ''); return d ? 'CB' + parseInt(d, 10) : ''; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/* ---------- the roster ---------- */
console.log('Reading the roster from kv:vas-state …');
const sr = await api('GET', `rules?key=eq.${encodeURIComponent('kv:vas-state')}&select=value`);
if (!sr?.length) { console.error('No vas-state in Supabase — nothing to provision from.'); process.exit(2); }
let payload = String(sr[0].value?.data || '');
if (!payload && sr[0].value?.store) {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/${sr[0].value.store.replace(/^raw\//, '')}`, { headers: H });
  payload = await r.text();
}
const S = JSON.parse(payload);
const roster = (S.roster || []).filter(a => normCb(a.code));
if (!roster.length) { console.error('The roster is empty — refusing to provision.'); process.exit(2); }
const leaders = [...new Set(roster.map(a => String(a.tl || '').trim()).filter(Boolean))].sort();
console.log(`  ${roster.length} agents · ${leaders.length} team leaders\n`);

/* ---------- team leader CB numbers ---------- */
let tlMap = {};
if (fs.existsSync(TL_MAP_FILE)) tlMap = JSON.parse(fs.readFileSync(TL_MAP_FILE, 'utf8'));
let seeded = false;
for (const l of leaders) if (!(l in tlMap)) { tlMap[l] = ''; seeded = true; }
/* NEVER DELETE A CB NUMBER (audit round 6, 2026-08-28 — caught by DOING it). This used to
   prune every leader absent from today's Agent List, and it did so on a DRY RUN, in a file
   that is untracked by git and holds hand-curated numbers the header says cannot be derived
   from the roster. Running it once, with no flags, silently destroyed "Hloniphile Jojo":
   "CB100" and "Nikita Baijnath": "CB230" — two leaders whose teams had just dissolved. The
   next --apply would then have found no CB for them and DEACTIVATED their accounts, with the
   only copy of the recovery data already deleted by the same tool.
   Absent leaders are now reported and KEPT: a stale entry costs nothing, because `want` is
   built from the roster's own leaders, so an entry nobody references is never used. */
const absent = Object.keys(tlMap).filter((k) => !leaders.includes(k));
if (absent.length) console.log(`  note: ${absent.length} mapped leader(s) are not on this Agent List — kept, not deleted: ${absent.join(', ')}`);
if (seeded) {
  fs.mkdirSync(path.dirname(TL_MAP_FILE), { recursive: true });
  if (fs.existsSync(TL_MAP_FILE)) {                    // a dated copy before every write
    try { fs.copyFileSync(TL_MAP_FILE, TL_MAP_FILE.replace(/\.json$/, '') + '.' + new Date().toISOString().slice(0, 10) + '.bak.json'); } catch (e) {}
  }
  fs.writeFileSync(TL_MAP_FILE, JSON.stringify(tlMap, null, 2) + '\n');
  console.log(`Seeded ${path.relative(ROOT, TL_MAP_FILE)} — fill in any blank CB number and re-run.\n`);
}

/* ---------- what each account should look like ---------- */
const want = [];
for (const a of roster) {
  const cb = normCb(a.code);
  want.push({ cb, username: cb.toLowerCase(), full_name: a.name || cb, role: 'agent', team: null, who: a.tl || '' });
}
const missingTl = [];
for (const l of leaders) {
  const cb = normCb(tlMap[l]);
  if (!cb) { missingTl.push(l); continue; }
  want.push({ cb, username: cb.toLowerCase(), full_name: l, role: 'team_leader', team: l, who: l });
}

/* A CB number that is both an agent and a team leader can only be one account.
   The leader wins — they need the wider view — and it is reported, never silent. */
const byCb = new Map();
for (const w of want) {
  const prev = byCb.get(w.cb);
  if (!prev) { byCb.set(w.cb, w); continue; }
  const keep = prev.role === 'team_leader' ? prev : w;
  const drop = keep === prev ? w : prev;
  console.log(`  ! ${w.cb} is both ${prev.full_name} (${prev.role}) and ${w.full_name} (${w.role}) — keeping the ${keep.role} account.`);
  byCb.set(w.cb, keep); void drop;
}
const targets = [...byCb.values()];

/* ---------- reconcile against app_users ---------- */
const existing = await api('GET', 'app_users?select=id,username,full_name,role,apps,tabs,cb,team,active');
const byUser = new Map(existing.map(u => [u.username, u]));

let created = 0, updated = 0, unchanged = 0, skipped = 0;
const rows = [];
for (const t of targets) {
  const cur = byUser.get(t.username);
  /* Never touch a management account that happens to collide on username. */
  if (cur && !['agent', 'team_leader'].includes(cur.role)) {
    console.log(`  ! ${t.username} already exists as role '${cur.role}' — left alone.`);
    skipped++; continue;
  }
  const patch = {
    username: t.username, full_name: t.full_name, role: t.role, cb: t.cb, team: t.team,
    /* apps/tabs are the MANAGEMENT gate (site/auth-gate.js). A portal account is
       granted no management app at all, so if one of these users ever loads
       /pulse/ or / they get the "No access" notice rather than an empty shell —
       and the Worker's role lockdown refuses their API calls regardless. */
    apps: ['agent'], tabs: {}, active: true,
  };
  if (!cur) {
    patch.password_hash = hashPassword(START_PASSWORD);
    patch.must_change_password = FORCE_CHANGE;
    patch.created_by = 'provision-agent-logins';
    rows.push(patch); created++;
  } else {
    const same = cur.full_name === patch.full_name && cur.role === patch.role &&
      (cur.cb || '') === patch.cb && (cur.team || null) === patch.team && cur.active === true;
    if (RESET) { patch.password_hash = hashPassword(START_PASSWORD); patch.must_change_password = FORCE_CHANGE; }
    if (same && !RESET) { unchanged++; continue; }
    if (APPLY) await api('PATCH', `app_users?id=eq.${cur.id}`, patch, { Prefer: 'return=minimal' });
    updated++;
  }
}
if (rows.length && APPLY) {
  for (let i = 0; i < rows.length; i += 50) await api('POST', 'app_users', rows.slice(i, i + 50), { Prefer: 'return=minimal' });
}

/* THE TEAM MAP. `tl` also travels in the agent digest, but the digest is
   published by whichever PULSE tab happens to be open — fine for figures, wrong
   for the input to a team leader's authorisation, because a colleague on a stale
   tab can silently empty their page. So the roster's agent→leader map is written
   here as its own key, straight from the Agent List, and the Worker falls back to
   it wherever the digest has no value. */
if (APPLY) {
  const teams = {};
  for (const a of roster) teams[normCb(a.code)] = String(a.tl || '').trim();
  await api('POST', 'rules', [{ key: 'kv:agent-teams', value: { teams, source: 'Agent List roster', n: roster.length },
    updated_by: 'provision-agent-logins', updated_at: new Date().toISOString() }], { Prefer: 'resolution=merge-duplicates,return=minimal' });
  console.log(`  wrote kv:agent-teams (${roster.length} agents → team leader)`);
}

/* Portal accounts for people no longer on the roster are DEACTIVATED, not deleted:
   auth_log keeps referring to them, and a leaver returning next month should get
   their history back rather than a fresh identity. */
const wanted = new Set(targets.map(t => t.username));
let retired = 0;
for (const u of existing) {
  if (!['agent', 'team_leader'].includes(u.role) || wanted.has(u.username) || !u.active) continue;
  if (APPLY) await api('PATCH', `app_users?id=eq.${u.id}`, { active: false }, { Prefer: 'return=minimal' });
  console.log(`  - ${u.username} (${u.full_name}) is no longer on the roster — deactivated.`);
  retired++;
}

/* ---------- the handout ---------- */
const outDir = path.join(ROOT, 'reports', 'agent-logins');
fs.mkdirSync(outDir, { recursive: true });
const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const byTeam = {};
for (const t of targets) (byTeam[t.who || 'Unassigned'] ||= []).push(t);
for (const [team, list] of Object.entries(byTeam)) {
  const csv = ['CB Number,Name,Role,Sign in at,Password',
    ...list.sort((a, b) => a.full_name.localeCompare(b.full_name)).map(t =>
      [t.cb, t.full_name, t.role === 'team_leader' ? 'Team Leader' : 'Agent',
        'https://chatterbox-agentos.pages.dev/agent/', START_PASSWORD].map(esc).join(','))].join('\n');
  fs.writeFileSync(path.join(outDir, team.replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '-') + '.csv'), csv + '\n');
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN (nothing written — pass --apply)'}`);
console.log(`  created ${created} · updated ${updated} · unchanged ${unchanged} · skipped ${skipped} · deactivated ${retired}`);
console.log(`  handout CSVs per team: ${path.relative(ROOT, outDir)}/`);
console.log(`  password for everyone: ${START_PASSWORD}${FORCE_CHANGE ? '  (must be changed on first sign-in)' : '  (permanent until changed)'}`);
if (!FORCE_CHANGE) console.log(`  NOTE: everyone shares this password, so it plus a CB number signs in as that person.\n        Re-run with --apply --force-change to require a personal password at first sign-in.`);
if (missingTl.length) {
  console.log(`\n  ${missingTl.length} TEAM LEADER(S) HAVE NO CB NUMBER AND WERE SKIPPED — they cannot sign in yet:`);
  missingTl.forEach(l => console.log(`     ${l}`));
  console.log(`  Add their CB numbers to ${path.relative(ROOT, TL_MAP_FILE)} and re-run with --apply.`);
}
