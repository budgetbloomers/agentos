/**
 * WIMPY ORDERING — the agent's lunch order, inside Agent Analytics.
 *
 * WHY THE MENU AND THE ARITHMETIC LIVE HERE AND NOT ON THE PAGE.
 * Two reasons, and the second is the one that matters.
 *
 * 1. The CSP allows the browser to reach exactly two origins: itself and this
 *    Worker (site/_headers, connect-src). A page fetch to the n8n webhook would
 *    be blocked outright. So the order is posted from here — the same shape the
 *    Coaching Hub and HighLevel already use: the browser never talks to the
 *    third party, and the URL is not shipped to 130 phones.
 *
 * 2. A PRICE THE CLIENT SENDS IS NOT A PRICE. If the page computed the total and
 *    this route wrote it down, the total would be whatever the last person to
 *    open devtools decided it was. So the page's total is DISPLAY ONLY: every
 *    submitted order is re-priced here from this file, and the number that
 *    reaches n8n is the one this file worked out. The client's figure is
 *    compared and reported when it disagrees, never trusted.
 *
 * ONE MENU, ONE PLACE (the brief's §18). Prices appear in this object and
 * nowhere else — not in the page, not in a component, not in a test fixture.
 * The page renders whatever this serves, so a price change is one edit here.
 *
 * WHAT IS DELIBERATELY NOT PRICED. The brief is explicit: do not invent prices.
 * The 12-wing platter carries `basePrice: null` and `configurablePrice: true`
 * because the Phoenix price could not be verified — the page shows it as
 * unorderable and says why, rather than guessing a number somebody would be
 * charged. Add-ons are the same: they exist, they attach to the order, and they
 * cost 0.00 until a real price is put here.
 */

const WEBHOOK = 'https://n8n-production-591cc.up.railway.app/webhook/wimpy';

/* Add-ons are a shared pool; each item names the ones that make sense for it.
   price 0 + configurablePrice: no charge is applied until somebody sets one. */
const ADD_ONS = {
  extra_cheese:  { id: 'extra_cheese',  name: 'Extra Cheese',        price: 0, configurablePrice: true },
  extra_bacon:   { id: 'extra_bacon',   name: 'Extra Bacon',         price: 0, configurablePrice: true },
  extra_egg:     { id: 'extra_egg',     name: 'Extra Fried Egg',     price: 0, configurablePrice: true },
  extra_patty:   { id: 'extra_patty',   name: 'Extra Beef Patty',    price: 0, configurablePrice: true },
  extra_mayo:    { id: 'extra_mayo',    name: 'Extra Mayo',          price: 0, configurablePrice: true },
  extra_relish:  { id: 'extra_relish',  name: 'Extra Wimpy Relish',  price: 0, configurablePrice: true },
  extra_onions:  { id: 'extra_onions',  name: 'Extra Grilled Onions',price: 0, configurablePrice: true },
  extra_chips:   { id: 'extra_chips',   name: 'Extra Chips',         price: 0, configurablePrice: true },
  extra_dip:     { id: 'extra_dip',     name: 'Extra Dipping Sauce', price: 0, configurablePrice: true },
};

/* `removable:false` is the thing the item stops being without it — a toasted
   sandwich with no bread is not a sandwich, and the brief lists no way to remove
   the Champion's patty (it does list one for the Dagwood, so that one is true). */
const inc = (name, removable = true) => ({ name, removable });

