#!/usr/bin/env node
/* ============================================================================
   EXEC REPORT — pull the Performance section from the live engines.

       node tools/exec-pull.mjs reports/exec-weekly/2026-W38                # live
       node tools/exec-pull.mjs reports/exec-weekly/2026-W38 --digest f.json # a saved digest
       node tools/exec-pull.mjs reports/exec-weekly/2026-W38 --dry           # print, write nothing

   WHY THIS EXISTS. Nick, 2026-09-17: "we should have all actual data for that
   tab" — and he is right. Nothing on the Performance tab is missing from the
   business; it was missing from the REPORT, because the first issue was typed
   from committed evidence (the 14 Sep Ops audit) instead of asked of the engine.
   This closes that gap: it reads the digest the Ops engine already publishes and
   writes the section's readings into the week's data.json with basis 'actual'.

   WHERE THE NUMBERS COME FROM. `kv:nba-digest` is built by the deployed Ops
   engine itself (the `__nbaPush` block), republished every fifteen minutes by
   the runner, and stored gzipped at `raw/kv/nba-digest`. It carries one row per
   agent — cb, name, tl, campaign, group/tenure, `stats{sales, gwp, ta, gwpSale,
   qa, qaN, conv, talkDay, att, present, scheduled, target, canc, cancPct}`,
   `composite{raw, adj}`, `r2a{tier}` and `nba{code, lvl, label}` — plus the
   period, the working days and the thresholds the engine ran under.

   So this file does NOT compute a performance figure. It aggregates rows the
   engine already computed (CLAUDE.md non-negotiable 1) and it reads the TARGETS
   out of the digest's own `thresholds` block rather than carrying a second copy
   of any rule (non-negotiable 12 — a rule must be read, not copied).

   WHAT IT CANNOT REACH, AND WHY THAT IS SAID OUT LOUD. Insurance opt-in is a
   PULSE driver (`opt` in perfScore) and does not travel in the Ops digest, so it
   is left exactly as the week's file already had it. Better a badged placeholder
   than a number this tool invented.

   CREDENTIALS. Live mode reads `supabase.env` at the repo root — the same file
   reach-report.mjs and the rest of tools/ use, and the same one that is
   deliberately not in the repo. Without it, pass a digest file with --digest
   (the runner can save one) or this exits saying so, rather than half-writing.
   ============================================================================ */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import zlib from 'node:zlib';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const DIR = argv.find(a => !a.startsWith('--'));
const flag = n => { const i = argv.indexOf(n); return i < 0 ? null : (argv[i + 1] || ''); };
const DRY = argv.includes('--dry');
const WINDOW = flag('--window');   // YYYY-MM-DD..YYYY-MM-DD

/* ------------------------------------------------------------ the digest ---- */

async function loadDigest() {
  const file = flag('--digest');
  if (file) return JSON.parse(readFileSync(file, 'utf8'));

  const envPath = join(ROOT, 'supabase.env');
  if (!existsSync(envPath)) {
    console.error(
      'No supabase.env at the repo root and no --digest file given.\n' +
      'This runs where the credentials live (the runner, or a checkout with supabase.env).\n' +
      'To work from a saved digest instead:  node tools/exec-pull.mjs <dir> --digest nba-digest.json');
    process.exit(2);
  }
  const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/nba-digest', { headers: H });
  if (!r.ok) { console.error(`digest fetch failed: ${r.status} ${r.statusText}`); process.exit(3); }
  let buf = Buffer.from(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString());
}

/* --------------------------------------------------------- the aggregation -- */

