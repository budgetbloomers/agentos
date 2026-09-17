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
const REQUESTS = JSON.parse(readFileSync(join(ROOT, 'specs/exec_data_requests.json'), 'utf8'));

/* THE THREE-STATE ANSWER. The five probe states are how a gap is diagnosed; this
   is how it is REPORTED to someone deciding what to go and collect.
     Fully     — we hold the data. Either the report already reads it (live) or
                 it sits in a table, a KPI or a published field and only needs
                 wiring. Nobody outside this repo has to do anything.
     Partially — half of it. Usually the value without its comparator (revenue
                 with no budget), or a register we keep by hand rather than feed.
     Not at all — nothing in the business produces it. */
const HAVE = { live: 'Fully', wiring: 'Fully', partial: 'Partially', manual: 'Partially', feed: 'Not at all' };

/* Which request covers which factor — built from the requests' own `unlocks`, so
   a factor cannot be quietly left without somewhere to get its data from. */
const COVERED_BY = (() => {
  const m = new Map();
  REQUESTS.requests.forEach(r => (r.unlocks || []).forEach(u => {
    if (!m.has(u)) m.set(u, []);
    m.get(u).push(r);
  }));
  return m;
})();

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
      return { f, pr, state, have: HAVE[state], asks: COVERED_BY.get(`${s.k}.${f.k}`) || [] };
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
    factors: x.rows.map(r => ({ k: r.f.k, w: r.f.w, state: r.state, have: r.have,
      probe: r.f.feed.probe, hit: r.pr.hit, where: r.pr.where, asks: r.asks.map(a => a.id) }))
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
    console.log(`   ${pad(r.have, 10)} ${pad(LABEL[r.state], 7)} ${lpad(r.f.w, 3)}%  ${pad(r.f.label, 42)} ${r.asks.map(a => a.id).join(', ') || (r.have === 'Fully' ? '— ours to wire' : 'NO REQUEST — GAP')}`);
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
  L.push('*Generated by `node tools/exec-coverage.mjs --write`. Every state below was PROBED against this repository, not asserted — re-run it and the list is current. Do not hand-edit this file.*');
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

  /* ---- part one: do we have it? ---- */
  L.push('---');
  L.push('');
  L.push('# Part one — what each section needs, and whether we have it');
  L.push('');
  sections.forEach(x => {
    L.push(`## ${x.s.label} — ${x.s.weight}% of the business score`);
    L.push('');
    L.push(`Owner: ${x.s.owner} · Exec: ${x.s.exec}`);
    L.push('');
    L.push('| Data required | Weight | Have it? | Where it is / what is missing | Request |');
    L.push('|---|---:|---|---|---|');
    x.rows.forEach(({ f, pr, have, asks, state: r0 }) => {
      const fe = f.feed;
      const where = have === 'Fully'
        ? `${fe.system} — \`${fe.store}\``
        : (fe.needs?.length ? `Have: ${fe.system}. **Missing: ${fe.needs.join('; ')}**` : `**Nothing produces this.** Would come from ${fe.system}`);
      L.push(`| **${f.label}**<br><span>${fe.fields.map(z => `\`${z}\``).join(' · ')}</span> | ${f.w}% | ${have} | ${where} | ${asks.map(a => `\`${a.id}\``).join(' ') || (r0 === 'live' ? 'already read' : '— ours to wire') } |`);
    });
    L.push('');
    const gaps = x.rows.filter(r => r.have !== 'Fully');
    if (gaps.length) {
      L.push(`To close this section: ${[...new Set(gaps.flatMap(g => g.asks.map(a => a.id)))].map(z => `\`${z}\``).join(' · ')}`);
      L.push('');
    } else {
      L.push('Nothing outside this repo is needed for this section.');
      L.push('');
    }
  });

  /* ---- part two: the formats to send the team ---- */
  const needed = new Set(sections.flatMap(x => x.rows.filter(r => r.have !== 'Fully').flatMap(r => r.asks.map(a => a.id))));
  const asks = REQUESTS.requests.filter(r => needed.has(r.id)).sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));

  L.push('---');
  L.push('');
  L.push('# Part two — the formats to source');
  L.push('');
  L.push(`${asks.length} requests. Each one is a single thing somebody produces, and between them they close every gap in part one.`);
  L.push('');
  L.push('| # | Request | What it is | Owner | Cadence | Unlocks |');
  L.push('|---:|---|---|---|---|---|');
  asks.forEach((r, i) => L.push(`| ${i + 1} | **${r.id}** — ${r.title} | ${r.kind} | ${r.owner} | ${r.cadence} | ${r.unlocks.length} factor${r.unlocks.length === 1 ? '' : 's'} |`));
  L.push('');
  L.push('## Rules for every file');
  L.push('');
  Object.entries(REQUESTS.conventions).filter(([k]) => !k.startsWith('_'))
    .forEach(([k, v]) => L.push(`- **${k}** — ${v}`));
  L.push('');
  L.push(REQUESTS.conventions._note);
  L.push('');

  const TYPE = { cb: 'CB number', pct: 'percent', money: 'rand', int: 'whole number', number: 'number', date: 'date', time: 'time', text: 'text', enum: 'one of a list' };
  const colTable = (cols) => {
    const out = ['| Column | Type | Required | Example | Notes |', '|---|---|---|---|---|'];
    cols.forEach(c => out.push(`| \`${c.name}\` | ${TYPE[c.type] || c.type} | ${c.required ? 'yes' : 'no'} | ${c.example === '' ? '*(blank)*' : c.example} | ${c.note || ''} |`));
    return out;
  };

  asks.forEach((r, i) => {
    L.push(`### ${i + 1}. ${r.id} — ${r.title}`);
    L.push('');
    L.push(`**${r.kind === 'column' ? 'A column, not a new file' : r.kind === 'mapping' ? 'A written mapping, not a file' : r.kind === 'register' ? 'A register that must be created first' : 'A file'}** · owner **${r.owner}** · ${r.fmt} · ${r.cadence}`);
    L.push('');
    L.push(`- **Grain** — ${r.grain}`);
    L.push(`- **System today** — ${r.system}`);
    L.push(`- **Unlocks** — ${r.unlocks.join(' · ')}`);
    if (r.newSource) L.push('- **Our side** — needs a new `SOURCES` entry and `TRANSFORM` mapping before the first load.');
    if (r.pii) L.push(`- **PII** — ${r.pii}`);
    L.push('');
    L.push(`*Why:* ${r.why}`);
    L.push('');
    if (r.sheets) {
      Object.entries(r.sheets).forEach(([sheet, cols]) => {
        L.push(`**Sheet: ${sheet}**`);
        L.push('');
        colTable(cols).forEach(z => L.push(z));
        L.push('');
      });
    } else {
      colTable(r.columns).forEach(z => L.push(z));
      L.push('');
    }
  });

  /* ---- the same pack as a branded page, for sending and printing ----
     A purpose-built renderer for exactly the markdown this tool emits — headings,
     tables, bullets, rules, bold, italics and inline code. Not a general markdown
     parser and not pretending to be one; there is no converter on this machine and
     a document the team receives every month is worth forty lines. */
  const mdToHtml = (md) => {
    const esc2 = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    /* <br> and <span> are ours, emitted above — put them back after escaping. */
    const inline = t => esc2(t)
      .replace(/&lt;br&gt;/g, '<br>').replace(/&lt;span&gt;/g, '<span class="fld">').replace(/&lt;\/span&gt;/g, '</span>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
    const lines = md.split('\n');
    const out = [];
    let i = 0, inList = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    while (i < lines.length) {
      const l = lines[i];
      if (/^\|/.test(l) && /^\|[\s:–-]+\|/.test(lines[i + 1] || '')) {
        closeList();
        const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const align = cells(lines[i + 1]).map(c => (c.endsWith(':') ? ' class="num"' : ''));
        out.push('<table><thead><tr>' + cells(l).map((c, n) => `<th${align[n] || ''}>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
        i += 2;
        while (i < lines.length && /^\|/.test(lines[i])) {
          out.push('<tr>' + cells(lines[i]).map((c, n) => `<td${align[n] || ''}>${inline(c)}</td>`).join('') + '</tr>');
          i++;
        }
        out.push('</tbody></table>');
        continue;
      }
      const h = l.match(/^(#{1,3})\s+(.*)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
      if (/^---\s*$/.test(l)) { closeList(); out.push('<hr>'); i++; continue; }
      const b = l.match(/^[-*]\s+(.*)$/);
      if (b) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(b[1])}</li>`); i++; continue; }
      if (!l.trim()) { closeList(); i++; continue; }
      closeList(); out.push(`<p>${inline(l)}</p>`); i++;
    }
    closeList();
    return out.join('\n');
  };

  const logo = (() => {
    try { return (readFileSync(join(ROOT, 'agent/index.html'), 'utf8').match(/var LOGO="(data:image\/png;base64,[^"]+)"/) || [])[1]; }
    catch { return null; }
  })();

  const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Data Requirements — The Chatterbox</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--navy:#0A1730;--ink:#0F1E36;--body:#3B4A63;--muted:#71809B;--line:#E3E9F3;--bg:#F2F5FA;--card:#fff;
 --blue:#2563EB;--green:#158A4C;--amber:#B45309;--red:#C42D2D;--radius:14px}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--ink);font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:22px 22px 60px}
.mast{background:var(--navy);color:#fff;border-radius:var(--radius);padding:22px 24px;margin-bottom:16px;position:relative;overflow:hidden}
.mast::after{content:"";position:absolute;inset:0;background:radial-gradient(640px 300px at 92% -40%,rgba(56,189,248,.22),transparent 62%)}
.mast-top{display:flex;gap:18px;align-items:flex-start;position:relative}
.mast-logo{background:#fff;border-radius:11px;padding:11px 13px;flex:none}.mast-logo img{display:block;width:150px}
.mast h1{font-size:21px;font-weight:800;letter-spacing:-.4px;border:none;padding:0;margin:0;color:#fff}
.mast p{font-size:12.5px;color:#9FB6DA;margin-top:3px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:4px 20px 18px;box-shadow:0 1px 2px rgba(15,30,54,.05),0 4px 14px rgba(15,30,54,.05)}
h1{font-size:19px;font-weight:800;letter-spacing:-.3px;margin:26px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--line)}
h2{font-size:15.5px;font-weight:800;margin:22px 0 8px}
h3{font-size:13.5px;font-weight:800;margin:20px 0 7px;color:var(--navy)}
p{margin:7px 0;max-width:96ch}
ul{margin:7px 0 7px 20px}li{margin:3px 0;max-width:96ch}
hr{border:none;border-top:1px solid var(--line);margin:22px 0}
table{width:100%;border-collapse:collapse;font-size:12px;margin:9px 0 14px}
th{text-align:left;font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding:6px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
th.num,td.num{text-align:right}
td{padding:7px 9px;border-bottom:1px solid #F1F4FA;vertical-align:top}
tbody tr:hover{background:#FAFCFF}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#EEF3FB;color:#1E40AF;padding:1px 5px;border-radius:4px}
b{font-weight:700}
.fld{display:block;color:var(--muted);font-size:10.5px;margin-top:3px;line-height:1.45}
td:nth-child(3){font-weight:700;white-space:nowrap}
@page{size:A4;margin:12mm 10mm}
@media print{*{print-color-adjust:exact;-webkit-print-color-adjust:exact}
 body{background:#fff;font-size:10px}.wrap{max-width:none;padding:0}.card{box-shadow:none;border:none;padding:0}
 table,tr,h1,h2,h3{break-inside:avoid;page-break-inside:avoid}h1,h2,h3{break-after:avoid}thead{display:table-header-group}}
</style></head><body><div class="wrap">
<header class="mast"><div class="mast-top">
${logo ? `<div class="mast-logo"><img src="${logo}" alt="The Chatterbox"></div>` : ''}
<div><h1>Executive Weekly Health Report — the data it needs</h1>
<p>What each section requires, whether we have it, and the format for everything we do not · ${new Date().toISOString().slice(0, 10)} · internal</p></div>
</div></header>
<div class="card">${mdToHtml(L.join('\n').replace(/^# Executive[^\n]*\n/, ''))}</div>
</div></body></html>`;
  writeFileSync(join(ROOT, 'reports/exec-weekly/DATA-REQUIREMENTS.html'), page);

  const out = join(ROOT, 'reports/exec-weekly/DATA-REQUIREMENTS.md');
  writeFileSync(out, L.join('\n') + '\n');
  console.log(`  wrote ${out}\n`);
}
