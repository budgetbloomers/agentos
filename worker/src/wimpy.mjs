/**
 * WIMPY WEEKDAY VALUE MENU — the 3–3–3–1 operating model (Nick, 2026-08-31).
 *
 * 3 Breakfasts + 3 Burgers + 3 Toasteds + 1 Daily Big One. The customer sees
 * ten choices; the kitchen runs THIRTEEN core ingredients — and the overlap is
 * not a design aspiration, it is ENFORCED: every item declares its ingredients
 * from the ING table below, verify-wimpy fails if any ingredient is used by
 * fewer than two items, and the least-shared ingredient (chicken mayo) is
 * deliberately placed across two categories so nothing on the stock sheet
 * exists for one product. The full analysis — ingredient matrix, food cost
 * model, wastage, prep and speed ranking — lives in specs/wimpy-3331-menu.md;
 * this file is the single operational source the page and the pricing use.
 *
 * WHY THE MENU AND THE ARITHMETIC LIVE HERE AND NOT ON THE PAGE (unchanged
 * from the first Wimpy brief):
 *   1. The CSP lets the browser reach itself and this Worker only — the n8n
 *      webhook is unreachable from the page, so orders post from here.
 *   2. A PRICE THE CLIENT SENDS IS NOT A PRICE. The page's total is display
 *      only; every order is re-priced from this file, the client's figure is
 *      compared and a disagreement travels as price_mismatch, never trusted.
 *
 * THE PRICES ARE THE BRIEF'S, EXACTLY (its §5: roughly 20% off Wimpy's list,
 * rounded to clean points — "do not randomly change these prices"). Margin
 * problems found in costing are FLAGGED in the spec (Cheese Burger ~46% food
 * cost, Big Bacon & Cheese ~47%), not solved by moving a selling price.
 *
 * THE DAILY BIG ONE ROTATES BY THE SAST WEEKDAY. Monday's Mega Breakfast is
 * not orderable on a Tuesday — the menu serves only today's hero, and the
 * pricer refuses any Big One whose day is not today, by name, so a stale tab
 * cannot order yesterday's feature. On a weekend the nine core items stand and
 * the hero slot advertises Monday's Big One instead (the brief defines nothing
 * for weekends; serving the core nine and trailing Monday was the call that
 * keeps the tab useful without inventing a sixth feature).
 *
 * WHAT WAS REMOVED, DELIBERATELY (brief §7): wings (two bastings and two
 * dipping sauces existed for one category), mince (one product's ingredient),
 * gherkins (ditto). Add-ons survive only where they are a core ingredient the
 * kitchen already holds — and stay at 0.00/configurable because the FIRST
 * brief's rule still stands: an unverified price is never invented.
 */

const WEBHOOK = 'https://n8n-production-591cc.up.railway.app/webhook/wimpy';

/* ---------------------------------------------------------------- ingredients
   THE thirteen. Ids are the contract the overlap test checks against; costs are
   ESTIMATES for the model in specs/wimpy-3331-menu.md (stated there as
   assumptions, per-portion ZAR) and are NOT selling prices — they exist so the
   food-cost view the spec documents can be recomputed from one place. */
export const ING = {
  eggs:         { name: 'Eggs',          unitCost: 2.20 },   // per egg
  bacon:        { name: 'Bacon',         unitCost: 3.80 },   // per rasher
  patty:        { name: 'Beef patty',    unitCost: 9.50 },   // 100 g
  cheese:       { name: 'Cheese',        unitCost: 2.80 },   // per slice
  banger:       { name: 'Banger',        unitCost: 5.00 },   // per sausage
  bread:        { name: 'Bread',         unitCost: 0.90 },   // per slice
  bun:          { name: 'Burger bun',    unitCost: 2.80 },
  chips:        { name: 'Chips',         unitCost: 5.00 },   // per portion
  tomato:       { name: 'Tomato',        unitCost: 1.20 },   // per portion
  onion:        { name: 'Onion',         unitCost: 0.60 },
  lettuce:      { name: 'Lettuce',       unitCost: 0.80 },
  relish:       { name: 'Wimpy Relish',  unitCost: 1.20 },
  chicken_mayo: { name: 'Chicken mayo',  unitCost: 7.50 },   // 80 g
};
export const OVERHEAD_PER_MEAL = 1.20;   // butter, oil, gas, wrap — the spec's stated assumption

