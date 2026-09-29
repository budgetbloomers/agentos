#!/usr/bin/env node
/**
 * PostToolUse hook (Edit|Write) — invariant guard for the dashboard.
 * Fires after any file edit; acts only when the edited file is the dashboard HTML.
 * Exit 2 = block and feed the violation back to Claude so it fixes it immediately.
 *
 * Guards the business rules that must survive any refactor (see CLAUDE.md "Non-negotiables").
 */
const fs = require('fs');
const path = require('path');

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch (e) { process.exit(0); }
let payload = {};
try { payload = JSON.parse(input); } catch (e) { process.exit(0); }

const fp = (payload.tool_input && (payload.tool_input.file_path || payload.tool_input.filePath)) || '';
if (!fp) process.exit(0);
const base = path.basename(fp).toLowerCase();
const isDashboard = base === 'chatterbox_agentos_analytics.html' || (base === 'index.html' && fp.replace(/\\/g, '/').includes('/site/'));
if (!isDashboard) process.exit(0);

let html = '';
try { html = fs.readFileSync(fp, 'utf8'); } catch (e) { process.exit(0); }

const problems = [];

// 1. Composite weights must exist and sum to 100
const cw = html.match(/compositeWeights[\s\S]{0,120}?vals:\[([^\]]+)\]/);
if (!cw) problems.push('compositeWeights rule not found — the composite scorecard definition (25/20/20/15/10/5/5) must stay in DEFAULT_RULES.');
else {
  const sum = [...cw[1].matchAll(/:(\d+(?:\.\d+)?)'/g)].reduce((s, m) => s + parseFloat(m[1]), 0);
  if (Math.round(sum) !== 100) problems.push('Composite weights sum to ' + sum + ', not 100. Weights must sum to exactly 100 (framework section 7).');
}

// 2. Graduated R2A engine must remain present — as a CLASSIFIER only. There is no penalty
//    (Nick, 2026-09-11: "nba priority rules must not affect the agent scores"; 2026-09-29:
//    "remove the penalty"): no rule key, and the composite never subtracts one.
if (!/function\s+cfTier\s*\(/.test(html)) problems.push('cfTier() missing — the graduated critical-fail tier engine (R2A-1/-2/-3, higher of count/rate band) must not be removed.');
if (/'pen[123]:\d/.test(html)) problems.push('A pen1/pen2/pen3 key is back in the nbaThresholds rule — the composite penalty was removed (2026-09-29); the R2A tier classifies, it never deducts.');
if (/nbaVal\(\s*['"]pen[123]['"]/.test(html)) problems.push('Code reads a pen1/pen2/pen3 rule value — the composite penalty was removed (2026-09-29); tiers carry pen:0.');
if (/raw\s*-\s*pen\b|raw-\(?\s*(cfPen|coachPen)/.test(html)) problems.push('The composite subtracts a penalty again — Adj must equal the composite (penalty removed 2026-09-29).');

// 3. Decision ladder must remain a single-primary-NBA function
if (!/function\s+acNBA\s*\(/.test(html)) problems.push('acNBA() missing — the fixed-order decision ladder must stay in code.');

// 4. NBA thresholds must stay rules, not constants
if (!/nbaThresholds/.test(html)) problems.push('nbaThresholds rule missing — ladder thresholds must remain user-editable rules, not hardcoded values.');

// 5. Core hygiene primitives
if (!/function\s+normCB\s*\(/.test(html)) problems.push('normCB() missing — CB code normalisation is the identity join; it must not be removed.');
if (!/function\s+maskName\s*\(/.test(html)) problems.push('maskName() missing — PII masking must stay (POPIA).');

// 6. GWP floor check reference (value-first two-check rule)
if (!/gwpFloor/.test(html)) problems.push('gwpFloor threshold missing — Check 1 (VALUE, GWP/sale >= R99) must remain first in the two-check rule.');

if (problems.length) {
  console.error('DASHBOARD GUARD — non-negotiable invariant(s) broken by this edit:\n- ' + problems.join('\n- ') + '\nFix the edit so these invariants hold (see CLAUDE.md).');
  process.exit(2);
}

process.exit(0);
