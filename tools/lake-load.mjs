/* LOAD THE FACT STORES INTO THE LAKE — and let Postgres do the deduplicating.
 *
 * migration-010 modelled every source as a table whose PRIMARY KEY is that source's
 * identity rule, "so re-uploading is idempotent rather than additive". Eight of those ten
 * tables had never received a row: the data lived only as JSON blobs, where a duplicate is
 * something a browser has to remember to prevent. This is the writer that was missing.
 *
 * Every row goes in through INSERT ... ON CONFLICT (natural key) DO UPDATE. That is the
 * whole point: run it twice and the second run changes nothing, because the key decides
 * identity, not the arrival. A file loaded seven times lands once.
 *
 *   node tools/lake-load.mjs                    # load every mapped source
 *   node tools/lake-load.mjs --source VICI_CALL_REPORT
 *   node tools/lake-load.mjs --dry              # parse, map and report; write nothing
 *
 * NOT LOADED HERE, DELIBERATELY:
 *   AGENT_LIST — owned by sync_agent_list() (migration-014), which reconciles logins in one
 *                transaction. A second writer would fight it.
 *   BI_ACTIVE_CASES — already populated by its own path (27 377 rows) and now protected by
 *                bi_active_cases_natural_uq (migration-017). Loading it again from a blob
 *                that holds only the current month would add nothing and risk the money.
 *
 * ONE KEY, ONE ROW PER STATEMENT (Spec Kit 014, T2, 2026-10-07). Every run since 6 Oct died on
 * SF_INACTIVE: the export carried one line twice (account 10496996 / contract 16342608 / deactivated
 * 2026-10-05, identical, batch B0473), both landed in one 500-row upsert, and Postgres refuses
 * "ON CONFLICT DO UPDATE command cannot affect row a second time" (21000). The throw ended the run,
 * so ViciDial, referrals and CallX — loaded after SF_INACTIVE — stopped with it, and agent_day was
 * never refreshed. Rows sharing a conflict key now collapse BEFORE the upsert (the last one wins,
 * exactly what a sequential upsert would have kept) and are counted in the report; a source that
 * fails is reported FAILED and the rest still load; the pg client has an 'error' listener, so a
 * dropped connection is a reported failure instead of an "Unhandled 'error' event" crash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from '../nicks_code/diagnostics/node_modules/pg/lib/index.js';
import { storeText } from './kv-store.mjs';   // a store may be kept gzipped at rest (spec 013)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---- helpers: the blobs are parsed spreadsheets, so every value arrives as text ---- */
const s = (v) => { const t = v == null ? '' : String(v).trim(); return t === '' ? null : t; };
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const day = (v) => { const t = s(v); if (!t) return null; const m = /^(\d{4}-\d{2}-\d{2})/.exec(t); return m ? m[1] : null; };
const ts = (v) => { const t = s(v); if (!t) return null; const d = new Date(t.replace(' ', 'T')); return isNaN(d) ? null : d.toISOString(); };
/* VICI ONLY — migration-051. ts() above depends on the RUNNING PROCESS's local timezone for any
   naive (no offset/Z) date-time string: ECMA-262 says a date-time string with no timezone is LOCAL
   time. That is exactly how B0351/B0355/B0356 landed every ViciDial call up to 2h off true SAST —
   the loading machine's clock, not Africa/Johannesburg, decided the instant. ViciDial's call_date is
   always naive SAST (UTC+2, no DST) — never new Date() it. tsSast() computes the UTC instant with a
   hard-coded offset so no machine's timezone can move a call again. Other sources keep ts(): unaudited
   here, and SF_OPEN_CASES/SF_CLOSED_CASES pass day-only strings through it, which ts() handles safely
   (no time component for the local-time rule to apply to). A string that already carries an explicit
   offset or 'Z' is unambiguous and falls back to ts(). */
