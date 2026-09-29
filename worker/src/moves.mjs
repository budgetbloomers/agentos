/**
 * moves.mjs — CAMPAIGN MOVES BY EFFECTIVE DATE (sprint 2026-09-29, item 2; decision D4).
 *
 * UAT 28 Sep: four of Denise's agents worked Download & Test for the first two weeks of September and
 * Courtesy after; AgentOS blended the month under one campaign. The cause was deliberate (CLAUDE.md
 * non-negotiable 11: an Agent List rewrites the agent's WHOLE current month) and D4 changes it for
 * CAMPAIGNS only: the latest list still decides the campaign NOW and the team leader, but a mover's
 * earlier days stay under the campaign they were worked on.
 *
 * WHERE THE DATE COMES FROM. Every published Agent List is kept as a dated snapshot in `agent_list`
 * (migration-010). A campaign change between two snapshots takes effect on the FIRST snapshot that
 * shows the new campaign — the earliest day the business told us. The first snapshot inside the month
 * sets the month's opening campaign (dates before the earliest observation resolve to it, as orgAt
 * does). A human can state the true day instead: `kv:campaign-move-overrides` {YYYY-MM: {CBnn:
 * [{from, campaign}]}} replaces the derived segments for that agent and month.
 *
 * Only MOVERS travel (≥ 2 segments in the month) — everyone else is exactly what the list says.
 */
import { normCb } from './portal.mjs';

const OVR = 'kv:campaign-move-overrides';
/* A PHASE IS NOT A CAMPAIGN. Nesting is the training phase before Courtesy (and September's campaign set
   dropped it on purpose): a Nesting → Courtesy graduation is not a campaign move, so the month stays whole
   under the campaign the agent graduated into, exactly as before. Found on the real September snapshots
   (2026-09-29): 13 Nesting → Courtesy graduates on 14 Sep beside the 4 Download & Test → Courtesy movers. */
export const PHASE_CAMPAIGNS = ['Nesting'];

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: month + '-01', to: month + '-' + String(last).padStart(2, '0') };
}

/* every snapshot row in the month, paged — PostgREST caps a response at 1000 rows */
async function snapshotRows(DB, from, to) {
  const out = [];
  for (let off = 0; off < 20000; off += 1000) {
    const page = await DB.select('agent_list?select=as_of,employee_code,campaign&as_of=gte.' + from + '&as_of=lte.' + to
      + '&order=employee_code.asc,as_of.asc&limit=1000&offset=' + off);
    out.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  return out;
}

/* Sorted, one segment per day (the later entry wins), a run of the same campaign merged, and the FIRST
   segment always opening the month — no day of the month may belong to no campaign (review, 2026-09-29). */
function tidySegments(segs, monthStart) {
  const byDay = new Map();
  for (const s of Array.isArray(segs) ? segs : []) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.from)) || !String(s.campaign || '').trim()) continue;
    byDay.set(String(s.from) < monthStart ? monthStart : String(s.from), String(s.campaign).trim());
  }
  const out = [];
  for (const [d, campaign] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (out.length && out[out.length - 1].campaign === campaign) continue;
    out.push({ from: d, campaign });
  }
  if (out.length) out[0].from = monthStart;
  return out;
}

/** Derive each agent's campaign segments for a month from the dated snapshots. Pure. */
export function deriveMoves(rows, month) {
  const { from } = monthBounds(month);
  const by = {};
  for (const r of rows || []) {
    const cb = normCb(r.employee_code || ''), camp = String(r.campaign || '').trim();
    if (!cb || !camp || PHASE_CAMPAIGNS.includes(camp)) continue;
    (by[cb] = by[cb] || []).push({ as_of: String(r.as_of), campaign: camp });
  }
  const agents = {};
  for (const [cb, seq] of Object.entries(by)) {
    seq.sort((a, b) => a.as_of.localeCompare(b.as_of));
    const segs = [];
    for (const s of seq) {
      if (!segs.length) segs.push({ from, campaign: s.campaign, source: 'list', list: s.as_of });
      else if (segs[segs.length - 1].campaign !== s.campaign) segs.push({ from: s.as_of, campaign: s.campaign, source: 'list', list: s.as_of });
    }
    if (segs.length >= 2) agents[cb] = segs;
  }
  return agents;
}

/** GET /api/campaign-moves?month=YYYY-MM — the movers and their dated segments, overrides applied. */
export async function campaignMoves(DB, month) {
  const { from, to } = monthBounds(month);
  const [rows, ovr] = await Promise.all([
    snapshotRows(DB, from, to),
    DB.select('rules?key=eq.' + encodeURIComponent(OVR) + '&select=value'),
  ]);
  const agents = deriveMoves(rows, month);
  const overrides = ((ovr && ovr[0] && ovr[0].value) || {})[month] || {};
  for (const [cb0, segs] of Object.entries(overrides)) {
    const cb = normCb(cb0);
    const clean = tidySegments(segs, from).map((s) => ({ ...s, source: 'override' }));
    if (clean.length >= 2) agents[cb] = clean; else delete agents[cb];   // one segment = not a mover
  }
  const lists = [...new Set((rows || []).map((r) => String(r.as_of)))].sort();
  return { month, from, to, agents, lists, updatedAt: new Date().toISOString() };
}

/** POST /api/campaign-moves {month, cb, segments:[{from, campaign}] | null} — admin sets the true day. */
export async function setCampaignMove(DB, user, body) {
  if (!user || user.role !== 'admin') return { status: 403, body: { error: 'Only an admin can set a campaign move date.' } };
  const month = String((body && body.month) || ''), cb = normCb((body && body.cb) || '');
  if (!/^\d{4}-\d{2}$/.test(month) || !cb) return { status: 400, body: { error: 'month (YYYY-MM) and cb are required.' } };
  const segs = body.segments == null ? null : (Array.isArray(body.segments) ? body.segments : []);
  if (segs && !segs.every((s) => s && /^\d{4}-\d{2}-\d{2}$/.test(String(s.from)) && String(s.from).startsWith(month) && String(s.campaign || '').trim()))
    return { status: 400, body: { error: 'Each segment needs a from date inside the month and a campaign.' } };
  const cur = await DB.select('rules?key=eq.' + encodeURIComponent(OVR) + '&select=value');
  const all = (cur && cur[0] && cur[0].value) || {};
  const m = { ...(all[month] || {}) };
  if (segs) m[cb] = tidySegments(segs.slice(0, 31), month + '-01'); else delete m[cb];
  await DB.insert('rules', [{ key: OVR, value: { ...all, [month]: m }, updated_by: user.username || 'admin', updated_at: new Date().toISOString() }], true);
  return { status: 200, body: { ok: true, month, cb, segments: m[cb] || null } };
}
