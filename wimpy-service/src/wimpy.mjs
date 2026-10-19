/**
 * WIMPY WEEKDAY VALUE MENU — the 3–3–3–1 operating model (Nick, 2026-08-31).
 *
 * 3 Breakfasts + 3 Burgers + 2 Toasteds + 1 Daily Big One (Cheese & Tomato Toasted
 * removed 2026-09-14). The customer sees
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
 * gherkins (ditto). THE ADD-ON DOOR IS GONE TOO (Nick, 2026-09-10: "no option
 * to add-ons and edit the items"): an item is an id and a quantity, nothing
 * else travels, and a request still carrying an add-on or a customisation is
 * refused in words rather than stripped.
 *
 * ITS OWN SERVICE SINCE 2026-10-09 (Spec Kit 018, specs/018-wimpy-standalone-service/): this module moved
 * out of the Cloudflare Worker UNCHANGED into wimpy-service/src/; "the Worker" below now means this service.
 * ITS OWN APP SINCE 2026-09-10 (specs/wimpy-vas-apps-plan.md): the page is
 * /wimpy/ (now the service's own origin), signed in with a CB number and the person's password since Spec Kit
 * 009 (a session SCOPED to these routes — see auth.mjs signinWimpy); the order form asks for the CB
 * number, name and surname, which travel to the kitchen beside the account's
 * own name; orders are taken 07:00–09:00 SAST, Monday to Friday (Spec Kit 020, 2026-10-09; 08:00–17:00 before); everyone
 * orders, management included.
 */

import { db } from './db.mjs';
import { writeOrderToHighLevel, hlConfigured, dbWhy, FIRST_TRY_GRACE_MIN } from './wimpy-hl.mjs';

const WEBHOOK = 'https://n8n-production-591cc.up.railway.app/webhook/wimpy';

/* MY ORDERS STARTS HERE (Spec Kit 015, decision 4): orders placed before the release went only to the kitchen hand-off
   and are not in the ledger, so the history begins on the release day — the page says so. Released 2026-10-07
   (Worker 03191223) — the day the first ledger row was written. */
export const WIMPY_HISTORY_SINCE = '2026-10-07';

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
  /* FOUR MORE for the burgers added 2026-10-19 (Nick: "add only the rib burger, crispy stack and the peri peri chicken",
     builds from the Wimpy menu cards he sent). Onion rings and mayo are shared by the Crispy Stack and the Peri-Peri
     Chicken; the rib patty and the peri-peri fillet are each used by one burger alone — the overlap rule's two named
     exceptions, by Nick's instruction. Costs are ESTIMATES, like every cost here. */
  rib_patty:      { name: 'Rib patty',                unitCost: 16.00 },   // basted rib patty
  peri_chicken:   { name: 'Peri-peri chicken fillet', unitCost: 15.00 },   // flame-grilled, basted
  onion_rings:    { name: 'Crispy fried onion rings', unitCost: 3.50 },    // per portion
  mayo:           { name: 'Mayo (creamy / chilli / peri-peri)', unitCost: 1.50 },   // per portion
  gherkins:       { name: 'Gherkins',                 unitCost: 0.80 },    // the Cheese card's build (Nick, 2026-10-19)
};
export const OVERHEAD_PER_MEAL = 1.20;   // butter, oil, gas, wrap — the spec's stated assumption

/* There is no add-on table any more (Nick, 2026-09-10). The kitchen still holds
   the thirteen ingredients; nothing can be added to an item through this file. */

const inc = (name) => ({ name });