/* Add-ons: only core ingredients the kitchen already holds — no new stock line
   can enter through the add-on door. 0.00 + configurable until a price is set. */
const ADD_ONS = {
  extra_cheese:  { id: 'extra_cheese',  name: 'Extra Cheese',         price: 0, configurablePrice: true },
  extra_bacon:   { id: 'extra_bacon',   name: 'Extra Bacon',          price: 0, configurablePrice: true },
  extra_egg:     { id: 'extra_egg',     name: 'Extra Fried Egg',      price: 0, configurablePrice: true },
  extra_patty:   { id: 'extra_patty',   name: 'Extra Beef Patty',     price: 0, configurablePrice: true },
  extra_relish:  { id: 'extra_relish',  name: 'Extra Wimpy Relish',   price: 0, configurablePrice: true },
  extra_onions:  { id: 'extra_onions',  name: 'Extra Grilled Onions', price: 0, configurablePrice: true },
  extra_chips:   { id: 'extra_chips',   name: 'Extra Chips',          price: 0, configurablePrice: true },
};

const inc = (name, removable = true) => ({ name, removable });

/* ------------------------------------------------------------------ the nine
   ing[]: ingredient id → units used, the machine-readable half of the spec's
   ingredient matrix. prep: LOW/MEDIUM/HIGH per the brief's §11 bands. */
