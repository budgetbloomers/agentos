/**
 * THE KITCHEN BOARD CHECK (2026-11-24). Nick: "fix whatever is not working for the wimpy".
 *
 * On 24 Nov every accepted order reached HighLevel (183/183 in 14 days), yet 15 cards sat in "New Order" all day — the
 * 10:32 batch move only picked up the newest 22 because the HighLevel board lazy-loads — and 21 never left "Order
 * Processing". Nothing told anyone. This module READS the Wimpy Pipeline (never writes to HighLevel) and says, after
 * ordering closes (10:30 SAST), which of TODAY's cards are still waiting:
 *     10:45 SAST — cards still in "New Order"
 *     12:00 SAST — cards still in "New Order" or "Order Processing"
 * The result goes to kv:wimpy-board-status (counts, SAST times, CB numbers — never a phone number or a name) and is
 * also the route's answer. The AgentOS Worker's health sentinel turns it into ONE banner alert (worker/src/health.mjs,
 * id wimpy-board) for the people who already get the banner, and clears it when the board is clean.
 *
 * WHO RUNS IT: the Worker's ten-minute tick calls GET /api/wimpy/cron/board?slot=… with the CRON_SECRET bearer — the
 * HighLevel key stays here, and Vercel Hobby cannot (crons once a day, fired anywhere in the hour).
 *
 * WHICH CB A CARD IS: the kitchen's n8n flow makes the card ("Avesh | 1 × Crispy Stack") with no CB on it, so a card is
 * matched to today's ledger row (wimpy_orders: cb, placed_at, the owner's first name) — same first name in the card or
 * contact name, card made within 5 min before / 30 min after the order, nearest first, each row used once. A card that
 * matches no row is still counted ("CB not known").
 *
 * NEVER THROWS. HighLevel down / slow / unconfigured → {ok:false, error} (redacted), written the same way, so the banner
 * says "could not read the kitchen board" once — not an alert per card, not a storm.
 */
import { hlRequest, hlConfigured, resolvePipeline, redact, HL_READ_TIMEOUT_MS, dbWhy } from './wimpy-hl.mjs';

export const BOARD_KEY = 'kv:wimpy-board-status';
/* the slots, in day order — the Worker's twin (worker/src/health.mjs WIMPY_BOARD_SLOTS) must list the same */
export const BOARD_SLOTS = {
  '10:45': { stages: ['New Order'] },
  '12:00': { stages: ['New Order', 'Order Processing'] },
};
export const BOARD_PAGES = 5;          // ≤ 500 cards read — a day has ~20–60; more pages = truncated, said so
const PAGE = 100;
const LIST_MAX = 40;                   // cards named in the status; the count is always the whole number
const MIN = 60000, HOUR = 60 * MIN;

const same = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').toLowerCase();
const letters = (s) => String(s || '').toLowerCase().replace(/[^\p{L}]/gu, '');
/** 00:00 SAST of the day `now` falls on, as UTC ms (SAST is UTC+2 all year). */
export function sastDayStart(now) { const d = new Date(now + 2 * HOUR); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 2 * HOUR; }
export const sastDate = (ms) => new Date(ms + 2 * HOUR).toISOString().slice(0, 10);
export const sastHm = (ms) => new Date(ms + 2 * HOUR).toISOString().slice(11, 16);

/**
 * Pure: which ledger order each waiting card belongs to. cards = HighLevel opportunities (createdAt, name, contact);
 * orders = [{cb, placed_at, first}] → [{cb|null, at:'HH:MM', stage}] in card order.
 */
export function matchCards(cards, orders, stageName) {
  const used = new Set();
  return cards.slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map((c) => {
    const t = Date.parse(c.createdAt);
    const hay = letters(c.name) + ' ' + letters(c.contact && (c.contact.name || ((c.contact.firstName || '') + (c.contact.lastName || ''))));
    let best = null;
    orders.forEach((o, i) => {
      if (used.has(i) || !o.first) return;
      const d = t - Date.parse(o.placed_at);
      if (!(d >= -5 * MIN && d <= 30 * MIN)) return;
      if (!hay.includes(letters(o.first))) return;
      if (!best || Math.abs(d) < best.d) best = { i, d: Math.abs(d) };
    });
    if (best) used.add(best.i);
    return { cb: best ? String(orders[best.i].cb || '').toUpperCase() || null : null, at: sastHm(t), stage: stageName(c) };
  });
}

