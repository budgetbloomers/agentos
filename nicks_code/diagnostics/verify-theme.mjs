#!/usr/bin/env node
/**
 * verify-theme.mjs — the per-account theme toggle (Nick, 2026-08-30).
 *
 * Run:  node nicks_code/diagnostics/verify-theme.mjs
 *
 * The failure modes this exists to catch, all of which are invisible until
 * somebody signs in and the page is the wrong colour:
 *
 *   A. LIGHT MUST NOT REGRESS. Light is the suite's one skin; every dark rule
 *      is scoped to [data-theme="dark"] so the default path is untouched.
 *   B. NO FLASH. Each app stamps the cached theme BEFORE its stylesheet, and
 *      nothing later in the file overwrites a dark choice.
 *   C. THE ACCOUNT IS THE RECORD. The value round-trips through app_users, the
 *      session carries it, and the cache is only ever written from a confirmed
 *      server answer.
 *   D. TWO VALUES ONLY. Anything the stylesheets cannot render is refused.
 *   E. THE AGENT APP IS NOT COVERED, deliberately — it has no dark palette, so
 *      the route stays off PORTAL_ALLOWED and the app ships no toggle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
const head = (t) => console.log('\n' + t);

const APPS = [
  ['Ops', 'Chatterbox_AgentOS_Analytics.html'],
  ['VAS (PULSE)', 'nicks_code/index.html'],
  ['Tracker', 'tracker/index.html'],
];
const css = (s) => (s.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');

head('A · light does not regress');
for (const [name, file] of APPS) {
  const s = read(file);
  const c = css(s);
  /* Every dark declaration must be behind the attribute. A bare token change
     would repaint light for everybody who never asked for dark. */
  const darkBlocks = c.match(/:root\[data-theme="dark"\][^{]*\{[^}]*\}/g) || [];
  ok(darkBlocks.length > 0, name + ': has a [data-theme="dark"] block');
  const bareDarkBg = /(?:^|\n)\s*(?::root|body)\s*\{[^}]*background[^;}]*#0[0-9A-F]{5}/i.test(c);
  ok(!bareDarkBg, name + ': no dark ground leaked into the default :root/body');
}

head('B · no flash, and nothing overwrites the choice');
for (const [name, file] of APPS) {
  const s = read(file);
  const boot = s.indexOf('localStorage.getItem("cbx_theme")');
  ok(boot > -1, name + ': stamps the cached theme in a pre-paint snippet');
  const firstStyle = s.indexOf('<style');
  ok(boot > -1 && firstStyle > -1 && boot < firstStyle, name + ': that snippet runs BEFORE the first stylesheet');
  /* The bug this catches for real: PULSE used to end with a bare
     dataset.theme='light', which would have overwritten a dark account on
     every load, several thousand lines after the snippet set it. */
  const forced = s.match(/dataset\.theme\s*=\s*['"]light['"]/g) || [];
  const guarded = /dataset\.theme!=='dark'\)\s*document\.documentElement\.dataset\.theme='light'/.test(s.replace(/\s+/g, ''))
    || /dataset\.theme=\(t==="dark"\)\?"dark":"light"/.test(s);
  ok(forced.length === 0 || guarded, name + ': no unguarded force back to light');
}

head('C · the account is the record');
const auth = read('worker/src/auth.mjs');
ok(/app_users\([^)]*\btheme\b[^)]*\)/.test(auth), 'the session select carries theme, so /api/me returns it');
const idx = read('worker/src/index.mjs');
ok(idx.includes("path === '/api/theme'"), 'POST /api/theme exists');
ok(/app_users\?username=eq\.\$\{encodeURIComponent\(user\.username\)\}/.test(idx),
  'it writes the SESSION\'s username — never one supplied by the caller');
const gate = read('site/auth-gate.js');
ok(gate.includes('themeSync(window.CBX_USER)'), 'sign-in reconciles the cache against the account');
ok(/function themeCache[\s\S]{0,220}removeItem\(THKEY\)/.test(gate),
  'an account with no preference CLEARS the local cache (a stale dark cannot survive)');
ok(/themeCache\(picked\);\s*themeApply\(picked\)/.test(gate) && gate.indexOf('themeCache(picked)') > gate.indexOf("api('/api/theme'"),
  'the cache is written only AFTER the server confirms the save');

head('D · two values only');
ok(idx.includes("t !== 'light' && t !== 'dark'"), 'the Worker refuses anything but light/dark');
const mig = read('supabase/migration-013-user-theme.sql');
ok(/check \(theme is null or theme in \('light', 'dark'\)\)/.test(mig), 'and the column has the same check constraint');

head('E · the toggle is a real, explicit save');
ok(gate.includes('cbxThSave') && gate.includes('Previewing'), 'clicking a swatch previews; Save persists');
ok(/var close = function \(\) \{ themeApply\(themeRead\(\)\);/.test(gate),
  'cancelling or dismissing restores the SAVED theme — a preview never sticks');
ok(gate.includes('addThemeButton()'), 'the button is added on sign-in');

head('F · Agent Analytics is deliberately not covered');
const portal = read('worker/src/portal.mjs');
ok(!portal.includes("'/api/theme'"), '/api/theme is NOT on PORTAL_ALLOWED');
const agent = read('agent/index.html');
ok(!agent.includes('cbx_theme'), 'the agent app ships no theme toggle (it has no dark palette)');
/* the phrase appears in the file's own header comment explaining WHY it does
   not load the gate — assert on the script tag, not on the prose */
ok(!/<script[^>]+src=["'][^"']*auth-gate\.js/.test(agent), 'and still does not load the management gate');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