const tsSast = (v) => {
  const t = s(v); if (!t) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) return ts(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(t);
  if (!m) return ts(v);
  const [, Y, Mo, D, h, mi, se] = m.map(Number);
  return new Date(Date.UTC(Y, Mo - 1, D, h, mi, se) - 2 * 3600 * 1000).toISOString();
};
/* An account number parsed as a float in some exports — "10299052.0" is the same account
   as "10299052", and the closed-case store held both for 17 445 cases. */
const idish = (v) => { const t = s(v); return t == null ? null : t.replace(/\.0+$/, ''); };
const hash = (parts) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const str = parts.join('');
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
};

/* ---- one entry per source: the table, its conflict target, and the row mapping ----
   The conflict target IS the identity rule in specs/source_keys.json and the table's own
   primary key. They are the same rule written for two audiences. */
export const MAP = {
  ATTENDANCE: {
    table: 'attendance', conflict: '(attendance_date, employee_code)',
    row: (r) => ({ attendance_date: day(r._d), employee_code: s(r.employee_code), employee_name: s(r.employee_name),
      title: s(r.title), employee_type: s(r.employee_type), department: s(r.department), reports_to: s(r.reports_to),
      status_code: s(r.status_code), status: s(r.status), batch_id: s(r._batch) }),
  },
  QA_EVALUATIONS: {
    table: 'qa_evaluations', conflict: '(record_id)',
    row: (r) => ({ record_id: s(r.record_id), date_of_call: day(r.call_date), submitted_at: ts(r.submitted_at),
      status: s(r.qa_status), sales_agent: s(r.sales_agent), sales_agent_cb: s(r.sales_agent_code),
      employee_code: s(r.sales_agent_code), team_leader: s(r.team_leader), tenure: null, campaign: s(r.campaign),
      qa_agent: s(r.qa_agent), score_pct: num(r.score_percent), call_duration_sec: int(r.call_duration_seconds),
      assessment_type: s(r.assessment_type), offense_number: s(r.offense_number),
      coaching_category: s(r.coaching_category), critical_fail: s(r.critical_fail_category),
      escalation: s(r.escalation_decision), batch_id: s(r._batch) }),
  },
  SF_OPEN_CASES: {
    table: 'sf_open_cases', conflict: '(snapshot_date, case_number)',
    row: (r) => ({ snapshot_date: day(r._d), case_number: idish(r.case_number), case_id: s(r.case_id),
      subject: s(r.subject), opened_at: ts(r.opened_at), age_hours: num(r.age_hours),
      account_number: idish(r.account_number), account_name: s(r.account_name), case_owner: s(r.case_owner),
      employee_code: null, owner_kind: null, status: s(r.status), record_type: s(r.record_type), batch_id: s(r._batch) }),
  },
  SF_CLOSED_CASES: {
    table: 'sf_closed_cases', conflict: '(case_number, closed_at)',
    row: (r) => ({ case_number: idish(r.case_number), closed_at: ts(r.closed_at) || (day(r.closed_at) ? day(r.closed_at) + 'T00:00:00Z' : null),
      closed_day: day(r.closed_at) || day(r._d), case_id: s(r.case_id), opened_at: ts(r.opened_at),
      disposition: s(r.disposition), status: s(r.status), age_hours: num(r.age_hours),
      account_number: idish(r.account_number), account_name: s(r.account_name), case_owner: s(r.case_owner),
      employee_code: null, batch_id: s(r._batch) }),
  },
  SF_INACTIVE: {
    table: 'sf_inactive', conflict: '(account_number, contract_number, deactivate_date)',
    row: (r) => ({ account_number: idish(r.account_number), contract_number: idish(r.contract_number),
      deactivate_date: day(r.deactivate_date), create_date: day(r.create_date), contract_status: s(r.contract_status),
      account_name: s(r.account_name), owner: s(r.owner), employee_code: s(r.owner_norm),
      charge_amount_ex: num(r.charge_amount), product_bundle: s(r.product_bundle),
      marketing_type: s(r.marketing_type), batch_id: s(r._batch) }),
  },
  VICI_CALL_REPORT: {
    table: 'vici_calls', conflict: '(call_date, agent_login, lead_id, status)',
    delta: { day: 'call_day', sum: 'length_in_sec' },   // only the days whose count or seconds moved (see changedDays)
    /* call_date is the FULL timestamp — see migration-016. Keyed on the day instead, 2 016
       real calls collapse and their billable seconds go with them. */
    row: (r) => ({ call_date: tsSast(r.call_dt), call_day: day(r._d) || day(r.call_dt), agent_login: s(r.user_raw) || '',
      lead_id: s(r.lead_id) || '', status: s(r.status) || '', full_name: s(r.full_name), user_group: s(r.user_group),
      campaign_id: s(r.campaign_id), length_in_sec: int(r.length_in_sec) || 0, status_name: s(r.status_name),
      employee_code: s(r.user_cb), batch_id: s(r._batch) }),
  },
  REFERRALS: {
    table: 'referrals', conflict: '(contact_id)',
    /* TWO SHAPES IN ONE STORE. The HighLevel pull gained a contact_id at some point: 2 037 of
       the 2 567 rows carry one, 530 do not. The table is keyed on it, so the older rows are
       reported as unusable rather than given a made-up key — an unkeyable row is a reporting
       problem to fix at the source, not a duplicate to invent an identity for. */
    row: (r) => ({ contact_id: s(r.contact_id), created_at: ts(r.ref_date) || (day(r.ref_date) ? day(r.ref_date) + 'T00:00:00Z' : null),
      referral_day: day(r.ref_date) || day(r._d), agent_name: s(r.agent), employee_code: s(r.employee_code),
      business_name: s(r.referred), tags: s(r.tags) }),
  },
  CALLX_CALL_RECORDS: {
    table: 'callx_calls', conflict: '(row_hash)',
    delta: { day: 'call_day', sum: 'billable_sec' },
    /* No natural id in the export; the hash is over the four fields that are unique across
       all 63 735 live rows — the same four specs/source_keys.json names. */
    row: (r) => ({ row_hash: hash([s(r.call_datetime), s(r.agent), s(r.destination_number), s(r.duration_seconds)]),
      call_at: ts(r.call_datetime), call_day: day(r._d) || day(r.call_datetime), agent_label: s(r.agent),
      employee_code: null, call_type: s(r.call_type), campaign: s(r.campaign), disposition: s(r.lead_disposition),
      duration_sec: int(r.duration_seconds), billable_sec: int(r.billable_seconds) || 0, branch: s(r.branch),
      batch_id: s(r._batch) }),
  },
};

