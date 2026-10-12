/**
 * THE NODE SERVER — the container's entry point (Spec Kit 018). `node src/server.mjs`.
 *
 * Forty lines of adapter: a Node http request becomes a Web Request, handle() answers, the Response is written back.
 * The page (public/index.html) is served at / with the same security headers. Two things the platform used to do are
 * done here instead:
 *   · ctx.waitUntil — the ledger row and the HighLevel card are written AFTER the order's reply (wimpy.mjs recordOrder);
 *     every such promise is kept in `inflight` and SIGTERM/SIGINT drain it (≤ 20 s) before the process exits, so a
 *     container restart never loses a card that was being written;
 *   · the retry cron — setInterval every RETRY_EVERY_MIN minutes (default 20; 0 disables) runs retryDueOrders, the job
 *     the Worker ran at :07/:27/:47. On Vercel this is vercel.json's cron instead; this timer never runs there.
 *
 * THE CLIENT ADDRESS: unless TRUST_PROXY is set, any x-forwarded-for / x-real-ip a client sends is DROPPED and the
 * socket's address is written to x-wimpy-socket-ip (overwritten on every request — app.mjs clientIp reads only that).
 * Behind a reverse proxy set TRUST_PROXY=1 and the proxy's x-forwarded-for is used.
 *
 * STARTUP REFUSES TO RUN UNCONFIGURED: without SUPABASE_URL and SUPABASE_SECRET_KEY it exits 1 naming the variable.
 * The HighLevel key/location and CRON_SECRET are optional (ordering works; cards wait; see wimpy-hl.mjs).
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { dbConfigured, VERSION } from './app.mjs';
import { nodeRequestHandler } from './node-adapter.mjs';
import { trustsProxy } from './net.mjs';
import { retryDueOrders, dbWhy, hlConfigured } from './wimpy-hl.mjs';
import { db } from './db.mjs';

const DRAIN_MS = 20000;
export const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'];

/** The http.Server, with `drain()` (awaits in-flight background work) and `ctx` exposed for tests. */
export function createServer(env, opts = {}) {
  const inflight = new Set();
  const ctx = { waitUntil(p) { const q = Promise.resolve(p).catch(() => {}); inflight.add(q); q.finally(() => inflight.delete(q)); } };
  const trust = trustsProxy(env);
  /* the request/response plumbing is src/node-adapter.mjs — shared with the Vercel entry; the page itself is served by
     handle() (app.mjs page()) — one place for both hosts */
  const server = http.createServer(nodeRequestHandler(env, ctx, { trust }));
  /* drain LOOPS: a request still running when the drain starts registers its waitUntil work after the first snapshot
     (an order awaiting the kitchen webhook registers the ledger chain only once the kitchen answers) — review 018 M1 */
  server.drain = async () => { while (inflight.size) await Promise.all([...inflight]); };
  server.ctx = ctx;
  return server;
}

/** The missing required variable names — [] when the service may start. */
export function missingConfig(env) { return REQUIRED.filter((k) => !env[k]); }

export function main(env = process.env) {
  const missing = missingConfig(env);
  if (missing.length) {
    console.error('Wimpy service cannot start: ' + missing.join(' and ') + ' not set. See .env.example — the values live in the git-ignored env files (scripts/env.mjs assembles .env).');
    process.exit(1);
  }
  if (!dbConfigured(env)) { console.error('Wimpy service cannot start: database settings incomplete.'); process.exit(1); }
  const port = Number(env.PORT) || 8080;
  const server = createServer(env);
  server.listen(port, '0.0.0.0', () => console.info('[wimpy] v' + VERSION + ' listening on :' + port
    + ' · HighLevel ' + (hlConfigured(env) ? 'configured' : 'NOT configured (cards wait as pending)')
    + ' · proxy ' + (env.TRUST_PROXY ? 'trusted' : 'not trusted')));
  const everyMin = env.RETRY_EVERY_MIN == null || env.RETRY_EVERY_MIN === '' ? 20 : Number(env.RETRY_EVERY_MIN);
  let timer = null;
  if (Number.isFinite(everyMin) && everyMin > 0) {
    timer = setInterval(() => {
      retryDueOrders(env, db(env)).then((w) => console.info('[wimpy:retry] ' + JSON.stringify(w)))
        .catch((e) => console.warn('[wimpy:retry] failed: ' + dbWhy(env, e)));
    }, everyMin * 60000);
    console.info('[wimpy] HighLevel retry every ' + everyMin + ' min');
  } else console.info('[wimpy] HighLevel retry timer OFF (RETRY_EVERY_MIN=' + env.RETRY_EVERY_MIN + ')');
  /* STOP IN ORDER: stop accepting, let the requests in progress FINISH (server.close's callback), then drain the
     background work they registered — bounded by DRAIN_MS, which docker-compose's stop_grace_period must exceed, or
     Docker's SIGKILL at 10 s cuts a card write short. A second signal does not re-enter. */
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return; stopping = true;
    console.info('[wimpy] ' + sig + ' — finishing requests and draining background work (≤ ' + DRAIN_MS / 1000 + ' s)');
    if (timer) clearInterval(timer);
    const closed = new Promise((r) => server.close(() => r()));
    server.closeIdleConnections && server.closeIdleConnections();
    await Promise.race([closed.then(() => server.drain()), new Promise((r) => setTimeout(r, DRAIN_MS))]);
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
