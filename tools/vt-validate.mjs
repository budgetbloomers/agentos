/* VT VALIDATE — the Vehicle Tracking half of the Upload Station validator (spec 071, F2).
 *
 * tools/upload-station-validate.mjs validates a day's upload folder. Since spec 071 that folder can also hold the three
 * Vehicle Tracking files — "BI Active Fitted <ddmmyy>.xlsx", "Scheduled & Missed <ddmmyy>.xlsx" and the master VT
 * report, whose "Schedulers Data" sheet is the Schedulers Data upload (spec 072; it REPLACED the once-only "opening
 * book" slot, which read the same sheet for the sale date alone — RETIRED below). This module recognises them with the
 * ENGINE's own detection
 * (nicks_code/vt-engine.js — never a second copy of the signatures), parses them with the engine's parsers, and checks:
 *   · the signature (the columns the engine reads by position are where it reads them)
 *   · the extract date from the file name (a name without ddmmyy is dated "today" by the station, and flagged)
 *   · VT lines present, and the thin-pull share against an earlier file of the same kind in the folder (guardUpload)
 *   · both daily files present together; the Schedulers Data file is flagged "load after the first day's two files"
 *   · the Agent List's VT sheet: each rated agent's Target equals the business month's Sales Review SPD budget for their
 *     sub-campaign and tenure (warn on mismatch — A1); a Scheduling agent's "-" is expected (not rated in v1)
 * Pure apart from the workbook objects it is handed. Findings are {sev, area, msg} like the validator's.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VT = require(path.join(HERE, '..', 'nicks_code', 'vt-engine.js'));
/* spec 072 U-1/U-3: the third file is the master report's Schedulers Data sheet. The retired 'VT opening book' slot
   is named as retired wherever a stored receipt or an old habit still calls it that. */
const KIND = { vtBiFitted: 'BI Active Fitted', vtSchedMissed: 'Scheduled & Missed', vtSchedulers: 'Schedulers Data' };
const RETIRED = { opening_book: 'the VT opening book slot, retired by spec 072 - the same sheet is now the Schedulers Data upload' };
const GUARD_KIND = { vtBiFitted: 'bi', vtSchedMissed: 'sm', vtSchedulers: 'schedulers' };

/** Which sheet of a workbook is a VT file, if any: {kind, sheet, aoa} | null. `sheets` = {name: aoa}. */
export function detectVtWorkbook(sheets) {
  for (const [name, aoa] of Object.entries(sheets || {})) {
    const kind = VT.detect((aoa && aoa[0]) || [], name);
    if (kind) return { kind, sheet: name, aoa };
  }
  return null;
}

/**
 * files: [{name, sheets:{sheetName: aoa}}]   agentList: {sheetName: aoa} | null   periodEnd: 'YYYY-MM-DD'
 * → {sources:[{name, kind, label, extractOn, assumed, rows, vtLines}], findings:[{sev, area, msg}], vtFiles:Set<name>}
 */
/** The names a VT upload kind has answered to, for a receipt or a folder that still uses the old one (spec 072 U-3). */
export function retiredSlotNote(dbKind) { return RETIRED[String(dbKind || '')] || null; }

