#!/usr/bin/env node
/**
 * `npm test` — every test/*.test.mjs in its own process (each is a self-contained guard that exits non-zero on a
 * failure), in order; the run fails if any file fails. No credentials: every suite stubs Supabase, HighLevel and the
 * kitchen webhook. Set WIMPY_SKIP_BROWSER=1 to skip the Chromium sections (see _harness.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs') && (!only.length || only.some((o) => f.includes(o)))).sort();
const results = [];
for (const f of files) {
  console.log('\n======== ' + f + ' ========');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit', env: process.env });
  results.push({ f, code: r.status, ms: Date.now() - t0 });
}
console.log('\n==== wimpy-service tests ====');
for (const r of results) console.log('  ' + (r.code === 0 ? 'ok   ' : 'FAIL ') + r.f + ' (' + (r.ms / 1000).toFixed(1) + ' s)');
const failed = results.filter((r) => r.code !== 0);
console.log(failed.length ? failed.length + ' of ' + results.length + ' files FAILED' : 'all ' + results.length + ' files passed');
process.exit(failed.length ? 1 : 0);
