#!/usr/bin/env node
/**
 * agent-links.mjs — the Links tab in Agent Analytics (Nick, 2026-09-08: "add a tab that says
 * links … and put a screenshot of each one just to make it look nice" — agent view only).
 *
 *   node tools/agent-links.mjs                       show the record
 *   node tools/agent-links.mjs --seed                write the three titles (addresses to follow)
 *   node tools/agent-links.mjs --set salesforce https://…   set an address AND capture its screenshot
 *   node tools/agent-links.mjs --set vicidial  https://…
 *   node tools/agent-links.mjs --set rewarded  https://…
 *
 * The record is kv:agent-links {items:[{key, title, sub, url, shot, capturedAt}]}; the Worker hands
 * it to every agent's overview and the page paints the cards. `shot` is a JPEG data URI (960×600,
 * quality 60, ~50 KB) taken headlessly at the moment the address is set — re-run --set to refresh.
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/'; const KEY = 'kv:agent-links';
const SEED = [
  { key: 'salesforce', title: 'Salesforce', sub: 'Login | Consumer Partners', url: null, shot: null },
  { key: 'vicidial',   title: 'ViciDial',   sub: 'Agent web client: Phone Login', url: null, shot: null },
  { key: 'rewarded',   title: 'Rewards',    sub: 'Rewarded', url: null, shot: null },
];
const args = process.argv.slice(2);
const read = async () => { const r = await (await fetch(REST + 'rules?key=eq.' + encodeURIComponent(KEY) + '&select=value', { headers: H })).json(); return (r[0] && r[0].value && r[0].value.items) || null; };
const write = async (items) => { const r = await fetch(REST + 'rules', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: KEY, value: { items }, updated_by: 'agent-links', updated_at: new Date().toISOString() }]) }); if (!r.ok) throw new Error('write failed ' + r.status + ' ' + await r.text()); };
const show = (items) => { for (const i of items || []) console.log('  ' + i.key.padEnd(11) + i.title.padEnd(12) + (i.sub || '').padEnd(32) + (i.url || 'address to be added').padEnd(48) + (i.shot ? 'screenshot ' + Math.round(i.shot.length / 1024) + ' KB (' + String(i.capturedAt || '').slice(0, 10) + ')' : 'no screenshot')); };

let items = await read();
if (args.includes('--seed')) { items = items || []; for (const s of SEED) if (!items.some((i) => i.key === s.key)) items.push(s); await write(items); console.log('seeded'); }
const si = args.indexOf('--set');
if (si >= 0) {
  const key = args[si + 1], url = args[si + 2];
  if (!key || !/^https?:\/\//.test(url || '')) { console.error('usage: --set <key> <https://url>'); process.exit(2); }
  items = items || SEED.map((s) => ({ ...s }));
  let it = items.find((i) => i.key === key); if (!it) { it = { key, title: key, sub: '', url: null, shot: null }; items.push(it); }
  const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 960, height: 600 } });
    /* a page this machine cannot reach (the dialler lives on the office LAN) keeps its placeholder — never a blank screenshot */
    const reached = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).then((r) => !!r && r.status() < 500).catch(() => false);
    it.url = url;
    if (reached) {
      await page.waitForTimeout(1500);
      const title = await page.title().catch(() => '');
      const jpg = await page.screenshot({ type: 'jpeg', quality: 60 });
      it.shot = 'data:image/jpeg;base64,' + jpg.toString('base64'); it.capturedAt = new Date().toISOString(); if (title && !it.sub) it.sub = title;
      console.log('captured ' + key + ' — page title "' + title + '", ' + Math.round(jpg.length / 1024) + ' KB');
    } else console.log('address saved for ' + key + ' — the page could not be reached from this machine, so the card keeps its placeholder (run --set again from the office network for a screenshot)');
  } finally { await b.close(); }
  await write(items); console.log('saved');
}
console.log(KEY + ':'); show(items || []); if (!items) console.log('  (no record yet — run --seed)');
