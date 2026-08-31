#!/usr/bin/env node
/**
 * verify-wimpy.mjs — the 3–3–3–1 Weekday Value Menu, proven.
 *
 *   node nicks_code/diagnostics/verify-wimpy.mjs
 *
 * Stubbed, so it proves the RULES rather than the network:
 *   · 3 breakfasts + 3 burgers + 3 toasteds + exactly one Big One per weekday
 *   · every brief price is the price, to the cent, and lives in one file
 *   · THE OVERLAP PRINCIPLE IS AN INVARIANT: no ingredient may be used by
 *     fewer than two items, and the least-shared one must cross categories
 *   · a Big One is only orderable ON ITS DAY, refused by name off it
 *   · weekends serve the nine and trail Monday — nothing is invented
 *   · the total is re-priced SERVER-side; a client figure is never trusted
 *   · identity comes from the session; a failed webhook keeps the cart
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = 'file:///' + path.resolve(HERE, '..', '..', 'worker', 'src', 'wimpy.mjs').replace(/\\/g, '/').replace(/ /g, '%20');

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const { wimpyMenu, priceOrder, formatOrder, submitWimpyOrder, todaysBigOne, ALL_ITEMS, ING } = await import(W);

/* A UTC moment that is the given SAST weekday (0=Sun..6=Sat), mid-morning. */
const onDay = (dow) => {
  const base = Date.parse('2026-08-31T08:00:00Z');           // a Monday in SAST
  return base + ((dow + 6) % 7) * 86400000;
};
const MON = onDay(1), TUE = onDay(2), WED = onDay(3), THU = onDay(4), FRI = onDay(5), SAT = onDay(6), SUN = onDay(0);

head('A · THE STRUCTURE IS 3 + 3 + 3 + 1');
{
  const m = wimpyMenu(MON);
  ok(m.categories.map((c) => c.id).join(',') === 'breakfast,burgers,toasteds', 'three categories, in menu order');
  for (const c of ['breakfast', 'burgers', 'toasteds'])
    ok(m.items.filter((i) => i.category === c).length === 3, 'exactly three ' + c + ' choices');
  ok(m.items.length === 10, 'the customer sees TEN choices — nine core plus today’s Big One', m.items.length);
  ok(m.bigOne && m.items.some((i) => i.id === m.bigOne.id), 'the Big One is one of them');
  ok(m.title === 'Weekday Value Menu', 'and the menu says what it is', m.title);
}

head('B · EVERY PRICE IS THE BRIEF’S, TO THE CENT');
{
  const WANT = {
    mzansi_brekkie: 45.90, double_up_breakfast: 65.90, farmhouse_breakfast: 77.90,
    cheese_burger: 54.90, bacon_cheese_burger: 82.90, big_cheese_burger: 95.90,
    toasted_cheese_tomato: 49.90, toasted_chicken_mayo: 53.90, toasted_bacon_egg: 55.90,
    mega_breakfast: 95.90, dagwood: 97.90, big_bacon_cheese: 103.90,
    big_champion: 115.90, fully_loaded_dagwood: 127.90,
  };
  for (const [id, price] of Object.entries(WANT)) {
    const d = ALL_ITEMS.find((i) => i.id === id);
    ok(d && d.basePrice === price, (d ? d.name : id) + ' is R' + price.toFixed(2), d ? 'got ' + d.basePrice : 'missing');
  }
  ok(ALL_ITEMS.length === 14, 'fourteen definitions in total — nine core, five Big Ones, nothing invented', ALL_ITEMS.length);
  ok(!ALL_ITEMS.some((i) => /wing|mince|liver|kids|dessert/i.test(i.name)),
    'the exclusions hold: no wings, mince, livers, kids meals or desserts');
}

