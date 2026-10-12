/**
 * NODE REQUEST → handle() → NODE RESPONSE (Spec Kit 018). One adapter for both hosts that hand us Node's http objects:
 * the container's own http.Server (src/server.mjs) and Vercel's root-entrypoint runtime, which calls the default export
 * with (req, res) in Node's shape — req.url is a bare path, not a Web Request (deploy 2026-10-09).
 *
 *   · the body is capped at MAX_BODY and the rest drained, so an over-long upload gets a readable 413, never a cut socket;
 *   · unless `trust` is set, a client's x-forwarded-for / x-real-ip are DROPPED and the socket's address is written to
 *     x-wimpy-socket-ip (overwritten on every request — app.mjs clientIp reads only that); under a trusted proxy (Vercel
 *     always) the forwarded headers pass through and the socket header is removed;
 *   · a body Vercel has already parsed (req.body as a string, Buffer or object) is used as it is.
 */
import { handle, SOCKET_IP_HEADER } from './app.mjs';
import { SECURITY_HEADERS } from './headers.mjs';

export const MAX_BODY = 256 * 1024;

export const readBody = (req) => new Promise((resolve, reject) => {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (typeof req.body === 'object') return resolve(Buffer.from(JSON.stringify(req.body)));
  }
  const chunks = []; let n = 0, over = false;
  req.on('data', (c) => { if (over) return; n += c.length; if (n > MAX_BODY) { over = true; chunks.length = 0; reject(new Error('body too large')); } else chunks.push(c); });
  req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
  req.on('error', reject);
  req.on('aborted', () => reject(new Error('client aborted')));
});

export function nodeRequestHandler(env, ctx, { trust = false } = {}) {
  return async (req, res) => {
    try {
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const url = new URL(req.url || '/', proto + '://' + host);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      if (trust) headers.delete(SOCKET_IP_HEADER);
      else { headers.delete('x-forwarded-for'); headers.delete('x-real-ip'); headers.set(SOCKET_IP_HEADER, String((req.socket && req.socket.remoteAddress) || '')); }
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      const request = new Request(url, { method: req.method, headers, body: body && body.length ? body : undefined });
      const out = await handle(request, env, ctx);
      const outHeaders = {}; for (const [k, v] of out.headers) outHeaders[k] = v;
      const buf = Buffer.from(await out.arrayBuffer());
      if (out.status !== 204 && out.status !== 304) outHeaders['content-length'] = String(buf.length);
      res.writeHead(out.status, outHeaders);
      res.end(req.method === 'HEAD' || out.status === 204 || out.status === 304 ? undefined : buf);
    } catch (e) {
      const why = String((e && e.message) || e);
      const status = why.includes('body too large') ? 413 : 500;
      if (status === 500) console.error('[wimpy] request failed: ' + why.slice(0, 200));
      const text = JSON.stringify({ error: status === 413 ? 'That request is too large.' : 'Something went wrong on the server — try again in a minute.' });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), Connection: 'close', ...SECURITY_HEADERS });
      res.end(text);
    }
  };
}
