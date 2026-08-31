/**
 * AGENT LOGINS, KEPT IN STEP WITH THE AGENT LIST — automatically, and atomically.
 *
 * Nick, 2026-08-30: every list upload should create a login for anyone new, and
 * remove the account of anyone who has left, so nothing accumulates. Then, the
 * same day: the latest list must be the SINGLE source of truth, the database
 * must enforce it, and a failed sync must roll back rather than half-apply.
 *
 * WHY THIS RUNS IN THE WORKER AND NOT IN THE NODE TOOL. tools/provision-agent-
 * logins.mjs does a similar job and does it well, but only when a human
 * remembers to run it — which is the same "waiting for somebody" weakness the
 * roster cron was built to remove. Ten agents started on 25 August and still had
 * no way to sign in five days later. This runs on the cron that already syncs
 * the roster, so a list upload provisions itself within ten minutes. The tool
 * stays: it does password resets, handout CSVs and team leaders, none of which
 * belong on a timer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE RECONCILIATION IS NOW ONE SQL CALL AND NOT A LOOP HERE.
 *
 * The first version of this file compared the list to app_users in JavaScript
 * and applied the answer as a sequence of separate PostgREST calls: insert the
 * new accounts, update the changed ones, delete the leavers. It was correct and
 * it was guarded, and it still had one failure it could not defend against — a
 * network error between the inserts and the deletes leaves accounts created and
 * leavers still able to sign in, with nothing to roll back to and no record of
 * how far it got. There is no way to make a sequence of HTTP calls atomic.
 *
 * A PostgREST rpc runs inside ONE transaction, so sync_agent_list() (migration
 * 014) either applies the whole reconciliation or none of it, and its integrity
 * checks run BEFORE the commit — a list that would leave an agent without an
 * account raises and the previous state stands. That is the whole reason the
 * logic moved: not elegance, atomicity.
 *
 * THE GUARDS DID NOT MOVE, THEY WERE PROMOTED. All four still exist, now as
 * parameters the database enforces rather than promises this file makes:
 *   1. Nothing runs unless the roster fingerprint CHANGED. Kept HERE, because
 *      the cheapest possible version of "nothing to do" is one small select and
 *      no round trip to the function at all — 143 of every 144 daily ticks.
 *   2. A roster smaller than MIN_ROSTER is not a roster.       → p_min_roster
 *   3. Deletions capped at MAX_DELETE_SHARE, refused whole.    → p_max_delete_share
 *   4. ONLY role 'agent' is ever deleted.                      → in the function
 * plus one the JavaScript version never had: a duplicate CB number inside the
 * uploaded list rejects the entire synchronisation instead of letting the last
 * row silently win.
 *
 * PASSWORDS ARE HASHED HERE, DELIBERATELY. The scheme is PBKDF2-SHA256 via
 * WebCrypto (auth.mjs) and Postgres cannot reproduce it; teaching pgcrypto a
 * second scheme would mean two ways to hold a password. So the function tells us
 * which CB numbers it is about to create and we hash for exactly those. The
 * first call is speculative and writes NOTHING if hashes are missing — it comes
 * back NEEDS_HASHES, we generate them, and call once more. One round trip on an
 * ordinary day, two on a day somebody starts.
 *
 * WHAT DELETION COSTS, checked rather than assumed: auth_log.user_id is a plain
 * uuid with NO foreign key and the username is stored beside it as text, so a
 * person's sign-in history survives their account being removed. app_sessions
 * DOES cascade, which is what should happen — a deleted account's live sessions
 * must die with it, so a leaver is signed out by the same statement that removes
 * them and their old credentials cannot work because they no longer exist. And
 * the list itself is now kept: agent_list holds every dated snapshot, so a
 * removed agent stays NAMED in history without staying ACTIVE.
 */

import { hashPassword } from './auth.mjs';

const START_PASSWORD = 'agentos123';
const MIN_ROSTER = 25;             // the floor has run 120-130 for months
const MAX_DELETE_SHARE = 0.25;     // more than a quarter leaving in one list is a broken list
const FP_KEY = 'kv:agent-logins-fp';

