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
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../nicks_code/diagnostics/node_modules/pg/lib/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2];
}
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const DRY = process.argv.includes('--dry');
const sFlag = process.argv.indexOf('--source');
const ONLY = sFlag > 0 && process.argv[sFlag + 1] && !process.argv[sFlag + 1].startsWith('--') ? process.argv[sFlag + 1] : '';

/* ---- helpers: the blobs are parsed spreadsheets, so every value arrives as text ---- */
const s = (v) => { const t = v == null ? '' : String(v).trim(); return t === '' ? null : t; };
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const day = (v) => { const t = s(v); if (!t) return null; const m = /^(\d{4}-\d{2}-\d{2})/.exec(t); return m ? m[1] : null; };
const ts = (v) => { const t = s(v); if (!t) return null; const d = new Date(t.replace(' ', 'T')); return isNaN(d) ? null : d.toISOString(); };
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
const MAP = {
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
    /* call_date is the FULL timestamp — see migration-016. Keyed on the day instead, 2 016
       real calls collapse and their billable seconds go with them. */
    row: (r) => ({ call_date: ts(r.call_dt), call_day: day(r._d) || day(r.call_dt), agent_login: s(r.user_raw) || '',
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
    /* No natural id in the export; the hash is over the four fields that are unique across
       all 63 735 live rows — the same four specs/source_keys.json names. */
    row: (r) => ({ row_hash: hash([s(r.call_datetime), s(r.agent), s(r.destination_number), s(r.duration_seconds)]),
      call_at: ts(r.call_datetime), call_day: day(r._d) || day(r.call_datetime), agent_label: s(r.agent),
      employee_code: null, call_type: s(r.call_type), campaign: s(r.campaign), disposition: s(r.lead_disposition),
      duration_sec: int(r.duration_seconds), billable_sec: int(r.billable_seconds) || 0, branch: s(r.branch),
      batch_id: s(r._batch) }),
  },
};

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 300000 });
await client.connect();
console.log((DRY ? 'DRY RUN — nothing will be written' : 'LOADING') + '\n');

const CHUNK = 500;
let grandIn = 0, grandOut = 0;

for (const [src, m] of Object.entries(MAP)) {
  if (ONLY && src !== ONLY) continue;
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/cb-facts-${src}`, { headers: H });
  if (!r.ok) { console.log('  ' + src.padEnd(22) + 'no blob (' + r.status + ')'); continue; }
  let rows; try { rows = JSON.parse(await r.text()); } catch { console.log('  ' + src.padEnd(22) + 'not JSON'); continue; }

  /* Rows the table cannot accept are REPORTED, never silently dropped: a not-null column
     with nothing to put in it is a mapping problem or a bad export, and both need naming. */
  const mapped = []; let unusable = 0;
  const keyCols = m.conflict.replace(/[()]/g, '').split(',').map((x) => x.trim());
  for (const row of rows) {
    const o = m.row(row);
    if (keyCols.some((k) => o[k] == null || o[k] === '')) { unusable++; continue; }
    mapped.push(o);
  }
  grandIn += rows.length;

  const before = (await client.query(`select count(*)::int n from ${m.table}`)).rows[0].n;
  if (!DRY && mapped.length) {
    const cols = Object.keys(mapped[0]);
    const upd = cols.filter((c) => !keyCols.includes(c)).map((c) => `${c}=excluded.${c}`).join(', ');
    for (let i = 0; i < mapped.length; i += CHUNK) {
      const slice = mapped.slice(i, i + CHUNK);
      const params = []; const tuples = [];
      slice.forEach((o, n) => {
        tuples.push('(' + cols.map((_, ci) => '$' + (n * cols.length + ci + 1)).join(',') + ')');
        cols.forEach((c) => params.push(o[c]));
      });
      await client.query(
        `insert into ${m.table} (${cols.join(',')}) values ${tuples.join(',')}
         on conflict ${m.conflict} do update set ${upd}`, params);
    }
  }
  const after = (await client.query(`select count(*)::int n from ${m.table}`)).rows[0].n;
  grandOut += after - before;

  console.log('  ' + src.padEnd(22) + String(rows.length).padStart(7) + ' blob rows → '
    + String(mapped.length).padStart(7) + ' mapped   table ' + String(before).padStart(6) + ' → ' + String(after).padStart(6)
    + '   new ' + String(after - before).padStart(6)
    + (unusable ? '   unusable (no key): ' + unusable : ''));
}

/* The contract, straight from the database. */
const audit = await client.query('select * from lake_duplicates order by source');
console.log('\n  ' + 'source'.padEnd(20) + 'rows'.padStart(9) + 'distinct'.padStart(11) + '   one row, one fact?');
for (const r of audit.rows)
  console.log('  ' + r.source.padEnd(20) + String(r.rows).padStart(9) + String(r.distinct_keys).padStart(11)
    + '   ' + (String(r.rows) === String(r.distinct_keys) ? 'yes' : 'NO — ' + (r.rows - r.distinct_keys) + ' extra'));

console.log('\n' + (DRY ? 'dry run. ' : '') + grandIn.toLocaleString('en-ZA') + ' blob rows considered, '
  + grandOut.toLocaleString('en-ZA') + ' new row(s) in the lake.');
await client.end();
