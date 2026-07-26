/* Shared paths for the AgentOS verification suites. Everything generated lands in
   .work/ (gitignored); the repo root is resolved relative to this folder. */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const WORK = path.join(__dirname, '.work');
fs.mkdirSync(WORK, { recursive: true });
// Playwright-managed Chromium: default to the pinned CI/sandbox install; override
// with CBX_CHROME=/path/to/chrome when running elsewhere.
function chrome() {
  if (process.env.CBX_CHROME) return process.env.CBX_CHROME;
  const base = '/opt/pw-browsers';
  try {
    const hit = fs.readdirSync(base).find(d => /^chromium-\d+$/.test(d));
    if (hit) return path.join(base, hit, 'chrome-linux', 'chrome');
  } catch (e) {}
  return 'chromium';
}
module.exports = { ROOT, WORK, CHROME: chrome() };
