#!/usr/bin/env node
/* verify-vt-build.mjs — THE COMPANION FILES SHIP INSIDE THEIR PAGE (Spec Kit 071, Phase C task C9).
 *
 * PULSE loads vt-engine.js and vt-pages.js with <script src="X.js" data-inline></script>: from disk (file://) a relative
 * classic script just works, and tools/prepare-site.js replaces each tag with the file's text so the deployed shell is
 * still one file with one build id. Proves:
 *   B1  the real build passes its consistency check; site/pulse/index.html carries both files inlined, verbatim, and
 *       no data-inline tag is left; every shell carries the build id build.txt names; no site/tracker/
 *   B2  a tagged file that is missing FAILS the build (exit ≠ 0, named), in a throwaway copy of the build tool
 *   B3  an inlined file's text can never close the script tag early (</script → <\/script)
 *   B4  the SOURCE page from file:// exposes window.VTEngine and window.VTStation; so does the BUILT page from file://
 *
 *   node nicks_code/diagnostics/verify-vt-build.mjs [--no-build]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (d !== undefined ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);
const read = (p) => fs.readFileSync(p, 'utf8');

head('B1 · the real build');
if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, encoding: 'utf8' });
  ok(r.status === 0 && /Build consistency verified/.test(r.stdout), 'node tools/prepare-site.js passes its build-consistency check', (r.stderr || r.stdout).slice(-300));
}
const SRC = read(path.join(ROOT, 'nicks_code', 'index.html'));
const OUT = read(path.join(ROOT, 'site', 'pulse', 'index.html'));
for (const f of ['vt-engine.js', 'vt-pages.js']) {
  ok(SRC.includes('<script src="' + f + '" data-inline></script>'), 'the source page loads ' + f + ' with a data-inline tag');
  const code = read(path.join(ROOT, 'nicks_code', f)).replace(/<\/script/gi, '<\\/script');
  ok(OUT.includes('/* inlined ' + f + ' (tools/prepare-site.js) */\n' + code + '\n</script>'), 'site/pulse/index.html carries ' + f + ' inlined, verbatim');
}
ok(!/<script\b[^>]*\bdata-inline\b[^>]*>\s*<\/script>/i.test(OUT), 'no data-inline tag is left in the built page');
{ const bt = read(path.join(ROOT, 'site', 'build.txt')).trim(); const ids = ['index.html', 'pulse/index.html', 'agent/index.html', 'agent-preview/index.html']
    .map((s) => (read(path.join(ROOT, 'site', s)).match(/CBX_BUILD='([^']+)'/) || [])[1]);
  ok(ids.every((x) => x === bt), 'every shell carries the build id in build.txt (' + bt + ')', ids.join(',')); }
ok(!fs.existsSync(path.join(ROOT, 'site', 'tracker')), 'no site/tracker/ (Phase A) after the build');

head('B2 · a missing companion fails the build · B3 · </script is escaped');
{ const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-build-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools')); fs.mkdirSync(path.join(tmp, 'nicks_code'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'prepare-site.js'), path.join(tmp, 'tools', 'prepare-site.js'));
    fs.writeFileSync(path.join(tmp, 'Chatterbox_AgentOS_Analytics.html'), '<html><head></head><body></body></html>');
    fs.writeFileSync(path.join(tmp, 'nicks_code', 'index.html'), '<html><title>t</title><script src="gone.js" data-inline></script></html>');
    const r = spawnSync(process.execPath, [path.join(tmp, 'tools', 'prepare-site.js')], { cwd: tmp, encoding: 'utf8' });
    ok(r.status !== 0 && /INLINE FAILED: nicks_code\/index\.html tags gone\.js/.test(r.stderr), 'a data-inline file that is missing fails the build and is named', r.status + ' ' + r.stderr.slice(0, 200));
    fs.writeFileSync(path.join(tmp, 'nicks_code', 'index.html'), '<html><title>t</title><script data-inline src="x.js"></script></html>');
    const r2 = spawnSync(process.execPath, [path.join(tmp, 'tools', 'prepare-site.js')], { cwd: tmp, encoding: 'utf8' });
    ok(r2.status !== 0 && /INLINE FAILED/.test(r2.stderr), 'a data-inline tag in another shape fails the build instead of shipping unread', r2.stderr.slice(0, 160));
    fs.writeFileSync(path.join(tmp, 'nicks_code', 'x.js'), 'window.__x = "</script><b>not html</b>";');
    fs.writeFileSync(path.join(tmp, 'nicks_code', 'index.html'), '<html><title>t</title><script src="x.js" data-inline></script></html>');
    spawnSync(process.execPath, [path.join(tmp, 'tools', 'prepare-site.js')], { cwd: tmp, encoding: 'utf8' });
    const built = fs.existsSync(path.join(tmp, 'site', 'pulse', 'index.html')) ? read(path.join(tmp, 'site', 'pulse', 'index.html')) : '';
    ok(built.includes('window.__x = "<\\/script><b>not html</b>";'), 'a companion\'s "</script" is written as "<\\/script" (it cannot end the tag)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); } }

head('B4 · file://');
{ const { chromium } = req('playwright'); const browser = await chromium.launch();
  try {
    for (const [label, file] of [['the source page (nicks_code/index.html)', path.join(ROOT, 'nicks_code', 'index.html')], ['the built page (site/pulse/index.html)', path.join(ROOT, 'site', 'pulse', 'index.html')]]) {
      const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
      await page.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded' });
      const got = await page.waitForFunction(() => window.VTEngine && window.VTStation && { v: window.VTEngine.version, k: typeof window.VTStation.ingest, d: window.VTEngine.detect(['Installation Status', 'Vehicle Reg Number', 'Box Number', 'Unit Type', 'Case Number', 'Created By'], 'Export') }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
      ok(got && got.k === 'function' && got.d === 'vtBiFitted', label + ' from file:// exposes window.VTEngine (' + (got && got.v) + ') and window.VTStation', JSON.stringify(got));
      ok(!errs.some((e) => /VTEngine|VTStation|vt-engine|vt-pages/.test(e)), label + ': no VT page error', errs.join(' ; '));
      await page.close();
    }
  } finally { await browser.close(); } }
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
