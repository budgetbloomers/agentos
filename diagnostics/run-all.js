/* Runs every verification suite in order; exits non-zero on any failure. */
const { execFileSync } = require('child_process');
const steps = [
  ['prep (fixtures + hermetic app copies)', ['prep.js']],
  ['Ops rules & calculations golden', ['golden.js']],
  ['Ops display sweep (every page, filters, masking, live RAG)', ['display_sweep.js']],
  ['Upload merge / performance harness', ['harness.js', 'current']],
  ['Ask widget rendering (both widgets)', ['widget_test.js']],
  ['PULSE (VAS) golden via __mtd', ['pulse_golden.js']],
  ['Tracker save-path smoke', ['tracker_test.js']],
  ['Large-file upload (250k-row CallX, gzip round-trip)', ['bigfile_test.js']],
];
let failed = 0;
for (const [name, args] of steps) {
  console.log('\n=== ' + name + ' ===');
  try { execFileSync(process.execPath, args, { cwd: __dirname, stdio: 'inherit' }); }
  catch (e) { failed++; console.error('*** SUITE FAILED: ' + name); }
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nALL SUITES PASSED');
process.exit(failed ? 1 : 0);
