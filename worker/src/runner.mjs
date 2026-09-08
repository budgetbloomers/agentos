/**
 * runner.mjs — the Worker keeps the GitHub runner honest.
 *
 * WHY THIS EXISTS (Monday 2026-09-08, 05:30 SAST): GitHub fired no scheduled run at all between
 * 03:13 and 09:25 UTC — not the 15-minute tick, not the two-hour coaching cron. Actions was
 * "operational", the workflow enabled, nothing queued. GitHub's own docs say a schedule "can be
 * delayed during periods of high load … some queued jobs may be dropped", and a fresh repo with a
 * fifteen-minute cron is exactly what gets dropped. The sentinel raised runner-silent within the
 * hour, which is the alert doing its job — but the never-stale plan promised that every alert has
 * a DRIVER that re-runs the step without a person. This is that driver.
 *
 * The Worker's own cron (every 10 minutes, Cloudflare, reliable) asks GitHub to run the 15-minute
 * tick whenever the tick is overdue inside its window and nothing is already queued or running.
 * GitHub's cron stays in place; when it keeps up, this never fires (a 15-minute cadence is always
 * inside the 20-minute threshold). The request is a workflow_dispatch with inputs.steps = 'tick',
 * so only the digests and the Ops relay run — a hand dispatch without the input still runs everything.
 *
 * Needs GH_DISPATCH_TOKEN (Worker secret; a token with Actions: write on the repo). Without it the
 * function returns {skipped} and the sentinel still says what is wrong.
 */
const HOUR = 3600000;
const REPO = 'budgetbloomers/agentos';
const WORKFLOW = 'publish-digests.yml';
export const KICK_KEY = 'kv:runner-kick';
export const TICK_STEPS = ['agent-digest', 'ops-relay', 'nba-digest'];   // what the 15-minute cron runs
export const TICK_OVERDUE_MIN = 20;                                        // cron cadence 15 + slack
export const KICK_COOLDOWN_MIN = 20;                                       // one ask per gap; a tick takes ~5 min

/** Pure: is the 15-minute tick overdue inside its own window (Mon–Sat 06:00–20:00 SAST)? */
export function tickDue(nowMs, jobs, lastKickMs) {
  const sast = new Date(nowMs + 2 * HOUR); const h = sast.getUTCHours(), w = sast.getUTCDay();
  if (w === 0 || h < 6 || h >= 20) return null;
  const steps = (jobs && jobs.steps) || {};
  const newest = TICK_STEPS.map((k) => (steps[k] && Date.parse(steps[k].ranAt)) || 0).reduce((a, b) => Math.max(a, b), 0);
  if (newest && nowMs - newest < TICK_OVERDUE_MIN * 60000) return null;      // GitHub's cron is keeping up
  if (lastKickMs && nowMs - lastKickMs < KICK_COOLDOWN_MIN * 60000) return null;   // already asked; give the run time to report
  return { newest: newest || null, minutesSilent: newest ? Math.round((nowMs - newest) / 60000) : null };
}

async function readJson(DB, key) {
  const r = await DB.select('rules?key=eq.' + encodeURIComponent(key) + '&select=value').catch(() => null);
  const v = r && r[0] && r[0].value; if (!v) return null;
  try { return v.steps || v.at ? v : JSON.parse(v.data || 'null'); } catch (e) { return null; }
}

export async function kickRunner(env, DB, nowMs = Date.now()) {
  if (!env.GH_DISPATCH_TOKEN) return { skipped: 'no GH_DISPATCH_TOKEN' };
  const jobs = await readJson(DB, 'kv:jobs-status');
  const last = await readJson(DB, KICK_KEY);
  const due = tickDue(nowMs, jobs, last && last.at ? Date.parse(last.at) : 0);
  if (!due) return { skipped: 'not due' };
  const gh = { Authorization: 'Bearer ' + env.GH_DISPATCH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'chatterbox-agentos-worker' };
  /* never pile a second run on one GitHub is already running — that is how a dropped slot turns into a queue */
  for (const st of ['queued', 'in_progress']) {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/actions/runs?status=' + st + '&per_page=1', { headers: gh }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (j && j.total_count > 0) return { skipped: 'a run is ' + st };
  }
  const res = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches', {
    method: 'POST', headers: { ...gh, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs: { steps: 'tick' } }),
  }).catch((e) => ({ status: 0, statusText: String(e && e.message || e) }));
  const rec = { at: new Date(nowMs).toISOString(), http: res.status, reason: due.minutesSilent == null ? 'tick never reported' : 'tick silent ' + due.minutesSilent + ' min', minutesSilent: due.minutesSilent };
  await DB.insert('rules', [{ key: KICK_KEY, value: { data: JSON.stringify(rec) }, updated_by: 'runner-kick', updated_at: rec.at }], true).catch(() => {});
  console[res.status === 204 ? 'info' : 'warn']('[runner] dispatched publish-digests tick → HTTP ' + res.status + ' (' + rec.reason + ')');
  return rec;
}
