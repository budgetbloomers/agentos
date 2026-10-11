/* usage-028-harness.mjs — the test bench for Spec Kit 028 (the usage report). TEST CODE ONLY.
 *
 * The migration's trigger, mapping function and views are plpgsql + Postgres aggregates, so a stub that only records
 * PostgREST calls could prove the Worker CALLED the table, never what the table DOES. PGlite (@electric-sql/pglite, a
 * devDependency of nicks_code/diagnostics since spec 017) is PostgreSQL 18 compiled to WASM: it runs
 * supabase/migration-061-usage-events.sql VERBATIM, in-process, with no server, no network and no credentials. Nothing
 * in this file can reach the live database — there is no connection string anywhere.
 *
 *   newDb()        PGlite with the tables 061 builds on (app_users + auth_log from migration-003, rules + ask_log from
 *                  schema.sql), Supabase's three API roles, and optionally migration-061 itself
 *   applyMigration the statements of one migration file, one by one (a failure names its statement)
 *   restFetch(db)  a PostgREST emulator over that database for the shapes the Worker and tools/usage-backfill.mjs use:
 *                  GET table?select&filters&order&offset&limit · POST table[?on_conflict] with Prefer resolution/return ·
 *                  POST rpc/<fn> — so the REAL modules run unchanged against the real schema
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const MIGRATION = 'migration-061-usage-events.sql';
const SUPA = path.join(ROOT, 'supabase');

/* ---- a SQL file → its top-level statements (dollar quotes, strings and comments respected; spec 017's splitter) ---- */
export function splitSql(text) {
  const out = []; let cur = ''; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i], c2 = text.slice(i, i + 2);
    if (c2 === '--') { const e = text.indexOf('\n', i); const j = e < 0 ? n : e; cur += text.slice(i, j); i = j; continue; }
    if (c2 === '/*') { const e = text.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; cur += text.slice(i, j); i = j; continue; }
    if (c === "'") { let j = i + 1; while (j < n) { if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; } if (text[j] === "'") break; j++; } cur += text.slice(i, j + 1); i = j + 1; continue; }
    if (c === '"') { const e = text.indexOf('"', i + 1); const j = e < 0 ? n : e + 1; cur += text.slice(i, j); i = j; continue; }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) { const tag = m[0]; const e = text.indexOf(tag, i + tag.length); const j = e < 0 ? n : e + tag.length; cur += text.slice(i, j); i = j; continue; }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => strip(s));
}
export const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
export const readSql = (name) => (fs.existsSync(path.join(SUPA, name)) ? fs.readFileSync(path.join(SUPA, name), 'utf8') : '');

/* Supabase's API roles. service_role has BYPASSRLS there, which is why the Worker reads RLS-on tables at all. */
const ROLES = `
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
`;
export function baselineSql() {
  const keep = (file, re) => splitSql(readSql(file)).filter((s) => re.test(strip(s)));
  return [
    ...keep('migration-003-auth.sql', /^create table if not exists (app_users|auth_log)\b|^alter table (app_users|auth_log)\s+enable row level security/i),
    ...keep('migration-011-agent-portal.sql', /^alter table app_users add column if not exists team\b/i),
    ...keep('schema.sql', /^create table if not exists (rules|ask_log)\b/i),
  ];
}

export async function applyMigration(db, file) {
  const text = readSql(file);
  if (!text) throw new Error(file + ' does not exist');
  for (const s of splitSql(text)) {
    try { await db.exec(s); }
    catch (e) { throw new Error(file + ' failed at: ' + strip(s).slice(0, 140).replace(/\s+/g, ' ') + ' — ' + (e.message || e)); }
  }
}

export async function newDb({ migrate = true, before } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(ROLES);
  for (const s of baselineSql()) await db.exec(s);
  if (before) await before(db);
  if (migrate) await applyMigration(db, MIGRATION);
  return db;
}

