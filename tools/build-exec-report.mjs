#!/usr/bin/env node
/* ============================================================================
   EXECUTIVE WEEKLY HEALTH REPORT — the builder.

   WHAT THIS IS. One command turns a week's readings into the report the
   executives read:

       node tools/build-exec-report.mjs reports/exec-weekly/2026-W37

   The folder holds `data.json` (the week's readings, each with its basis) and
   receives `index.html` (the report), `REPORT.md` (the same thing in text, for
   the pack and the brain vault) and `scores.json` (the computed scores, so the
   next week can quote a delta without recomputing history).

   WHY IT IS A SCRIPT AND NOT A DOCUMENT. CLAUDE.md non-negotiable 1: the maths
   is deterministic code, never LLM arithmetic. Nobody — human or model — types
   a section score into this report. The rule book (specs/exec_scorecard_rules.json)
   owns the weights and the bands; this file owns the arithmetic; data.json owns
   the readings. Change a weight in the rule book, re-run, and every number moves
   together.

   THE THREE RULES THE ARITHMETIC OBEYS.

   1. AN ABSENCE IS NOT A NOUGHT. A factor with no reading leaves the
      denominator; the rest of its section renormalise to 100. This is the same
      doctrine that stops a missing BI file dropping a team's composite by 30
      points (non-negotiable 6). A factor that IS measured and IS bad still
      scores badly — an absence and a failure must never look the same, so the
      report prints COVERAGE beside every score: how much of the section's
      weight was actually measured.

   2. THE BASIS TRAVELS WITH THE NUMBER. Every reading is 'actual' (an engine
      computed it from an upload), 'manual' (a person supplied it, and is named),
      'simulated' (a placeholder so the framework can be reviewed before the feed
      exists) or 'absent'. Simulated readings are badged on the face of the
      report, counted in the section's own coverage as simulated, and are only
      allowed into the overall business score while `countSimulated` is true in
      the rule book. Nobody should ever have to ask which numbers are real.

   3. ONE NUMBER, ONE VERDICT. The score, the band, the RAG colour and the arrow
      are decided here, once, and the HTML paints what it is given
      (non-negotiable 12). There is no threshold inside the template.

   SCALES. A reading becomes 0-100 one of four ways, named per factor:
     target      value ÷ target × 100          (higher is better)
     targetDown  target ÷ value × 100          (lower is better; value 0 = 100)
     pct         the value already IS the score
     band        step bands, first match wins, listed high to low
   All capped at `scales.cap` (110) so one runaway factor cannot paper over a
   failing one.
   ============================================================================ */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const RULES_PATH = join(ROOT, 'specs/exec_scorecard_rules.json');

/* ---------------------------------------------------------------- arithmetic */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = n => Math.round(n * 10) / 10;

/** A reading → a 0-100 score, or null when there is nothing to score. */
export function scoreFactor(factor, reading, cap = 110) {
  if (!reading || reading.basis === 'absent') return null;
  const v = reading.value;
  if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
  const val = Number(v);
  const target = reading.target === undefined ? factor.target : reading.target;

  let raw;
  switch (factor.scale) {
    case 'pct':
      raw = val;
      break;
    case 'target':
      if (!Number.isFinite(Number(target)) || Number(target) === 0) return null;
      raw = (val / Number(target)) * 100;
      break;
    case 'targetDown':
      if (!Number.isFinite(Number(target))) return null;
      // Zero of a bad thing is a perfect score, not a divide-by-zero.
      raw = val === 0 ? cap : (Number(target) / val) * 100;
      break;
    case 'band': {
      const bands = reading.bands || factor.bands || [];
      const hit = bands.find(b => val >= b.min);
      if (!hit) return 0;
      raw = hit.score;
      break;
    }
    default:
      return null;
  }
  return round1(clamp(raw, 0, cap));
}

/** Band + RAG for a 0-100 score. */
export function bandOf(score, bands) {
  if (score === null) return { label: 'Not measured', rag: 'grey', min: null };
  return bands.find(b => score >= b.min) || bands[bands.length - 1];
}

/**
 * Score one section. Factors with no reading leave the denominator; the rest
 * renormalise. Returns the effective weight each factor actually carried, so
 * the report can show why a section scored what it did.
 */
export function scoreSection(section, readings, rules) {
  const cap = rules.scales?.cap ?? 110;
  const countSim = rules.countSimulated !== false;
  const rows = section.factors.map(f => {
    const reading = readings[f.k] || { basis: 'absent' };
    const scored = scoreFactor(f, reading, cap);
    const counts = scored !== null && (countSim || reading.basis !== 'simulated');
    return { factor: f, reading, score: scored, counts };
  });

  const liveWeight = rows.filter(r => r.counts).reduce((a, r) => a + r.factor.w, 0);
  const totalWeight = section.factors.reduce((a, f) => a + f.w, 0);
  const measuredWeight = rows
    .filter(r => r.counts && r.reading.basis !== 'simulated')
    .reduce((a, r) => a + r.factor.w, 0);

  rows.forEach(r => { r.effW = r.counts && liveWeight ? round1((r.factor.w / liveWeight) * 100) : 0; });

  const score = liveWeight
    ? round1(rows.filter(r => r.counts).reduce((a, r) => a + r.score * r.factor.w, 0) / liveWeight)
    : null;

  const coverage = totalWeight ? round1((liveWeight / totalWeight) * 100) : 0;
  const realCoverage = totalWeight ? round1((measuredWeight / totalWeight) * 100) : 0;

  return {
    k: section.k,
    label: section.label,
    weight: section.weight,
    owner: section.owner,
    exec: section.exec,
    question: section.question,
    score,
    band: bandOf(score, rules.bands),
    coverage,
    realCoverage,
    thin: coverage < (rules.coverageFloor ?? 0.5) * 100,
    rows
  };
}

