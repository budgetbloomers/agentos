// audit-ops-vs-pulse.mjs — READ-ONLY: Ops facts vs PULSE per day (sales, attendance, QA, cancellations, referrals).
// Needs reports/ops-audit-<date>/vas-state-sept-slice.json from a prior audit-ops-stores run's helper; see 2026-09-14 audit notes.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const rest = async (q) => (await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H })).json();
const kv = async (key) => { const row = (await rest(`rules?key=eq.${encodeURIComponent('kv:' + key)}&select=value`))[0]; const v = row.value || {}; return JSON.parse(v.data != null ? String(v.data) : await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: H })).text()); };
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'ops-audit-2026-09-14', 'vas-state-sept-slice.json'), 'utf8'));
const rows = async (src) => { const j = await kv('cb-facts-' + src); return Array.isArray(j) ? j : (j.rows || []); };
const days = []; for (let d = new Date('2026-08-26'); d <= new Date('2026-09-13'); d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));
const pad = (s, n) => String(s).padStart(n);
/* SALES: PULSE sales[d][agent].n (net cases) vs Ops BI_ACTIVE_CASES distinct account per _d */
const bi = await rows('BI_ACTIVE_CASES'); console.log('BI keys', Object.keys(bi[0]).join(','));
const biDay = {}; for (const r of bi) { const d = r._d; if (!d) continue; (biDay[d] = biDay[d] || { acc: new Set(), cases: new Set(), rows: 0 }); biDay[d].acc.add(r.account_number); biDay[d].cases.add(r.case_number || r.case_no || r.account_number); biDay[d].rows++; }
console.log('\nSALES         PULSE n   PULSE x(exVAT)   Ops rows  Ops distinct acc  Ops distinct case');
for (const d of days) { const p = P.sales[d] || {}; let n = 0, x = 0; for (const a of Object.values(p)) { n += a.n || 0; x += a.x || 0; } const o = biDay[d]; console.log(d, pad(n, 8), pad(x.toFixed(0), 14), pad(o ? o.rows : '—', 10), pad(o ? o.acc.size : '—', 16), pad(o ? o.cases.size : '—', 17)); }
/* ATTENDANCE: PULSE att[d] statuses vs Ops ATTENDANCE rows per _d */
const at = await rows('ATTENDANCE'); console.log('\nATT keys', Object.keys(at[0]).join(','));
const atDay = {}; for (const r of at) { const d = r._d; if (!d) continue; atDay[d] = atDay[d] || { n: 0, present: 0 }; atDay[d].n++; if (!r.absence_flag) atDay[d].present++; }
console.log('\nATTENDANCE    PULSE agents  PULSE present  Ops rows  Ops present');
for (const d of days) { const p = P.att[d] || {}; const n = Object.keys(p).length; const pr = Object.values(p).filter((s) => s === 'P').length; const o = atDay[d]; console.log(d, pad(n, 12), pad(pr, 14), pad(o ? o.n : '—', 9), pad(o ? o.present : '—', 12)); }
/* QA: PULSE evals[d] count vs Ops QA rows per _d */
const qa = await rows('QA_EVALUATIONS'); const qaDay = {}; for (const r of qa) if (r._d) qaDay[r._d] = (qaDay[r._d] || 0) + 1;
console.log('\nQA            PULSE evals   Ops rows');
for (const d of days) { const p = P.evals[d] || {}; let n = 0; for (const l of Object.values(p)) n += l.length; console.log(d, pad(n, 11), pad(qaDay[d] || '—', 10)); }
/* CANCELLATIONS: PULSE cancRows dd (deactivation day) vs Ops SF_INACTIVE rows per _d */
const inact = await rows('SF_INACTIVE'); const inDay = {}; for (const r of inact) if (r._d) inDay[r._d] = (inDay[r._d] || 0) + 1;
console.log('\nCANC          PULSE cancRows(dd)  Ops SF_INACTIVE rows');
const cr = P.canc; // PULSE canc[d] = owner→count
for (const d of days) { const p = P.canc[d] || {}; let n = 0; for (const v of Object.values(p)) n += v; console.log(d, pad(n, 16), pad(inDay[d] || '—', 20)); }
/* REFERRALS: PULSE refs.by (per CB, month) vs Ops REFERRALS rows Sept */
const rf = await rows('REFERRALS'); const sept = rf.filter((r) => (r._d || '') >= '2026-09-01'); console.log('\nREFERRALS Sept: Ops rows', sept.length, '· PULSE refs.by total', Object.values(P.refs.by || {}).reduce((a, b) => a + b, 0), '· PULSE refs keys', Object.keys(P.refs).join(','));
