/**
 * THE CLIENT ADDRESS (Spec Kit 018) — what the per-network sign-in limit counts by. The Worker read Cloudflare's
 * cf-connecting-ip; neither host here has that. A proxy's x-forwarded-for is trusted only when the adapter says so
 * (TRUST_PROXY — Vercel's adapter always, because Vercel's edge sets it from the real client and drops a client's own;
 * the container only when it sits behind a reverse proxy). Otherwise the address is the one the Node adapter writes into
 * x-wimpy-socket-ip from the socket on EVERY request, overwriting anything a client sent under that name.
 * '' when nothing trustworthy is known — the limit then simply does not apply (the per-account lock still does).
 */
import { isIP } from 'node:net';

export const SOCKET_IP_HEADER = 'x-wimpy-socket-ip';

export const trustsProxy = (env) => !!(env && env.TRUST_PROXY && String(env.TRUST_PROXY) !== '0' && String(env.TRUST_PROXY).toLowerCase() !== 'false');

/* Under a trusted proxy the RIGHTMOST x-forwarded-for entry is used — the one OUR proxy appended (nginx's
   $proxy_add_x_forwarded_for appends; a client-sent value sits to its left and is ignored). Only a well-formed address
   counts; and nothing falls back to the socket header on that host (security review 018 M2/L1: on Vercel nobody
   overwrites it, so it would be client-controlled). */
export function clientIp(req, env) {
  const h = req.headers;
  const valid = (v) => (isIP(String(v || '').trim()) ? String(v).trim() : '');
  if (trustsProxy(env)) {
    const parts = String(h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const last = valid(parts[parts.length - 1]);
    if (last) return last;
    return valid(h.get('x-real-ip'));
  }
  return valid(h.get(SOCKET_IP_HEADER));
}