const ITEMS = [
  // ---- BREAKFAST — 3 ----
  { id: 'mzansi_brekkie', name: 'Mzansi Brekkie', category: 'breakfast',
    basePrice: 45.90, prep: 'LOW',
    description: 'A fried egg, two rashers of bacon and grilled tomato on toast. The weekday starter.',
    ing: { eggs: 1, bacon: 2, tomato: 1, bread: 2 },
    includedIngredients: [inc('Fried egg'), inc('Bacon'), inc('Grilled tomato'), inc('Toast', false)],
    addOns: ['extra_egg', 'extra_bacon', 'extra_chips'] },

  { id: 'double_up_breakfast', name: 'Double Up Breakfast', category: 'breakfast',
    basePrice: 65.90, prep: 'MEDIUM',
    description: 'Two eggs, two rashers of bacon, a grilled banger and tomato on toast. Made fresh.',
    ing: { eggs: 2, bacon: 2, banger: 1, tomato: 1, bread: 2 },
    includedIngredients: [inc('2 fried eggs'), inc('Bacon'), inc('Banger'), inc('Grilled tomato'), inc('Toast', false)],
    addOns: ['extra_egg', 'extra_bacon', 'extra_chips'] },

  { id: 'farmhouse_breakfast', name: 'Farmhouse Breakfast', category: 'breakfast',
    basePrice: 77.90, prep: 'MEDIUM',
    description: 'Two eggs, bacon, two bangers, grilled tomato and onion, with chips and toast. The full plate.',
    ing: { eggs: 2, bacon: 2, banger: 2, chips: 1, tomato: 1, onion: 1, bread: 2 },
    includedIngredients: [inc('2 fried eggs'), inc('Bacon'), inc('2 bangers'), inc('Chips'),
      inc('Grilled tomato'), inc('Grilled onion'), inc('Toast', false)],
    addOns: ['extra_egg', 'extra_bacon', 'extra_chips'] },

  // ---- BURGERS — 3 ----
  { id: 'cheese_burger', name: 'Cheese Burger', category: 'burgers',
    basePrice: 54.90, prep: 'LOW',
    description: 'Flame-grilled beef patty with cheese, lettuce, tomato, onion and Wimpy Relish, with chips.',
    ing: { patty: 1, cheese: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Beef patty', false), inc('Cheese'), inc('Lettuce'), inc('Tomato'),
      inc('Onion'), inc('Wimpy Relish'), inc('Chips')],
    addOns: ['extra_cheese', 'extra_patty', 'extra_relish', 'extra_onions', 'extra_chips'] },

  { id: 'bacon_cheese_burger', name: 'Bacon & Cheese Burger', category: 'burgers',
    basePrice: 82.90, prep: 'MEDIUM',
    description: 'Beef patty, crispy bacon and cheese with the full salad and Wimpy Relish, with chips.',
    ing: { patty: 1, bacon: 2, cheese: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Beef patty', false), inc('Bacon'), inc('Cheese'), inc('Lettuce'),
      inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_patty', 'extra_relish', 'extra_onions', 'extra_chips'] },

  { id: 'big_cheese_burger', name: 'Big Cheese Burger', category: 'burgers',
    basePrice: 95.90, prep: 'MEDIUM',
    description: 'Two patties, double cheese, the full salad and Wimpy Relish, with chips. A weekday favourite.',
    ing: { patty: 2, cheese: 2, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('2 beef patties', false), inc('Double cheese'), inc('Lettuce'),
      inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_patty', 'extra_relish', 'extra_onions', 'extra_chips'] },

  // ---- TOASTEDS — 3 ----
  { id: 'toasted_cheese_tomato', name: 'Cheese & Tomato Toasted', category: 'toasteds',
    basePrice: 49.90, prep: 'LOW',
    description: 'Melted cheese and tomato on toasted bread, with chips.',
    ing: { cheese: 1, tomato: 1, bread: 2, chips: 1 },
    includedIngredients: [inc('Cheese'), inc('Tomato'), inc('Toasted bread', false), inc('Chips')],
    addOns: ['extra_cheese', 'extra_chips'] },

  { id: 'toasted_chicken_mayo', name: 'Chicken Mayo Toasted', category: 'toasteds',
    basePrice: 53.90, prep: 'LOW',
    description: 'Creamy chicken mayo on toasted bread, with chips.',
    ing: { chicken_mayo: 1, bread: 2, chips: 1 },
    includedIngredients: [inc('Chicken mayo'), inc('Toasted bread', false), inc('Chips')],
    addOns: ['extra_cheese', 'extra_chips'] },

  { id: 'toasted_bacon_egg', name: 'Bacon & Egg Toasted', category: 'toasteds',
    basePrice: 55.90, prep: 'LOW',
    description: 'Bacon and fried egg on toasted bread, with chips.',
    ing: { bacon: 2, eggs: 1, bread: 2, chips: 1 },
    includedIngredients: [inc('Bacon'), inc('Fried egg'), inc('Toasted bread', false), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_chips'] },
];

/* ------------------------------------------------------------ the Big Ones
   One per weekday, keyed 1–5 = Monday–Friday. The hero of the day and the
   reason to come back tomorrow. */
const BIG_ONES = {
  1: { id: 'mega_breakfast', name: 'Mega Breakfast', day: 1,
    basePrice: 95.90, prep: 'HIGH', category: 'bigone',
    description: 'Three eggs, three rashers of bacon, two bangers, grilled tomato and onion, chips and toast. Monday, done properly.',
    ing: { eggs: 3, bacon: 3, banger: 2, chips: 1, tomato: 1, onion: 1, bread: 2 },
    includedIngredients: [inc('3 fried eggs'), inc('Bacon'), inc('2 bangers'), inc('Chips'),
      inc('Grilled tomato'), inc('Grilled onion'), inc('Toast', false)],
    addOns: ['extra_egg', 'extra_bacon', 'extra_chips'] },

  2: { id: 'dagwood', name: 'Dagwood', day: 2,
    basePrice: 97.90, prep: 'HIGH', category: 'bigone',
    description: 'The triple-decker: beef patty, fried egg, bacon and cheese stacked on three slices of toast with the full salad and Wimpy Relish, with chips.',
    ing: { patty: 1, eggs: 1, bacon: 2, cheese: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bread: 3, chips: 1 },
    includedIngredients: [inc('Beef patty'), inc('Fried egg'), inc('Bacon'), inc('Cheese'),
      inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Toast', false), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_patty', 'extra_relish', 'extra_chips'] },

  3: { id: 'big_bacon_cheese', name: 'Big Bacon & Cheese', day: 3,
    basePrice: 103.90, prep: 'MEDIUM',  category: 'bigone',
    description: 'Two patties, three rashers of bacon and double cheese with the full salad and Wimpy Relish, with chips.',
    ing: { patty: 2, bacon: 3, cheese: 2, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('2 beef patties', false), inc('Bacon'), inc('Double cheese'),
      inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_patty', 'extra_relish', 'extra_chips'] },

  4: { id: 'big_champion', name: 'Big Champion', day: 4,
    basePrice: 115.90, prep: 'MEDIUM', category: 'bigone',
    description: 'Two patties, a fried egg and double cheese with the full salad and Wimpy Relish, with chips. Thursday’s heavyweight.',
    ing: { patty: 2, eggs: 1, cheese: 2, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('2 beef patties', false), inc('Fried egg'), inc('Double cheese'),
      inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_patty', 'extra_relish', 'extra_chips'] },

  5: { id: 'fully_loaded_dagwood', name: 'Fully Loaded Dagwood', day: 5,
    basePrice: 127.90, prep: 'HIGH', category: 'bigone',
    description: 'The Friday stack: two patties, fried egg, bacon, double cheese AND chicken mayo across three slices of toast, full salad, Wimpy Relish, chips.',
    ing: { patty: 2, eggs: 1, bacon: 2, cheese: 2, chicken_mayo: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bread: 3, chips: 1 },
    includedIngredients: [inc('2 beef patties'), inc('Fried egg'), inc('Bacon'), inc('Double cheese'),
      inc('Chicken mayo'), inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Toast', false), inc('Chips')],
    addOns: ['extra_cheese', 'extra_bacon', 'extra_egg', 'extra_patty', 'extra_relish', 'extra_chips'] },
};

const CATEGORIES = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'burgers',   label: 'Burgers' },
  { id: 'toasteds',  label: 'Toasteds' },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* SAST weekday — UTC+2, no daylight saving to track. Injectable for the tests,
   which must be able to make it any day of the week. */
export function sastDay(now = Date.now()) {
  return new Date(now + 2 * 3600000).getUTCDay();
}

/** Today's Big One — null on a weekend, when `next` trails Monday's instead. */
export function todaysBigOne(now = Date.now()) {
  const d = sastDay(now);
  return BIG_ONES[d] || null;
}

const withAddOns = (i) => ({ ...i, available: i.basePrice != null,
  addOns: (i.addOns || []).map((k) => ADD_ONS[k]).filter(Boolean) });

/**
 * The menu the page renders. Prices travel from here and nowhere else.
 * `items` carries the nine core choices PLUS today's Big One only — another
 * day's hero is not in the payload at all, so a client cannot even try to
 * order it. Weekend: nine items, no hero, and `weekend` trails Monday's.
 */
export function wimpyMenu(now = Date.now()) {
  const d = sastDay(now);
  const hero = BIG_ONES[d] || null;
  return {
    currency: 'ZAR',
    title: 'Weekday Value Menu',
    dayName: DAY_NAMES[d],
    categories: CATEGORIES,
    items: [...ITEMS, ...(hero ? [BIG_ONES[d]] : [])].map(withAddOns),
    bigOne: hero ? { ...withAddOns(hero), dayName: DAY_NAMES[d] } : null,
    weekend: hero ? null : {
      message: 'The Big One is a weekday feature — back Monday.',
      next: { name: BIG_ONES[1].name, basePrice: BIG_ONES[1].basePrice, dayName: 'Monday' },
    },
    /* the whole week, names and prices only — the page prints the rhythm
       ("there's a reason to come back tomorrow") without making any of them
       orderable off their day */
    week: [1, 2, 3, 4, 5].map((k) => ({ day: k, dayName: DAY_NAMES[k],
      name: BIG_ONES[k].name, basePrice: BIG_ONES[k].basePrice, today: k === d })),
  };
}

/* Money in cents, so a total is never the sum of a hundred floating-point
   sixteenths. Everything is added as an integer and divided once at the end. */
const cents = (r) => Math.round(Number(r) * 100);
const rands = (c) => Math.round(c) / 100;
export const zar = (r) => 'R' + Number(r).toFixed(2);

/** Every orderable definition for a given moment: the nine plus today's hero. */
function defsFor(now) {
  const hero = todaysBigOne(now);
  return [...ITEMS, ...(hero ? [hero] : [])];
}

/**
 * Re-price a submitted order from the menu above and say what is wrong with it.
 * Returns { ok, errors[], items[], totalCents }. The caller must not proceed on
 * !ok — every message here is written to be shown to the agent as-is.
 */
export function priceOrder(body, now = Date.now()) {
  const errors = [];
  const raw = (body && body.order && Array.isArray(body.order.items)) ? body.order.items : [];
  if (!raw.length) errors.push('Add at least one item before submitting.');

  const items = [];
  let totalCents = 0;
  const today = todaysBigOne(now);

  raw.forEach((row, n) => {
    const where = 'Item ' + (n + 1);
    const id = String((row && row.id) || '');
    let def = defsFor(now).find((i) => i.id === id);

    /* A Big One ordered off its day is refused BY NAME — a tab left open since
       yesterday must hear which day it is, not "unknown item". */
    if (!def) {
      const other = Object.values(BIG_ONES).find((b) => b.id === id);
      if (other) {
        errors.push(other.name + ' is ' + DAY_NAMES[other.day] + '’s Big One'
          + (today ? ' — today’s is the ' + today.name + '.' : ' — the Big One returns Monday.'));
        return;
      }
      errors.push(where + ': unknown menu item.'); return;
    }
    if (def.basePrice == null) {
      errors.push(def.name + ' has no price set yet, so it cannot be ordered. Ask Nick to configure it.');
      return;
    }
    const qty = Math.floor(Number(row.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) { errors.push(def.name + ': quantity must be between 1 and 20.'); return; }

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
      const aid = String((a && a.id) || a || '');
      if (!allowed.includes(aid) || !ADD_ONS[aid]) { errors.push(def.name + ': "' + aid + '" is not an add-on for this item.'); continue; }
      if (added.some((x) => x.id === aid)) continue;
      const ao = ADD_ONS[aid];
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

/** The human-readable order n8n forwards downstream. */
export function formatOrder({ agentName, cb, items, total, notes }) {
  const L = ['WIMPY ORDER', '', 'Agent: ' + agentName, 'CB Number: ' + cb, ''];
  for (const it of items) {
    L.push('---', '');
    L.push(it.quantity + ' × ' + it.item.toUpperCase()
      + (it.category === 'bigone' ? ' (TODAY’S BIG ONE)' : '') + ' — ' + zar(it.item_total));
    const c = it.customisations || {};
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

/* South African local time. SAST is UTC+2 all year — no daylight saving. */
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
         offers Retry, so the message has to say what happened. */
      return { status: 502, body: { error: 'The order could not be sent (the kitchen system answered ' + r.status + '). Your order has been kept — press Retry.', detail: text.slice(0, 200) } };
    }
    return { status: 200, body: { ok: true, total_price: priced.total, order_formatted: payload.order_formatted, timestamp: payload.timestamp } };
  } catch (e) {
    const why = ctrl.signal.aborted ? 'the kitchen system did not answer within 15 seconds' : String((e && e.message) || e).slice(0, 140);
    return { status: 502, body: { error: 'The order could not be sent — ' + why + '. Your order has been kept — press Retry.' } };
  } finally { clearTimeout(timer); }
}

/* Exported for the spec's models and the overlap test — never for the page. */
export const ALL_ITEMS = [...ITEMS, ...Object.values(BIG_ONES)];

/* ============================================================================
 * THE OPERATING MODEL, COMPUTED — GET /api/portal/wimpy/model.
 *
 * Nick, 2026-08-31 second pass: "all this must be in the wimpy tab". The
 * ingredient matrix, overlap analysis, food cost, wastage, speed ranking and
 * verdict render INSIDE the tab — and they are computed HERE, from the same
 * ITEMS/ING tables the menu and the pricer use, so the analysis on screen can
 * never drift from the menu being sold. Change a recipe or a unitCost and
 * every table updates together; specs/wimpy-3331-menu.md is the narrative
 * copy of the same numbers.
 *
 * Authored (not derived) pieces are labelled: the margin-flag explanations,
 * the wastage reasons, the stock comparison and the verdict are judgement,
 * and pretending judgement is arithmetic would be its own kind of lie.
 * ========================================================================== */

/* Estimated execution minutes — model data, not menu data, so it lives beside
   the model rather than on the customer-facing items. */
const EST_MIN = {
  toasted_cheese_tomato: 4, toasted_chicken_mayo: 4, toasted_bacon_egg: 5,
  mzansi_brekkie: 5, cheese_burger: 6, double_up_breakfast: 7,
  bacon_cheese_burger: 7, big_cheese_burger: 7, big_champion: 8,
  big_bacon_cheese: 8, farmhouse_breakfast: 9, mega_breakfast: 10,
  dagwood: 10, fully_loaded_dagwood: 12,
};

/* §13's flags, authored. The prices stay the brief's — these say WHY the
   margin is weak and which lever exists, exactly as the brief asked. */
const MARGIN_FLAGS = {
  cheese_burger: 'Patty + chips against the entry price. It stays: the door price that makes the board read as value, and its buyers trade up. Levers: strict 100 g patty spec; a 100 g chip portion takes it to ~43.9%.',
  big_bacon_cheese: 'R30.40 of protein in one build (double patty + three rashers). Wednesday’s hero buys mid-week traffic with it. Two rashers would give 43.3%; first item to re-cost on real supplier prices.',
};

const WASTAGE_WHY = {
  banger: 'Breakfast-side only. A slow breakfast day strands the line — Monday’s Mega Breakfast burns the stock into the week. Order small, twice weekly.',
  chicken_mayo: 'A prepared mix with a short fridge life, on two items. Friday’s Fully Loaded Dagwood clears the week’s mix. Batch small, mix daily.',
};

export function wimpyModel() {
  const dayName = (d) => DAY_NAMES[d];

  /* ---- utilisation, derived ---- */
  const uses = {}, cats = {};
  for (const i of ALL_ITEMS) for (const k of Object.keys(i.ing || {})) {
    (uses[k] = uses[k] || []).push(i.id);
    (cats[k] = cats[k] || new Set()).add(i.category);
  }
  const utilisation = Object.keys(ING).map((k) => ({
    id: k, name: ING[k].name, items: (uses[k] || []).length, categories: [...(cats[k] || [])],
  })).sort((a, b) => b.items - a.items);

  /* ---- food cost, derived from ING + OVERHEAD ---- */
  const cost = ALL_ITEMS.map((i) => {
    let c = OVERHEAD_PER_MEAL;
    for (const [k, n] of Object.entries(i.ing || {})) c += ING[k].unitCost * n;
    const fc = c / i.basePrice * 100;
    const band = fc <= 35 ? 'strong' : fc <= 43 ? 'acceptable' : 'weak';
    return {
      id: i.id, name: i.name, category: i.category, day: i.day ? dayName(i.day) : null,
      price: i.basePrice, cost: Math.round(c * 100) / 100,
      foodCostPct: Math.round(fc * 10) / 10,
      grossProfit: Math.round((i.basePrice - c) * 100) / 100,
      marginPct: Math.round((100 - fc) * 10) / 10,
      band, flag: MARGIN_FLAGS[i.id] || null,
    };
  }).sort((a, b) => a.foodCostPct - b.foodCostPct);
  const blended = Math.round(cost.reduce((n, r) => n + r.foodCostPct, 0) / cost.length * 10) / 10;

  /* ---- speed, derived ---- */
  const speed = ALL_ITEMS.map((i) => ({
    id: i.id, name: i.name, prep: i.prep, estMin: EST_MIN[i.id] || null,
    day: i.day ? dayName(i.day) : null,
  })).sort((a, b) => (a.estMin || 99) - (b.estMin || 99));

  /* ---- wastage, risk derived from spread, reasons authored ---- */
  const wastage = utilisation.map((u) => ({
    ...u,
    risk: u.items >= 5 ? 'LOW' : 'MEDIUM',
    why: WASTAGE_WHY[u.id] || (u.items >= 5 ? 'Wide spread — stock turns daily.' : 'Thin spread — watch it.'),
  }));

  return {
    computedFrom: 'worker/src/wimpy.mjs — the same tables the menu and pricer use',
    assumptions: 'Ingredient costs are ESTIMATES, not supplier invoices: '
      + Object.values(ING).map((g) => g.name + ' R' + g.unitCost.toFixed(2)).join(' · ')
      + ' · overhead R' + OVERHEAD_PER_MEAL.toFixed(2) + '/meal (butter, oil, gas, wrap). '
      + 'Replace with real costs in the ING table and every figure here recomputes.',
    ingredients: Object.keys(ING).map((k) => ({ id: k, name: ING[k].name })),
    matrix: ALL_ITEMS.map((i) => ({ id: i.id, name: i.name, category: i.category,
      day: i.day ? dayName(i.day) : null, ing: i.ing })),
    utilisation,
    overlap: {
      singleUse: utilisation.filter((u) => u.items < 2).map((u) => u.name),   // enforced empty
      most: utilisation[0], least: utilisation[utilisation.length - 1],
      note: 'Zero single-use ingredients — enforced by verify-wimpy: an item that adds a fourteenth stock line fails the build. The two thinnest lines each have a weekly burn-down day (Mega Breakfast for bangers, Fully Loaded Dagwood for chicken mayo).',
    },
    cost, blendedFoodCostPct: blended,
    speed,
    wastage,
    stock: {   /* authored comparison */
      thisMenu: { ingredients: 13, sauces: 1, proteins: 5, breads: 2, stations: 3 },
      fullMenu: { ingredients: '45+', sauces: '8+', proteins: '10+', breads: '5+', stations: '6+' },
      note: 'One flat-top runs every protein; chips fry in parallel and gate nothing. Batch-prepped each morning: the salad line, chicken-mayo mix, cheese and relish portions.',
    },
    strategy: [1, 2, 3, 4, 5].map((d) => ({ day: dayName(d), name: BIG_ONES[d].name,
      price: BIG_ONES[d].basePrice,
      pitch: [null, 'Start-the-week plate; burns the weekend’s breakfast stock into service.',
        'The classic triple-decker; first patty day.',
        'Mid-week peak; the indulgence bump.',
        'The heavyweight — best gross profit on the board.',
        'The week’s finale; everything on the board in one stack.'][d] })),
    verdict: [   /* authored */
      ['Menu simplicity', '10 visible choices, 3 decisions.'],
      ['Ingredient overlap', '13 lines, zero single-use — test-enforced.'],
      ['Kitchen speed', '9 of 14 items LOW/MEDIUM; every HIGH item is a Big One, one per day.'],
      ['Food cost', blended + '% blended on stated assumptions.'],
      ['Gross profit', 'R29.80–R76.30 a plate; Thursday’s promotion peak is also the margin peak.'],
      ['Wastage', 'Two MEDIUM lines, each cleared by its own weekly hero day.'],
      ['Stock complexity', '13 ingredients, 1 sauce, 2 breads, 3 stations.'],
      ['Value perception', 'Clean price points, premium copy — never "cheap".'],
      ['Big One potential', 'The weekly rhythm is the marketing engine; day-locking makes it real.'],
      ['Overall viability', 'Sound. Two known margin flags are priced-in strategy, first in line for re-costing.'],
    ],
    chain: 'Fewer ingredients → fewer prep steps → faster kitchen → less wastage → easier stock control → stronger margins → simple decisions → strong weekday value.',
  };
}