/* ------------------------------------------------------------------ the nine
   ing[]: ingredient id → units used, the machine-readable half of the spec's
   ingredient matrix. prep: LOW/MEDIUM/HIGH per the brief's §11 bands.

   wasPrice IS THE PRE-DISCOUNT PRICE, struck through on the card (Nick,
   2026-08-31: "add the 20% off but make it the real price"). Two provenances,
   and the difference is not cosmetic:

     · SUPPLIED — a real Wimpy list price Nick gave in the FIRST Wimpy brief
       for the same build. Four items have one, and they show a ~34% saving,
       not 20%, because the value menu cut the toasteds and the Dagwood harder
       than the rest. That is the truth about those four and it is shown as
       such rather than flattened to a uniform claim.
     · DERIVED — basePrice ÷ 0.8, taken up to the next .90: the brief's own
       "~20% off current Wimpy pricing, rounded clean" rule run backwards. It
       is arithmetic on Nick's stated rule, not a verified till price, and the
       card claims only "save 20%" — never "Wimpy charges this".

   The old Champion's supplied R124.90 was deliberately NOT reused for the Big
   Champion: that was a single-patty build and this is two, and a real price
   for a different product is not a real price for this one. */
const ITEMS = [
  // ---- BREAKFAST — 3 ----
  { id: 'mzansi_brekkie', name: 'Mzansi Brekkie', category: 'breakfast',
    basePrice: 45.90, wasPrice: 57.90, prep: 'LOW',
    description: 'A fried egg, two rashers of bacon and grilled tomato on toast. The weekday starter.',
    ing: { eggs: 1, bacon: 2, tomato: 1, bread: 2 },
    includedIngredients: [inc('Fried egg'), inc('Bacon'), inc('Grilled tomato'), inc('Toast')] },

  { id: 'double_up_breakfast', name: 'Double Up Breakfast', category: 'breakfast',
    basePrice: 65.90, wasPrice: 82.90, prep: 'MEDIUM',
    description: 'Two eggs, two rashers of bacon, a grilled banger and tomato on toast. Made fresh.',
    ing: { eggs: 2, bacon: 2, banger: 1, tomato: 1, bread: 2 },
    includedIngredients: [inc('2 fried eggs'), inc('Bacon'), inc('Banger'), inc('Grilled tomato'), inc('Toast')] },

  { id: 'farmhouse_breakfast', name: 'Farmhouse Breakfast', category: 'breakfast',
    basePrice: 77.90, wasPrice: 97.90, prep: 'MEDIUM',
    description: 'Two eggs, bacon, two bangers, grilled tomato and onion, with chips and toast. The full plate.',
    ing: { eggs: 2, bacon: 2, banger: 2, chips: 1, tomato: 1, onion: 1, bread: 2 },
    includedIngredients: [inc('2 fried eggs'), inc('Bacon'), inc('2 bangers'), inc('Chips'),
      inc('Grilled tomato'), inc('Grilled onion'), inc('Toast')] },

  // ---- BURGERS — 6 (three added 2026-10-19, see below) ----
  /* CORRECTED 2026-10-19 from the Wimpy menu card Nick sent: the Cheese is R92.90 at Wimpy (was shown as R68.90, a
     derived figure). Staff pay R73.90 — the highest .90 price at least 20% under the card, like the rest of the menu.
     The build is the card's: beef patty, cheese, grilled onions, gherkins, lettuce, Wimpy Relish. */
  { id: 'cheese_burger', name: 'Cheese Burger', category: 'burgers',
    basePrice: 73.90, wasPrice: 92.90, prep: 'LOW',
    description: 'Beef patty, a slice of cheese, grilled onions, gherkins, lettuce and Famous Wimpy Relish, with chips.',
    ing: { patty: 1, cheese: 1, onion: 1, gherkins: 1, lettuce: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Beef patty'), inc('Cheese'), inc('Grilled onions'), inc('Gherkins'),
      inc('Lettuce'), inc('Famous Wimpy Relish'), inc('Chips')] },

  { id: 'bacon_cheese_burger', name: 'Bacon & Cheese Burger', category: 'burgers',
    basePrice: 82.90, wasPrice: 103.90, prep: 'MEDIUM',
    description: 'Beef patty, crispy bacon and cheese with the full salad and Wimpy Relish, with chips.',
    ing: { patty: 1, bacon: 2, cheese: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Beef patty'), inc('Bacon'), inc('Cheese'), inc('Lettuce'),
      inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')] },

  { id: 'big_cheese_burger', name: 'Big Cheese Burger', category: 'burgers',
    basePrice: 95.90, wasPrice: 119.90, prep: 'MEDIUM',
    description: 'Two patties, double cheese, the full salad and Wimpy Relish, with chips. A weekday favourite.',
    ing: { patty: 2, cheese: 2, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('2 beef patties'), inc('Double cheese'), inc('Lettuce'),
      inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')] },

  /* ADDED 2026-10-19 (Nick: "add only the rib burger, crispy stack and the peri peri chicken"; then the Wimpy menu cards:
     Crispy Stack R106.90, Peri-Peri Chicken R94.90; then "correct ... percentages to the other two burgers"). The card
     price is the struck-through LIST price; staff pay the highest .90 price at least 20% under it, like the rest of the
     menu: R85.90 and R75.90 — each card reads "save 20%" (Nick: "must be 20 and not 21"). The Rib Burger had no card: it stays unpriced — "Price not set yet", priceOrder refuses
     it — until Nick sends its price. */
  { id: 'rib_burger', name: 'Rib Burger', category: 'burgers',
    basePrice: null, wasPrice: null, prep: 'MEDIUM',
    description: 'A basted rib patty with lettuce, tomato, onion and Wimpy Relish on a bun, with chips.',
    ing: { rib_patty: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Basted rib patty'), inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')] },

  { id: 'crispy_stack', name: 'Crispy Stack', category: 'burgers',
    basePrice: 85.90, wasPrice: 106.90, prep: 'MEDIUM',
    description: 'Beef patty, two rashers of streaky bacon, crispy fried onion rings, a slice of cheese, tomato, lettuce and creamy or chilli mayo, with chips.',
    ing: { patty: 1, bacon: 2, onion_rings: 1, cheese: 1, tomato: 1, lettuce: 1, mayo: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Beef patty'), inc('2 rashers streaky bacon'), inc('Crispy fried onion rings'), inc('Cheese'),
      inc('Tomato'), inc('Lettuce'), inc('Creamy or chilli mayo'), inc('Chips')] },

  { id: 'peri_peri_chicken', name: 'Peri-Peri Chicken', category: 'burgers',
    basePrice: 75.90, wasPrice: 94.90, prep: 'MEDIUM',
    description: 'Peri-peri basted tender grilled chicken fillet, crispy fried onion rings, a slice of cheese, lettuce and creamy peri-peri mayo, with chips.',
    ing: { peri_chicken: 1, onion_rings: 1, cheese: 1, lettuce: 1, mayo: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('Peri-peri grilled chicken fillet'), inc('Crispy fried onion rings'), inc('Cheese'), inc('Lettuce'),
      inc('Creamy peri-peri mayo'), inc('Chips')] },

  // ---- TOASTEDS — 2 (Cheese & Tomato Toasted removed, Nick 2026-09-14; cheese, tomato,
  //      bread and chips are still each shared by other items, so the overlap rule holds) ----
  { id: 'toasted_chicken_mayo', name: 'Chicken Mayo Toasted', category: 'toasteds',
    basePrice: 53.90, wasPrice: 80.90, /* SUPPLIED */ prep: 'LOW',
    description: 'Creamy chicken mayo on toasted bread, with chips.',
    ing: { chicken_mayo: 1, bread: 2, chips: 1 },
    includedIngredients: [inc('Chicken mayo'), inc('Toasted bread'), inc('Chips')] },

  { id: 'toasted_bacon_egg', name: 'Bacon & Egg Toasted', category: 'toasteds',
    basePrice: 55.90, wasPrice: 84.90, /* SUPPLIED */ prep: 'LOW',
    description: 'Bacon and fried egg on toasted bread, with chips.',
    ing: { bacon: 2, eggs: 1, bread: 2, chips: 1 },
    includedIngredients: [inc('Bacon'), inc('Fried egg'), inc('Toasted bread'), inc('Chips')] },
];

/* ------------------------------------------------------------ the Big Ones
   One per weekday, keyed 1–5 = Monday–Friday. The hero of the day and the
   reason to come back tomorrow. */
const BIG_ONES = {
  1: { id: 'mega_breakfast', name: 'Mega Breakfast', day: 1,
    basePrice: 95.90, wasPrice: 119.90, prep: 'HIGH', category: 'bigone',
    description: 'Three eggs, three rashers of bacon, two bangers, grilled tomato and onion, chips and toast. Monday, done properly.',
    ing: { eggs: 3, bacon: 3, banger: 2, chips: 1, tomato: 1, onion: 1, bread: 2 },
    includedIngredients: [inc('3 fried eggs'), inc('Bacon'), inc('2 bangers'), inc('Chips'),
      inc('Grilled tomato'), inc('Grilled onion'), inc('Toast')] },

  2: { id: 'dagwood', name: 'Dagwood', day: 2,
    basePrice: 97.90, wasPrice: 149.90, /* SUPPLIED */ prep: 'HIGH', category: 'bigone',
    description: 'The triple-decker: beef patty, fried egg, bacon and cheese stacked on three slices of toast with the full salad and Wimpy Relish, with chips.',
    ing: { patty: 1, eggs: 1, bacon: 2, cheese: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bread: 3, chips: 1 },
    includedIngredients: [inc('Beef patty'), inc('Fried egg'), inc('Bacon'), inc('Cheese'),
      inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Toast'), inc('Chips')] },

  3: { id: 'big_bacon_cheese', name: 'Big Bacon & Cheese', day: 3,
    basePrice: 103.90, wasPrice: 129.90, prep: 'MEDIUM',  category: 'bigone',
    description: 'Two patties, three rashers of bacon and double cheese with the full salad and Wimpy Relish, with chips.',
    ing: { patty: 2, bacon: 3, cheese: 2, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('2 beef patties'), inc('Bacon'), inc('Double cheese'),
      inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')] },

  4: { id: 'big_champion', name: 'Big Champion', day: 4,
    basePrice: 115.90, wasPrice: 144.90, prep: 'MEDIUM', category: 'bigone',
    description: 'Two patties, a fried egg and double cheese with the full salad and Wimpy Relish, with chips. Thursday’s heavyweight.',
    ing: { patty: 2, eggs: 1, cheese: 2, lettuce: 1, tomato: 1, onion: 1, relish: 1, bun: 1, chips: 1 },
    includedIngredients: [inc('2 beef patties'), inc('Fried egg'), inc('Double cheese'),
      inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Chips')] },

  5: { id: 'fully_loaded_dagwood', name: 'Fully Loaded Dagwood', day: 5,
    basePrice: 127.90, wasPrice: 159.90, prep: 'HIGH', category: 'bigone',
    description: 'The Friday stack: two patties, fried egg, bacon, double cheese AND chicken mayo across three slices of toast, full salad, Wimpy Relish, chips.',
    ing: { patty: 2, eggs: 1, bacon: 2, cheese: 2, chicken_mayo: 1, lettuce: 1, tomato: 1, onion: 1, relish: 1, bread: 3, chips: 1 },
    includedIngredients: [inc('2 beef patties'), inc('Fried egg'), inc('Bacon'), inc('Double cheese'),
      inc('Chicken mayo'), inc('Lettuce'), inc('Tomato'), inc('Onion'), inc('Wimpy Relish'), inc('Toast'), inc('Chips')] },
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

/* THE ORDERING WINDOW — 07:00 to 09:00 SAST, Monday to Friday (Nick, 2026-10-09, Spec Kit 020: "it must only be
   accessible from 7 to 9, monday to friday then its closed"; it was 08:00–17:00 from 2026-09-10 and the 08:00 hour
   alone from 2026-09-02). Outside the window the menu and My orders still read; nothing can be ordered. The
   page shows the hours when closed, but a page's clock is nobody's authority —
   THIS is the lock: the menu says whether the window is open and submit
   refuses outside it. SAST is UTC+2, no daylight saving. */
export const WINDOW = { fromHour: 7, toHour: 9, hours: '07:00–09:00', days: 'Monday to Friday' };
export function wimpyWindowOpen(now = Date.now()) {
  const d = new Date(now + 2 * 3600000);
  const dow = d.getUTCDay(), h = d.getUTCHours();
  return dow >= 1 && dow <= 5 && h >= WINDOW.fromHour && h < WINDOW.toHour;
}

/* ORDERS ARE AS-IS (Nick, 2026-09-02 and again 2026-09-10) — an item is served
   exactly as the kitchen makes it. `available` is the only flag the page reads. */
const served = (i) => ({ ...i, available: i.basePrice != null });

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
    /* the window travels with the menu so a page that fetched it can say when
       ordering opens rather than guessing from its own clock */
    window: { open: wimpyWindowOpen(now), hours: WINDOW.hours, days: WINDOW.days },
    categories: CATEGORIES,
    items: [...ITEMS, ...(hero ? [BIG_ONES[d]] : [])].map(served),
    bigOne: hero ? { ...served(hero), dayName: DAY_NAMES[d] } : null,
    weekend: hero ? null : {
      message: 'The Big One is a weekday feature — back Monday.',
      next: { name: BIG_ONES[1].name, basePrice: BIG_ONES[1].basePrice, dayName: 'Monday' },
    },
    /* the whole week, names and prices only — the page prints the rhythm
       ("there's a reason to come back tomorrow") without making any of them
       orderable off their day */
    /* READABLE, NOT ORDERABLE. Every day carries enough for an agent to see
       what is on (Nick: "the user should be able to read tuesday, thursday
       etc") — the pricer still refuses an off-day Big One by name, so this
       changes what can be READ, never what can be bought. */
    week: [1, 2, 3, 4, 5].map((k) => ({ day: k, dayName: DAY_NAMES[k],
      name: BIG_ONES[k].name, basePrice: BIG_ONES[k].basePrice,
      wasPrice: BIG_ONES[k].wasPrice, description: BIG_ONES[k].description,
      today: k === d })),
  };
}

/* Money in cents, so a total is never the sum of a hundred floating-point
   sixteenths. Everything is added as an integer and divided once at the end. */
/* Quantity is the ONE thing a person may change about an item (Nick, 2026-09-10). */
const MAX_QTY = 10;
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
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) { errors.push(def.name + ': quantity must be between 1 and ' + MAX_QTY + '.'); return; }

    /* EVERY ITEM COMES AS IT IS (Nick, 2026-09-02; add-ons too, 2026-09-10). A
       request still carrying a customisation or an add-on is an old cached tab —
       and silently stripping it would hand the kitchen a different order than the
       person believes they placed (their "no onions" would arrive WITH onions),
       so it is refused in words instead. */
    if ((Array.isArray(row.removed) && row.removed.length)
      || (Array.isArray(row.added) && row.added.length)
      || (row.choices && Object.keys(row.choices).length)
      || (row.customisations && ((row.customisations.removed || []).length || (row.customisations.added || []).length))) {
      errors.push(def.name + ' comes as it is — add-ons and customisations are not taken. Remove the item and add it back.');
      return;
    }

    const unit = cents(def.basePrice);
    const line = unit * qty;
    totalCents += line;
    items.push({
      id: def.id, item: def.name, category: def.category, quantity: qty,
      base_price: rands(cents(def.basePrice)),
      unit_total: rands(unit),
      item_total: rands(line),
    });
  });

  return { ok: !errors.length, errors, items, totalCents, total: rands(totalCents) };
}

/** The human-readable order n8n forwards downstream. */
export function formatOrder({ agentName, cb, listName, phone, items, total, notes }) {
  const L = ['WIMPY ORDER', '', 'Name: ' + agentName, 'CB Number: ' + cb];
  if (phone) L.push('Phone: ' + phone);
  if (listName && listName !== agentName) L.push('On the Agent List as: ' + listName);
  L.push('');
  for (const it of items) {
    L.push('---', '');
    L.push(it.quantity + ' × ' + it.item.toUpperCase()
      + (it.category === 'bigone' ? ' (TODAY’S BIG ONE)' : '') + ' — ' + zar(it.item_total));
    L.push('');
  }
  L.push('---', '', 'TOTAL: ' + zar(total));
  if (notes) L.push('', 'Additional Notes:', notes);
  return L.join('\n');
}

/* WHO IS ORDERING — typed on the form, checked against the session (Nick,
   2026-09-10: "when they order they need to put their cb number, name,
   surname"). The CB typed must be the signed-in person's own: an agent's CB, or
   a manager's username (they have no CB). Names are letters, spaces, hyphens
   and apostrophes, 2–40 characters — enough for every name on the list and
   nothing that could carry an instruction to the kitchen. */
const NAME_RE = /^[\p{L}][\p{L}\s'’\-.]{0,39}$/u;
/* A SOUTH AFRICAN MOBILE OR LANDLINE (Nick, 2026-09-14: "the user must add their phone number").
   Typed however people type it — 082 123 4567, 0821234567, +27 82 123 4567, 27821234567 — and
   normalised to the ten-digit local form (0821234567) so the kitchen sheet gets one shape. */
export function normPhone(v) {
  const d = String(v || '').replace(/[^0-9+]/g, '');
  const m = /^(?:\+?27|0)?([1-9]\d{8})$/.exec(d.replace(/^\+/, ''));
  return m ? '0' + m[1] : null;
}
export function whoIsOrdering(user, who) {
  const w = who && typeof who === 'object' ? who : {};
  const typedCb = String(w.cb || '').trim();
  const first = String(w.first_name || '').trim().replace(/\s+/g, ' ');
  const last = String(w.surname || '').trim().replace(/\s+/g, ' ');
  const phone = normPhone(w.phone);
  const own = String(user.cb || '').trim();
  const norm = (v) => /^\s*(cb)?[\s-]*0*\d+\s*$/i.test(v) ? 'CB' + String(parseInt(String(v).replace(/[^0-9]/g, ''), 10)) : String(v).trim().toLowerCase();
  if (!typedCb) return { error: 'Type your CB number.' };
  if (!first || !NAME_RE.test(first) || first.length < 2) return { error: 'Type your name (letters only, 2 to 40 characters).' };
  if (!last || !NAME_RE.test(last) || last.length < 2) return { error: 'Type your surname (letters only, 2 to 40 characters).' };
  if (!String(w.phone || '').trim()) return { error: 'Type your phone number.' };
  if (!phone) return { error: 'That phone number does not look right — type a South African number, e.g. 082 123 4567.' };
  if (own) {
    if (norm(typedCb) !== norm(own)) return { error: 'That CB number is not the one you signed in with (' + own.toUpperCase() + '). An order can only be placed in your own name — sign in as that person to order for them.' };
    return { cb: own.toUpperCase(), first, last, phone };
  }
  /* management: no CB on the account, the username is the handle */
  if (norm(typedCb) !== String(user.username || '').trim().toLowerCase())
    return { error: 'You have no CB number on your account — type your username (' + user.username + ') in the CB number box.' };
  return { cb: String(user.username).toLowerCase(), first, last, phone };
}

/* South African local time. SAST is UTC+2 all year — no daylight saving. */
function sastNow() {
  const d = new Date(Date.now() + 2 * 3600000).toISOString();
  return d.slice(0, 19) + '+02:00';
}

/* THE LEDGER (Spec Kit 015, 2026-10-07 — "it must only show their order history and no one elses"). Once the kitchen
   has said yes, the order is kept in wimpy_orders, OWNED BY THE SESSION'S ACCOUNT (user.user_id — never anything the
   page sent), and then its HighLevel card is written. BOTH happen after the reply, in one ctx.waitUntil chain
   (insert → card; review M1): the database has no abort, and a stalled insert awaited here held the confirmation back
   after the kitchen already had the order — the person presses Retry and the kitchen gets it twice. Nothing here can
   change the reply: a failed insert is logged and reported (kv:wimpy-ledger-failed → the health banner); a HighLevel
   failure is the row's business (wimpy-hl.mjs). The row is due for the retry cron only after FIRST_TRY_GRACE_MIN, so
   the cron never races this chain. No session id (a direct call, as verify-wimpy makes) → nothing to own it → nothing
   recorded. Never awaited by the caller; never throws. */
function recordOrder(env, user, who, priced, notes, now, ctx) {
  if (!user || !user.user_id || !env || !env.SUPABASE_URL) return;
  const DB = db(env);
  const configured = hlConfigured(env);
  const chain = (async () => {
    let row = null;
    try {
      const ins = await DB.insert('wimpy_orders', [{
        owner_user_id: user.user_id, cb: who.cb, placed_at: new Date(now).toISOString(),
        items: priced.items.map((i) => ({ id: i.id, item: i.item, quantity: i.quantity, item_total: i.item_total })),
        total: priced.total, notes: notes || null,
        hl_state: 'pending', hl_next_at: new Date(now + FIRST_TRY_GRACE_MIN * 60000).toISOString(),
        hl_error: configured ? null : 'HighLevel is not configured yet — the card is written once WIMPY_HL_API_KEY and WIMPY_HL_LOCATION_ID are set',
        hl_contact_seed: { first: who.first, last: who.last, phone: who.phone },
      }], false, true);
      row = (ins && ins[0]) || null;
    } catch (e) {
      const why = dbWhy(env, e);
      console.error('[wimpy] the kitchen has the order but the ledger insert failed — it will be missing from My orders: ' + why);
      await DB.insert('rules', [{ key: 'kv:wimpy-ledger-failed', value: { data: JSON.stringify({ at: new Date(now).toISOString(), error: why }) },
        updated_by: 'wimpy', updated_at: new Date(now).toISOString() }], true).catch(() => {});
      return;
    }
    if (row && configured) await writeOrderToHighLevel(env, DB, row);
  })().catch((e) => { console.error('[wimpy] ledger chain failed: ' + dbWhy(env, e)); });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(chain);
}

/**
 * POST /api/wimpy/order — validate, re-price, send.
 *
 * The identity is checked against the SESSION: the form's CB number must be the
 * signed-in person's own, so an order cannot be placed in somebody else's name.
 * The typed name and surname travel as typed, and the account's own name (the
 * Agent List's) travels beside them as list_name, so the kitchen sheet can
 * reconcile a nickname without anyone's word being silently corrected.
 * `ctx` (spec 015) lets the HighLevel card be written after the reply.
 */
export async function submitWimpyOrder(env, user, body, now = Date.now(), ctx = null) {
  /* THE WINDOW IS ENFORCED HERE, not only shown on the page — a tab left open
     since 16:55 does not get to order at half past five. */
  if (!wimpyWindowOpen(now)) return { status: 403, body: {
    error: 'Wimpy orders are taken between 07:00 and 09:00, Monday to Friday (SA time). Ordering is closed now — the menu is back next working day.' } };

  const who = whoIsOrdering(user, body && body.who);
  if (who.error) return { status: 400, body: { error: who.error } };
  const agentName = who.first + ' ' + who.last;
  const cb = who.cb;
  const listName = String(user.full_name || '').trim();

  const priced = priceOrder(body, now);
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
    first_name: who.first,
    surname: who.last,
    phone_number: who.phone,
    list_name: listName,
    timestamp: sastNow(),
    total_price: priced.total,
    order_formatted: formatOrder({ agentName, cb, listName, phone: who.phone, items: priced.items, total: priced.total, notes }),
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
    /* the kitchen said yes: keep it (spec 015) — never able to change this reply */
    try { recordOrder(env, user, who, priced, notes, now, ctx); }   // after the reply (waitUntil) — never awaited here
    catch (e) { console.error('[wimpy] ledger step failed: ' + String((e && e.message) || e).slice(0, 120)); }
    return { status: 200, body: { ok: true, total_price: priced.total, order_formatted: payload.order_formatted, timestamp: payload.timestamp } };
  } catch (e) {
    const why = ctrl.signal.aborted ? 'the kitchen system did not answer within 15 seconds' : String((e && e.message) || e).slice(0, 140);
    return { status: 502, body: { error: 'The order could not be sent — ' + why + '. Your order has been kept — press Retry.' } };
  } finally { clearTimeout(timer); }
}

/* Exported for the spec's models and the overlap test — never for the page. */
export const ALL_ITEMS = [...ITEMS, ...Object.values(BIG_ONES)];
