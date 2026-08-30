#!/usr/bin/env node
/**
 * verify-wimpy.mjs — the Wimpy ordering system.
 *
 *   node nicks_code/diagnostics/verify-wimpy.mjs
 *
 * Stubbed, so it proves the RULES rather than the network:
 *   · every brief price is the price, and lives in exactly one file
 *   · the total is re-priced SERVER-side — a client figure is never trusted
 *   · removing an included ingredient is free
 *   · wings cannot be ordered without both sauces
 *   · the 12-wing platter has no invented price and cannot be ordered
 *   · identity comes from the session, not the request
 *   · a failed webhook does NOT report success (the cart must survive)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = 'file:///' + path.resolve(HERE, '..', '..', 'worker', 'src', 'wimpy.mjs').replace(/\\/g, '/').replace(/ /g, '%20');

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const { wimpyMenu, priceOrder, formatOrder, submitWimpyOrder } = await import(W);
const menu = wimpyMenu();
const byId = (id) => menu.items.find((i) => i.id === id);

head('A · THE MENU IS THE BRIEF');
const WANT = {
  toasted_cheese_tomato: 75.90, toasted_chicken_mayo: 80.90, toasted_bacon_egg: 84.90,
  toasted_mince_cheese: 95.90, dagwood: 149.90, champion_burger: 124.90, wings_6: 154.90,
};
for (const [id, price] of Object.entries(WANT))
  ok(byId(id) && byId(id).basePrice === price, `${byId(id) ? byId(id).name : id} is R${price.toFixed(2)}`,
    byId(id) ? 'got ' + byId(id).basePrice : 'missing');
ok(menu.items.length === 8, 'eight items and no invented extras', 'got ' + menu.items.length);
ok(menu.categories.map((c) => c.id).join(',') === 'sandwiches,burgers,wings', 'three categories');
ok(byId('wings_12_platter').basePrice === null && byId('wings_12_platter').configurablePrice === true,
  'the 12-wing platter has NO invented price and is marked configurable');
ok(byId('wings_12_platter').available === false, '...and is served as unavailable, so it cannot be ordered');
ok(menu.items.every((i) => i.addOns.every((a) => a.price === 0 && a.configurablePrice)),
  'no add-on price is invented — every one is 0 and configurable');

head('B · PRICING IS DONE HERE, NOT BY THE CALLER');
{
  const r = priceOrder({ order: { items: [{ id: 'dagwood', quantity: 2 }] } });
  ok(r.ok && r.total === 299.80, '2 × Dagwood = R299.80', 'got ' + r.total);
}
{
  /* removing is free — the brief is explicit */
  const plain = priceOrder({ order: { items: [{ id: 'dagwood', quantity: 1 }] } });
  const stripped = priceOrder({ order: { items: [{ id: 'dagwood', quantity: 1, removed: ['Gherkins', 'Lettuce'] }] } });
  ok(stripped.ok && stripped.total === plain.total && plain.total === 149.90,
    'removing gherkins and lettuce changes nothing — R149.90 either way', 'got ' + stripped.total);
  ok(stripped.items[0].customisations.removed.length === 2, '...and both removals are recorded');
}
{
  const r = priceOrder({ order: { items: [{ id: 'dagwood', quantity: 1, removed: ['Toasted bread'] }] } });
  ok(!r.ok, 'an ingredient the item does not have cannot be removed');
}
{
  const r = priceOrder({ order: { items: [
    { id: 'wings_6', quantity: 1, choices: { basting: 'Peri-Peri', dipping_sauce: 'BBQ' } },
    { id: 'champion_burger', quantity: 1, choices: { sauce: 'Chilli Mayo' }, removed: ['Grilled onions'] },
    { id: 'toasted_chicken_mayo', quantity: 2, added: [{ id: 'extra_mayo' }] },
  ] } });
  ok(r.ok, 'a realistic three-item order prices cleanly', (r.errors || []).join('; '));
  ok(r.total === 154.90 + 124.90 + 80.90 * 2, 'total = R' + (154.90 + 124.90 + 80.90 * 2).toFixed(2), 'got ' + r.total);
  ok(r.items[2].item_total === 161.80, 'quantity multiplies the line, not the base', 'got ' + r.items[2].item_total);
}

head('C · REQUIRED CHOICES ARE REQUIRED');
ok(!priceOrder({ order: { items: [{ id: 'wings_6', quantity: 1, choices: { basting: 'BBQ' } }] } }).ok,
  'wings without a dipping sauce are refused');
ok(!priceOrder({ order: { items: [{ id: 'wings_6', quantity: 1, choices: { dipping_sauce: 'BBQ' } }] } }).ok,
  'wings without a basting are refused');
ok(!priceOrder({ order: { items: [{ id: 'wings_6', quantity: 1, choices: { basting: 'Garlic', dipping_sauce: 'BBQ' } }] } }).ok,
  'a basting that is not on the menu is refused');
ok(!priceOrder({ order: { items: [{ id: 'wings_12_platter', quantity: 1, choices: { basting: 'BBQ', dipping_sauce: 'BBQ' } }] } }).ok,
  'the platter is refused while it has no price — never guessed at');
