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
  /* the pre-discount prices are Worker data too — a "was" typed into the page
     would be exactly the kind of unbacked price claim this rule exists to stop */
  const priced = ['45.90', '65.90', '77.90', '54.90', '82.90', '95.90', '49.90', '53.90', '55.90', '97.90', '103.90', '115.90', '127.90',
    '57.90', '68.90', '75.90', '80.90', '84.90', '119.90', '129.90', '144.90', '149.90', '159.90'];
  const inPage = priced.filter((p) => page.includes(p));
  ok(inPage.length === 0, 'none of the fourteen prices appears in agent/index.html — one menu, one place', inPage.join(','));
  ok(page.includes('wp-hero') && page.includes('TODAY\\u2019S BIG ONE'.replace('\\u2019', '’')),
    'the page renders the Big One hero from the payload');
  ok(page.includes('wp-week'), 'and the week strip — the reason to come back tomorrow');
  ok(!/cheap|bargain|budget|clearance|discount/i.test(page.match(/wp-title[\s\S]{0,400}/)[0]),
    'the header language is value, never cheap');
}

head('J · THE REAL PRICE, AND THE SAVING');
{
  const all = ALL_ITEMS;
  ok(all.every((i) => i.wasPrice > i.basePrice),
    'every one of the fourteen carries a pre-discount price above what it sells for',
    all.filter((i) => !(i.wasPrice > i.basePrice)).map((i) => i.name).join(','));

  /* The four Nick actually gave a Wimpy price for, in the first brief. These are
     the only ones claiming a real till price, and they must match it exactly. */
  const SUPPLIED = { toasted_cheese_tomato: 75.90, toasted_chicken_mayo: 80.90,
    toasted_bacon_egg: 84.90, dagwood: 149.90 };
  for (const [id, was] of Object.entries(SUPPLIED)) {
    const d = all.find((i) => i.id === id);
    ok(d.wasPrice === was, d.name + ' is struck through at its SUPPLIED list price R' + was.toFixed(2), d.wasPrice);
  }

  /* Everything else is the brief's own "~20% off, rounded clean" rule run
     backwards. It must land in a tight band — a derived figure that drifted to
     "save 31%" would be a claim nobody can stand behind. */
  const derived = all.filter((i) => !SUPPLIED[i.id]);
  ok(derived.length === 10, 'ten items carry a derived pre-discount price', derived.length);
  for (const d of derived) {
    const save = (1 - d.basePrice / d.wasPrice) * 100;
    ok(save >= 19.5 && save <= 21, d.name + ' derives to save ' + save.toFixed(1) + '% — inside the brief’s 20% rule',
      save.toFixed(2));
  }
  /* the supplied four are a DEEPER cut, and that is shown honestly rather than
     flattened to look like the rest */
  for (const id of Object.keys(SUPPLIED)) {
    const d = all.find((i) => i.id === id);
    const save = (1 - d.basePrice / d.wasPrice) * 100;
    ok(save > 30, d.name + ' shows its true deeper cut (' + save.toFixed(1) + '%), not a uniform 20%');
  }
  ok(!all.some((i) => i.id === 'big_champion' && i.wasPrice === 124.90),
    'the old single-patty Champion price is NOT reused for the two-patty Big Champion');
}

head('K · THE WEEK IS READABLE, AND STILL NOT ORDERABLE');
{
  const m = wimpyMenu(TUE);
  ok(m.week.every((w) => w.description && w.wasPrice > w.basePrice),
    'every weekday in the strip carries its description and its real price — enough to read what is on');
  ok(m.week.find((w) => w.day === 4).name === 'Big Champion',
    'Thursday can be read from a Tuesday session');
  /* readable is not orderable — the day lock is unchanged */
  const r = priceOrder({ order: { items: [{ id: 'big_champion', quantity: 1 }] } }, TUE);
  ok(!r.ok && /Big Champion is Thursday/.test(r.errors[0]),
    'and reading Thursday still cannot buy it on a Tuesday', r.errors[0]);
}

head('L · THE OPERATING MODEL IS GONE FROM THE TAB');
{
  const fs0 = await import('node:fs');
  const pageSrc = fs0.readFileSync(path.resolve(HERE, '..', '..', 'agent', 'index.html'), 'utf8');
  for (const gone of ['data-wsub', 'wModelHTML', 'wLoadModel', 'wm-sec', 'Ingredient matrix'])
    ok(pageSrc.indexOf(gone) < 0, 'the tab no longer carries ' + gone);
  const worker = fs0.readFileSync(path.resolve(HERE, '..', '..', 'worker', 'src', 'index.mjs'), 'utf8');
  ok(worker.indexOf('wimpy/model') < 0, 'and the Worker no longer serves /api/portal/wimpy/model');
  const portal = fs0.readFileSync(path.resolve(HERE, '..', '..', 'worker', 'src', 'portal.mjs'), 'utf8');
  ok(portal.indexOf('wimpy/model') < 0, '...nor allows it');
}

head('M · THE TAB RENDERS THE PRICES AND THE WEEK');
{
  /* The real page, in a real browser, over the real menu payload — a broken
     string builder shows here rather than on an agent’s phone. */
  const fs2 = await import('node:fs');
  const http = await import('node:http');
  const { pathToFileURL } = await import('node:url');
  const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
  const pageSrc = fs2.readFileSync(path.resolve(HERE, '..', '..', 'agent', 'index.html'), 'utf8');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(pageSrc); });
  await new Promise((r) => srv.listen(8298, '127.0.0.1', r));
  const b = await chromium.launch();
  try {
    const pg = await b.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.goto('http://127.0.0.1:8298/', { waitUntil: 'domcontentloaded' });
    const out = await pg.evaluate((menu) => {
      window.WMENU = menu; window.D = { name: 'Test Agent', cb: 'CB999' };
      window.WDAY = null;
      const shut = wimpyPage();
      window.WDAY = 4;                       // read Thursday from a Tuesday session
      const open = wimpyPage();
      return { shut, open };
    }, wimpyMenu(TUE));
    ok(errs.length === 0, 'the page renders with no errors', errs[0]);
    ok(/<s class="was">R149\.90<\/s>/.test(out.shut), 'the hero strikes through the real price');
    ok(/save 3[0-9]%/.test(out.shut), 'and badges the actual saving');
    ok(/data-wday="4"/.test(out.shut) && /role="button"/.test(out.shut), 'each weekday is a real button');
    ok(out.shut.indexOf('wp-peek') < 0, 'nothing is expanded until a day is tapped');
    ok(out.open.indexOf('wp-peek') >= 0 && /THURSDAY’S BIG ONE/.test(out.open),
      'tapping Thursday opens Thursday to read');
    ok(/Two patties, a fried egg/.test(out.open), '...with what is actually in it');
    ok(/Available Thursday/.test(out.open) && /today’s is the Dagwood/.test(out.open),
      '...and says when it can be had, and what today’s is instead');
    ok(out.open.indexOf('data-wadd="big_champion"') < 0,
      'and offers NO add button for an off-day item — the Worker would refuse it anyway');
    ok((out.open.match(/<div/g) || []).length === (out.open.match(/<\/div>/g) || []).length, 'every div is closed');
  } finally { await b.close(); srv.close(); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