head('C · THE OVERLAP PRINCIPLE IS AN INVARIANT, NOT AN ASPIRATION');
{
  const uses = {};                             // ingredient -> Set of item ids
  const cats = {};                             // ingredient -> Set of categories
  for (const i of ALL_ITEMS) for (const k of Object.keys(i.ing || {})) {
    (uses[k] = uses[k] || new Set()).add(i.id);
    (cats[k] = cats[k] || new Set()).add(i.category);
  }
  ok(Object.keys(ING).length === 13, 'thirteen core ingredients — the brief’s list exactly', Object.keys(ING).join(','));
  for (const k of Object.keys(ING))
    ok((uses[k] || new Set()).size >= 2, ING[k].name + ' is used by at least two items (' + (uses[k] ? uses[k].size : 0) + ')',
      'SINGLE-USE INGREDIENT — this is the stock line the whole model exists to prevent');
  ok(Object.keys(uses).every((k) => ING[k]), 'no item uses an ingredient outside the thirteen');
  const least = Object.keys(ING).sort((a, b) => uses[a].size - uses[b].size)[0];
  ok(least === 'chicken_mayo' && cats.chicken_mayo.size >= 2,
    'the least-shared ingredient (chicken mayo, ' + uses.chicken_mayo.size + ' items) still crosses categories: '
    + [...cats.chicken_mayo].join(' + '));
  const most = Object.keys(ING).sort((a, b) => uses[b].size - uses[a].size)[0];
  console.log('  (most-used: ' + ING[most].name + ' in ' + uses[most].size + ' of 14 items)');
  /* every item is built ONLY from the shared pool — the §7 rule as code */
  ok(ALL_ITEMS.every((i) => Object.keys(i.ing || {}).length >= 3), 'every item draws on at least three shared ingredients');
}

head('D · ONE BIG ONE PER DAY, AND THE DAY DECIDES');
{
  const days = { 1: 'mega_breakfast', 2: 'dagwood', 3: 'big_bacon_cheese', 4: 'big_champion', 5: 'fully_loaded_dagwood' };
  for (const [d, id] of Object.entries(days)) {
    const hero = todaysBigOne(onDay(+d));
    ok(hero && hero.id === id, 'day ' + d + ' features the ' + (hero ? hero.name : '(none)'), hero && hero.id);
  }
  const tue = wimpyMenu(TUE);
  ok(tue.bigOne.id === 'dagwood' && tue.dayName === 'Tuesday', 'Tuesday’s menu says Tuesday and serves the Dagwood');
  ok(!tue.items.some((i) => i.id === 'mega_breakfast'),
    'Monday’s hero is NOT in Tuesday’s payload — a client cannot even try to order it');
  ok(tue.week.length === 5 && tue.week.filter((w) => w.today).length === 1
    && tue.week.find((w) => w.today).name === 'Dagwood',
    'the week strip shows all five with exactly today marked — the reason to come back tomorrow');
}

head('E · WEEKENDS: NOTHING INVENTED, MONDAY TRAILED');
{
  for (const [label, t] of [['Saturday', SAT], ['Sunday', SUN]]) {
    const m = wimpyMenu(t);
    ok(m.bigOne === null && m.items.length === 9, label + ' serves the nine core items and no hero');
    ok(m.weekend && m.weekend.next.name === 'Mega Breakfast' && m.weekend.next.dayName === 'Monday',
      '...and trails Monday’s ' + m.weekend.next.name);
  }
  const r = priceOrder({ order: { items: [{ id: 'mega_breakfast', quantity: 1 }] } }, SAT);
  ok(!r.ok && /returns Monday/.test(r.errors[0]), 'ordering a Big One on Saturday is refused with the honest answer', r.errors[0]);
}

head('F · A BIG ONE OFF ITS DAY IS REFUSED BY NAME');
{
  const r = priceOrder({ order: { items: [{ id: 'mega_breakfast', quantity: 1 }] } }, THU);
  ok(!r.ok, 'Monday’s Mega Breakfast cannot be ordered on Thursday');
  ok(/Mega Breakfast is Monday/.test(r.errors[0]) && /Big Champion/.test(r.errors[0]),
    '...and the message names both days’ heroes', r.errors[0]);
  const r2 = priceOrder({ order: { items: [{ id: 'big_champion', quantity: 1 }] } }, THU);
  ok(r2.ok && r2.total === 115.90, 'Thursday’s own Big Champion prices at R115.90 on Thursday');
}

