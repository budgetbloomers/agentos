#!/usr/bin/env node
/* ============================================================================
   EXEC REPORT — the coverage test.

       node tools/exec-coverage.mjs                    # the table
       node tools/exec-coverage.mjs --write            # + DATA-REQUIREMENTS.md
       node tools/exec-coverage.mjs --section lrc      # one section
       node tools/exec-coverage.mjs --json             # machine-readable

   WHAT IT ANSWERS. "What is missing from LRC?" — and from every other section.
   For all 58 factors it decides, by LOOKING, which of five states each is in:

     LIVE     the report reads it today. Proved by importing exec-pull's own
              aggregation and running it over a digest: whatever comes back with
              a value IS live, by demonstration rather than by assertion.
     WIRING   the number exists in this suite — a lake table, an Ops KPI, an
              engine symbol, a field the digest publishes — but nothing carries
              it into the report yet. No new data contract; a morning's work.
     MANUAL   a human-maintained register is the only possible source. It is a
              real reading, and it AGES: the report must print the date it was
              last touched or it will quote July in December.
     PARTIAL  the probe finds the value and NOT what the value is measured
              against. Revenue is exact to the rand and "revenue vs budget" is
              unscoreable, because no budget exists. `feed.needs` names the
              missing half. Counting these as WIRING would flatter the plan by
              about a sixth of the business score.
     FEED     nothing in the business produces this number. A new contract is
              needed, and the requirement names the exact fields.

   WHY A PROBE AND NOT A LIST. A list of gaps is stale the day it is written; a
   probe is re-run. The rule book declares each factor's `feed.probe` and the
   tool resolves it against this repo — a table in supabase/*.sql, a field in the
   Ops digest builder, a KPI id, an engine symbol, an API credential in tools/.
   A factor cannot be marked reachable because somebody typed that it was.

   THE PROBE IS NOT A GUARANTEE. It proves an artefact EXISTS, not that the
   number is correct or that a pipeline is running. WIRING means "the thing to
   read is here", which is exactly the claim being made.
   ============================================================================ */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performanceFrom } from './exec-pull.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i < 0 ? null : (argv[i + 1] || ''); };
const ONLY = flag('--section');
const RULES = JSON.parse(readFileSync(join(ROOT, 'specs/exec_scorecard_rules.json'), 'utf8'));

/* ------------------------------------------------------------- the corpus --- */

const read = p => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
const OPS = read('Chatterbox_AgentOS_Analytics.html');
const PULSE = read('nicks_code/index.html');
const AGENT = read('agent/index.html');        // the commission engine lives here, not in Ops
const WORKER = ['index', 'portal', 'campaign', 'health', 'rules', 'provision', 'coaching', 'auth', 'wimpy', 'kb']
  .map(f => read(`worker/src/${f}.mjs`)).join('\n');
const TOOLS = (() => {
  const dir = join(ROOT, 'tools');
  return readdirSync(dir).filter(f => f.endsWith('.mjs') || f.endsWith('.js'))
    .map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
})();
const SQL = (() => {
  const dir = join(ROOT, 'supabase');
  if (!existsSync(dir)) return '';
  return readdirSync(dir).filter(f => f.endsWith('.sql'))
    .map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
})();

/* The Ops digest builder — the block that decides what leaves the engine. Probed
   on its own rather than on the whole 542 KB file, so `digest:stats.qa` cannot
   pass because the string happens to appear in some unrelated page. */
const DIGEST_BLOCK = (() => {
  const i = OPS.indexOf('return {cb:st.cb,name:st.name');
  const j = OPS.indexOf('window.__nbaPush', i);
  return i < 0 ? '' : OPS.slice(i, j < 0 ? i + 6000 : j);
})();

/* --------------------------------------------------------------- the probes -- */

