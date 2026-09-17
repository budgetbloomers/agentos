#!/usr/bin/env node
/**
 * verify-composite-recompute.mjs — every agent's rating, recomputed from scratch.
 *
 *   node nicks_code/diagnostics/verify-composite-recompute.mjs
 *
 * Nick, 2026-09-08: "do checks on all the agents rating and make sure is good, correct calculations
 * are being applied". verify-composite-score proves the ENGINE matches the RULE BOOK on fixtures;
 * verify-agent-card proves the PAGE paints what the engine published. This closes the triangle:
 * it takes the live digest's raw day rows and, using nothing but specs/composite_rules.json,
 * recomputes for EVERY rated agent —
 *   · the window (last 5 worked sessions) and the scheduled window (last 5 employed days);
 *   · Avg GWP per Sale, Target Achievement, Total GWP, Conversion, Talk Time, Attendance and their
 *     targets (QA has no per-day detail in the digest: its value is taken as published and only its
 *     points, target and verdict are re-derived);
 *   · the points formula (bar changes shade at half the target; points start there), the
 *     renormalised score, the compliance penalty, the band and the distance to the next band;
 *   · the period totals the card quotes against the sum of the day rows —
 * and fails on any disagreement beyond rounding. Read-only.
 */
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'composite_rules.json'), 'utf8'));
const VAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'mtd_engine_rules.json'), 'utf8')).reference_data.vat_multiplier.value;
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };
const near = (a, b, tol = 0.051) => a != null && b != null && Math.abs(a - b) <= tol;

/* Optional: a digest FILE instead of the live one (`node verify-composite-recompute.mjs path.json`) —
   to prove a rule-book change against a digest built from the new build BEFORE it is published,
   when the live digest still carries the old rule (2026-09-11: the R2A penalties going to 0). */