/** Today's cards in the Wimpy Pipeline, newest first, at most BOARD_PAGES pages. → {ok, cards, truncated} | {ok:false, error} */
async function todaysCards(env, pipelineId, dayStart) {
  let cards = [], truncated = false;
  for (let page = 1; page <= BOARD_PAGES; page++) {
    const r = await hlRequest(env, 'GET', '/opportunities/search', { timeoutMs: HL_READ_TIMEOUT_MS,
      query: { location_id: env.WIMPY_HL_LOCATION_ID, pipeline_id: pipelineId, limit: PAGE, page, order: 'added_desc' } });
    if (!r.ok) return { ok: false, error: r.error };
    const got = (r.json && r.json.opportunities) || [];
    cards = cards.concat(got);
    const oldest = got.reduce((m, c) => Math.min(m, Date.parse(c && c.createdAt) || Infinity), Infinity);
    if (got.length < PAGE || oldest < dayStart) break;
    if (page === BOARD_PAGES) truncated = true;
  }
  return { ok: true, cards: cards.filter((c) => c && c.id && Date.parse(c.createdAt) >= dayStart), truncated };
}

/** Today's ledger rows with the owner's first name; unreadable → [] (the CBs then read "not known", the count stands). */
async function todaysOrders(env, DB, dayStart) {
  try {
    const rows = (await DB.select('wimpy_orders?placed_at=gte.' + encodeURIComponent(new Date(dayStart).toISOString())
      + '&select=cb,placed_at,owner_user_id&order=placed_at.asc&limit=1000')) || [];
    const ids = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))];
    const names = new Map();
    if (ids.length) for (const u of (await DB.select('app_users?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,full_name')) || [])
      names.set(String(u.id), String(u.full_name || '').trim().split(/\s+/)[0] || '');
    return rows.map((r) => ({ cb: r.cb, placed_at: r.placed_at, first: names.get(String(r.owner_user_id)) || '' }));
  } catch (e) { console.warn('[wimpy:board] ledger unreadable: ' + dbWhy(env, e)); return []; }
}

/**
 * One check. {slot:'10:45'|'12:00', now?} → the status written to kv:wimpy-board-status:
 *   {v:1, day, slot, at, ok:true, stages, count, cards:[{cb, at, stage}], truncated}
 *   {v:1, day, slot, at, ok:false, error}
 */
export async function checkKitchenBoard(env, DB, { slot, now = Date.now() } = {}) {
  const def = BOARD_SLOTS[slot];
  const dayStart = sastDayStart(now);
  const base = { v: 1, day: sastDate(now), slot, at: new Date(now).toISOString() };
  let status;
  try {
    if (!def) status = { ...base, ok: false, error: 'unknown slot' };
    else if (!hlConfigured(env)) status = { ...base, ok: false, error: 'HighLevel is not configured on the Wimpy service (WIMPY_HL_API_KEY / WIMPY_HL_LOCATION_ID)' };
    else {
      const P = await resolvePipeline(env);
      const want = P.ok ? Object.keys(P.stages).filter((id) => def.stages.some((n) => same(P.stages[id], n))) : [];
      if (!P.ok) status = { ...base, ok: false, error: P.error };
      else if (want.length < def.stages.length) status = { ...base, ok: false, error: 'the Wimpy Pipeline has no stage named ' + def.stages.filter((n) => !want.some((id) => same(P.stages[id], n))).map((n) => '"' + n + '"').join(' / ') };
      else {
        const t = await todaysCards(env, P.pipelineId, dayStart);
        if (!t.ok) status = { ...base, ok: false, error: t.error };
        else {
          const waiting = t.cards.filter((c) => want.includes(c.pipelineStageId) && (!c.status || c.status === 'open'));
          const orders = waiting.length ? await todaysOrders(env, DB, dayStart) : [];
          const named = matchCards(waiting, orders, (c) => P.stages[c.pipelineStageId] || '');
          status = { ...base, ok: true, stages: def.stages, count: named.length, cards: named.slice(0, LIST_MAX), truncated: t.truncated };
        }
      }
    }
  } catch (e) { status = { ...base, ok: false, error: redact(env, String((e && e.message) || e)) }; }
  if (!status.ok) status.error = redact(env, status.error).slice(0, 200);
  try {
    await DB.insert('rules', [{ key: BOARD_KEY, value: { data: JSON.stringify(status) }, updated_by: 'wimpy-board', updated_at: new Date(now).toISOString() }], true);
    status.written = true;
  } catch (e) { console.warn('[wimpy:board] status not stored: ' + dbWhy(env, e)); status.written = false; }
  return status;
}