const PROBES = {
  /* a field the Ops engine actually publishes in its digest */
  digest: (arg) => {
    const leaf = arg.split('.').pop();
    return { hit: new RegExp(`\\b${leaf}\\s*:`).test(DIGEST_BLOCK), where: 'kv:nba-digest builder (Ops __nbaPush)' };
  },
  /* a KPI defined in the Ops dashboard's KPI register */
  opsKpi: (arg) => ({ hit: new RegExp(`id\\s*:\\s*'${arg}'`).test(OPS), where: 'Ops DEFAULT_KPIS' }),
  /* a symbol computed somewhere in the suite */
  engine: (arg) => {
    const where = [['Ops', OPS], ['PULSE', PULSE], ['Agent app', AGENT], ['Worker', WORKER], ['tools', TOOLS]]
      .filter(([, src]) => src.includes(arg)).map(([n]) => n);
    return { hit: where.length > 0, where: where.join(' + ') };
  },
  /* a table the database actually creates */
  sqlTable: (arg) => ({
    hit: new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${arg}\\b`, 'i').test(SQL),
    where: 'supabase migrations'
  }),
  /* an external API this repo already holds a client and a credential for */
  api: (arg) => ({ hit: TOOLS.includes(arg) || WORKER.includes(arg), where: 'tools/ API client + gitignored credential file' }),
  manual: () => ({ hit: true, where: 'human-maintained register' }),
  none: () => ({ hit: false, where: '' })
};

function probe(spec) {
  const [kind, ...rest] = String(spec || 'none').split(':');
  const fn = PROBES[kind];
  if (!fn) return { hit: false, where: `unknown probe kind "${kind}"`, kind };
  return { ...fn(rest.join(':')), kind, arg: rest.join(':') };
}

/* ----------------------------------------------------- what the report reads - */

/* Not a declaration: run exec-pull's own aggregation over a digest carrying every
   field the builder publishes, and see which factors come back with a value. */
function liveFactors() {
  const agent = {
    cb: 'CB-1', tl: 'TL', campaign: 'Courtesy', tenure: 'M1',
    composite: { adj: 72 }, r2a: { tier: 'Tier 0' }, nba: { code: 'R1' },
    stats: { sales: 10, gwp: 1200, target: 12, present: 5, conv: 5, qa: 84, canc: 1, talkDay: 180, att: 92 }
  };
  const out = performanceFrom({
    agents: [agent], period: { from: '2026-09-01', to: '2026-09-14' },
    thresholds: { convTarget: 8, qaTarget: 85 }
  });
  return new Set(Object.keys(out));
}

/* ------------------------------------------------------------------- the run - */

const LIVE = liveFactors();
const STATE_ORDER = ['live', 'wiring', 'partial', 'manual', 'feed'];
const LABEL = { live: 'LIVE', wiring: 'WIRING', partial: 'PARTIAL', manual: 'MANUAL', feed: 'FEED' };

const sections = RULES.sections
  .filter(s => !ONLY || s.k === ONLY)
  .map(s => {
    const rows = s.factors.map(f => {
      const pr = probe(f.feed?.probe);
      let state;
      const needs = f.feed?.needs?.length ? f.feed.needs : null;
      if (LIVE.has(f.k) && s.k === 'performance' && !needs) state = 'live';
      else if (pr.kind === 'manual') state = 'manual';
      else if (pr.hit && needs) state = 'partial';
      else if (pr.hit) state = 'wiring';
      else state = 'feed';
      return { f, pr, state };
    });
    const w = (st) => rows.filter(r => r.state === st).reduce((a, r) => a + r.f.w, 0);
    return {
      s, rows,
      byState: Object.fromEntries(STATE_ORDER.map(k => [k, w(k)])),
      /* how much of this section could be REAL if every existing source were wired */
      reachable: w('live') + w('wiring') + w('manual')   // partial is NOT reachable: half of it is missing
    };
  });

if (argv.includes('--json')) {
  console.log(JSON.stringify(sections.map(x => ({
    section: x.s.k, weight: x.s.weight, byState: x.byState, reachable: x.reachable,
    factors: x.rows.map(r => ({ k: r.f.k, w: r.f.w, state: r.state, probe: r.f.feed.probe, hit: r.pr.hit, where: r.pr.where }))
  })), null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
let tot = { live: 0, wiring: 0, partial: 0, manual: 0, feed: 0 };

sections.forEach(x => {
  console.log(`\n  ${x.s.label}  —  ${x.s.weight}% of the business score`);
  console.log(`  ${'-'.repeat(104)}`);
  x.rows.forEach(r => {
    console.log(`   ${pad(LABEL[r.state], 7)} ${lpad(r.f.w, 3)}%  ${pad(r.f.label, 42)} ${pad(r.f.feed.probe, 26)} ${r.pr.hit ? r.pr.where : r.f.feed.system}`);
  });
  const b = x.byState;
  console.log(`   ${' '.repeat(7)}      reachable ${lpad(x.reachable, 3)}% of the section` +
    `   (live ${b.live} · wiring ${b.wiring} · partial ${b.partial} · manual ${b.manual} · needs a feed ${b.feed})`);
  STATE_ORDER.forEach(k => { tot[k] += (b[k] / 100) * x.s.weight; });
});

if (!ONLY) {
  const r1 = n => Math.round(n * 10) / 10;
  console.log(`\n  ${'='.repeat(104)}`);
  console.log(`  THE BUSINESS SCORE, BY WHERE ITS EVIDENCE WOULD COME FROM`);
  console.log(`    read today (live)            ${lpad(r1(tot.live), 6)}%`);
  console.log(`    exists, not wired            ${lpad(r1(tot.wiring), 6)}%   ← no new data contract`);
  console.log(`    half exists, half missing    ${lpad(r1(tot.partial), 6)}%   ← the value is there, the comparator is not`);
  console.log(`    a human register             ${lpad(r1(tot.manual), 6)}%`);
  console.log(`    needs a new feed             ${lpad(r1(tot.feed), 6)}%`);
  console.log(`    ${'-'.repeat(38)}`);
  console.log(`    reachable without a new feed ${lpad(r1(tot.live + tot.wiring + tot.manual), 6)}%\n`);
}

/* -------------------------------------------------------- the requirements --- */

if (argv.includes('--write')) {
  const L = [];
  const r1 = n => Math.round(n * 10) / 10;
  L.push('# Executive Weekly Health Report — the data it needs');
  L.push('');
  L.push('*Generated by `node tools/exec-coverage.mjs --write`. Every state below was PROBED against this');
  L.push('repository, not asserted — re-run it and the list is current. Do not hand-edit this file.*');
  L.push('');
  L.push('| State | Meaning |');
  L.push('|---|---|');
  L.push('| **LIVE** | The report reads it today. |');
  L.push('| **WIRING** | The number exists in the suite — a table, a KPI, a published field — and nothing carries it into the report yet. No new data contract. |');
  L.push('| **PARTIAL** | The value exists; what it is measured *against* does not. Revenue is exact to the rand and "revenue vs budget" is unscoreable. **Needs** names the missing half. |');
  L.push('| **MANUAL** | A human-maintained register is the only possible source. Real, and it ages: print the date it was last touched. |');
  L.push('| **FEED** | Nothing in the business produces this number. The fields below are the requirement. |');
  L.push('');
  L.push('## Where the business score would get its evidence');
  L.push('');
  L.push('| | Share of the business score |');
  L.push('|---|---:|');
  L.push(`| Read today | ${r1(tot.live)}% |`);
  L.push(`| Exists, not wired | ${r1(tot.wiring)}% |`);
  L.push(`| Half exists (the value, not its comparator) | ${r1(tot.partial)}% |`);
  L.push(`| A human register | ${r1(tot.manual)}% |`);
  L.push(`| Needs a new feed | ${r1(tot.feed)}% |`);
  L.push(`| **Reachable without a new feed** | **${r1(tot.live + tot.wiring + tot.manual)}%** |`);
  L.push('');
  L.push('| Section | Weight | Live | Wiring | Partial | Manual | Needs a feed | Reachable |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  sections.forEach(x => L.push(`| ${x.s.label} | ${x.s.weight}% | ${x.byState.live}% | ${x.byState.wiring}% | ${x.byState.partial}% | ${x.byState.manual}% | ${x.byState.feed}% | **${x.reachable}%** |`));
  L.push('');
  L.push('*Percentages inside a section are that section\'s own weight, not the business score.*');
  L.push('');

  sections.forEach(x => {
    L.push(`## ${x.s.label} — ${x.s.weight}% of the business score`);
    L.push('');
    L.push(`Owner: ${x.s.owner} · Exec: ${x.s.exec}`);
    L.push('');
    L.push(`**${x.reachable}% of this section is reachable without a new data contract.**`);
    L.push('');
    STATE_ORDER.forEach(st => {
      const rows = x.rows.filter(r => r.state === st);
      if (!rows.length) return;
      L.push(`### ${LABEL[st]}`);
      L.push('');
      rows.forEach(({ f, pr }) => {
        const fe = f.feed;
        L.push(`**${f.label}** *(${f.w}% of the section)*`);
        L.push('');
        L.push(`- **System** — ${fe.system}`);
        L.push(`- **Store** — ${fe.store}`);
        L.push(`- **Fields** — ${fe.fields.map(x => `\`${x}\``).join(' · ')}`);
        L.push(`- **Grain / cadence** — ${fe.grain}, ${fe.cadence}`);
        L.push(`- **Owner** — ${fe.owner}`);
        L.push(`- **Probe** — \`${fe.probe}\` → ${pr.hit ? `found in ${pr.where}` : 'nothing found'}`);
        if (fe.needs?.length) { L.push(`- **Missing half** —`); fe.needs.forEach(n => L.push(`    - ${n}`)); }
        if (fe.note) L.push(`- **Note** — ${fe.note}`);
        L.push('');
      });
    });
  });

  const out = join(ROOT, 'reports/exec-weekly/DATA-REQUIREMENTS.md');
  writeFileSync(out, L.join('\n') + '\n');
  console.log(`  wrote ${out}\n`);
}