const CHUNK = 500;
const swallow = () => null;

/** the conflict target's columns — the identity rule */
export const keyColsOf = (m) => m.conflict.replace(/[()]/g, '').split(',').map((x) => x.trim());

/**
 * Rows sharing one conflict key → one row, the LAST (what a sequential upsert would have kept). Postgres
 * refuses a single INSERT … ON CONFLICT DO UPDATE that touches one key twice, so this must hold for every
 * statement. Returns { rows, dropped }; the input is never changed.
 */
export function dedupeByKey(rows, keyCols) {
  const at = new Map();
  rows.forEach((o, i) => at.set(JSON.stringify(keyCols.map((k) => o[k])), i));
  if (at.size === rows.length) return { rows, dropped: 0 };
  const keep = new Set(at.values());
  return { rows: rows.filter((_, i) => keep.has(i)), dropped: rows.length - at.size };
}

/** mapped rows → the upsert statements, `chunk` rows each, never one key twice in a statement */
export function upsertStatements(m, mapped, chunk = CHUNK) {
  const keyCols = keyColsOf(m);
  const rows = dedupeByKey(mapped, keyCols).rows;
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const upd = cols.filter((c) => !keyCols.includes(c)).map((c) => `${c}=excluded.${c}`).join(', ');
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = []; const tuples = [];
    slice.forEach((o, n) => {
      tuples.push('(' + cols.map((_, ci) => '$' + (n * cols.length + ci + 1)).join(',') + ')');
      cols.forEach((c) => params.push(o[c]));
    });
    out.push({ rows: slice, params, text: `insert into ${m.table} (${cols.join(',')}) values ${tuples.join(',')}
         on conflict ${m.conflict} do ${upd ? 'update set ' + upd : 'nothing'}` });
  }
  return out;
}

