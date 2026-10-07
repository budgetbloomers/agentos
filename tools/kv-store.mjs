/**
 * READING A STORE THAT MAY BE KEPT COMPRESSED (Spec Kit 013, 2026-10-07).
 *
 * The Worker keeps an Ops fact store gzipped at rest once it is too big for the Worker to unpack (Ops' ViciDial call
 * store reached 132.7 MB). The apps never notice — the Worker serves it with Content-Encoding: gzip — but a tool that
 * reads raw/kv/<key> straight from Storage gets the gzip bytes. Every such tool reads through here: the format is
 * decided by the bytes (the gzip magic 1f 8b; plain JSON can never start with it), never by a flag.
 */
import zlib from 'node:zlib';

/** true when the bytes are gzip */
export function isGzip(buf) {
  return !!buf && buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** the store's JSON text, whether it was stored plain or gzipped */
export function storeText(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return isGzip(b) ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8');
}

/** fetch Response → the store's JSON text */
export async function responseText(res) {
  return storeText(Buffer.from(await res.arrayBuffer()));
}