/**
 * Reconcile app_users against the Agent List, in one transaction.
 *
 * @param {object} DB      the Supabase client
 * @param {array}  roster  the roster rows rosterSync produced
 * @param {string} fp      that roster's fingerprint — the change gate
 * @param {object} opts    { force, asOf, actor }
 * @returns {object} the function's own report, or { skipped, ... } when a gate
 *                   declined before it was called. `status` is one of
 *                   SUCCESS | REFUSED | FAILED | NEEDS_HASHES.
 */
export async function syncAgentLogins(DB, roster, fp, opts = {}) {
  const rows = Array.isArray(roster) ? roster : [];

  /* guard 1 — nothing to do unless the list actually moved. Kept in front of the
     function so a stable list costs one select rather than a reconciliation. */
  if (!opts.force && fp) {
    const seen = await DB.select(`rules?key=eq.${encodeURIComponent(FP_KEY)}&select=value`).catch(() => null);
    if (seen && seen[0] && seen[0].value && seen[0].value.fingerprint === fp)
      return { skipped: 'unchanged', fingerprint: fp };
  }

  /* Cheap enough to check here, and a clearer message than the function's:
     an empty roster never reaches the database at all. */
  if (rows.length < MIN_ROSTER)
    return { skipped: 'roster too small', n: rows.length, min: MIN_ROSTER };

  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.asOf || '')) ? String(opts.asOf)
    : new Date().toISOString().slice(0, 10);
  const batch = 'sync-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const call = (hashes, apply) => DB.rpc('sync_agent_list', {
    p_as_of: asOf, p_rows: rows, p_batch: batch, p_fingerprint: fp || null,
    p_actor: opts.actor || 'cron', p_hashes: hashes, p_apply: apply,
    p_min_roster: MIN_ROSTER, p_max_delete_share: MAX_DELETE_SHARE,
  });

  /* Speculative first: if nobody is new this is the only call, and if somebody
     is, this one has written nothing. */
  let out = await call({}, true);

  if (out && out.status === 'NEEDS_HASHES') {
    const hashes = {};
    for (const cb of out.needs_hashes || []) hashes[cb] = await hashPassword(START_PASSWORD);
    out = await call(hashes, true);
    /* A second NEEDS_HASHES means the list moved between the two calls — rare,
       harmless, and the next cron tick picks it up. Nothing has been written. */
  }

  /* The fingerprint gate closes only on a real success. A REFUSED or FAILED list
     must be retried on the next tick, not remembered as done. */
  if (out && out.status === 'SUCCESS' && fp) {
    const now = new Date().toISOString();
    await DB.insert('rules', [{ key: FP_KEY,
      value: { fingerprint: fp, n: out.on_list, as_of: asOf, at: now },
      updated_by: 'sync_agent_list', updated_at: now }], true);
  }

  return out || { status: 'FAILED', errors: ['the synchronisation returned nothing'] };
}

/**
 * THE LEADER HALF OF THE SAME RULE (Nick, 2026-08-31). migration-014 reconciles agents
 * against the Agent List and deliberately left leaders alone, because the list names a
 * leader but never carries their CB — an account could not be created without inventing a
 * login. migration-018 removes that obstacle without inventing anything: team_leader_cbs
 * holds the name→CB map a human maintains, and a leader is only ever created from a code
 * written down there. Removal needs no map at all: a team_leader who leads NOBODY on the
 * current list has no evidence of belonging to it.
 *
 * Same posture as the agent path throughout: the function guards fail-closed (a short list
 * refuses whole, more than p_max_delete removals refuses whole, only role 'team_leader' is
 * ever touched), and hashing happens HERE because Postgres cannot reproduce WebCrypto
 * PBKDF2 — NEEDS_HASHES comes back having written nothing, we hash exactly the CB numbers
 * it names, and call again.
 */
export async function syncTeamLeaders(DB, opts = {}) {
  const call = (hashes, apply) => DB.rpc('sync_team_leaders', {
    p_hashes: hashes, p_actor: opts.actor || 'cron', p_apply: apply,
  });
  let out = await call({}, true);
  if (out && out.status === 'NEEDS_HASHES') {
    const hashes = {};
    for (const cb of out.needs_hashes || []) hashes[cb] = await hashPassword(START_PASSWORD);
    out = await call(hashes, true);
  }
  return out || { status: 'FAILED', errors: ['the leader synchronisation returned nothing'] };
}
