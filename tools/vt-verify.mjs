#!/usr/bin/env node
/* VT VERIFY — the Vehicle Tracking proofs the local tick runs once a day (spec 071, Phase F item 1).
 *
 *   node tools/vt-verify.mjs
 *
 * GitHub Actions is off (2026-09-16), so the nightly proof in publish-digests.yml does not run; the local tick
 * (tools/tick-local.mjs) is what runs on a schedule. This is the cheap half of the VT suites — pure Node, no browser, no
 * network, no credentials — so the tick stays fast: the rule book drift guard, the calendar, the rating, the engine, the
 * engine against the November reference report (skips without ../reference/zips/vt/), the VT Report's own views, its
 * .xlsx export and its oracle over the owner's master workbook (spec 072; skips without ../reference/zips/vt-master/),
 * the health logic, the validator and the two permission tools. The tick stamps the result as the `verify-vt` step in kv:jobs-status, and a red stamp raises
 * the existing "verification-failed" banner (worker/src/health.mjs). The browser suites stay in verify.yml / by hand.
 * Exit 0 = all green; otherwise the last line names the red suites.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* spec 072 E4: the three pure 072 suites join the daily tick — the dashboard's own views and integrity verdicts
   (verify-vt-views, ~0.3 s), the .xlsx export against the model (verify-vt-export, ~0.3 s) and the oracle over the
   owner's master workbook (verify-vt-report-oracle, ~3.2 s, which SKIPS where ../reference/zips/vt-master/ is not on
   the machine). About 3.8 s added. The BROWSER suite for the page (verify-vt-dashboard) stays out of the tick and
   runs in .github/workflows/verify.yml and by hand, like every other browser suite. */
export const VT_PURE_SUITES = ['verify-vt-rules', 'verify-vt-periods', 'verify-vt-rating', 'verify-vt-engine', 'verify-vt-oracle',
  'verify-vt-views', 'verify-vt-report-oracle', 'verify-vt-export',
  'verify-vt-health', 'verify-vt-validate', 'verify-grant-tabs-071', 'verify-audit-permissions-071'];

export function runAll(suites = VT_PURE_SUITES, run = (s) => spawnSync(process.execPath, [path.join(ROOT, 'nicks_code', 'diagnostics', s + '.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 300000, windowsHide: true })) {
  const out = [];
  for (const s of suites) {
    const t0 = Date.now(); const r = run(s);
    const m = /(\d+)\s+passed,\s*(\d+)\s+failed/.exec(String(r.stdout || '')) || /(\d+) passed, (\d+) failed/.exec(String(r.stdout || ''));
    out.push({ suite: s, ok: r.status === 0, passed: m ? +m[1] : null, failed: m ? +m[2] : null, ms: Date.now() - t0 });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const res = runAll();
  for (const r of res) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.suite.padEnd(30)} ${r.passed ?? '?'} passed, ${r.failed ?? '?'} failed  (${Math.round(r.ms / 100) / 10} s)`);
  const red = res.filter((r) => !r.ok);
  const total = Math.round(res.reduce((s, r) => s + r.ms, 0) / 1000);
  console.log(red.length ? `FAILED: ${red.map((r) => r.suite + (r.failed != null ? ' (' + r.failed + ' failed)' : '')).join(', ')} — ${total} s` : `all ${res.length} VT suites green — ${total} s`);
  process.exitCode = red.length ? 1 : 0;
}