/** The overall business score: section scores weighted by each section's portion. */
export function scoreBusiness(sections, rules) {
  const live = sections.filter(s => s.score !== null);
  const w = live.reduce((a, s) => a + s.weight, 0);
  const declared = sections.reduce((a, s) => a + s.weight, 0);
  const score = w ? round1(live.reduce((a, s) => a + s.score * s.weight, 0) / w) : null;
  const realWeight = sections.reduce((a, s) => a + s.weight * (s.realCoverage / 100), 0);
  return {
    score,
    band: bandOf(score, rules.bands),
    weightScored: w,
    weightDeclared: declared,
    /* How much of the whole business score rests on a measured number rather
       than a placeholder. The single most important caveat on page one. */
    evidence: declared ? round1((realWeight / declared) * 100) : 0
  };
}

/* ------------------------------------------------------------------ rendering */

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (v, unit) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  switch (unit) {
    case 'zar': return 'R' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
    case 'pct': return n.toLocaleString('en-GB', { maximumFractionDigits: 1 }) + '%';
    case 'int': return n.toLocaleString('en-GB');
    case 'days': return n.toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' d';
    case 'mins': return n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) + ' min';
    default: return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
};

const BASIS_LABEL = {
  actual: 'Actual',
  manual: 'Manual',
  simulated: 'Simulated',
  absent: 'No feed'
};