const sum = (rows, f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
const has = (rows, f) => rows.filter(r => f(r) !== null && f(r) !== undefined && !Number.isNaN(Number(f(r))));
const r1 = n => Math.round(n * 10) / 10;

/** Every Performance reading, aggregated from rows the engine computed. */
export function performanceFrom(digest, opts = {}) {
  const A = digest.agents || [];
  const T = digest.thresholds || {};
  const vat = opts.vat ?? 1.15;
  const gwpPerSale = opts.gwpPerSale ?? 89;           // the engine's own GWP target rate
  const period = `${digest.period?.from} → ${digest.period?.to}`;
  const src = (what) => `NBA digest (kv:nba-digest, built by the deployed Ops engine), ${A.length} agents, ${period}. ${what}`;
  const out = {};

  /* Sales and the money. The digest's gwp is the engine's inclusive figure per
     agent; the target is the engine's own: Σ per-agent sales target × R89 × VAT. */
  const sales = sum(A, a => a.stats?.sales);
  const salesTarget = sum(A, a => a.stats?.target);
  const gwp = sum(A, a => a.stats?.gwp);
  if (salesTarget > 0) {
    out.gwpVsTarget = {
      value: Math.round(gwp), target: Math.round(salesTarget * gwpPerSale * vat), basis: 'actual',
      source: src(`Σ agent GWP (incl VAT) against Σ sales target × R${gwpPerSale} × ${vat} — the engine's own GWP target.`)
    };
    out.salesVsTarget = {
      value: sales, target: Math.round(salesTarget), basis: 'actual',
      source: src('Σ sales (distinct cases, net of cancellation) against Σ per-agent tenure target.')
    };
  }

  /* Sales per day against the tenure target, both derived the way the engine
     does: sales ÷ shifts actually worked, target ÷ the same shifts. */
  const present = sum(A, a => a.stats?.present);
  if (present > 0 && salesTarget > 0) {
    out.spdVsTarget = {
      value: r1(sales / present), target: r1(salesTarget / present), basis: 'actual',
      source: src('Σ sales ÷ Σ shifts worked, against the same tenure targets over the same shifts. Saturdays carry their sales but are never a shift.')
    };
  }

  /* Conversion, QA and attendance are per-agent rates: weight each agent by the
     work behind it rather than taking a mean of means, except QA, which the rule
     book explicitly totals AS a mean of agent means. */
  const conv = has(A, a => a.stats?.conv);
  if (conv.length) {
    out.conversion = {
      value: r1(sum(conv, a => a.stats.conv) / conv.length), target: T.convTarget ?? undefined, basis: 'actual',
      source: src(`Mean agent conversion (sales ÷ unique leads) over ${conv.length} agents carrying lead data, against the engine's convTarget.`)
    };
  }
  const qa = has(A, a => a.stats?.qa);
  if (qa.length) {
    out.qaMean = {
      value: r1(sum(qa, a => a.stats.qa) / qa.length), target: T.qaTarget ?? undefined, basis: 'actual',
      source: src(`Mean of agent means over ${qa.length} evaluated agents — the rule book's own total. Date of Call only; 0% scores kept.`)
    };
  }

  /* Cancellation rate. Present only once the digest carries it (added 2026-09-17);
     an older digest simply leaves the factor as the week's file had it. */
  const canc = has(A, a => a.stats?.canc);
  if (canc.length && sales > 0) {
    const c = sum(canc, a => a.stats.canc);
    out.cancelRate = {
      value: r1(c / (sales + c) * 100), target: undefined, basis: 'actual',
      source: src(`${c} cancellations against ${sales + c} gross sales. Counted per account, as sales are.`)
    };
  }

  /* The share of the rated floor on track. The digest publishes each agent's
     composite; the band comes from the composite rule book, not from here. */
  const rated = has(A, a => a.composite?.adj);
  if (rated.length) {
    const onTrack = rated.filter(a => a.composite.adj >= (opts.onTrackAt ?? 70)).length;
    out.ratedOnTrack = {
      value: r1(onTrack / rated.length * 100), target: undefined, basis: 'actual',
      source: src(`${onTrack} of ${rated.length} rated agents at ${opts.onTrackAt ?? 70}+ on the composite (five confirmed sessions).`)
    };
  }
  return out;
}

/** The campaign and team-leader tables, and the two agent lists. */
export function breakoutsFrom(digest, rules) {
  const A = digest.agents || [];
  const hue = rules.viz?.campaigns || {};
  const money = n => 'R' + Math.round(n).toLocaleString('en-GB');
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—');
  const group = (key) => {
    const m = new Map();
    A.forEach(a => { const k = key(a) || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(a); });
    return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
  };

  const camp = group(a => a.campaign).map(([k, rows]) => {
    const s = sum(rows, a => a.stats?.sales), t = sum(rows, a => a.stats?.target), g = sum(rows, a => a.stats?.gwp);
    return { key: k, hue: hue[k] || rules.viz?.campaignFallback,
      cells: [k, String(rows.length), s.toLocaleString('en-GB'), money(g), pct(s, t), s ? money(g / s) : '—'],
      bar: t > 0 ? Math.round(s / t * 100) : null };
  });

  const tl = group(a => a.tl).map(([k, rows]) => {
    const s = sum(rows, a => a.stats?.sales), t = sum(rows, a => a.stats?.target);
    const att = has(rows, a => a.stats?.att), qa = has(rows, a => a.stats?.qa);
    return { key: k,
      cells: [k, String(rows.length), pct(s, t),
        att.length ? r1(sum(att, a => a.stats.att) / att.length) + '%' : '—',
        qa.length ? r1(sum(qa, a => a.stats.qa) / qa.length) + '%' : '—'],
      bar: t > 0 ? Math.round(s / t * 100) : null };
  });

  const byComposite = has(A, a => a.composite?.adj).sort((x, y) => y.composite.adj - x.composite.adj);
  const top = byComposite.slice(0, 5).map(a => ({
    cells: [a.cb, a.campaign || '—', a.tenure || a.group || '—', String(a.stats?.sales ?? '—'),
      a.stats?.gwp == null ? '—' : money(a.stats.gwp), String(Math.round(a.composite.adj))],
    bar: Math.round(a.composite.adj)
  }));
  const watch = byComposite.slice(-5).reverse().map(a => ({
    cells: [a.cb, a.campaign || '—', a.tenure || a.group || '—',
      a.nba ? `${a.nba.code} ${a.nba.label || ''}`.trim() : '—',
      a.r2a?.tier && a.r2a.tier !== 'Tier 0' ? a.r2a.tier : '—', String(Math.round(a.composite.adj))],
    bar: Math.round(a.composite.adj)
  }));
  return { camp, tl, top, watch };
}

/* ------------------------------------------------------------------- run ---- */

/* Only when run as a command. The coverage tool imports performanceFrom to prove
   which factors the report can actually read, and importing must not go looking
   for credentials. */
const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (!invoked) { /* imported as a library */ } else { await main(); }

/* THE WINDOW MUST BE THE WINDOW (2026-10-27). kv:nba-digest is published for a
   SINGLE CALENDAR MONTH — periodWindow() in the Ops engine, and nba-republish
   refuses any payload whose window is not one reporting month. Pull it into a
   report labelled 25 Sep – 26 Oct and every figure on the page becomes a lie
   about its own period: right arithmetic, wrong fortnight, and nothing on the
   face of it would say so. So the window is checked against the digest's own,
   and a mismatch REFUSES rather than writes. A cross-month range needs a
   date-ranged read of the lake (bi_active_cases on contract_create_date,
   attendance, qa_evaluations, vici_calls, sf_inactive), which is a different
   source, not a different flag. */
function checkWindow(digest, want) {
  const have = `${digest.period?.from}..${digest.period?.to}`;
  if (!want || want === have) return;
  console.error(
    `\n  REFUSING — the digest does not cover the window this report is for.\n` +
    `    report wants : ${want}\n` +
    `    digest covers: ${have}\n\n` +
    `  kv:nba-digest is published one calendar month at a time, so a cross-month window\n` +
    `  cannot come from it. Fill this period from a date-ranged read of the lake, or set\n` +
    `  the report's window to the month the digest actually covers.\n`);
  process.exit(4);
}

async function main() {
if (!DIR) {
  console.error('usage: node tools/exec-pull.mjs <report-folder> [--digest <file>] [--dry]');
  process.exit(1);
}
const digest = await loadDigest();
/* The report's own window wins: --window overrides, otherwise data.json states it. */
const wantWin = WINDOW || (() => {
  try {
    const dj = JSON.parse(readFileSync(join(resolve(DIR), 'data.json'), 'utf8'));
    return dj.meta?.window ? `${dj.meta.window.from}..${dj.meta.window.to}` : null;
  } catch { return null; }
})();
checkWindow(digest, wantWin);
const rules = JSON.parse(readFileSync(join(ROOT, 'specs/exec_scorecard_rules.json'), 'utf8'));
const readings = performanceFrom(digest);
const bo = breakoutsFrom(digest, rules);

console.log(`\n  digest: ${digest.agents?.length ?? 0} agents · ${digest.period?.from} → ${digest.period?.to} · ${digest.workDays} working days`);
Object.entries(readings).forEach(([k, v]) =>
  console.log(`    ${k.padEnd(16)} ${String(v.value).padStart(10)}  target ${String(v.target ?? '—').padStart(10)}  ${v.basis}`));
const missing = rules.sections.find(s => s.k === 'performance').factors
  .filter(f => !readings[f.k]).map(f => f.k);
if (missing.length) console.log(`\n  NOT in this digest, left as the week's file had them: ${missing.join(', ')}`);

if (DRY) { console.log('\n  --dry: nothing written.\n'); process.exit(0); }

const dataPath = join(resolve(DIR), 'data.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const perf = data.sections.performance;
Object.entries(readings).forEach(([k, v]) => {
  const keep = perf.factors[k] || {};
  /* A target the week's file states by hand (a budget, a plan) wins over a
     derived one; a target the engine owns always comes from the engine. */
  perf.factors[k] = { ...v, target: v.target === undefined ? keep.target : v.target };
});
perf.breakouts = (perf.breakouts || []).map(b => {
  if (b.title === 'By campaign') return { ...b, basis: 'actual', rows: bo.camp.map(c => c.cells), bars: bo.camp.map(c => c.bar), hues: bo.camp.map(c => c.hue) };
  if (b.title === 'By team leader') return { ...b, basis: 'actual', rows: bo.tl.map(c => c.cells), bars: bo.tl.map(c => c.bar) };
  if (b.title.startsWith('Top agents')) return { ...b, basis: 'actual', rows: bo.top.map(c => c.cells), bars: bo.top.map(c => c.bar) };
  if (b.title.startsWith('Watchlist')) return { ...b, basis: 'actual', rows: bo.watch.map(c => c.cells), bars: bo.watch.map(c => c.bar) };
  return b;
});
data._pulled = { at: new Date().toISOString(), digestPeriod: digest.period, agents: digest.agents?.length ?? 0 };
writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log(`\n  wrote ${Object.keys(readings).length} actual readings into ${dataPath}`);
console.log('  now run: node tools/build-exec-report.mjs ' + DIR + '\n');
}
