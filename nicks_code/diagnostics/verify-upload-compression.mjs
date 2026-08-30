/* SAVES ARE GZIPPED ON THE WIRE, AND WHAT IS STORED IS UNCHANGED.
 *
 * Browsers compress downloads but never request BODIES, so every save pushed the whole
 * state uncompressed — 8.8 MB of VAS state up a South African link after every change.
 * The client now gzips; the Worker decompresses, so Supabase Storage holds exactly the
 * same plain JSON as before and every other reader is untouched.
 *
 * The Worker decides by the gzip MAGIC NUMBER, never by Content-Encoding: some edges
 * decompress a request body before it reaches the Worker and some pass it through, and
 * guessing wrong would write compressed bytes into the store as if they were JSON —
 * i.e. corrupt the whole floor's data. Both shapes are asserted here.
 *
 * Run: node verify-upload-compression.mjs
 */
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

/* The exact shapes the apps and the Worker use. */
const clientGzip = async (text) =>
  await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();

const workerDecode = async (bodyBlobOrText) => {
  const req = new Request('https://x/api/kv?key=vas-state', { method: 'POST', body: bodyBlobOrText });
  const buf = await req.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b)
    return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return new TextDecoder().decode(buf);
};

/* A payload shaped like real state: repetitive case rows. */
const rows = [];
for (let i = 0; i < 20000; i++) rows.push({ k: 'C' + i, owner: 'Agent ' + (i % 120), status: '2nd attempt', opened: '2026-08-0' + (i % 9), age: i % 900 });
const payload = JSON.stringify({ closedcases: { rows }, roster: [{ code: 'CB1', name: 'A', tl: 'TL' }] });

const gz = await clientGzip(payload);
ok('the client can gzip a state payload', gz.size > 0 && gz.size < payload.length, gz.size + ' vs ' + payload.length);
ok('it compresses by at least 5x (these rows are highly repetitive)',
  payload.length / gz.size >= 5, (payload.length / gz.size).toFixed(1) + 'x');

const fromGzip = await workerDecode(gz);
ok('a GZIPPED body round-trips byte-identical', fromGzip === payload,
  'len ' + fromGzip.length + ' vs ' + payload.length);

const fromPlain = await workerDecode(payload);
ok('a PLAIN body still works (older client, or an edge that already decompressed)',
  fromPlain === payload, 'len ' + fromPlain.length);

/* The magic-number test must not misfire on ordinary JSON. */
ok('plain JSON is never mistaken for gzip', !(payload.charCodeAt(0) === 0x1f && payload.charCodeAt(1) === 0x8b));
const unicode = JSON.stringify({ note: 'Nonhlanhlo Sokhela — R1 234,56 · 90%' });
ok('multi-byte characters survive the plain path', (await workerDecode(unicode)) === unicode);
ok('multi-byte characters survive the gzip path', (await workerDecode(await clientGzip(unicode))) === unicode);

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