const arrow = d => (d === null || d === undefined ? '' : d > 0.05 ? '▲' : d < -0.05 ? '▼' : '▬');
const deltaCls = d => (d === null || d === undefined ? 'flat' : d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat');

/* ------------------------------------------------------------------- charts --
   Four marks, and the rule book supplies every colour (viz block, validated with
   the dataviz validator rather than by eye).

   METER — a section or factor score against 100. The prescribed form for "a
   single ratio against a limit": the fill carries the severity, the track is a
   lighter step of the SAME ramp so the state reads across the whole bar, and a
   hairline tick sits at 100 so over- and under-target are read against the
   target, not against the end of the bar.

   MAGNITUDE BAR — a breakout row's % of target. ONE hue for every bar, because
   the job is magnitude: colouring a bar by its own length double-encodes what
   the length already says, and burns the only free channel.

   IDENTITY DOT — the campaign's own hue beside its name. Colour follows the
   entity, never its rank, so a campaign keeps its hue wherever it appears.

   No script on this page, so hover is the native `title` tooltip. Every mark
   carries one, and every value is also in the table cell beside it — the mark is
   never the only place a number exists. */
let VIZ = {};

function meter(score, rag, opts = {}) {
  const max = VIZ.scaleMax || 110;
  const w = score === null ? 0 : Math.max(0, Math.min(100, (score / max) * 100));
  const tick = (100 / max) * 100;
  return `<span class="meter ${rag}${opts.sm ? ' sm' : ''}" title="${score === null ? 'not measured' : score + ' / 100'}">
    <i style="width:${w.toFixed(1)}%"></i><b style="left:${tick.toFixed(1)}%"></b></span>`;
}

function magBar(pct, opts = {}) {
  if (pct === null || pct === undefined) return '';
  const max = opts.max || 120;
  const w = Math.max(0, Math.min(100, (pct / max) * 100));
  const tick = (100 / max) * 100;
  return `<span class="mag" title="${pct}% of target"><i style="width:${w.toFixed(1)}%"></i><b style="left:${tick.toFixed(1)}%"></b></span>`;
}

function dot(hue, label) {
  return hue ? `<span class="idot" style="background:${hue}" title="${esc(label)}"></span>` : '';
}

/* The suite's logo lives once, in agent/index.html. Read it at build time rather
   than keeping a second copy of a 31 KB asset in the repo (ponytail rule). */
function logoDataUri() {
  try {
    const src = readFileSync(join(ROOT, 'agent/index.html'), 'utf8');
    const m = src.match(/var LOGO="(data:image\/png;base64,[^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

function ragDot(rag) { return `<span class="dot ${rag}"></span>`; }

function factorRows(sec) {
  return sec.rows.map(r => {
    const { factor: f, reading: rd, score } = r;
    const b = bandOf(score, BANDS);
    const basis = rd.basis || 'absent';
    return `<tr class="${basis === 'simulated' ? 'sim' : ''}">
      <td class="fx"><b>${esc(f.label)}</b><div class="src">${esc(rd.source || f.source || '')}</div></td>
      <td class="num">${fmt(rd.value, f.unit)}</td>
      <td class="num muted">${rd.target === undefined || rd.target === null ? '—' : fmt(rd.target, f.unit)}</td>
      <td class="mt">${meter(score, b.rag)}</td>
      <td class="num sc"><b>${score === null ? '—' : score}</b></td>
      <td class="num muted">${f.w}${r.counts && r.effW !== f.w ? `<span class="eff">→${r.effW}</span>` : ''}</td>
      <td><span class="pill ${basis}">${BASIS_LABEL[basis] || basis}</span></td>
      <td><span class="bl ${b.rag}">${esc(b.label)}</span></td>
    </tr>`;
  }).join('');
}

function breakoutTable(bo) {
  if (!bo || !bo.rows?.length) return '';
  const bars = bo.bars || [];
  const hues = bo.hues || [];
  const barMax = bo.barMax || (bars.length ? Math.max(120, ...bars.filter(Number.isFinite)) : 120);
  const withBar = bars.some(v => v !== null && v !== undefined);
  return `<div class="bo">
    <div class="bo-h">${esc(bo.title)}${bo.basis ? ` <span class="pill ${bo.basis}">${BASIS_LABEL[bo.basis] || bo.basis}</span>` : ''}</div>
    ${bo.note ? `<div class="bo-n">${esc(bo.note)}</div>` : ''}
    <table class="bt"><thead><tr>
      ${bo.cols.map((c, i) => `<th class="${i ? 'num' : ''}">${esc(c)}</th>`).join('')}
      ${withBar ? `<th class="bar-h">${esc(bo.barLabel || '')}</th>` : ''}
    </tr></thead>
    <tbody>${bo.rows.map((r, ri) => `<tr>${r.map((c, i) => i === 0
      ? `<td>${dot(hues[ri], r[0])}${esc(c)}</td>`
      : `<td class="num">${esc(c)}</td>`).join('')}
      ${withBar ? `<td class="bar-c">${magBar(bars[ri], { max: barMax })}</td>` : ''}</tr>`).join('')}
    </tbody></table>
  </div>`;
}

let BANDS = [];

function renderHTML(model) {
  const { meta, business, sections, data, rules } = model;
  const logo = logoDataUri();
  VIZ = rules.viz || {};
  const V = VIZ;
  /* One place decides a colour: the rule book. The template only names the token. */
  const vizVars = [
    `--mag:${V.magnitude || '#2563EB'}`, `--mag-t:${V.magnitudeTrack || '#E8EFFB'}`,
    ...Object.entries(V.status || {}).map(([k, v]) => `--st-${k}:${v}`),
    ...Object.entries(V.statusTrack || {}).map(([k, v]) => `--st-${k}-t:${v}`)
  ].join(';');

  const kpiCards = sections.map(s => {
    const d = data.previous?.sections?.[s.k];
    const delta = d === undefined || s.score === null ? null : round1(s.score - d);
    return `<a class="kpi" href="#sec-${s.k}">
      <div class="kpi-top"><span class="kpi-w">${s.weight}% of business</span>${ragDot(s.band.rag)}</div>
      <div class="kpi-name">${esc(s.label)}</div>
      <div class="kpi-val">${s.score === null ? '—' : s.score}<span class="unit">/100</span>
        ${delta === null ? '' : `<span class="delta ${deltaCls(delta)}">${arrow(delta)} ${Math.abs(delta)}</span>`}</div>
      ${meter(s.score, s.band.rag)}
      <div class="kpi-sub"><span class="bl ${s.band.rag}">${esc(s.band.label)}</span></div>
      <div class="kpi-cov"><span style="width:${s.coverage}%"></span><i style="width:${s.realCoverage}%"></i></div>
      <div class="kpi-cov-l">${s.realCoverage}% measured · ${s.coverage}% scored</div>
    </a>`;
  }).join('');

  const secBlocks = sections.map(s => `
    <section class="card" id="sec-${s.k}">
      <div class="sec-head">
        <div>
          <h2>${ragDot(s.band.rag)}${esc(s.label)}</h2>
          <div class="q">${esc(s.question)}</div>
        </div>
        <div class="sec-score">
          <div class="ss-val">${s.score === null ? '—' : s.score}<span>/100</span></div>
          <div class="ss-b ${s.band.rag}">${esc(s.band.label)}</div>
          <div class="ss-w">${s.weight}% of the business score</div>
        </div>
      </div>
      <div class="meta-row">
        <span><b>Owner</b> ${esc(s.owner)}</span>
        <span><b>Exec</b> ${esc(s.exec)}</span>
        <span><b>Evidence</b> ${s.realCoverage}% of this section is a measured number${s.thin ? ' <b class="warn">· thin evidence</b>' : ''}</span>
      </div>
      ${data.sections[s.k]?.commentary ? `<p class="comm">${esc(data.sections[s.k].commentary)}</p>` : ''}
      <table class="ft">
        <thead><tr><th>Contributing factor</th><th class="num">Reading</th><th class="num">Target</th><th class="mt-h">Score vs target</th><th class="num">Score</th><th class="num">Weight</th><th>Basis</th><th>Band</th></tr></thead>
        <tbody>${factorRows(s)}</tbody>
      </table>
      ${(data.sections[s.k]?.breakouts || []).map(breakoutTable).join('')}
    </section>`).join('');

  const secLabel = Object.fromEntries(sections.map(s => [s.k, s.label]));
  const reds = (data.redIssues || []).map(r => `<tr>
      <td><b>${esc(r.issue)}</b>${r.section ? `<div class="rsec">${esc(secLabel[r.section] || r.section)}</div>` : ''}</td>
      <td>${esc(r.impact)}</td><td class="ev">${esc(r.evidence)}</td>
      <td>${esc(r.owner)}</td><td>${esc(r.action)}</td><td class="num">${esc(r.due)}</td><td>${esc(r.escalation)}</td>
    </tr>`).join('');

  const SRC_RAG = { ok: 'green', stale: 'amber', down: 'red' };
  const sources = (data.sources || []).map(s => `<div class="src-chip ${s.state || 'ok'}">
      <b>${ragDot(SRC_RAG[s.state] || 'grey')}${esc(s.name)}</b><span>${esc(s.endsOn || '—')}</span></div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#0A1730">
<title>Executive Weekly Health Report — The Chatterbox</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
/* Tokens are the suite's — the same ones in agent/index.html and the Ops
   dashboard — so this reads as the same product. Light theme by intent: this
   page is printed and forwarded far more often than it is browsed. */
:root{
  --navy:#0A1730; --navy2:#0E2244; --ink:#0F1E36; --body:#3B4A63; --muted:#71809B;
  --line:#E3E9F3; --bg:#F2F5FA; --card:#FFFFFF;
  --blue:#2563EB; --blue-soft:#EAF1FF; --sky:#38BDF8;
  --green:#158A4C; --green-soft:#E6F6ED;
  --amber:#B45309; --amber-soft:#FCF0DD;
  --red:#C42D2D; --red-soft:#FBE9E9;
  --violet:#6D4AE0; --violet-soft:#EFEAFD;
  --grey:#7A8797; --grey-soft:#EEF2F8;
  --radius:14px; --shadow:0 1px 2px rgba(15,30,54,.05),0 4px 14px rgba(15,30,54,.05);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--ink);font-size:13.5px;line-height:1.5;-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums;text-align:right}
.wrap{max-width:1180px;margin:0 auto;padding:22px 22px 60px}
a{color:var(--blue)}

/* ---------- chart marks ----------
   Thin marks, a 4px rounded data-end anchored square to the baseline, a hairline
   target tick, recessive tracks. Status fills are the text-safe steps (>=3:1 on
   white); each track is the lighter step of the SAME ramp, so the state reads
   across the whole bar and not only where it is filled. */
.meter{position:relative;display:block;height:8px;border-radius:5px;background:var(--st-grey-t);overflow:hidden;margin:9px 0 7px}
.meter.sm{height:6px;margin:0}
.meter i{position:absolute;left:0;top:0;bottom:0;border-radius:0 4px 4px 0;background:var(--st-grey);transition:none}
.meter.green{background:var(--st-green-t)} .meter.green i{background:var(--st-green)}
.meter.amber{background:var(--st-amber-t)} .meter.amber i{background:var(--st-amber)}
.meter.red{background:var(--st-red-t)}     .meter.red i{background:var(--st-red)}
/* the target tick: 100 is the limit the fill is read against, not the bar's end */
.meter b{position:absolute;top:-1px;bottom:-1px;width:1px;background:rgba(15,30,54,.34)}
.mag{position:relative;display:block;height:8px;min-width:90px;border-radius:5px;background:var(--mag-t);overflow:hidden}
.mag i{position:absolute;left:0;top:0;bottom:0;border-radius:0 4px 4px 0;background:var(--mag)}
.mag b{position:absolute;top:-1px;bottom:-1px;width:1px;background:rgba(15,30,54,.3)}
.idot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle;flex:none}
td.mt{width:118px;padding-right:14px;vertical-align:top}
td.mt .meter{margin:5px 0 0}
td.bar-c .mag{margin:5px 0 0}
th.mt-h{width:118px}
td.sc{width:46px}
td.bar-c{width:120px;vertical-align:top}
th.bar-h{width:120px}

/* ---------- the section strip ---------- */
.strip-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:13px 16px 11px;margin-bottom:12px}
.strip-h{font-size:12px;font-weight:800;color:var(--body);display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:9px}
.strip-h span{font-weight:500;color:var(--muted);font-size:11.5px}
.strip{display:flex;gap:2px;height:58px;align-items:flex-end}
.seg{position:relative;display:block;height:100%;border-radius:4px;background:var(--st-grey-t);overflow:hidden}
.seg.green{background:var(--st-green-t)}.seg.amber{background:var(--st-amber-t)}.seg.red{background:var(--st-red-t)}
.seg i{position:absolute;left:0;right:0;bottom:0;background:var(--st-grey);border-radius:4px 4px 0 0}
.seg.green i{background:var(--st-green)}.seg.amber i{background:var(--st-amber)}.seg.red i{background:var(--st-red)}
.seg em{position:absolute;left:0;right:0;top:4px;text-align:center;font-style:normal;font-size:9.5px;font-weight:800;color:var(--ink);opacity:.5}
.strip-l{display:flex;gap:2px;margin-top:5px}
.strip-l span{font-size:9px;color:var(--muted);text-align:center;line-height:1.25;overflow:hidden;letter-spacing:-.01em}

/* ---------- masthead ---------- */
.mast{background:var(--navy);border-radius:var(--radius);padding:22px 24px;color:#fff;position:relative;overflow:hidden;margin-bottom:14px}
.mast::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(680px 320px at 92% -40%,rgba(56,189,248,.22),transparent 62%)}
.mast-top{display:flex;align-items:flex-start;gap:18px;position:relative;flex-wrap:wrap}
.mast-logo{background:#fff;border-radius:11px;padding:11px 13px;flex:none}
.mast-logo img{display:block;width:150px}
.mast-ttl{font-size:21px;font-weight:800;letter-spacing:-.4px}
.mast-sub{font-size:12.5px;color:#9FB6DA;margin-top:3px}
.mast-right{margin-left:auto;text-align:right}
.big-score{font-size:60px;font-weight:900;letter-spacing:-2.6px;line-height:1}
.big-score span{font-size:19px;font-weight:800;color:#8FA8CC;letter-spacing:-.4px}
.big-band{display:inline-block;font-size:12px;font-weight:800;padding:4px 12px;border-radius:999px;margin-top:5px;letter-spacing:.02em}
.big-band.green{background:rgba(52,211,153,.18);color:#6EE7B7}
.big-band.amber{background:rgba(251,191,36,.16);color:#FCD34D}
.big-band.red{background:rgba(251,113,133,.16);color:#FDA4AF}
.big-band.grey{background:rgba(148,182,255,.14);color:#C6D3E8}
.mast-meter{margin-top:9px;width:190px;margin-left:auto}
.mast-meter .meter{background:rgba(255,255,255,.16)}
.mast-note{position:relative;margin-top:14px;font-size:12.5px;color:#C7D6EE;max-width:74ch;line-height:1.55}
.mast-note b{color:#fff}
.mast-bar{position:relative;display:flex;gap:16px;flex-wrap:wrap;margin-top:13px;padding-top:12px;border-top:1px solid rgba(255,255,255,.13);font-size:11.5px;color:#9FB6DA}
.mast-bar b{color:#E7EEFA;font-weight:700}

/* ---------- kpi strip ---------- */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:10px;margin-bottom:16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 13px;box-shadow:var(--shadow);text-decoration:none;color:inherit;display:block;transition:transform .12s,box-shadow .12s}
.kpi:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(15,30,54,.09)}
.kpi-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.kpi-w{font-size:10px;font-weight:800;letter-spacing:.09em;color:var(--muted);text-transform:uppercase}
.kpi-name{font-size:12px;font-weight:700;color:var(--body);line-height:1.25;min-height:30px}
.kpi-val{font-size:27px;font-weight:800;letter-spacing:-.9px;display:flex;align-items:baseline;gap:5px}
.kpi-val .unit{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:0}
.kpi-sub{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
.delta{font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:12px}
.delta.up{background:var(--green-soft);color:var(--green)}
.delta.down{background:var(--red-soft);color:var(--red)}
.delta.flat{background:var(--grey-soft);color:var(--muted)}
.kpi-cov{position:relative;height:4px;border-radius:3px;background:#EEF2F8;margin-top:9px;overflow:hidden}
.kpi-cov span{position:absolute;left:0;top:0;bottom:0;background:#CBD8EC}
.kpi-cov i{position:absolute;left:0;top:0;bottom:0;background:var(--blue)}
.kpi-cov-l{font-size:9.5px;color:var(--muted);margin-top:4px;letter-spacing:.01em}

/* ---------- cards ---------- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px;margin-bottom:12px}
.card h2{font-size:16px;font-weight:800;letter-spacing:-.2px;display:flex;align-items:center;gap:8px}
.card h3{font-size:13.5px;font-weight:800;margin-bottom:6px}
.sec-head{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:11px;margin-bottom:11px}
.q{font-size:12.5px;color:var(--muted);margin-top:3px;max-width:78ch}
.sec-score{margin-left:auto;text-align:right;flex:none}
.ss-val{font-size:30px;font-weight:900;letter-spacing:-1.2px;line-height:1}
.ss-val span{font-size:13px;font-weight:700;color:var(--muted);letter-spacing:0}
.ss-b{font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;display:inline-block;margin-top:5px}
.ss-b.green{background:var(--green-soft);color:var(--green)}
.ss-b.amber{background:var(--amber-soft);color:var(--amber)}
.ss-b.red{background:var(--red-soft);color:var(--red)}
.ss-b.grey{background:var(--grey-soft);color:var(--grey)}
.ss-w{font-size:10.5px;color:var(--muted);margin-top:4px}
.meta-row{display:flex;gap:18px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-bottom:10px}
.meta-row b{color:var(--body);font-weight:700}
.warn{color:var(--amber)!important}
.comm{font-size:13px;color:var(--body);line-height:1.6;margin-bottom:11px;max-width:92ch}

/* ---------- tables ---------- */
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th.num{text-align:right}
td{padding:7px 8px;border-bottom:1px solid #F1F4FA;vertical-align:top}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:#FAFCFF}
tr.sim td{background:#FCFBF6}
tr.sim:hover td{background:#F9F7EF}
.fx b{font-weight:700}
.src{font-size:10.5px;color:var(--muted);margin-top:2px;line-height:1.4;max-width:58ch}
.eff{color:var(--blue);font-weight:700}
.muted{color:var(--muted)}
.ev{font-size:11.5px;color:var(--body)}
.pill{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;letter-spacing:.02em;white-space:nowrap}
.pill.actual{background:var(--green-soft);color:var(--green)}
.pill.manual{background:var(--blue-soft);color:var(--blue)}
.pill.simulated{background:var(--amber-soft);color:var(--amber)}
.pill.absent{background:var(--grey-soft);color:var(--grey)}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none;margin-right:7px}
.dot.green{background:#34D399}.dot.amber{background:#FBBF24}.dot.red{background:#FB7185}.dot.grey{background:#C3CCDC}
.bl{font-size:11.5px;font-weight:800;color:var(--body)}
.bl.green{color:var(--green)}.bl.amber{color:var(--amber)}.bl.red{color:var(--red)}.bl.grey{color:var(--muted)}
.bo{margin-top:13px;border:1px solid var(--line);border-radius:11px;overflow:hidden}
.bo-h{background:#F7F9FD;padding:8px 11px;font-size:11.5px;font-weight:800;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.bo-n{padding:7px 11px 0;font-size:11px;color:var(--muted)}
.bt{font-size:12px}
.bt th{padding:6px 11px}
.bt td{padding:6px 11px}

/* ---------- red issues ---------- */
.reds{border-left:3px solid var(--red)}
.reds h2{color:var(--red)}
.rsec{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--red);margin-top:4px}
/* ---------- data trust ---------- */
.src-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.src-chip{border:1px solid var(--line);border-radius:9px;padding:6px 10px;font-size:11px;display:flex;flex-direction:column;gap:1px;background:#FAFCFF}
.src-chip b{font-weight:700;font-size:11.5px;display:flex;align-items:center}
.src-chip span{color:var(--muted);font-size:10.5px}
.src-chip.stale{border-color:#F3D9A6;background:#FEFBF4}
.src-chip.down{border-color:#F0C9C9;background:#FEF6F6}
.foot{font-size:11.5px;color:var(--muted);margin-top:18px;line-height:1.6;max-width:94ch}
.foot b{color:var(--body)}
/* PRINT — this page is forwarded and printed more often than it is browsed, so
   the paper layout is a first-class target, not a fallback. Every fill keeps its
   colour (a RAG report in greyscale is a table), nothing splits across a page
   break mid-card, and the masthead leads page one on its own. */
@page{size:A4;margin:12mm 10mm}
@media print{
  *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  body{background:#fff;font-size:10.5px}
  .wrap{max-width:none;padding:0}
  .card,.kpi,.strip-card{box-shadow:none;break-inside:avoid;page-break-inside:avoid}
  .kpi:hover,.kpi{transform:none}
  .mast{break-after:avoid}
  .bo,.reds table tr,.ft tr{break-inside:avoid;page-break-inside:avoid}
  .card h2,.sec-head{break-after:avoid}
  /* A4's text column is ~190 mm. Five KPI cards do not fit: one fr will not shrink
     below a card's min-content, and the 27px value plus its delta pill pushed the
     fifth card off the page. Four columns, minmax(0,·) so they may shrink, and the
     display figures step down for paper. (Proved by forcing the print rules on
     screen at 718px and looking at it — the validator checks colour, not layout.) */
  .kpi-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
  .kpi-val{font-size:20px;letter-spacing:-.6px}
  .kpi-w{font-size:8.5px;letter-spacing:.05em}
  .kpi-name{font-size:11px;min-height:26px}
  .delta{font-size:9px;padding:1px 5px}
  .strip{height:46px}
  .strip-l span{font-size:7.5px}
  .seg em{font-size:8.5px}
  .src{max-width:46ch}
  .foot{break-inside:avoid}
  a{color:inherit;text-decoration:none}
  thead{display:table-header-group}
}
@media(max-width:720px){
  .mast-right{margin-left:0;text-align:left}
  .sec-score{margin-left:0;text-align:left}
  table{font-size:11.5px}
}
</style>
</head>
<body style="${vizVars}">
<div class="wrap">

  <header class="mast">
    <div class="mast-top">
      ${logo ? `<div class="mast-logo"><img src="${logo}" alt="The Chatterbox"></div>` : ''}
      <div>
        <div class="mast-ttl">Executive Weekly Health Report</div>
        <div class="mast-sub">${esc(meta.periodLabel)} · issued ${esc(meta.issued)} · ${esc(meta.audience)}</div>
      </div>
      <div class="mast-right">
        <div class="big-score">${business.score === null ? '—' : business.score}<span>/100</span></div>
        <div class="big-band ${business.band.rag}">${esc(business.band.label)}</div>
        <div class="mast-meter">${meter(business.score, business.band.rag)}</div>
      </div>
    </div>
    <div class="mast-note">${esc(meta.headline)}</div>
    <div class="mast-bar">
      <span><b>${business.evidence}%</b> of the business score rests on a measured number</span>
      <span><b>${sections.filter(s => s.score !== null).length} of ${sections.length}</b> sections carried a score</span>
      <span><b>${esc(meta.roster)}</b></span>
      <span>Rule book <b>${esc(rules.version)}</b></span>
      <span>Confidential · internal</span>
    </div>
  </header>

  <section class="strip-card">
    <div class="strip-h">Where the business score comes from<span>each block is a section, as wide as its share of the score</span></div>
    <div class="strip">${sections.map(s => `<span class="seg ${s.band.rag}" style="flex:${s.weight}"
        title="${esc(s.label)} — ${s.weight}% of the score, ${s.score === null ? 'not measured' : s.score + '/100'} (${esc(s.band.label)})">
        <i style="height:${s.score === null ? 0 : Math.min(100, (s.score / (rules.viz?.scaleMax || 110)) * 100).toFixed(1)}%"></i>
        <em>${s.weight}%</em></span>`).join('')}</div>
    <div class="strip-l">${sections.map(s => `<span style="flex:${s.weight}">${esc(s.label.split(' — ')[0])}</span>`).join('')}</div>
  </section>

  <div class="kpi-grid">${kpiCards}</div>

  ${data.summary?.length ? `<section class="card">
    <h2>What an executive needs to do about it</h2>
    <div class="q">The 60-second test: what works, what is broken, who owns it, what action is live, where it escalates.</div>
    <ul style="margin:11px 0 0 18px;font-size:13px;line-height:1.7">
      ${data.summary.map(s => `<li>${esc(s)}</li>`).join('')}
    </ul>
  </section>` : ''}

  ${reds ? `<section class="card reds">
    <h2>Red issues — governed format</h2>
    <div class="q">A red number without an owner, an action and a due date is not governed (KB module 08).</div>
    <table style="margin-top:9px"><thead><tr>
      <th>Issue</th><th>Impact</th><th>Evidence</th><th>Owner</th><th>Action</th><th class="num">Due</th><th>Escalation</th>
    </tr></thead><tbody>${reds}</tbody></table>
  </section>` : ''}

  ${secBlocks}

  <section class="card">
    <h2>Data trust</h2>
    <div class="q">The sources never end on the same day. This is where each one stops, as at ${esc(meta.asAt)}.</div>
    <div class="src-row">${sources}</div>
    ${data.trustNote ? `<p class="comm" style="margin-top:11px">${esc(data.trustNote)}</p>` : ''}
  </section>

  <div class="foot">
    <b>How to read a score.</b> Every factor is scored against its own target, capped at 110, then weighted inside its
    section; the section is weighted by its share of the business. A factor with no reading leaves the denominator and the
    others renormalise — an absence is never counted as a nought, which is why every score is printed beside the share of it
    that rests on a measured number. Bands: ${rules.bands.map(b => `${esc(b.label)} ${b.min}+`).join(' · ')}.<br>
    <b>Basis.</b> <span class="pill actual">Actual</span> an engine computed it from an upload ·
    <span class="pill manual">Manual</span> a named person supplied it ·
    <span class="pill simulated">Simulated</span> a placeholder while the feed is built — shaded rows ·
    <span class="pill absent">No feed</span> nothing to score.<br>
    <b>Language.</b> Seat-level or modelled <i>contribution</i> only; never EBITDA before management accounts are tied out.<br>
    Generated by <code>tools/build-exec-report.mjs</code> from <code>specs/exec_scorecard_rules.json</code> ${esc(rules.version)}
    and <code>${esc(meta.dataFile)}</code>. Re-run the command to regenerate; never edit this page by hand.
  </div>
</div>
</body>
</html>`;
}

function renderMD(model) {
  const { meta, business, sections, data } = model;
  const L = [];
  L.push(`# Executive Weekly Health Report — The Chatterbox`);
  L.push('');
  L.push(`**${meta.periodLabel}** · issued ${meta.issued} · ${meta.audience}`);
  L.push('');
  L.push(`## Overall business health: ${business.score ?? '—'}/100 — ${business.band.label}`);
  L.push('');
  L.push(meta.headline);
  L.push('');
  L.push(`${business.evidence}% of the business score rests on a measured number; ${business.weightScored} of ${business.weightDeclared} points of section weight were scored. ${meta.roster}`);
  L.push('');
  L.push('| Section | Weight | Score | Band | Measured | Owner |');
  L.push('|---|---:|---:|---|---:|---|');
  sections.forEach(s => L.push(`| ${s.label} | ${s.weight}% | ${s.score ?? '—'} | ${s.band.label} | ${s.realCoverage}% | ${s.owner} |`));
  L.push('');
  if (data.summary?.length) {
    L.push('## What an executive needs to do about it');
    L.push('');
    data.summary.forEach(s => L.push(`- ${s}`));
    L.push('');
  }
  if (data.redIssues?.length) {
    L.push('## Red issues');
    L.push('');
    L.push('| Issue | Impact | Evidence | Owner | Action | Due | Escalation |');
    L.push('|---|---|---|---|---|---|---|');
    data.redIssues.forEach(r => L.push(`| ${r.issue} | ${r.impact} | ${r.evidence} | ${r.owner} | ${r.action} | ${r.due} | ${r.escalation} |`));
    L.push('');
  }
  sections.forEach(s => {
    L.push(`## ${s.label} — ${s.score ?? '—'}/100 (${s.band.label}, ${s.weight}% of the business score)`);
    L.push('');
    L.push(`*${s.question}*`);
    L.push('');
    L.push(`Owner: ${s.owner} · Exec: ${s.exec} · Evidence: ${s.realCoverage}% measured${s.thin ? ' — **thin evidence**' : ''}`);
    L.push('');
    if (data.sections[s.k]?.commentary) { L.push(data.sections[s.k].commentary); L.push(''); }
    L.push('| Factor | Reading | Target | Score | Weight | Basis |');
    L.push('|---|---:|---:|---:|---:|---|');
    s.rows.forEach(r => L.push(`| ${r.factor.label} | ${fmt(r.reading.value, r.factor.unit)} | ${r.reading.target === undefined || r.reading.target === null ? '—' : fmt(r.reading.target, r.factor.unit)} | ${r.score ?? '—'} | ${r.factor.w}${r.counts && r.effW !== r.factor.w ? ` → ${r.effW}` : ''} | ${BASIS_LABEL[r.reading.basis] || r.reading.basis} |`));
    L.push('');
    (data.sections[s.k]?.breakouts || []).forEach(bo => {
      if (!bo.rows?.length) return;
      L.push(`**${bo.title}**${bo.basis ? ` (${BASIS_LABEL[bo.basis] || bo.basis})` : ''}`);
      L.push('');
      L.push('| ' + bo.cols.join(' | ') + ' |');
      L.push('|' + bo.cols.map((_, i) => (i ? '---:' : '---')).join('|') + '|');
      bo.rows.forEach(r => L.push('| ' + r.join(' | ') + ' |'));
      L.push('');
    });
  });
  L.push('## Data trust');
  L.push('');
  L.push('| Source | Ends on | State |');
  L.push('|---|---|---|');
  (data.sources || []).forEach(s => L.push(`| ${s.name} | ${s.endsOn || '—'} | ${s.state || 'ok'} |`));
  L.push('');
  if (data.trustNote) { L.push(data.trustNote); L.push(''); }
  L.push('---');
  L.push('');
  L.push(`Generated by \`tools/build-exec-report.mjs\` from \`specs/exec_scorecard_rules.json\` and \`${meta.dataFile}\`. Scores are computed, never typed — re-run the command to regenerate.`);
  return L.join('\n');
}

/* ------------------------------------------------------------------- the run */

export function build(dir, { write = true } = {}) {
  const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  BANDS = rules.bands;
  const dataPath = join(dir, 'data.json');
  if (!existsSync(dataPath)) throw new Error(`no data.json in ${dir}`);
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));

  const declared = rules.sections.reduce((a, s) => a + s.weight, 0);
  if (declared !== 100) throw new Error(`section weights must sum to 100, got ${declared}`);
  rules.sections.forEach(s => {
    const fw = s.factors.reduce((a, f) => a + f.w, 0);
    if (fw !== 100) throw new Error(`${s.k}: factor weights must sum to 100, got ${fw}`);
  });

  const unknown = [];
  rules.sections.forEach(s => {
    Object.keys(data.sections?.[s.k]?.factors || {}).forEach(k => {
      if (!s.factors.some(f => f.k === k)) unknown.push(`${s.k}.${k}`);
    });
  });
  if (unknown.length) throw new Error(`data.json carries readings no rule names: ${unknown.join(', ')}`);

  const sections = rules.sections.map(s => scoreSection(s, data.sections?.[s.k]?.factors || {}, rules));
  const business = scoreBusiness(sections, rules);
  const meta = { ...data.meta, dataFile: join(dir.replace(ROOT + '/', ''), 'data.json') };
  const model = { meta, business, sections, data, rules };

  if (write) {
    writeFileSync(join(dir, 'index.html'), renderHTML(model));
    writeFileSync(join(dir, 'REPORT.md'), renderMD(model) + '\n');
    writeFileSync(join(dir, 'scores.json'), JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      rules: rules.version,
      period: meta.periodLabel,
      business,
      sections: Object.fromEntries(sections.map(s => [s.k, {
        score: s.score, band: s.band.label, weight: s.weight,
        coverage: s.coverage, measured: s.realCoverage,
        factors: Object.fromEntries(s.rows.map(r => [r.factor.k, { score: r.score, basis: r.reading.basis, effW: r.effW }]))
      }]))
    }, null, 2) + '\n');
  }
  return model;
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invoked) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node tools/build-exec-report.mjs <report-folder>   (folder must hold data.json)');
    process.exit(1);
  }
  const m = build(resolve(dir));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n  ${m.meta.periodLabel}`);
  console.log(`  OVERALL  ${m.business.score}/100  ${m.business.band.label}   (${m.business.evidence}% measured evidence)\n`);
  m.sections.forEach(s => console.log(
    `    ${pad(s.label, 34)} ${String(s.score ?? '—').padStart(5)}  ${pad(s.band.label, 12)} w${String(s.weight).padStart(3)}%  measured ${String(s.realCoverage).padStart(5)}%${s.thin ? '  THIN' : ''}`));
  console.log(`\n  wrote index.html · REPORT.md · scores.json in ${dir}\n`);
}
