/**
 * Shared bits for the service's test files (Spec Kit 018). The files keep the suite's guard style — ok()/head() and a
 * pass/fail summary, exit code non-zero on any failure — so a port from nicks_code/diagnostics reads unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVICE = path.resolve(HERE, '..');

/* Playwright is a dev dependency; the suite already carries one for its own guards. Resolved from either place. Absent:
   the browser section FAILS — unless WIMPY_SKIP_BROWSER=1, in which case it is skipped LOUDLY (every browser section is
   the last in its file, so the file ends there with the checks it has). */
const CANDIDATES = [
  path.join(SERVICE, 'node_modules', 'playwright', 'index.mjs'),
  path.join(SERVICE, '..', 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs'),
];
export async function playwright() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return import(pathToFileURL(p).href);
  if (process.env.WIMPY_SKIP_BROWSER === '1') {
    console.log('\n  SKIP  browser section — Playwright not found and WIMPY_SKIP_BROWSER=1 (npm i, or npx playwright install chromium in nicks_code/diagnostics)');
    process.exit(process.exitCode || 0);
  }
  throw new Error('Playwright not found in ' + CANDIDATES.join(' or ') + ' — npm install (and npx playwright install chromium), or set WIMPY_SKIP_BROWSER=1 to skip the browser checks');
}
