/* Cloudflare Zero Trust Access — set up in front of chatterbox-agentos.pages.dev.
 *
 * The wrangler OAuth token has no Access scope, so the API cannot do this. This drives the
 * dashboard in a REAL browser window that Nick signs into, which is the same pattern the
 * project already uses for cloud writes (no credentials are stored anywhere, by design).
 *
 * It STOPS before anything is saved and prints what it is about to do, so nothing is
 * committed to the account without a look.
 */
import { chromium } from 'playwright';

const TEAM_HINT   = 'chatterbox';
const APP_DOMAIN  = 'chatterbox-agentos.pages.dev';
const ALLOW_DOMAIN = '@jamesbroley.com';
const BREAK_GLASS = 'a.jamesbroley@gmail.com';

const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

log('\n=== Cloudflare Zero Trust Access setup ===');
log('A browser window is open. Sign in to Cloudflare (and complete 2FA if prompted).');
log('I will wait for you, then take over.\n');

await page.goto('https://dash.cloudflare.com/', { waitUntil: 'domcontentloaded' });

// Wait until we are past the login screen — the dashboard URL carries the account id.
log('waiting for sign-in…');
await page.waitForFunction(
  () => !/\/login|\/sign-?up/.test(location.pathname) && document.querySelector('body')?.innerText?.length > 200,
  null, { timeout: 300000 }
);
log('signed in:', page.url());

// Zero Trust lives on a separate origin (one.dash.cloudflare.com) once enabled.
const ACC = '46e5ba08c800b1e753e8aa5e9e156d4f';
log('\nopening Zero Trust…');
await page.goto(`https://one.dash.cloudflare.com/${ACC}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const body = (await page.evaluate(() => document.body.innerText || '')).slice(0, 4000);
log('\n--- what the page shows ---');
log(body.split('\n').filter(l => l.trim()).slice(0, 40).join('\n'));
log('---------------------------\n');

const needsOnboarding = /team (name|domain)|choose a team|get started|onboard/i.test(body);
log(needsOnboarding
  ? `Zero Trust is NOT yet enabled — it wants a team domain. Suggested: "${TEAM_HINT}" (login URL becomes ${TEAM_HINT}.cloudflareaccess.com).`
  : 'Zero Trust appears to be enabled already.');

log(`\nNEXT, once Zero Trust is enabled, the application to create is:
  type            self-hosted
  name            Chatterbox AgentOS
  session         24 hours
  domain          ${APP_DOMAIN}   (subdomain and path both blank)
  policy          "Chatterbox staff", action Allow
    include       emails ending in ${ALLOW_DOMAIN}
    include       email is ${BREAK_GLASS}      <-- break-glass; the CF account owner
                                                   is NOT on ${ALLOW_DOMAIN}
  identity        One-time PIN
`);
log('Browser left open so you can finish or hand back. Press Ctrl+C here when done.');

await new Promise(() => {});   // hold the window open
