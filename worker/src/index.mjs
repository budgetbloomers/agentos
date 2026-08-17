/**
 * Chatterbox AgentOS — API Worker
 * Auth + shared app state (kv) + Tracker EOD rows + BI money rows + /api/ask.
 * Data: Supabase (service key as secret). AI: Workers AI (see DEFAULT_MODEL below).
 * IRON RULE: the LLM explains numbers, it never computes them.
 */
import { db } from './db.mjs';
import { login, logout, session, hashPassword } from './auth.mjs';
import { retrieveKB } from './kb.mjs';

// Hermes 2 Pro was deprecated 2026-05-30. Default: Llama 4 Scout (131k context —
// fits the entire software's digests without truncation). Fallback: Llama 3.3 70B.
// Swap without redeploy by setting rule 'ai_model' -> {"value":"@cf/..."}.
const DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// The framework the assistant actually knows (NBA Scoring Framework v3.0).
const KB = `THE CHATTERBOX — NBA SCORING FRAMEWORK v3.0 (reference knowledge).

TWO-CHECK SALES RULE (VALUE is checked before VOLUME):
- Check 1 VALUE: GWP per sale >= R99. Check 2 VOLUME: daily sales vs the agent's tenure target.
- PASS/PASS = On Target. FAIL/PASS = Value Issue (coach product mix & upselling). PASS/FAIL = Volume Issue (coach activity, pipeline, closing). FAIL/FAIL = Both Issues (value coaching takes priority).

TENURE DAILY SALES TARGETS: M1=3, M2=4, EXP-Courtesy=5, EXP-Cuddle=8. GWP/sale target is R99 for everyone.

DECISION LADDER — exactly ONE primary NBA per agent, checked top to bottom, first trigger wins:
LEVEL 1 Protect the Business (P1): R1 Zero Attendance (attended no scheduled days); R2 Critical QA Failure (QA < 80%); R2A-3 Critical Compliance Fail (>=4 critical fails OR CFR >= 30%); R3 Attendance Risk (attendance < 80%).
LEVEL 2 Protect the Revenue (P2): R2A-2 Compliance Risk (2-3 fails OR CFR 10-<30%); R4 GWP Value Failure (GWP/sale < R99); R4A Critical Sales-Volume Failure (value clears R99 but sales < 70% of target); R5 Moderate QA Risk (QA 80-89%); R6 Low Sales Achievement (sales 70-89% of target).
LEVEL 3 Improve the Skill (P3): R7 Critical Conversion Failure (conversion below tenure target); R8 Talk Time Below Target (< 150 min/day); R2A-1 Compliance Note (exactly 1 fail AND CFR < 10% — a logged coaching note, NEVER surfaced as a primary NBA).
LEVEL 4 Develop & Recognise (P4): R9 Developing Performer (90-99% of target, all other metrics in range); R10 Strong/Elite Performer (meeting or exceeding all key targets).

GRADUATED CRITICAL-FAIL RULE (R2A): CFR = critical fails / audited calls x 100. The tier is the HIGHER of the count band and the rate band.
- R2A-3: >=4 fails OR CFR >= 30%  ->  -10 composite, Elite BLOCKED, P1 48h compliance review, audit each fail, daily monitoring 10 days.
- R2A-2: 2-3 fails OR CFR 10-<30%  ->  -5 composite, Elite BLOCKED, P2 structured compliance coaching within 5 days, root-cause review, raised audit cadence.
- R2A-1: exactly 1 fail AND CFR < 10%  ->  -2 composite, Elite RETAINED, logged coaching note only.
- Tier 0: 0 fails. The penalty is CAPPED at -10 (never per-fail multipliers; a fail already auto-zeros its call inside QA).
HOW AN R2A FLAG CLEARS: R2A is re-evaluated every period. An R2A-2 flag clears when the agent's critical-fail position drops below the R2A-2 trigger in the next audit window — i.e. back to 0-1 fails AND CFR < 10% (Tier 0 or R2A-1). In practice: take no new critical fails, complete the 5-day structured compliance coaching and root-cause review, and pass the raised-cadence re-audits so CFR falls under 10%. If fails instead reach 4+ or CFR 30%+, it ESCALATES to R2A-3 (Elite stays blocked until cleared).

COMPOSITE SCORE (max 100). Weights: Avg GWP/Sale (Value) 25, Target Achievement (Volume) 20, QA 20, Total GWP peer-percentile 15, Conversion 10, Talk Time 5, Attendance 5. The critical-fail penalty is applied AFTER the weighted sum and reported as 'Adj'. Cancellations and Avg Attempts per Unique Lead are diagnostics only — never scored. All comparisons are within the agent's own tenure group.`;
// The software itself — apps, tabs, and the Manual tab's content — so the
// assistant can answer "how do I use this" and "what does X tab / colour mean".
const SOFTWARE_GUIDE = `THE CHATTERBOX AGENTOS — THE SOFTWARE ITSELF.
The AgentOS is one suite with three apps, switched with the [Ops Analytics | VAS Analytics | Tracker Analytics] toggle at the top. Users log in each time a tab opens; each user sees only the tabs they have permission for. All three apps share: the same logo, a Data Trust bar (source freshness — read it before trusting any number), an Upload Station, clickable agent names that open a full agent card with AI coaching, and this Ask AgentOS chat widget (bottom-right).

OPS ANALYTICS TABS:
- Command: Executive (command centre: production, quality, people, one controlled view) · Visual Brain (the floor as a living graph — agents, teams, campaigns, NBA rules coloured by priority; hover for info, it cannot be clicked).
- Sales Ops: Sales Production (dialler activity, activations, case pipeline) · Lead Management (per-agent funnel: open attempts, closures, conversion, cancellations — the daily lead report, live) · Session Dashboard (intraday snapshots per session).
- Quality & Risk: QA & Compliance (clean-sale control: pass rates, critical fails, coaching) · QA Agent Performance (the assessors' own output) · Agent Discipline (offenses, stage ladder, SLA breaches).
- People: Team Leader View (TL leaderboard, dual-check fleet, coaching tables — NBA v3.0) · Workforce (attendance/availability) · Agent Performance (per-agent scorecard: productivity × quality × attendance) · Manual (how to read the analytics — content below).
- Data: Upload Station (manual source uploads, validation, batch audit, exceptions) · Session Uploads (intraday snapshot slots 08:00/10:00/12:00/15:00/16:30) · Dictionary, Rules & Thresholds (every KPI definition, RAG threshold and rule — live-editable) · Training Guide (run the system in 20 min/week).

VAS ANALYTICS TABS: Dashboard · Month to Date · Weekly Reports · Daily Reports · Sales Heatmap · Workforce · Agent Performance · Leaderboards · Coaching · Compare Agents · Manual · Open Cases · Upload Station · Adjustments · Settings.

TRACKER ANALYTICS (Matrix EOD Daily Tracker): manual end-of-day capture, one row per date — Employed HC, Present HC, Afrilead/JAG/VT Sales, Avg GWP, Agents-to-Target; Attendance % (present÷employed) and SPD (VT sales÷present) calculate automatically, with day-on-day movement columns. Entries are stored in the shared database and visible to every user. Tabs: Input · Daily Tracker.

THE MANUAL TAB (both apps carry this content):
1. READ THE COLOURS FIRST — one traffic-light system everywhere: GREEN = on target (metric at or better than goal). AMBER = watch (slipping toward a problem). RED = act (below target; needs an owner and an action today). GREY = informational, no target set. Every KPI card shows value, target (e.g. "target >= 90%"), a trend arrow vs the previous period and a mini-sparkline; click a KPI for its full definition.
2. THE RULES BEHIND THE SCORES — the NBA v3.0 framework (two-check rule, decision ladder, R2A, composite — full detail in the framework section of this prompt).
3. HOW TO USE THE SOFTWARE — (a) check the Data Trust bar first: green fresh, amber/red stale — a chart on stale data is a confident wrong answer; (b) upload exports in the Upload Station — type auto-detected from headers, rejected rows logged with reasons, never silently dropped; (c) set filters and date range in the top bar — everything re-windows; (d) click any agent's name to open their full card: framework score, primary NBA, composite breakdown, graphs, peer comparison, AI coaching; (e) Ask AgentOS (this chat) answers about the numbers, the framework and the business — it never invents figures.
4. THE WEEKLY RHYTHM — daily: the system assigns one NBA per agent. Monday: the Team Leader confirms data, sets owners and due dates. During the week: coaching happens. Next review: clear the NBA if resolved, escalate if not. If a red number has no owned action, the system has failed.`;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req, env, ctx) {
    // CORS: the suite (pages.dev + preview subdomains) may call this API.
    const origin = req.headers.get('origin') || '';
    const okOrigin = origin === 'https://chatterbox-agentos.pages.dev' || /^https:\/\/[a-z0-9-]+\.chatterbox-agentos\.pages\.dev$/.test(origin);
    const cors = okOrigin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cbx-Client', 'Access-Control-Max-Age': '86400' } });
    const res = await this.handle(req, env, ctx);
    const h = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },

  async handle(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const DB = db(env);
    try {
      // ---------- version gate (ONE check; was copy-pasted 8×) ----------
      // Outdated app copies (old tabs / bookmarked preview URLs) show stale ghost
      // data, and used to bulk-repush stale caches and resurrect wiped data. Refuse
      // to authenticate them, and refuse their writes — read-only until refreshed.
      const stale = req.headers.get('x-cbx-client') !== 'v5';
      const OUTDATED = { error: 'This tab is an OUTDATED copy of AgentOS. Close it, go to https://chatterbox-agentos.pages.dev and press Ctrl+Shift+R.' };
      const GATED_WRITES = ['POST /api/kv', 'DELETE /api/kv', 'POST /api/eod', 'POST /api/bi', 'DELETE /api/bi', 'POST /api/bi/raw'];

      // ---------- auth ----------
      if (stale && (path === '/api/me' || (path === '/api/login' && req.method === 'POST'))) return json(OUTDATED, 426);
      if (path === '/api/login' && req.method === 'POST') {
        const r = await login(DB, req, await req.json());
        if (!r.ok) return json({ error: r.error }, r.status);
        // token also in body: cross-origin pages use Bearer (cookie is same-origin only)
        return json({ user: r.user, token: r.token });
      }

      // Referrals-pipe health: NO auth and NO data — booleans and counts only, so the
      // route/secrets/HighLevel legs can each be verified when the column reads 0.
      if (path === '/api/referrals/health') {
        const out = { route: true, hl_key: !!env.HL_API_KEY, hl_location: !!env.HL_LOCATION_ID };
        if (out.hl_key && out.hl_location) {
          try {
            const H = { Authorization: 'Bearer ' + env.HL_API_KEY, Version: '2021-07-28', Accept: 'application/json' };
            const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${env.HL_LOCATION_ID}&limit=1`, { headers: H });
            out.hl_status = r.status;
            if (r.ok) { const d = await r.json(); out.hl_total = (d.meta && d.meta.total) || (d.contacts || []).length; }
            const cf = await fetch(`https://services.leadconnectorhq.com/locations/${env.HL_LOCATION_ID}/customFields`, { headers: H });
            out.hl_fields_status = cf.status;
            if (cf.ok) out.hl_fields = ((await cf.json()).customFields || []).length;
          } catch (e) { out.hl_error = String(e.message || e).slice(0, 200); }
        }
        out.cache = globalThis.__hlCache ? { age_s: Math.round((Date.now() - globalThis.__hlCache.t) / 1000), rows: (globalThis.__hlCache.d.rows || []).length } : null;
        return json(out);
      }

      const user = await session(DB, req);
      if (path === '/api/me') return user ? json({ user }) : json({ error: 'not signed in' }, 401);
      if (path === '/api/logout' && req.method === 'POST') { await logout(DB, user); return json({ ok: true }); }

      // Everything below requires a session.
      if (!user) return json({ error: 'Sign in required.' }, 401);
      // Write gate stays BELOW the session check — exactly where the six copies sat,
      // so a signed-out stale tab still gets 401 first, as it does today.
      if (stale && GATED_WRITES.includes(req.method + ' ' + path))
        return json({ error: 'Outdated app version — press Ctrl+Shift+R to refresh, then retry.' }, 409);

      if (path === '/api/password' && req.method === 'POST') {
        const b = await req.json();
        if (!b.new_password || String(b.new_password).length < 10) return json({ error: 'Password must be at least 10 characters.' }, 400);
        await DB.update(`app_users?id=eq.${user.user_id}`, { password_hash: await hashPassword(String(b.new_password)), must_change_password: false });
        return json({ ok: true });
      }

      // ---------- referrals: live pull from HighLevel (LeadConnector v2) ----------
      // The HL key is a Worker secret (HL_API_KEY + HL_LOCATION_ID) — it must never reach
      // the browser. One contact = one referrer; the referred people sit in the base block
      // plus "Referral 2..5", so each row's count = filled blocks (totals exceed rows by
      // design). Both dashboards ingest these rows through their normal upload pipeline —
      // the Worker only fetches and shapes, it never computes report numbers.
      if (path === '/api/referrals' && req.method === 'GET') {
        if (!env.HL_API_KEY || !env.HL_LOCATION_ID) return json({ error: 'HighLevel is not configured — set Worker secrets HL_API_KEY and HL_LOCATION_ID.' }, 503);
        const now = Date.now();
        if (!url.searchParams.get('fresh') && globalThis.__hlCache && now - globalThis.__hlCache.t < 600000)
          return json(globalThis.__hlCache.d, 200, { 'X-Cbx-Cache': 'hit' });
        const H = { Authorization: 'Bearer ' + env.HL_API_KEY, Version: '2021-07-28', Accept: 'application/json' };
        const base = 'https://services.leadconnectorhq.com';
        const hl = async (q) => { const r = await fetch(base + q, { headers: H }); if (!r.ok) throw new Error('HighLevel ' + q.split('?')[0] + ' → ' + r.status); return r.json(); };
        const cf = await hl(`/locations/${env.HL_LOCATION_ID}/customFields`);
        const fieldName = {}; (cf.customFields || []).forEach(f => fieldName[f.id] = f.name);
        const fids = n => Object.keys(fieldName).filter(id => fieldName[id] === n);
        const AGENT = fids('Agent Name');
        const BLOCKS = [
          ['Full Name and Surname', 'Referral Contact Number'],
          ['Referral 2 Full Name', 'Referral 2 Contact Number'],
          ['Referral 3 Full Name', 'Referral 3 Contact Number'],
          ['Referral 4 Full Name', 'Referral 4 Contact Number'],
          ['Referral 5 Full Name', 'Referral 5 Contact Number'],
        ].map(pair => pair.flatMap(fids));
        const contacts = []; let said = null, sa = null, guard = 0;
        for (;;) {
          let q = `/contacts/?locationId=${env.HL_LOCATION_ID}&limit=100`;
          if (said) q += `&startAfterId=${said}&startAfter=${sa}`;
          const r = await hl(q);
          const batch = r.contacts || [];
          contacts.push(...batch);
          if (batch.length < 100 || ++guard > 300) break;
          said = (r.meta && r.meta.startAfterId) || batch[batch.length - 1].id;
          sa = (r.meta && r.meta.startAfter) || new Date(batch[batch.length - 1].dateAdded || 0).getTime();
        }
        const fval = (c, ids) => { for (const f of (c.customFields || [])) if (ids.includes(f.id) && String(f.value ?? '').trim() !== '') return String(f.value).trim(); return ''; };
        const rows = [];
        for (const c of contacts) {
          let n = BLOCKS.filter(ids => fval(c, ids) !== '').length;
          if (!n && (c.tags || []).some(t => /referral/i.test(t))) n = 1;   // tagged referral with empty blocks still counts once
          if (!n) continue;
          rows.push({ id: c.id, created: String(c.dateAdded || '').slice(0, 10), agent: fval(c, AGENT), referrer: c.contactName || '', count: n });
        }
        const d = { rows, contacts: contacts.length, pulled_at: new Date().toISOString() };
        globalThis.__hlCache = { t: now, d };
        return json(d, 200, { 'X-Cbx-Cache': 'miss' });
      }

      // ---------- shared app state (multi-user persistence for both dashboards) ----------
      // Stored in the rules table under 'kv:' keys (no DDL needed). Last write wins.
      // kv v2 — big-data safe. Payloads live in Supabase STORAGE (streamed
      // through, no JSON parsing — a multi-MB upload costs ~zero Worker CPU);
      // the rules row holds only a pointer + updated_at for newest-wins sync.
      if (path === '/api/kv' && req.method === 'GET') {
        const key = url.searchParams.get('key') || '';
        const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:' + key)}&select=value,updated_at`);
        if (!r || !r.length) return json({ found: false }, 404);
        // meta mode: freshness beacon only — lets open tabs poll for other users'
        // uploads cheaply (no payload streamed) and re-pull when it changes.
        if (url.searchParams.get('meta')) return json({ found: true, updated_at: r[0].updated_at || '' });
        const v = r[0].value || {};
        const hs = { 'Content-Type': 'text/plain; charset=utf-8' };
        if (v.store) { // payload in Storage — stream it straight through
          const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } });
          if (!sr.ok) return json({ found: false }, 404);
          return new Response(sr.body, { status: 200, headers: hs });
        }
        return new Response(String(v.data ?? ''), { status: 200, headers: hs }); // legacy small row
      }
      if (path === '/api/kv' && req.method === 'POST') {
        const qk = url.searchParams.get('key');
        if (!qk) return json({ error: 'key required' }, 400);
        // raw mode: body is the payload itself, streamed into Storage. A Storage
        // refusal (e.g. bucket missing) fails loudly — that is a misconfiguration
        // to fix, not to paper over with an inline-row fallback.
        const objPath = 'raw/kv/' + qk;
        /* SERVER-SIDE WIPE GUARD (17 Aug incident, twice in one hour). A tab running an old
           build and holding an empty state pushed 20KB of nothing over 1.08MB of uploads —
           and re-pushed it minutes after the blob was restored, because client-side guards
           cannot reach a zombie tab that never reloads. The server is the one place every
           tab must pass through: a drastic shrink of the state blob (new body under a tenth
           of the stored copy, and small in absolute terms) is refused with 409 unless the
           client explicitly declares the clear (?force=1, sent by the Danger-zone action in
           current builds). Old tabs surface the 409 through their existing "Cloud save
           failed" toast — loud, and harmless. */
        const body = await req.text();
        if (qk === 'vas-state' && body.length < 120000 && !url.searchParams.get('force')) {
          const head = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
            method: 'HEAD', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
          });
          const cur = parseInt(head.headers.get('content-length') || '0', 10);
          if (head.ok && cur > body.length * 10) {
            return json({ error: 'wipe_blocked: refusing to replace ' + cur + 'B of stored data with ' + body.length + 'B. If this clear is deliberate, use the app\'s Danger zone.' }, 409);
          }
        }
        const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'text/plain', 'x-upsert': 'true' },
          body: body,
        });
        if (!sr.ok) return json({ error: 'store failed: ' + sr.status + ' ' + (await sr.text()).slice(0, 150) }, 500);
        await DB.insert('rules', [{ key: 'kv:' + qk, value: { store: objPath }, updated_by: user.username, updated_at: new Date().toISOString() }], true);
        return json({ ok: true });
      }
      // Real delete (Upload Station "Delete file"): remove BOTH the Storage object and the
      // pointer row, so the source is gone from the database — not just cleared to empty.
      if (path === '/api/kv' && req.method === 'DELETE') {
        const qk = url.searchParams.get('key');
        if (!qk) return json({ error: 'key required' }, 400);
        await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${qk}`, {
          method: 'DELETE', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY },
        }).catch(() => {});                                    // ignore if there was no Storage object
        await DB.del(`rules?key=eq.${encodeURIComponent('kv:' + qk)}`);
        return json({ ok: true, deleted: qk });
      }

      // ---------- Tracker Analytics: daily_eod rows (one row per date) ----------
      // Row-level storage: per-date upserts mean two users editing DIFFERENT
      // dates can never clobber each other.
      // LOAD-BEARING 503 — do not simplify to the top-level 500. tracker/index.html
      // hydrate() branches on `r.status === 503` to fall back to the kv blob.
      if (path === '/api/eod' && req.method === 'GET') {
        try {
          const rows = await DB.select('daily_eod?select=*&order=eod_date.asc');
          return json({ rows: rows || [] });
        } catch (e) { return json({ error: 'no_table', detail: String(e.message || e).slice(0, 120) }, 503); }
      }
      if (path === '/api/eod' && req.method === 'POST') {
        const b = await req.json(); // {date, employed, present, afrilead, jag, vt, gwp, target} or {date, delete:true}
        if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return json({ error: 'valid date required' }, 400);
        if (b.delete) { await DB.del(`daily_eod?eod_date=eq.${b.date}`); return json({ ok: true, deleted: b.date }); }
        await DB.insert('daily_eod', [{
          eod_date: b.date,
          employed: b.employed ?? null, present: b.present ?? null,
          afrilead: b.afrilead ?? null, jag: b.jag ?? null, vt: b.vt ?? null,
          gwp: b.gwp ?? null, target: b.target ?? null,
          updated_by: user.username, updated_at: new Date().toISOString(),
        }], true);
        return json({ ok: true, date: b.date });
      }

      // ---------- Power BI - Active Cases: THE money rows (migration-005) ----------
      // Row-level storage, not the kv JSON blob: a blob cannot be filtered in SQL,
      // and this file is the money. The app keeps its own copy either way, so
      // figures never depend on this.
      if (path === '/api/bi' && req.method === 'GET') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const lim = Math.min(Number(url.searchParams.get('limit')) || 20000, 50000);
        let q = 'bi_active_cases?select=*';
        if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) q += `&contract_create_date=gte.${from}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) q += `&contract_create_date=lte.${to}`;
        q += `&order=contract_create_date.asc&limit=${lim}`;
        return json({ rows: (await DB.select(q)) || [] });
      }
      // Deleting the Power BI source also clears its queryable rows (the kv blob is
      // removed separately via DELETE /api/kv). The raw monthly archive in the
      // bi-reports bucket is kept as the audit trail (R-FMT-06 traceability).
      if (path === '/api/bi' && req.method === 'DELETE') {
        // rows first (FK), then the batch records — so a later re-upload of the same
        // file is allowed again (its file_hash is no longer on record).
        await DB.del('bi_active_cases?id=gt.0');
        await DB.del('batches?source_type=eq.BI_ACTIVE_CASES');
        return json({ ok: true });
      }
      if (path === '/api/bi' && req.method === 'POST') {
        const b = await req.json();                       // {batch, rows:[ table-shaped ]}
        const rows = Array.isArray(b.rows) ? b.rows : [];
        if (!rows.length) return json({ error: 'rows required' }, 400);

        // IDEMPOTENCY — the same file must never load twice, no matter who uploads it or
        // how many times (a colleague re-uploading, a double-click, or two uploads
        // racing). file_hash identifies the file; a partial unique index on
        // (source_type, file_hash) enforces it even under concurrency (migration-007).
        // This fast check catches the common case; the unique-index catch below closes
        // the race. Months still ACCUMULATE — a genuinely new file (different hash, e.g.
        // next month or a correction) is not skipped; it loads and replaces its own span.
        const fileHash = String(b.batch?.file_hash ?? '').trim();
        if (fileHash) {
          const dup = await DB.select(`batches?source_type=eq.BI_ACTIVE_CASES&file_hash=eq.${encodeURIComponent(fileHash)}&select=batch_id&limit=1`);
          if (dup && dup.length) return json({ ok: true, skipped: true, reason: 'This exact file is already loaded — skipped to avoid duplication.', batch_id: dup[0].batch_id });
        }

        // The file is authoritative ONLY for the span of sale dates it actually
        // carries. Months accumulate — see migration-005 header (deviates from
        // pack R-ING-BI-06 by decision, because this file is uploaded monthly).
        let mn = null, mx = null;
        for (const r of rows) {
          const d = r.contract_create_date;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue;
          if (!mn || d < mn) mn = d;
          if (!mx || d > mx) mx = d;
        }
        if (!mn || !mx) return json({ error: 'no valid contract_create_date in rows' }, 400);

        // Whitelist columns: never let a client key reach the table verbatim.
        const COLS = ['account_no', 'contract_create_date', 'owner', 'cb', 'charge_amount',
          'charge_code', 'contract_status', 'contract_number', 'case_number', 'account_name',
          'consultant', 'product_bundle', 'merged_bundle', 'sales_vertical', 'batch_id'];
        const pick = (r) => { const o = {}; for (const c of COLS) if (r[c] !== undefined) o[c] = r[c]; return o; };

        try {
          // batch first — bi_active_cases.batch_id is a FK into batches. Plain insert
          // (not upsert): if two same-file uploads race past the check above, the
          // (source_type, file_hash) unique index makes the loser's insert conflict —
          // caught here and skipped, so its rows never insert. That is the race-safe half.
          if (b.batch?.batch_id) {
            try {
              await DB.insert('batches', [{
                batch_id: b.batch.batch_id, source_type: 'BI_ACTIVE_CASES', source_system: 'Power BI',
                uploaded_by: user.username, uploaded_at: b.batch.uploaded_at || new Date().toISOString(),
                period_start: mn, period_end: mx,
                file_name: b.batch.original_file_name || null, file_hash: fileHash || null,
                raw_rows: b.batch.raw_row_count ?? null, loaded_rows: b.batch.loaded_row_count ?? null,
                rejected_rows: b.batch.rejected_row_count ?? null, status: b.batch.validation_status || null,
                notes: b.batch.notes || null, storage_path: b.batch.storage_path || null,
              }]);
            } catch (e) {
              if (/duplicate key|already exists|23505|conflict/i.test(String(e.message || e)))
                return json({ ok: true, skipped: true, reason: 'This exact file is already loaded (race) — skipped.' });
              throw e;
            }
          }
          // replace this month only, then append
          await DB.del(`bi_active_cases?contract_create_date=gte.${mn}&contract_create_date=lte.${mx}`);
          const CHUNK = 800;                              // PostgREST payload + Worker CPU headroom
          let ins = 0;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const part = rows.slice(i, i + CHUNK).map(pick);
            await DB.insert('bi_active_cases', part);
            ins += part.length;
          }
          return json({ ok: true, inserted: ins, replaced_range: mn + ' → ' + mx });
        } catch (e) {
          const m = String(e.message || e);
          if (/bi_active_cases/.test(m) && /does not exist|schema cache|relation/i.test(m)) {
            return json({ error: 'no_table', detail: m.slice(0, 140) }, 503);
          }
          return json({ error: 'bi_write_failed', detail: m.slice(0, 200) }, 500);
        }
      }
      // Immutable archive of the exact monthly export, so any figure can be
      // re-derived from the bytes that produced it (R-FMT-06 traceability).
      if (path === '/api/bi/raw' && req.method === 'POST') {
        const name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._-]/g, '_');
        if (!name) return json({ error: 'name required' }, 400);
        const objPath = 'bi-reports/' + name;
        const sr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${objPath}`, {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
            'Content-Type': req.headers.get('content-type') || 'application/octet-stream', 'x-upsert': 'true',
          },
          body: req.body,
        });
        if (!sr.ok) return json({ error: 'archive failed: ' + sr.status + ' ' + (await sr.text()).slice(0, 150) }, 500);
        return json({ ok: true, path: objPath });
      }

      // ---------- ask (Phase 3: Hermes with guardrails) ----------
      if (path === '/api/ask' && req.method === 'POST') {
        const ks = await DB.select('rules?key=eq.ai_kill_switch&select=value');
        if (!ks?.[0]?.value?.enabled) return json({ answer: 'The AI assistant is currently switched off by an administrator.' });
        const b = await req.json();
        const question = String(b.question || '').slice(0, 2000);
        const context = String(b.context || '').slice(0, 40000);
        const kb = retrieveKB(question);
        let sys = 'You are Ask AgentOS, the DATA ANALYST for The Chatterbox call centre. You have the entire software in front of you: all three analytics apps (Ops Analytics, VAS Analytics, Tracker Analytics), their full stored datasets, the live daily-EOD table, the live rules Dictionary, the operator notes, the NBA scoring framework and the company knowledge base. ANY question about agents, teams, sales, GWP, QA, attendance, leads, cancellations, campaigns, uploads, trends, or any tab of any app is IN SCOPE.\n'
          + 'WORK LIKE AN ANALYST: (1) answer with the number first, then the insight — compare against targets, previous days and peers when the data is present; compute differences and percentages from figures given in context; (2) cite where each figure comes from (which app/section of the context and the date window) so the reader can verify it; (3) name metric twins explicitly — "conversion" has two definitions (Card = sales ÷ total leads; Lead-Mgmt = sales ÷ total closed) — say which one you are using; (4) if a figure is not in the context, do not refuse: answer what you can and name exactly which tab or upload would hold the missing figure; (5) never invent a number — every figure you state must appear in, or be arithmetically derived from, the context below; (6) flag data-quality caveats you can see (stale digests, missing uploads, unmapped agents) like an analyst would. Only decline questions clearly unrelated to The Chatterbox or its operations (general trivia, news, personal advice, coding help). Be direct and executive; use short paragraphs or tight bullet lists.\n\n'
          + '=== THE SOFTWARE (apps, tabs, manual) ===\n' + SOFTWARE_GUIDE + '\n\n'
          + '=== NBA SCORING FRAMEWORK ===\n' + KB + '\n\n'
          + '=== COMPANY KNOWLEDGE BASE (TCB-KB-V3) ===\n' + kb + '\n=== end knowledge base ===\n\n'
          + 'RULES when using the knowledge base: state facts with their status where shown (confirmed / model / proposed / historical / conflict / input_required); never present a model or proposed figure as an actual. If two figures conflict (e.g. 330 vs 370 agents, R42,500 vs R34,762 revenue/agent), say both and note it is a recorded conflict — do not silently pick one. Name corrections are absolute: Nicholas Pillay is CTTO (never "Chief Growth..."); Claudell Panday spelling; Abigail owns recruitment execution; the COO is unresolved. If a fact is not in the knowledge above, say [INPUT REQUIRED] rather than inventing it.';
        if (context) {
          sys += '\n\n=== LIVE DASHBOARD DIGEST (all tabs of the app the user is in) ===\n' + context
            + '\n=== end live dashboard digest ===\nFor questions about dashboard numbers — any tab, any agent, any team — use the figures above directly. Only [INPUT REQUIRED] if a specific figure is genuinely absent from both the digest and the knowledge base.';
        }
        // Cloud data access: BOTH apps' full stored digests + upload history from
        // Supabase, injected on every question so the AI sees the entire software,
        // whichever widget the user asks from.
        let cloud = '';
        try {
          for (const [k, label] of [['ai-digest-ops', 'OPS ANALYTICS'], ['ai-digest-vas', 'VAS ANALYTICS'], ['ai-digest-tracker', 'TRACKER ANALYTICS']]) {
            try {
              const r = await DB.select(`rules?key=eq.${encodeURIComponent('kv:' + k)}&select=value,updated_at`);
              const v = r?.[0]?.value || {};
              let d = String(v.data || '');
              if (!d && v.store) d = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
              d = d.slice(0, 25000);
              if (d) cloud += '\n--- ' + label + ' — full stored digest (saved ' + (r[0].updated_at || 'unknown') + ') ---\n' + d + '\n';
            } catch (e) {}
          }
          // Tracker Analytics — live daily_eod rows straight from the database
          // (never stale, independent of any open tab). Att%/SPD computed here in
          // code — the model explains numbers, it never computes the canon.
          try {
            const eod = await DB.select('daily_eod?select=*&order=eod_date.desc&limit=60');
            if (eod?.length) cloud += '\n--- TRACKER ANALYTICS — Matrix EOD daily table (LIVE from the database, newest first) ---\n'
              + eod.map(r => {
                  const att = (r.employed > 0 && r.present != null) ? Math.round(r.present / r.employed * 100) + '%' : '-';
                  const spd = (r.present > 0 && r.vt != null) ? Math.round(r.vt / r.present * 100) / 100 : '-';
                  return '- ' + r.eod_date + ': employed ' + (r.employed ?? '-') + ' · present ' + (r.present ?? '-')
                    + ' · attendance ' + att + ' · Afrilead ' + (r.afrilead ?? '-') + ' · JAG ' + (r.jag ?? '-') + ' · VT ' + (r.vt ?? '-')
                    + ' · SPD ' + spd + ' · avg GWP ' + (r.gwp != null ? 'R' + r.gwp : '-') + ' · agents-to-target ' + (r.target ?? '-')
                    + ' (entered by ' + (r.updated_by || '?') + ')';
                }).join('\n') + '\n';
          } catch (e) {}
          // BI - Active Cases — THE money source, aggregated LIVE from the row table
          // (migration-008 views). Never depends on any app being open. GWP incl =
          // Σ charge_amount per account × 1.15; sales = distinct accounts.
          try {
            const N = x => Number(x) || 0;
            const tot = (await DB.select('bi_money_total?select=*'))?.[0];
            const bm = await DB.select('bi_money_by_month?select=*&order=ym.asc');
            if (tot || bm?.length) {
              cloud += '\n--- BI ACTIVE CASES — THE money model, LIVE from the database ---\n';
              if (tot) cloud += 'TOTAL (all months loaded): ' + N(tot.sales) + ' sales · GWP incl R' + Math.round(N(tot.gwp_incl))
                + ' (ex R' + Math.round(N(tot.gwp_ex)) + ') · ' + N(tot.charge_lines) + ' charge lines'
                + (N(tot.unattributed_lines) ? ' · ' + N(tot.unattributed_lines) + ' unattributed' : '')
                + ' · span ' + (tot.first_sale || '?') + ' → ' + (tot.last_sale || '?') + '\n';
              if (bm?.length) cloud += 'By month:\n' + bm.map(r => '- ' + r.ym + ': ' + N(r.sales) + ' sales · GWP incl R'
                + Math.round(N(r.gwp_incl)) + ' (ex R' + Math.round(N(r.gwp_ex)) + ') · ' + N(r.charge_lines) + ' lines'
                + (N(r.unattributed_lines) ? ' · ' + N(r.unattributed_lines) + ' unattributed' : '')).join('\n') + '\n';
            }
          } catch (e) {}
          // BI money by agent — top per recent month, so "top agent in June" or a
          // specific CB's GWP resolve from live data.
          try {
            const N = x => Number(x) || 0;
            const ba = await DB.select('bi_money_by_agent?select=*&order=ym.desc,gwp_incl.desc&limit=240');
            if (ba?.length) {
              const byM = {};
              for (const r of ba) (byM[r.ym] = byM[r.ym] || []).push(r);
              let s = '';
              for (const ym of Object.keys(byM).sort().reverse().slice(0, 3))
                s += ym + ': ' + byM[ym].slice(0, 15).map(r => (r.owner || r.cb) + ' ' + N(r.sales) + '/R' + Math.round(N(r.gwp_incl))).join(' · ') + '\n';
              if (s) cloud += 'By agent (top 15 per recent month, GWP incl):\n' + s;
            }
          } catch (e) {}
          // VAS ANALYTICS — sales/GWP by month summarised LIVE from its cloud blob,
          // so VAS figures answer even when nobody has the VAS app open.
          try {
            const vr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:vas-state')}&select=value`);
            const vv = vr?.[0]?.value || {};
            let vraw = String(vv.data || '');
            if (!vraw && vv.store) vraw = (await DB.storageGet('raw', vv.store.replace(/^raw\//, ''))) || '';
            if (vraw) {
              const V = JSON.parse(vraw);
              const perM = {};
              const addM = (d, s, g) => { const m = String(d).slice(0, 7); const o = perM[m] = perM[m] || { sales: 0, gwp: 0 }; o.sales += (Number(s) || 0); o.gwp += (Number(g) || 0); };
              for (const d in (V.sales || {})) for (const k in V.sales[d]) { const x = V.sales[d][k] || {}; addM(d, x.n, x.gwp); }
              for (const d in (V.tracker || {})) { if (V.sales && V.sales[d]) continue; for (const k in V.tracker[d]) { const x = V.tracker[d][k] || {}; addM(d, x.sales, x.gwp); } }
              const months = Object.keys(perM).sort();
              if (months.length) cloud += '\n--- VAS ANALYTICS — sales/GWP by month (LIVE from the vas-state blob) ---\n'
                + months.map(m => '- ' + m + ': ' + Math.round(perM[m].sales) + ' sales · GWP R' + Math.round(perM[m].gwp)).join('\n')
                + '\nRoster: ' + ((V.roster || []).length) + ' agents · uploads: ' + ((V.files || []).map(f => f.type).join(', ') || 'none') + '\n';
            }
          } catch (e) {}
          // Live rules Dictionary (kv:cb-config) — the ACTUAL thresholds in force,
          // visible from every app's widget, not just when asked from Ops.
          try {
            const rc = await DB.select(`rules?key=eq.${encodeURIComponent('kv:cb-config')}&select=value`);
            const v = rc?.[0]?.value || {};
            let raw = String(v.data || '');
            if (!raw && v.store) raw = (await DB.storageGet('raw', v.store.replace(/^raw\//, ''))) || '';
            if (raw) {
              const cfg = JSON.parse(raw);
              const rl = cfg && cfg.rules ? cfg.rules : {};
              const buf = Object.keys(rl).map(k2 => {
                const vals = rl[k2] && rl[k2].vals;
                return vals != null ? k2 + '=' + (Array.isArray(vals) ? vals.join('/') : vals) : null;
              }).filter(Boolean).join(' · ');
              if (buf) cloud += '\n--- LIVE RULES DICTIONARY (current thresholds in force — user-editable in Ops → Data → Dictionary) ---\n' + buf.slice(0, 4000) + '\n';
            }
          } catch (e) {}
          // Operator notes — the brain vault's hot cache (state of play).
          try {
            const hot = (await DB.storageGet('brain', 'hot.md')) || (await DB.storageGet('brain', 'brain/hot.md'));
            if (hot) cloud += '\n--- OPERATOR NOTES (brain vault — state of play) ---\n' + String(hot).slice(0, 4000) + '\n';
          } catch (e) {}
          try {
            const bt = await DB.select('batches?select=source_type,file_name,loaded_rows,rejected_rows,uploaded_by,uploaded_at&order=uploaded_at.desc&limit=10');
            if (bt?.length) cloud += '\n--- Upload history (latest batches) ---\n'
              + bt.map(x => '- ' + (x.uploaded_at || '?') + ': ' + (x.source_type || '?') + ' "' + (x.file_name || '') + '" (' + (x.loaded_rows ?? '?') + ' rows loaded, ' + (x.rejected_rows ?? 0) + ' rejected) by ' + (x.uploaded_by || '?')).join('\n') + '\n';
          } catch (e) {}
        } catch (e) {}
        if (cloud) {
          sys += '\n\n=== CLOUD DATA (the entire software: all three apps’ stored datasets, the live daily-EOD table, the live rules Dictionary, upload history, operator notes) ===' + cloud
            + '=== end cloud data ===\nThe data above covers the FULL datasets of all three apps — Ops Analytics, VAS Analytics and Tracker Analytics — whichever app the user is currently in. Use them for any question about the other app, past uploads, or data not on the current screen. The blocks marked "LIVE from the database" (BI Active Cases money by month/agent/total, VAS sales & GWP by month, the Matrix EOD table) are read straight from Supabase on THIS request — they are always current and AUTHORITATIVE: prefer them over any stored digest figure for money, sales or GWP. IMPORTANT: if a stored digest conflicts with a LIVE block or the LIVE DASHBOARD DIGEST (e.g. the stored one shows zeros or is missing an agent the live one lists), the LIVE figure is the truth — a stored digest may simply be stale.';
        }
        const mrow = await DB.select("rules?key=eq.ai_model&select=value");
        let model = (mrow?.[0]?.value?.value) || DEFAULT_MODEL;
        let ai;
        try {
          ai = await env.AI.run(model, { messages: [{ role: 'system', content: sys }, { role: 'user', content: question }], max_tokens: 900 });
        } catch (e) {
          // model unavailable / context error → fall back to the smaller model with tighter context
          model = FALLBACK_MODEL;
          ai = await env.AI.run(model, { messages: [{ role: 'system', content: sys.slice(0, 90000) }, { role: 'user', content: question }], max_tokens: 900 });
        }
        const answer = (ai && (ai.response || ai.result || '')) || '[no response]';
        ctx.waitUntil(DB.insert('ask_log', [{ asked_by: user.username, question, answer, model }]));
        return json({ answer });
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error', detail: String(e.message || e).slice(0, 300) }, 500);
    }
  },
};
