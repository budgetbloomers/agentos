/**
 * THE VERCEL ENTRY (Spec Kit 018). vercel.json rewrites every /api/* request to this function; Vercel serves
 * public/index.html itself. Web-handler signature: named exports per method, each takes a Request and returns a
 * Response — exactly what app.mjs handle() is.
 *
 *   · TRUST_PROXY is always on here: Vercel's edge sets x-forwarded-for from the real client and discards a client's own.
 *   · ctx.waitUntil → @vercel/functions waitUntil, so the ledger row and HighLevel card still land after the reply
 *     (without it the function could be frozen the moment the response is sent).
 *   · The retry runs from vercel.json `crons` → GET /api/wimpy/cron/retry with `Authorization: Bearer $CRON_SECRET`
 *     (Vercel adds that header itself when the CRON_SECRET environment variable exists).
 */
import { waitUntil } from '@vercel/functions';
import { handle } from '../src/app.mjs';
import { nodeRequestHandler } from '../src/node-adapter.mjs';

const ENV = { ...process.env, TRUST_PROXY: '1' };
const ctx = {
  waitUntil(p) {
    const q = Promise.resolve(p).catch(() => {});
    try { waitUntil(q); } catch (e) { /* outside Vercel's runtime: the promise simply runs */ }
  },
};
const run = (request) => handle(request, ENV, ctx);
const node = nodeRequestHandler(ENV, ctx, { trust: true });

/* THE ROOT ENTRYPOINT CALL (deploy 2026-10-09): Vercel hands the default export Node's (req, res) — req.url a bare path —
   not a Web Request; the runtime log said so ("Invalid URL … input: '/api/health'"). Both shapes are accepted. */
export default function vercelEntry(req, res) {
  if (typeof Request !== 'undefined' && req instanceof Request) return run(req);
  return node(req, res);
}
export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
export const OPTIONS = run;
export const HEAD = run;