ok(!priceOrder({ order: { items: [] } }).ok, 'an empty order is refused');
ok(!priceOrder({ order: { items: [{ id: 'not_a_real_thing', quantity: 1 }] } }).ok, 'an unknown item id is refused');
ok(!priceOrder({ order: { items: [{ id: 'dagwood', quantity: 0 }] } }).ok, 'a quantity of zero is refused');
ok(!priceOrder({ order: { items: [{ id: 'dagwood', quantity: 1, added: [{ id: 'extra_dip' }] }] } }).ok,
  'an add-on that does not belong to the item is refused');

head('D · THE FORMATTED ORDER');
{
  const r = priceOrder({ order: { items: [
    { id: 'dagwood', quantity: 1, removed: ['Gherkins'], added: [{ id: 'extra_cheese' }] },
    { id: 'wings_6', quantity: 1, choices: { basting: 'Peri-Peri', dipping_sauce: 'BBQ' } },
  ] } });
  const t = formatOrder({ agentName: 'John Smith', cb: 'CB12345', items: r.items, total: r.total, notes: 'Please make chips well done.' });
  ok(t.startsWith('WIMPY ORDER'), 'starts with the WIMPY ORDER header');
  ok(t.includes('Agent: John Smith') && t.includes('CB Number: CB12345'), 'names the agent and CB');
  ok(t.includes('1 × DAGWOOD — R149.90'), 'each line carries quantity, name and money');
  ok(t.includes('Removed:') && t.includes('• Gherkins'), 'lists removals');
  ok(t.includes('Added:') && t.includes('• Extra Cheese'), 'lists additions');
  ok(t.includes('Basting:') && t.includes('• Peri-Peri'), 'lists the basting');
  ok(t.includes('Dipping Sauce:') && t.includes('• BBQ'), 'lists the dip');
  ok(t.includes('TOTAL: R304.80'), 'ends on the real total (R304.80)');
  ok(t.includes('Additional Notes:\nPlease make chips well done.'), 'carries the notes');
}

head('E · IDENTITY AND THE WEBHOOK');
{
  const user = { full_name: 'John Smith', username: 'cb12345', cb: 'CB12345' };
  const good = { order: { items: [{ id: 'dagwood', quantity: 1 }], additional_notes: 'x' } };
  let sent = null;
  globalThis.fetch = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, text: async () => 'ok' }; };
  const r = await submitWimpyOrder({}, user, good);
  ok(r.status === 200 && r.body.ok, 'a valid order is accepted');
  ok(sent.url === 'https://n8n-production-591cc.up.railway.app/webhook/wimpy', 'posted to the n8n webhook');
  ok(sent.body.cb_number === 'CB12345' && sent.body.agent_name === 'John Smith', 'identity comes from the SESSION');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+02:00$/.test(sent.body.timestamp), 'timestamp is SAST with the offset', sent.body.timestamp);
  ok(sent.body.total_price === 149.90 && typeof sent.body.order_formatted === 'string', 'carries the total and the formatted order');
  ok(Array.isArray(sent.body.order.items) && sent.body.order.items[0].item === 'Dagwood', 'carries the structured order');

  /* the one that matters: a caller cannot set the price */
  const lie = { total_price: 1.00, order: { items: [{ id: 'dagwood', quantity: 1 }] } };
  await submitWimpyOrder({}, user, lie);
  ok(sent.body.total_price === 149.90, 'a client-supplied total is IGNORED — the Worker re-prices', 'got ' + sent.body.total_price);
  ok(sent.body.price_mismatch && sent.body.price_mismatch.client_total === 1,
    '...and the disagreement travels with the order rather than being hidden');

  /* identity must exist */
  ok((await submitWimpyOrder({}, { full_name: 'X', cb: '' }, good)).status === 403, 'no CB number → refused');
  ok((await submitWimpyOrder({}, { full_name: '', username: '', cb: 'CB1' }, good)).status === 403, 'no name → refused');

  /* a failed webhook must NOT read as success — the page keeps the cart */
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const bad = await submitWimpyOrder({}, user, good);
  ok(bad.status === 502 && !bad.body.ok, 'a webhook failure is reported as a failure');
  ok(/kept/i.test(bad.body.error), '...and the message says the order was kept', bad.body.error);

  globalThis.fetch = async () => { const e = new Error('nope'); throw e; };
  const dead = await submitWimpyOrder({}, user, good);
  ok(dead.status === 502 && /kept/i.test(dead.body.error), 'an unreachable webhook is reported the same way');
}

head('F · THE PAGE HOLDS NO PRICES');
{
  const fs = await import('node:fs');
  const page = fs.readFileSync(path.resolve(HERE, '..', '..', 'agent', 'index.html'), 'utf8');
  const block = page.slice(page.indexOf('===================== WIMPY ORDER ====================='),
    page.indexOf('===================== THE CAMPAIGN MANAGER VIEW ====================='));
  const prices = block.match(/\b\d+\.\d{2}\b/g) || [];
  ok(prices.length === 0, 'not one price literal in the Wimpy page code — it all comes from the Worker',
    prices.join(', '));
  ok(!/n8n-production/.test(page), 'the webhook URL is not shipped to the browser');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