/* ONLY THE DAYS THAT MOVED (2026-10-27). The step re-sent every row of every store on every tick: ViciDial alone is
   ~1.19M calls → 2 381 upserts of 500, each rewriting rows that had not changed, ~18 of the 20 minutes the tick allows.
   On 26 Oct, with the database busy (the Open Cases rewrite), one statement passed the 330 s client bound and two runs
   in a row timed out ("chunk 2137/2381: Query read timeout"). A source with `delta` is compared per day first — row
   count and the sum of one measure, blob against lake — and only a day whose signature differs is sent: a new day, a
   re-pulled fuller day (fullest-day-wins only ever grows a day), a corrected one at the same count. A day the lake holds
   MORE rows for than the blob is not sent: an upsert can only add rows, so sending it again cannot close that gap. It is
   NAMED instead (`surplus`). On 27 Oct that was every ViciDial day 26 Aug–15 Sep: each call stored twice exactly two hours
   apart — the batches were loaded before and after the migration-051 timezone fix, and call_date is in the key. Nothing
   reads those lake rows (VAS, Ops and the digests read the stores); clearing them is a separate, approved step. */
/** mapped rows + the lake's per-day {d, n, s} → { send: days to send, surplus: days the lake holds more rows for } */
export function changedDays(mapped, lakeRows, delta) {
  const blob = new Map();
  for (const o of mapped) { const d = o[delta.day]; if (!d) continue;
    const g = blob.get(d) || { n: 0, s: 0 }; g.n++; g.s += Number(o[delta.sum]) || 0; blob.set(d, g); }
  const lake = new Map((lakeRows || []).map((r) => [String(r.d), { n: Number(r.n), s: Number(r.s) }]));
  const send = new Set(), surplus = [];
  for (const [d, g] of blob) { const l = lake.get(d);
    if (!l || l.n < g.n || (l.n === g.n && l.s !== g.s)) send.add(d); else if (l.n > g.n) surplus.push(d); }
  return { send, surplus: surplus.sort() };
}

/** a pg error as one line: message [code] — detail (hint) */
const pgLine = (e) => String((e && e.message) || e) + (e && e.code ? ' [' + e.code + ']' : '')
  + (e && e.detail ? ' — ' + e.detail : '') + (e && e.hint ? ' (hint: ' + e.hint + ')' : '');

/* A CLIENT-SIDE TIMEOUT LEAVES THE CONNECTION BUSY (014 review T-R2). pg's query_timeout rejects the call, but the
   server is still running the statement on this connection, and every later query queues behind it — each source after
   it waited out its own ~330 s. So a timeout stops the run: the rest are reported "not attempted", and main() skips the
   audit and the refresh (they would queue too). A statement_timeout is different: the server cancelled it and the
   connection is free again, so the next source loads as before. */
const isClientTimeout = (e) => /Query read timeout/i.test(String((e && e.message) || e));

/**
 * Load every mapped source. readRows(src) → the blob's rows, or null when there is none (it says why).
 * A source that fails is logged FAILED and the next one still loads — unless it failed on a client-side query timeout:
 * then the remaining sources are FAILED "not attempted" and `aborted` says why.
 * Returns { grandIn, grandOut, failed, reasons, aborted }.
 */