let buf = process.argv[2] ? fs.readFileSync(process.argv[2])
  : Buffer.from(await (await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/agent-digest', { headers: H })).arrayBuffer());
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
const D = JSON.parse(buf.toString());
const rated = D.agents.filter((a) => a.composite && a.composite.rated);
console.log('digest ' + D.updatedAt + ' · ' + D.agents.length + ' agents, ' + rated.length + ' rated · rule book v' + R.version + ' · window ' + R.windowSessions + ' · floor ' + R.floor);

const F = +R.floor, N = +R.windowSessions;
const group = (tenure, camp) => {
  const t = String(tenure || '').trim().toLowerCase(), c = String(camp || '').trim().toLowerCase(); const norm = t.startsWith('exp') ? 'experienced' : t;
  const find = (cc) => R.tenureGroups.find((g) => { const gt = String(g.tenure || '').toLowerCase(), gc = String(g.campaign || '').toLowerCase(); return (!gt || gt === norm) && (!gc || gc === cc); }) || null;
  return find(c) || ((c && !/^(courtesy|cuddle|nesting|vt)$/.test(c)) ? find('courtesy') : null);
};
const pointsFor = (v, t, w) => { if (v == null || t == null || t === 0) return null; const att = Math.max(0, Math.min(1, v / t)); return Math.round(Math.max(0, Math.min(1, (att - F) / (1 - F))) * w * 10) / 10; };
const sum = (rows, k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
const stats = { window: {}, groups: {}, bands: {}, driversOff: {} };

for (const a of rated) {
  const id = a.code + ' ' + (a.name || '');
  const days = (a.days || []).slice().sort((x, y) => x.d.localeCompare(y.d));
  const win = days.filter((r) => r.act > 0).slice(-N);
  const sched = days.filter((r) => r.emp > 0).slice(-N);
  const c = a.composite; const P = Object.fromEntries(c.parts.map((p) => [p.k, p]));
  stats.window[win.length] = (stats.window[win.length] || 0) + 1;
  const grp = group(a.tenure, a.campaign); stats.groups[grp ? grp.label : 'NONE'] = (stats.groups[grp ? grp.label : 'NONE'] || 0) + 1;
  ok(id + ': window = last ' + N + ' worked sessions', c.window === win.length && (!win.length || (c.windowFrom === win[0].d && c.windowTo === win[win.length - 1].d)), c.window + ' ' + c.windowFrom + '→' + c.windowTo + ' vs ' + win.length + ' ' + (win[0] || {}).d + '→' + (win[win.length - 1] || {}).d);
  ok(id + ': has a tenure group', !!grp, a.tenure + '/' + a.campaign);
  const floorEx = Math.floor(((grp && grp.minGwpSale) || R.gwpFloorDefault) / VAT * 100) / 100;
  const s = sum(win, 's'), x = sum(win, 'x'), t = sum(win, 't'), tk = sum(win, 'tk'), actW = sum(win, 'act');
  const exp = {
    gwpSale:   { v: s > 0 ? x / s : null, t: floorEx },
    targetAch: { v: t > 0 ? s / t * 100 : null, t: R.targets.targetAch },
    qa:        { v: P.qa ? P.qa.value : null, t: R.targets.qa },                      // published value; no per-day QA in the digest
    gwpTotal:  { v: win.length ? x : null, t: win.length ? t * floorEx : null },
    /* more sales than leads on record is not a conversion — unmeasured (rule conv, 2026-09-15) */
    conv:      { v: (a.leads && (+a.sales || 0) <= a.leads) ? (+a.sales || 0) / a.leads * 100 : null, t: grp ? grp.convTarget : null },
    talk:      { v: actW > 0 ? (tk / 60) / actW : null, t: R.targets.talk },
    attendance:{ v: sum(sched, 'emp') > 0 ? sum(sched, 'act') / sum(sched, 'emp') * 100 : null, t: R.targets.attendance },
  };
  let raw = 0, wsum = 0;
  for (const def of R.drivers) {
    const p = P[def.k], e = exp[def.k]; if (!p) { ok(id + ' ' + def.k + ': part published', false, 'missing'); continue; }
    ok(id + ' ' + def.k + ': weight is the rule book\'s', p.w === def.w, p.w + ' vs ' + def.w);
    const measured = e.v != null && e.t != null && e.t !== 0;
    ok(id + ' ' + def.k + ': measured flag agrees', p.measured === measured, p.measured + ' vs ' + measured + ' (v ' + e.v + ', t ' + e.t + ')');
    if (measured && p.measured) {
      if (def.k !== 'qa') { const tol = def.k === 'gwpTotal' ? 0.02 : 0.051; ok(id + ' ' + def.k + ': value recomputed from the day rows', near(p.value, e.v, tol), p.value + ' vs ' + e.v); if (!near(p.value, e.v, tol)) stats.driversOff[def.k] = (stats.driversOff[def.k] || 0) + 1; }
      ok(id + ' ' + def.k + ': target is the rule book\'s', near(p.target, e.t, 0.011), p.target + ' vs ' + e.t);
      const pts = pointsFor(p.value, p.target, def.w);
      ok(id + ' ' + def.k + ': points follow the formula (shade at half, points start there)', near(p.points, pts, 0.051), p.points + ' vs ' + pts);
      ok(id + ' ' + def.k + ': verdict = value ≥ target', p.onTarget === (p.value >= p.target), p.onTarget + ' vs ' + (p.value >= p.target));
      ok(id + ' ' + def.k + ': available = weight − points', near(p.available, Math.max(0, def.w - p.points), 0.051), p.available + ' vs ' + (def.w - p.points));
      raw += p.points; wsum += def.w;
    } else if (!p.measured) ok(id + ' ' + def.k + ': an unmeasured driver carries no points and no verdict', p.points === 0 && p.onTarget === false && p.available === 0, JSON.stringify(p));
  }
  const score = Math.round(Math.min(100, wsum ? raw / wsum * 100 : 0) * 10) / 10;
  ok(id + ': score = Σpoints ÷ Σweights of measured drivers × 100', near(c.score, score, 0.051) && c.weightScored === wsum, c.score + ' vs ' + score + ' (weights ' + c.weightScored + ' vs ' + wsum + ')');
  const pen = Math.min(+R.combinedCap, (c.r2a && c.r2a.penalty || 0) + (c.cxPenalty || 0));
  ok(id + ': penalty is the compliance tier, capped', c.penaltyTotal === pen && c.penalty === (c.r2a && c.r2a.penalty || 0), c.penaltyTotal + ' vs ' + pen);
  const adj = Math.round(Math.max(0, c.score - pen) * 10) / 10;
  ok(id + ': adjusted = score − penalty (never below 0)', near(c.adj, adj, 0.051), c.adj + ' vs ' + adj);
  const band = (R.bands.find((b) => c.adj >= b.min) || R.bands[R.bands.length - 1]).label; stats.bands[band] = (stats.bands[band] || 0) + 1;
  ok(id + ': band from the adjusted score', c.band === band, c.band + ' vs ' + band);
  const next = R.bands.slice().reverse().find((b) => b.min > c.adj);
  ok(id + ': distance to the next band', (!next && !c.nextBand) || (next && c.nextBand && c.nextBand.label === next.label && near(c.nextBand.pointsAway, next.min - c.adj, 0.051)), JSON.stringify(c.nextBand) + ' vs ' + (next ? next.label + ' ' + (next.min - c.adj) : 'none'));
  ok(id + ': onTarget count', c.onTarget === c.parts.filter((p) => p.onTarget).length);
  const r2 = c.r2a || {}; const tier = R.r2aTiers.find((tt) => tt.tier === r2.tier);
  ok(id + ': compliance tier is a rule-book tier with its own penalty', !!tier && r2.penalty === tier.penalty, JSON.stringify(r2).slice(0, 120));
  /* the period figures the card quotes vs the day rows */
  ok(id + ': period sales = Σ day sales', (+a.sales || 0) === sum(days, 's'), a.sales + ' vs ' + sum(days, 's'));
  ok(id + ': period GWP = Σ day GWP', near(+a.gwpEx || 0, sum(days, 'x'), 0.02), a.gwpEx + ' vs ' + sum(days, 'x'));
  ok(id + ': period talk = Σ day talk', (+a.talk || 0) === sum(days, 'tk'), a.talk + ' vs ' + sum(days, 'tk'));
  ok(id + ': period shifts = Σ day shifts', (+a.act || 0) === sum(days, 'act') && (+a.emp || 0) === sum(days, 'emp'), a.act + '/' + a.emp + ' vs ' + sum(days, 'act') + '/' + sum(days, 'emp'));
  if (a.leads > 0 && P.conv && P.conv.measured) ok(id + ': conversion = period sales ÷ unique leads', near(P.conv.value, (+a.sales || 0) / a.leads * 100, 0.051), P.conv.value + ' vs ' + ((+a.sales || 0) / a.leads * 100));
}
const unrated = D.agents.filter((a) => a.composite && a.composite.rated === false);
ok('every unrated agent has no worked session (nothing to rate is not a zero)', unrated.every((a) => !(a.days || []).some((r) => r.act > 0)), unrated.filter((a) => (a.days || []).some((r) => r.act > 0)).map((a) => a.code).join(' '));

console.log('\nwindows (sessions → agents): ' + JSON.stringify(stats.window) + '\ngroups: ' + JSON.stringify(stats.groups) + '\nbands: ' + JSON.stringify(stats.bands) + (Object.keys(stats.driversOff).length ? '\nDRIVERS OFF: ' + JSON.stringify(stats.driversOff) : ''));
for (const f of failures.slice(0, 60)) console.log('  FAIL ' + f);
if (failures.length > 60) console.log('  … ' + (failures.length - 60) + ' more');
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed  (' + rated.length + ' agents recomputed) ====');
process.exit(fail ? 1 : 0);