head('G · THE SERVER PRICES, THE CLIENT ONLY DISPLAYS');
{
  const r = priceOrder({ order: { items: [
    { id: 'cheese_burger', quantity: 2 },
    { id: 'toasted_chicken_mayo', quantity: 1 },
  ] } }, WED);
  ok(r.ok && r.totalCents === 2 * 5490 + 5390, 'integer cents: 2 × R54.90 + R53.90 = R' + r.total, r.totalCents);
  const rm = priceOrder({ order: { items: [
    { id: 'cheese_burger', quantity: 1, removed: ['Onion', 'Wimpy Relish'] },
  ] } }, WED);
  ok(rm.ok && rm.total === 54.90, 'removing included ingredients is FREE');
  const bad = priceOrder({ order: { items: [{ id: 'cheese_burger', quantity: 1, removed: ['Beef patty'] }] } }, WED);
  ok(!bad.ok, 'the patty cannot be removed — a burger without it stops being the item');
  const q = priceOrder({ order: { items: [{ id: 'mzansi_brekkie', quantity: 0 }] } }, WED);
  ok(!q.ok, 'quantity zero is refused');
  const ao = priceOrder({ order: { items: [{ id: 'toasted_cheese_tomato', quantity: 1, added: ['extra_patty'] }] } }, WED);
  ok(!ao.ok, 'an add-on the item does not offer is refused');
  const un = priceOrder({ order: { items: [{ id: 'wings_6', quantity: 1 }] } }, WED);
  ok(!un.ok && /unknown/.test(un.errors[0]), 'the retired wings are gone — unknown item');
}

head('H · IDENTITY, MISMATCH AND FAILURE BEHAVIOUR');
{
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, text: async () => '' }; };
  try {
    /* submitWimpyOrder prices with the REAL clock, so the order is built from
       whatever today actually offers: today's hero on a weekday, the Big Cheese
       on a weekend. The suite must pass every day of the week. */
    const user = { full_name: 'Test Agent', username: 'cb999', cb: 'CB999' };
    const heroNow = todaysBigOne();
    const pick = heroNow || ALL_ITEMS.find((i) => i.id === 'big_cheese_burger');
    const body = { total_price: 1.00,                             // a lying client
      order: { items: [{ id: pick.id, quantity: 1 }], additional_notes: 'no onion on the side' } };
    const res = await submitWimpyOrder({}, user, body);
    ok(res.status === 200, 'a valid order for today (' + pick.name + ') submits', JSON.stringify(res.body).slice(0, 120));
    ok(sent.total_price === pick.basePrice, 'the total sent to the kitchen is the SERVER’s figure', sent.total_price);
    ok(sent.price_mismatch && sent.price_mismatch.client_total === 1.00,
      'the client’s wrong figure travels as price_mismatch, never adopted');
    ok(sent.cb_number === 'CB999' && sent.agent_name === 'Test Agent', 'identity is the session’s');
    if (heroNow) ok(sent.order_formatted.includes('(TODAY’S BIG ONE)'), 'the kitchen slip marks the Big One');
    else ok(true, '(weekend run — no Big One slip line to check)');
    ok(/\+02:00$/.test(sent.timestamp), 'timestamped in SAST');

    const noCb = await submitWimpyOrder({}, { full_name: 'X', username: 'x', cb: '' }, body);
    ok(noCb.status === 403, 'no CB number on the account → no order');

    globalThis.fetch = async () => { throw new Error('boom'); };
    const down = await submitWimpyOrder({}, user, body);
    ok(down.status === 502 && /kept/.test(down.body.error), 'a dead webhook reports failure and tells the agent the cart is kept');
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'err' });
    const err = await submitWimpyOrder({}, user, body);
    ok(err.status === 502 && /500/.test(err.body.error), 'a webhook error travels with its status, never as success');
  } finally { globalThis.fetch = realFetch; }
}

head('I · THE PAGE HOLDS NO PRICE OF ITS OWN');
{
  const fs = await import('node:fs');
  const page = fs.readFileSync(path.resolve(HERE, '..', '..', 'agent', 'index.html'), 'utf8');
  const priced = ['45.90', '65.90', '77.90', '54.90', '82.90', '95.90', '49.90', '53.90', '55.90', '97.90', '103.90', '115.90', '127.90'];
  const inPage = priced.filter((p) => page.includes(p));
  ok(inPage.length === 0, 'none of the fourteen prices appears in agent/index.html — one menu, one place', inPage.join(','));
  ok(page.includes('wp-hero') && page.includes('TODAY\\u2019S BIG ONE'.replace('\\u2019', '’')),
    'the page renders the Big One hero from the payload');
  ok(page.includes('wp-week'), 'and the week strip — the reason to come back tomorrow');
  ok(!/cheap|bargain|budget|clearance|discount/i.test(page.match(/wp-title[\s\S]{0,400}/)[0]),
    'the header language is value, never cheap');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