export async function loadAll({ client, map = MAP, readRows, log = console.log, only = '', dry = false, chunk = CHUNK }) {
  let grandIn = 0, grandOut = 0, aborted = ''; const failed = [], reasons = {};
  const todo = Object.keys(map).filter((src) => !only || src === only);
  for (let i = 0; i < todo.length; i++) {
    const src = todo[i], m = map[src];
    try {
      const rows = await readRows(src);
      if (rows == null) continue;
      /* Rows the table cannot accept are REPORTED, never silently dropped: a not-null column
         with nothing to put in it is a mapping problem or a bad export, and both need naming. */
      const mapped = []; let unusable = 0;
      const keyCols = keyColsOf(m);
      for (const row of rows) {
        const o = m.row(row);
        if (keyCols.some((k) => o[k] == null || o[k] === '')) { unusable++; continue; }
        mapped.push(o);
      }
      const twins = dedupeByKey(mapped, keyCols).dropped;
      grandIn += rows.length;

      const before = (await client.query(`select count(*)::int n from ${m.table}`)).rows[0].n;
      let send = mapped, dayNote = '';
      if (m.delta && mapped.length) {
        const deduped = dedupeByKey(mapped, keyCols).rows;
        const days = [...new Set(deduped.map((o) => o[m.delta.day]).filter(Boolean))];
        const sig = (await client.query(`select ${m.delta.day}::text d, count(*)::int n, coalesce(sum(${m.delta.sum}),0)::bigint s
          from ${m.table} where ${m.delta.day} = any($1::date[]) group by 1`, [days])).rows;
        const { send: moved, surplus } = changedDays(deduped, sig, m.delta);
        send = deduped.filter((o) => !o[m.delta.day] || moved.has(o[m.delta.day]));
        dayNote = '   days sent ' + moved.size + ' of ' + days.length + (moved.size < days.length ? ' (the rest unchanged)' : '')
          + (surplus.length ? ' · the lake holds MORE rows than the store for ' + surplus.length + ' day(s) ' + surplus[0]
            + (surplus.length > 1 ? '…' + surplus[surplus.length - 1] : '') + ' — twins an upsert cannot remove (not re-sent)' : '');
      }
      if (!dry && send.length) {
        const stm = upsertStatements(m, send, chunk);
        for (let k = 0; k < stm.length; k++) {
          try { await client.query(stm[k].text, stm[k].params); }
          catch (e) { throw Object.assign(new Error('chunk ' + (k + 1) + '/' + stm.length + ': ' + ((e && e.message) || e)), { code: e && e.code, detail: e && e.detail, hint: e && e.hint }); }
        }
      }
      const after = (await client.query(`select count(*)::int n from ${m.table}`)).rows[0].n;
      grandOut += after - before;

      log('  ' + src.padEnd(22) + String(rows.length).padStart(7) + ' blob rows → '
        + String(mapped.length).padStart(7) + ' mapped   table ' + String(before).padStart(6) + ' → ' + String(after).padStart(6)
        + '   new ' + String(after - before).padStart(6)
        + (unusable ? '   unusable (no key): ' + unusable : '')
        + (twins ? '   twin rows collapsed (same key, last kept): ' + twins : '') + dayNote);
    } catch (e) {
      failed.push(src); reasons[src] = pgLine(e);
      log('  ' + src.padEnd(22) + 'FAILED — ' + reasons[src]);
      if (isClientTimeout(e)) {
        aborted = src + ' — ' + reasons[src];
        for (const rest of todo.slice(i + 1)) {
          failed.push(rest); reasons[rest] = 'not attempted — the connection is still busy with ' + src + "'s timed-out query";
          log('  ' + rest.padEnd(22) + 'FAILED — ' + reasons[rest]);
        }
        break;
      }
    }
  }
  return { grandIn, grandOut, failed, reasons, aborted };
}

/* AFTER THE LOAD — data first, report second (2026-10-09). Every source had loaded ("new 0") and the step still said
   FAILED on every run since early 9 Oct: `select * from lake_duplicates` — a REPORT, over a 10.2M-row sf_open_cases —
   passed the 5-minute statement timeout, and because agent_day's refresh came after it, a run that DID add rows would
   have left agent_day behind. So: the refresh runs first; the report runs only when something new landed (otherwise
   nothing it counts can have changed); and a report that fails is a warning in the log, never the step's verdict.
   After a client-side query timeout neither runs — the connection may still be busy (014 review T-R2). */