/* ---- the PostgREST emulator ---- */
const IDENT = /^[a-z_][a-z0-9_]*$/;
const id = (s) => { if (!IDENT.test(s)) throw new Error('bad identifier ' + s); return '"' + s + '"'; };
const RESERVED = new Set(['select', 'order', 'offset', 'limit', 'on_conflict']);
const J = (b, status = 200) => new Response(b === undefined ? '' : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const val = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

function where(params, args) {
  const parts = [];
  for (const [k, raw] of params) {
    if (RESERVED.has(k)) continue;
    const col = id(k); const dot = raw.indexOf('.'); const op = raw.slice(0, dot); const v = raw.slice(dot + 1);
    if (op === 'eq') { args.push(v); parts.push(`${col} = $${args.length}`); }
    else if (op === 'like') { args.push(v.replace(/\*/g, '%')); parts.push(`${col}::text like $${args.length}`); }
    else if (op === 'gte' || op === 'gt' || op === 'lt' || op === 'lte') { args.push(v); parts.push(`${col} ${{ gte: '>=', gt: '>', lt: '<', lte: '<=' }[op]} $${args.length}`); }
    else if (op === 'in') { args.push(v.replace(/^\(|\)$/g, '').split(',')); parts.push(`${col}::text = any($${args.length})`); }
    else if (op === 'is') parts.push(`${col} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : 'false'}`);
    else throw new Error('emulator: unsupported filter ' + k + '=' + raw);
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}

/** fetch-shaped handler for https://<any>/rest/v1/… backed by `db`. `log` (optional) receives every call. */
export function restFetch(db, log) {
  return async (input, opts = {}) => {
    const u = new URL(String(input)); const method = String(opts.method || 'GET').toUpperCase();
    const h = new Headers(opts.headers || {}); const prefer = h.get('prefer') || '';
    const p = u.pathname.replace(/^\/rest\/v1\//, '');
    if (log) log.push({ method, path: p, query: u.search });
    try {
      if (p.startsWith('rpc/')) {
        const args = opts.body ? JSON.parse(opts.body) : {}; const names = Object.keys(args);
        const r = await db.query(`select ${id(p.slice(4))}(${names.map((n, i) => `${id(n)} => $${i + 1}`).join(', ')}) as r`, names.map((n) => val(args[n])));
        return J(r.rows[0].r);
      }
      const table = id(p);
      if (method === 'GET') {
        const args = []; const sel = u.searchParams.get('select');
        const cols = sel ? sel.split(',').map((c) => id(c.trim())).join(', ') : '*';
        let sql = `select ${cols} from ${table}` + where(u.searchParams, args);
        const ord = u.searchParams.get('order');
        if (ord) sql += ' order by ' + ord.split(',').map((o) => { const [c, d] = o.split('.'); return id(c) + (d === 'desc' ? ' desc' : ' asc'); }).join(', ');
        if (u.searchParams.get('limit')) sql += ' limit ' + parseInt(u.searchParams.get('limit'), 10);
        if (u.searchParams.get('offset')) sql += ' offset ' + parseInt(u.searchParams.get('offset'), 10);
        return J((await db.query(sql, args)).rows);
      }
      if (method === 'POST') {
        const rows = JSON.parse(opts.body || '[]'); const list = Array.isArray(rows) ? rows : [rows];
        if (!list.length) return J([], 201);
        const keys = Object.keys(list[0]); const args = [];
        const values = list.map((r) => '(' + keys.map((k) => { args.push(val(r[k] === undefined ? null : r[k])); return '$' + args.length; }).join(', ') + ')').join(', ');
        let sql = `insert into ${table} (${keys.map(id).join(', ')}) values ${values}`;
        const oc = u.searchParams.get('on_conflict');
        if (/resolution=ignore-duplicates/.test(prefer)) sql += oc ? ` on conflict (${id(oc)}) do nothing` : ' on conflict do nothing';
        else if (/resolution=merge-duplicates/.test(prefer)) sql += ` on conflict (${id(oc || keys[0])}) do update set ` + keys.map((k) => `${id(k)} = excluded.${id(k)}`).join(', ');
        const rep = /return=representation/.test(prefer);
        if (rep) { const sel = u.searchParams.get('select'); sql += ' returning ' + (sel ? sel.split(',').map((c) => id(c.trim())).join(', ') : '*'); }
        const r = await db.query(sql, args);
        return rep ? J(r.rows, 201) : J(undefined, 201);
      }
      return J({ message: 'emulator: unsupported ' + method }, 405);
    } catch (e) {
      const m = String(e.message || e);
      if (/does not exist/.test(m) && /relation/.test(m)) return J({ code: 'PGRST205', message: m }, 404);
      return J({ code: e.code || 'XX000', message: m }, /violates/.test(m) ? 409 : 400);
    }
  };
}