const ITEMS = [
  { id: 'toasted_cheese_tomato', name: 'Toasted Cheese & Tomato', category: 'sandwiches',
    basePrice: 75.90, description: 'Cheese and tomato on toasted bread, with medium chips.',
    includedIngredients: [inc('Cheese'), inc('Tomato'), inc('Toasted bread', false), inc('Medium chips')],
    addOns: ['extra_cheese', 'extra_mayo', 'extra_chips'] },

  { id: 'toasted_chicken_mayo', name: 'Toasted Chicken & Mayo', category: 'sandwiches',
    basePrice: 80.90, description: 'Chicken and mayonnaise on toasted bread, with medium chips.',
    includedIngredients: [inc('Chicken'), inc('Mayonnaise'), inc('Toasted bread', false), inc('Medium chips')],
    addOns: ['extra_cheese', 'extra_mayo', 'extra_chips'] },

  { id: 'toasted_bacon_egg', name: 'Toasted Bacon & Egg', category: 'sandwiches',
    basePrice: 84.90, description: 'Bacon and egg on toasted bread, with medium chips.',
    includedIngredients: [inc('Bacon'), inc('Egg'), inc('Toasted bread', false), inc('Medium chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_chips'] },

  { id: 'toasted_mince_cheese', name: 'Toasted Mince & Cheese', category: 'sandwiches',
    basePrice: 95.90, description: 'Mince and cheese on toasted bread, with medium chips.',
    includedIngredients: [inc('Mince'), inc('Cheese'), inc('Toasted bread', false), inc('Medium chips')],
    addOns: ['extra_cheese', 'extra_chips'] },

  { id: 'dagwood', name: 'Dagwood', category: 'sandwiches',
    basePrice: 149.90, description: 'The full stack — patty, bacon, cheese, egg, onions, gherkins, lettuce and Wimpy Relish.',
    includedIngredients: [inc('Beef patty'), inc('2 rashers of bacon'), inc('2 slices of cheese'),
      inc('Fried egg'), inc('Grilled onions'), inc('Gherkins'), inc('Lettuce'), inc('Famous Wimpy Relish')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_patty', 'extra_onions', 'extra_relish', 'extra_chips'] },

  { id: 'champion_burger', name: 'Champion Burger', category: 'burgers',
    basePrice: 124.90, description: 'Beef patty, streaky bacon, fried egg, cheese, onions, gherkins, lettuce and relish.',
    includedIngredients: [inc('Beef patty', false), inc('2 rashers of streaky bacon'), inc('Fried egg'),
      inc('Cheese'), inc('Grilled onions'), inc('Gherkins'), inc('Lettuce'), inc('Famous Wimpy Relish')],
    choices: [{ id: 'sauce', label: 'Sauce', required: true, options: ['Creamy Mayo', 'Chilli Mayo'] }],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_patty', 'extra_onions', 'extra_relish', 'extra_chips'] },

  { id: 'wings_6', name: '6 Chicken Wings', category: 'wings',
    basePrice: 154.90, description: 'Six wings, basted your way, with a dipping sauce.',
    includedIngredients: [inc('6 chicken wings', false)],
    choices: [
      { id: 'basting', label: 'Basting', required: true, options: ['BBQ', 'Peri-Peri', 'Lemon & Herb'] },
      { id: 'dipping_sauce', label: 'Dipping Sauce', required: true, options: ['BBQ', 'Peri-Peri'] },
    ],
    addOns: ['extra_dip', 'extra_chips'] },

  /* THE PRICE IS NOT KNOWN AND IS NOT GUESSED (brief §11, §19). Everything else
     about the item is real; only the number is missing, so it is served as null
     and the page refuses to add it until somebody fills this in. */
  { id: 'wings_12_platter', name: '12 Chicken Wings Platter', category: 'wings',
    basePrice: null, configurablePrice: true,
    description: 'Twelve wings, basted your way, with a dipping sauce and large chips.',
    includedIngredients: [inc('12 chicken wings', false), inc('Large chips')],
    choices: [
      { id: 'basting', label: 'Basting', required: true, options: ['BBQ', 'Peri-Peri', 'Lemon & Herb'] },
      { id: 'dipping_sauce', label: 'Dipping Sauce', required: true, options: ['BBQ', 'Peri-Peri'] },
    ],
    addOns: ['extra_dip', 'extra_chips'] },
];

const CATEGORIES = [
  { id: 'sandwiches', label: 'Sandwiches' },
  { id: 'burgers', label: 'Burgers' },
  { id: 'wings', label: 'Wings' },
];

/** The menu the page renders. Prices travel from here and nowhere else. */
export function wimpyMenu() {
  return {
    currency: 'ZAR',
    categories: CATEGORIES,
    addOns: ADD_ONS,
    items: ITEMS.map((i) => ({
      ...i,
      available: i.basePrice != null,
      addOns: (i.addOns || []).map((k) => ADD_ONS[k]).filter(Boolean),
    })),
  };
}

/* Money in cents, so a total is never the sum of a hundred floating-point
   sixteenths. Everything is added as an integer and divided once at the end. */
const cents = (r) => Math.round(Number(r) * 100);
const rands = (c) => Math.round(c) / 100;
export const zar = (r) => 'R' + Number(r).toFixed(2);

/**
 * Re-price a submitted order from the menu above and say what is wrong with it.
 * Returns { ok, errors[], items[], totalCents }. The caller must not proceed on
 * !ok — every message here is written to be shown to the agent as-is.
 */
export function priceOrder(body) {
  const errors = [];
  const raw = (body && body.order && Array.isArray(body.order.items)) ? body.order.items : [];
  if (!raw.length) errors.push('Add at least one item before submitting.');

  const items = [];
  let totalCents = 0;

  raw.forEach((row, n) => {
    const where = 'Item ' + (n + 1);
    const def = ITEMS.find((i) => i.id === String(row && row.id || ''));
    if (!def) { errors.push(where + ': unknown menu item.'); return; }
    if (def.basePrice == null) {
      errors.push(def.name + ' has no price set yet, so it cannot be ordered. Ask Nick to configure it.');
      return;
    }
    const qty = Math.floor(Number(row.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) { errors.push(def.name + ': quantity must be between 1 and 20.'); return; }

    /* required choices — the wings cannot go in without both sauces */
    const choices = {};
    for (const ch of (def.choices || [])) {
      const picked = String((row.choices || {})[ch.id] || '');
      if (!picked) { if (ch.required) errors.push(def.name + ': choose a ' + ch.label.toLowerCase() + '.'); continue; }
      if (!ch.options.includes(picked)) { errors.push(def.name + ': "' + picked + '" is not a ' + ch.label.toLowerCase() + ' option.'); continue; }
      choices[ch.id] = picked;
    }

    /* removals must be things the item actually has, and REMOVING IS FREE */
    const removable = def.includedIngredients.filter((g) => g.removable).map((g) => g.name);
    const removed = [];
    for (const r of (Array.isArray(row.removed) ? row.removed : [])) {
      const name = String(r || '');
      if (!removable.includes(name)) { errors.push(def.name + ': "' + name + '" cannot be removed.'); continue; }
      if (!removed.includes(name)) removed.push(name);
    }

    const allowed = def.addOns || [];
    const added = [];
    let addCents = 0;
    for (const a of (Array.isArray(row.added) ? row.added : [])) {
      const id = String((a && a.id) || a || '');
      if (!allowed.includes(id) || !ADD_ONS[id]) { errors.push(def.name + ': "' + id + '" is not an add-on for this item.'); continue; }
      if (added.some((x) => x.id === id)) continue;
      const ao = ADD_ONS[id];
      added.push({ id: ao.id, name: ao.name, price: ao.price });
      addCents += cents(ao.price);
    }

    const unit = cents(def.basePrice) + addCents;
    const line = unit * qty;
    totalCents += line;
    items.push({
      id: def.id, item: def.name, category: def.category, quantity: qty,
      base_price: rands(cents(def.basePrice)),
      customisations: { ...choices, removed, added },
      unit_total: rands(unit),
      item_total: rands(line),
    });
  });

  return { ok: !errors.length, errors, items, totalCents, total: rands(totalCents) };
}

/** The human-readable order n8n forwards downstream (brief §22). */
export function formatOrder({ agentName, cb, items, total, notes }) {
  const L = ['WIMPY ORDER', '', 'Agent: ' + agentName, 'CB Number: ' + cb, ''];
  for (const it of items) {
    L.push('---', '');
    L.push(it.quantity + ' × ' + it.item.toUpperCase() + ' — ' + zar(it.item_total));
    const c = it.customisations || {};
    if (c.basting) L.push('', 'Basting:', '  • ' + c.basting);
    if (c.dipping_sauce) L.push('', 'Dipping Sauce:', '  • ' + c.dipping_sauce);
    if (c.sauce) L.push('', 'Sauce:', '  • ' + c.sauce);
    if (c.removed && c.removed.length) { L.push('', 'Removed:'); c.removed.forEach((r) => L.push('  • ' + r)); }
    if (c.added && c.added.length) {
      L.push('', 'Added:');
      c.added.forEach((a) => L.push('  • ' + a.name + (a.price ? ' (' + zar(a.price) + ')' : '')));
    }
    L.push('');
  }
  L.push('---', '', 'TOTAL: ' + zar(total));
  if (notes) L.push('', 'Additional Notes:', notes);
  return L.join('\n');
}

/* South African local time, with the offset the brief's example carries. SAST is
   UTC+2 all year — there is no daylight saving to track. */
function sastNow() {
  const d = new Date(Date.now() + 2 * 3600000).toISOString();
  return d.slice(0, 19) + '+02:00';
}

/**
 * POST /api/portal/wimpy/order — validate, re-price, send.
 *
 * The identity is the SESSION's, never the request's: an order cannot be placed
 * in somebody else's name because there is no field in which to say a name.
 */
export async function submitWimpyOrder(env, user, body) {
  const agentName = String(user.full_name || user.username || '').trim();
  const cb = String(user.cb || '').trim().toUpperCase();
  if (!agentName) return { status: 403, body: { error: 'This account has no name on it, so an order cannot be placed. Ask Nick to check your profile.' } };
  if (!cb) return { status: 403, body: { error: 'This account has no CB number, so an order cannot be placed. Ask your team leader.' } };

  const priced = priceOrder(body);
  if (!priced.ok) return { status: 400, body: { error: priced.errors[0], errors: priced.errors } };

  const notes = String((body.order && body.order.additional_notes) || '').trim().slice(0, 1000);

  /* The page's total is display only. If it disagrees with this one, THIS one is
     sent and the disagreement travels with the order rather than being silently
     resolved — a mismatch means the two price lists have drifted apart, and
     somebody should find out. */
  const clientTotal = Number(body.total_price);
  const mismatch = Number.isFinite(clientTotal) && Math.abs(cents(clientTotal) - priced.totalCents) > 0
    ? { client_total: clientTotal, server_total: priced.total } : null;

  const payload = {
    cb_number: cb,
    agent_name: agentName,
    timestamp: sastNow(),
    total_price: priced.total,
    order_formatted: formatOrder({ agentName, cb, items: priced.items, total: priced.total, notes }),
    order: { items: priced.items, additional_notes: notes },
  };
  if (mismatch) payload.price_mismatch = mismatch;

  const url = String(env.WIMPY_WEBHOOK_URL || WEBHOOK);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await r.text().catch(() => '');
    if (!r.ok) {
      /* The order is NOT cleared on a failure — the page keeps the cart and
         offers Retry (brief §25), so the message has to say what happened. */
      return { status: 502, body: { error: 'The order could not be sent (the kitchen system answered ' + r.status + '). Your order has been kept — press Retry.', detail: text.slice(0, 200) } };
    }
    return { status: 200, body: { ok: true, total_price: priced.total, order_formatted: payload.order_formatted, timestamp: payload.timestamp } };
  } catch (e) {
    const why = ctrl.signal.aborted ? 'the kitchen system did not answer within 15 seconds' : String((e && e.message) || e).slice(0, 140);
    return { status: 502, body: { error: 'The order could not be sent — ' + why + '. Your order has been kept — press Retry.' } };
  } finally { clearTimeout(timer); }
}