export async function afterLoad({ client, grandOut, aborted, dry, log = console.log }) {
  if (aborted) { log('\nSTOPPED after a query timeout (' + aborted + ') — the lake audit and the agent_day refresh are skipped.'); return { failed: false, auditNote: 'skipped after a query timeout' }; }
  if (!grandOut) return { failed: false, auditNote: 'skipped — nothing new loaded' };
  /* agent_day is built from these tables and was only ever refreshed by the rake after ITS loads —
     so when this tool was the one adding days (Vici, closed cases) the view sat behind (14–21 Sep 2026). */
  if (!dry) { log('refreshing agent_day…'); await client.query('refresh materialized view concurrently agent_day'); }
  try {
    const audit = await client.query('select * from lake_duplicates order by source');   // the contract, straight from the database
    log('\n  ' + 'source'.padEnd(20) + 'rows'.padStart(9) + 'distinct'.padStart(11) + '   one row, one fact?');
    for (const r of audit.rows)
      log('  ' + r.source.padEnd(20) + String(r.rows).padStart(9) + String(r.distinct_keys).padStart(11)
        + '   ' + (String(r.rows) === String(r.distinct_keys) ? 'yes' : 'NO — ' + (r.rows - r.distinct_keys) + ' extra'));
    return { failed: false, auditNote: 'ran' };
  } catch (e) {
    const note = 'duplicate report skipped (warning, not a failure): ' + pgLine(e);
    log('\n' + note);
    return { failed: false, auditNote: note };
  }
}

async function main() {
  const env = {};
  for (const l of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2];
  }
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const DRY = process.argv.includes('--dry');
  const sFlag = process.argv.indexOf('--source');
  const ONLY = sFlag > 0 && process.argv[sFlag + 1] && !process.argv[sFlag + 1].startsWith('--') ? process.argv[sFlag + 1] : '';

  /* query_timeout is the client-side bound (a dead socket never answers a statement_timeout);
     connectionTimeoutMillis bounds the connect itself */
  const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 300000,
    query_timeout: 330000, connectionTimeoutMillis: 60000, keepAlive: true });
  /* WITHOUT THIS LISTENER a dropped connection is an "Unhandled 'error' event" crash — the run dies with
     no source named. With it, the in-flight query rejects and its source is reported FAILED. */
  client.on('error', (e) => { console.error('FAILED: the database connection dropped — ' + pgLine(e)); process.exitCode = 1; });
  await client.connect();
  /* the session pooler drops the client's statement_timeout option (2026-10-26: the role's 2-minute default applied
     instead) — set it on the session, where the pooler keeps it */
  await client.query(`set statement_timeout to '300s'`);
  try {
    console.log((DRY ? 'DRY RUN — nothing will be written' : 'LOADING') + '\n');
    const readRows = async (src) => {
      const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/cb-facts-${src}`, { headers: H });
      if (!r.ok) { console.log('  ' + src.padEnd(22) + 'no blob (' + r.status + ')'); return null; }
      try { return JSON.parse(storeText(Buffer.from(await r.arrayBuffer()))); }   // plain or kept-compressed (spec 013)
      catch { console.log('  ' + src.padEnd(22) + 'not JSON'); return null; }
    };
    const { grandIn, grandOut, failed, reasons, aborted } = await loadAll({ client, readRows, dry: DRY, only: ONLY });

    console.log('\n' + (DRY ? 'dry run. ' : '') + grandIn.toLocaleString('en-ZA') + ' blob rows considered, '
      + grandOut.toLocaleString('en-ZA') + ' new row(s) in the lake.');
    await afterLoad({ client, grandOut, aborted, dry: DRY });
    if (failed.length) { console.error('FAILED: ' + failed.map((s) => s + ' — ' + reasons[s]).join(' · ')); process.exitCode = 1; }
  } finally { await client.end().catch(swallow); }
}

/* main only as the entry point — verify-tick-014 imports the loader without connecting to anything */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch((e) => { console.error('FAILED: ' + pgLine(e)); process.exitCode = 1; });
}