export function validateVtPackage({ files = [], agentList = null, periodEnd = null } = {}) {
  const findings = [], sources = [], vtFiles = new Set();
  const f = (sev, msg) => findings.push({ sev, area: 'VT', msg });
  for (const file of files) {
    const hit = detectVtWorkbook(file.sheets);
    if (!hit) continue;
    /* THE BI HEADER IS SHARED (rule book vt-1.3, incident 2026-11-24): the VAS "BI Active <ddmmyy>.xlsx" export has the same
       columns as "BI Active Fitted". Without the slot to say which (a folder has none), the NAME decides, as in the station:
       no "Fitted" (detection.vtBiFitted.nameHint) = the VAS BI Active export, never validated as Vehicle Tracking. */
    if (hit.kind === 'vtBiFitted' && !VT.isBiFittedName(file.name)) {
      f('LOW', `${file.name}: has the BI Active columns but no "Fitted" in its name — read as the VAS BI Active export, not Vehicle Tracking (the Vehicle Tracking file must keep "Fitted" in its name).`);
      continue;
    }
    vtFiles.add(file.name);
    const label = KIND[hit.kind];
    const ex = VT.extractDate(file.name, periodEnd);
    const src = { name: file.name, kind: hit.kind, label, sheet: hit.sheet, extractOn: ex.date, assumed: ex.assumed, rows: 0, vtLines: 0, cases: 0 };
    if (ex.assumed) f('HIGH', `${file.name}: the file name carries no ddmmyy date, so the Upload Station would date it TODAY — rename it to the day it was pulled (e.g. "${label} 211126.xlsx").`);
    if (hit.kind === 'vtSchedulers') {
      const p = VT.parseSchedulers(hit.aoa);
      src.cases = Object.keys((p && p.cases) || {}).length; src.rows = (p && p.rows) || 0; src.skippedBlank = (p && p.skippedBlank) || 0;
      if (p.missing && p.missing.length) f('CRITICAL', `${file.name}: looks like the Schedulers Data sheet but the engine cannot find ${p.missing.join(', ')} — the sheet's column layout changed; the station will refuse it.`);
      else if (p.duplicates && p.duplicates.length) f('CRITICAL', `${file.name}: ${p.duplicates.length} case number(s) appear more than once (${p.duplicates.slice(0, 5).join(', ')}) — one row is one case, so the station refuses the whole file.`);
      else f('MEDIUM', `${file.name}: the Schedulers Data sheet of the master VT report — ${src.cases} cases, ${src.skippedBlank} empty rows skipped. It supplies the scheduler, the GWP and the true sale date, may be re-uploaded as often as the master is updated, and NEVER changes a status (its Result column is counted as a disagreement, never applied). The station refuses it on an empty book: load it after the first day's two daily files.`);
      (p.warnings || []).slice(0, 5).forEach((w) => f('MEDIUM', `${file.name}: ${typeof w === 'string' ? w : JSON.stringify(w)}`));
    } else {
      const p = hit.kind === 'vtBiFitted' ? VT.parseBi(hit.aoa) : VT.parseSm(hit.aoa);
      src.rows = p.rows || 0; src.vtLines = p.vtLines != null ? p.vtLines : (p.lines || 0); src.cases = Object.keys(p.cases || {}).length;
      if (p.missing && p.missing.length) f('CRITICAL', `${file.name}: looks like ${label} but the engine cannot find ${p.missing.join(', ')} — the export's column layout changed; the station will refuse it.`);
      else if (!src.cases) f('HIGH', `${file.name}: ${label} with no Vehicle Tracking lines (${src.rows} rows read) — the station refuses it ("This file has no Vehicle Tracking lines").`);
      (p.warnings || []).slice(0, 5).forEach((w) => f('MEDIUM', `${file.name}: ${typeof w === 'string' ? w : JSON.stringify(w)}`));
    }
    sources.push(src);
  }
  /* The thin-pull guard: each file against the EARLIER file of its kind in the same folder. The Schedulers Data
     sheet rides it too (spec 072 U-6, engine guardUpload kind 'schedulers'): the master sheet is the whole history,
     so its case count only grows and a suddenly short one is a bad export — the station refuses it, so the
     validator must say so first. */
  for (const kind of ['vtBiFitted', 'vtSchedMissed', 'vtSchedulers']) {
    const ofKind = sources.filter((s) => s.kind === kind).sort((a, b) => String(a.extractOn).localeCompare(String(b.extractOn)));
    for (let i = 1; i < ofKind.length; i++) {
      const g = VT.guardUpload(GUARD_KIND[kind], ofKind[i].cases, ofKind[i - 1].cases, false);
      if (!g.ok) f('HIGH', `${ofKind[i].name}: ${g.reason} (against ${ofKind[i - 1].name}) — re-pull it before loading.`);
    }
  }
  const has = (k) => sources.some((s) => s.kind === k);
  if (has('vtBiFitted') !== has('vtSchedMissed')) f('MEDIUM', `Only the ${has('vtBiFitted') ? 'BI Active Fitted' : 'Scheduled & Missed'} file is here — the day needs both; a missing day shifts first-seen sale days to the next upload.`);
  for (const k of ['vtBiFitted', 'vtSchedMissed', 'vtSchedulers']) {
    const days = sources.filter((s) => s.kind === k).map((s) => s.extractOn);
    const dup = days.filter((d, i) => d && days.indexOf(d) !== i);
    if (dup.length) f('MEDIUM', `Two ${KIND[k]} files carry the same extract date ${dup[0]} — the station keeps the first and refuses the same bytes twice; check which is the real pull.`);
  }
  findings.push(...vtTargetFindings(agentList, periodEnd));
  return { sources, findings, vtFiles };
}

/** the Agent List's VT sheet against the business month's Sales Review SPD budgets (A1). Pure. */
export function vtTargetFindings(agentList, periodEnd) {
  const out = [];
  if (!agentList) return out;
  let rows = [];
  for (const [, aoa] of Object.entries(agentList)) {
    const r = VT.parseRoster(aoa || [], null, null);
    if (r.length) { rows = r; break; }
  }
  if (!rows.length) return out;
  const cyc = VT.periods.cycleOf(periodEnd || new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10)).key;
  const bud = VT.budgetFor(cyc);
  if (!bud) { out.push({ sev: 'HIGH', area: 'VT', msg: `No Sales Review budgets in the VT rule book for ${cyc} or any earlier month — the VT Targets cannot be checked and no VT agent can be rated.` }); return out; }
  if (bud.cycle !== cyc) out.push({ sev: 'MEDIUM', area: 'VT', msg: `The VT rule book has no Sales Review budgets for ${cyc}; the targets are checked against ${bud.cycle} (the engine's fallback). Add ${cyc} to specs/vt_engine_rules.json and nicks_code/vt-engine.js.` });
  const notRated = new Set((VT.VT_RULES.teams && VT.VT_RULES.teams.notRated) || []);
  const mism = [], none = []; let sched = 0;
  for (const a of rows) {
    if (notRated.has(a.sub)) { sched++; continue; }
    const want = VT.spdBudget(bud, a.sub, a.tenure);
    if (a.target == null) { none.push(a.code); continue; }
    if (want != null && Math.abs(a.target - want) > 1e-9) mism.push(`${a.code} (${a.sub}/${a.tenure || '?'}: list ${a.target}, budget ${want})`);
  }
  if (none.length) out.push({ sev: 'HIGH', area: 'VT', msg: `${none.length} rated VT agent(s) carry no Target on the Agent List (${none.join(', ')}) — their Target Achievement is "not measured", never guessed.` });
  if (mism.length) out.push({ sev: 'MEDIUM', area: 'VT', msg: `${mism.length} VT agent(s) carry a Target that differs from the ${bud.cycle} Sales Review SPD budget: ${mism.slice(0, 12).join('; ')}${mism.length > 12 ? ' …' : ''}. The list's Target is what the engine uses — check which one is right.` });
  out.push({ sev: 'LOW', area: 'VT', msg: `VT sheet: ${rows.length} agents (${sched} Scheduling — no Target expected, not rated in v1); Targets checked against the ${bud.cycle} SPD budgets.` });
  return out;
}
