#!/usr/bin/env node
/**
 * menu.test.mjs — the 3–3–3–1 Weekday Value Menu, proven (verify-wimpy.mjs, ported to the Wimpy service — Spec Kit 018).
 *
 *   node test/menu.test.mjs   (or npm test)
 *
 * Stubbed, so it proves the RULES rather than the network:
 *   · 3 breakfasts + 3 burgers + 3 toasteds + exactly one Big One per weekday
 *   · every brief price is the price, to the cent, and lives in one file
 *   · THE OVERLAP PRINCIPLE IS AN INVARIANT: no ingredient may be used by
 *     fewer than two items, and the least-shared one must cross categories
 *   · a Big One is only orderable ON ITS DAY, refused by name off it
 *   · weekends serve the nine and trail Monday — nothing is invented
 *   · the total is re-priced SERVER-side; a client figure is never trusted
 *   · the CB number typed on the order must be the signed-in person’s own
 *   · a failed webhook keeps the cart
 *
 * ITS OWN APP SINCE 2026-09-10: the page half drives wimpy/index.html (WIMPY_HTML=site/wimpy/index.html
 * for the build copy), and the sign-in half proves the Wimpy session is SCOPED to the Wimpy routes. Since Spec Kit 009
 * (2026-10-06) the sign-in takes the CB number AND the person's password; verify-wimpy-signin.mjs drives that check.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = pathToFileURL(path.resolve(HERE, '..', 'src', 'wimpy.mjs')).href;

let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);

const { wimpyMenu, priceOrder, formatOrder, submitWimpyOrder, whoIsOrdering, todaysBigOne, wimpyWindowOpen, WINDOW, ALL_ITEMS, ING } = await import(W);

/* The page under test: the service's own. */
const PAGE = path.resolve(HERE, '..', 'public', 'index.html');

/* A UTC moment that is the given SAST weekday (0=Sun..6=Sat), mid-morning
   (10:00 SAST — OUTSIDE the ordering window, deliberately: pricing and menu
   structure must not depend on the window). */
const onDay = (dow) => {
  const base = Date.parse('2026-08-31T06:00:00Z');           // a Monday, 08:00 SAST
  return base + ((dow + 6) % 7) * 86400000;
};
const MON = onDay(1), TUE = onDay(2), WED = onDay(3), THU = onDay(4), FRI = onDay(5), SAT = onDay(6), SUN = onDay(0);
/* onDay is 08:00 SAST, INSIDE the 07:00–09:00 window (Spec Kit 020, 2026-10-09; it was 08:00–17:00 before).
   outWindow is 11:00 SAST the same day — outside it. */
const inWindow = (dow) => onDay(dow);
const outWindow = (dow) => onDay(dow) + 3 * 3600000;

/* the payload the page half is served, built by the module itself — never a hand-typed menu */
const MENU_FIXTURE = wimpyMenu(inWindow(3));

head('A · THE STRUCTURE IS 3 + 3 + 2 + 1 (Cheese & Tomato Toasted removed 2026-09-14)');
{
  const m = wimpyMenu(MON);
  ok(m.categories.map((c) => c.id).join(',') === 'breakfast,burgers,toasteds', 'three categories, in menu order');
  for (const c of ['breakfast', 'burgers'])
    ok(m.items.filter((i) => i.category === c).length === 3, 'exactly three ' + c + ' choices');
  ok(m.items.filter((i) => i.category === 'toasteds').length === 2, 'exactly two toasted choices');
  ok(!m.items.some((i) => /cheese.*tomato/i.test(i.name)), 'Cheese & Tomato Toasted is off the menu (Nick, 2026-09-14)');
  ok(m.items.length === 9, 'the customer sees NINE choices — eight core plus today’s Big One', m.items.length);
  ok(m.bigOne && m.items.some((i) => i.id === m.bigOne.id), 'the Big One is one of them');
  ok(m.title === 'Weekday Value Menu', 'and the menu says what it is', m.title);
}

head('B · EVERY PRICE IS THE BRIEF’S, TO THE CENT');
{
  const WANT = {
    mzansi_brekkie: 45.90, double_up_breakfast: 65.90, farmhouse_breakfast: 77.90,
    cheese_burger: 54.90, bacon_cheese_burger: 82.90, big_cheese_burger: 95.90,
    toasted_chicken_mayo: 53.90, toasted_bacon_egg: 55.90,
    mega_breakfast: 95.90, dagwood: 97.90, big_bacon_cheese: 103.90,
    big_champion: 115.90, fully_loaded_dagwood: 127.90,
  };
  for (const [id, price] of Object.entries(WANT)) {
    const d = ALL_ITEMS.find((i) => i.id === id);
    ok(d && d.basePrice === price, (d ? d.name : id) + ' is R' + price.toFixed(2), d ? 'got ' + d.basePrice : 'missing');
  }
  ok(ALL_ITEMS.length === 13, 'thirteen definitions in total — eight core, five Big Ones, nothing invented', ALL_ITEMS.length);
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
    ok(m.bigOne === null && m.items.length === 8, label + ' serves the eight core items and no hero');
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


head('G · THE SERVER PRICES, AND QUANTITY IS THE ONLY EDIT');
{
  const r = priceOrder({ order: { items: [
    { id: 'cheese_burger', quantity: 2 },
    { id: 'toasted_chicken_mayo', quantity: 1 },
  ] } }, WED);
  ok(r.ok && r.totalCents === 2 * 5490 + 5390, 'integer cents: 2 × R54.90 + R53.90 = R' + r.total, r.totalCents);
  /* QUANTITY IS THE ONE THING A PERSON MAY CHANGE (Nick, 2026-09-10: "they can have quantity
     just cant customize"). Every other shape of edit — a removal, an add-on, a choice — is
     refused in words, never silently stripped: stripping would hand the kitchen a different
     order than the person believes they placed. */
  const rm = priceOrder({ order: { items: [{ id: 'cheese_burger', quantity: 1, removed: ['Onion'] }] } }, WED);
  ok(!rm.ok && /as it is/.test(rm.errors[0]), 'a removal is refused — every item comes as it is', rm.errors[0]);
  const ao = priceOrder({ order: { items: [{ id: 'toasted_chicken_mayo', quantity: 1, added: ['extra_patty'] }] } }, WED);
  ok(!ao.ok && /as it is/.test(ao.errors[0]), 'an add-on is refused the same way', ao.errors[0]);
  const cz = priceOrder({ order: { items: [{ id: 'cheese_burger', quantity: 1, customisations: { added: [{ name: 'Extra cheese' }], removed: [] } }] } }, WED);
  ok(!cz.ok && /as it is/.test(cz.errors[0]), '...and so is an old client’s customisations object', cz.errors[0]);
  const q0 = priceOrder({ order: { items: [{ id: 'mzansi_brekkie', quantity: 0 }] } }, WED);
  ok(!q0.ok, 'quantity zero is refused');
  const q10 = priceOrder({ order: { items: [{ id: 'mzansi_brekkie', quantity: 10 }] } }, WED);
  ok(q10.ok && q10.totalCents === 10 * 4590, 'ten of one item is fine — quantity is allowed', q10.total);
  const q11 = priceOrder({ order: { items: [{ id: 'mzansi_brekkie', quantity: 11 }] } }, WED);
  ok(!q11.ok && /between 1 and 10/.test(q11.errors[0]), 'eleven is refused, and the message says the cap', q11.errors[0]);
  const plain = priceOrder({ order: { items: [{ id: 'cheese_burger', quantity: 1, removed: [], added: [], choices: {} }] } }, WED);
  ok(plain.ok && plain.total === 54.90, 'empty customisation fields from an old client still price fine');
  ok(!priceOrder({ order: { items: [{ id: 'cheese_burger', quantity: 1 }] } }, WED).items.some((i) => 'customisations' in i),
    'a priced line carries no customisations field at all — the door is gone, not merely shut');
  ok(!wimpyMenu(WED).items.some((i) => (i.addOns || []).length),
    'the menu advertises no add-ons — the page has nothing to build a sheet from');
  const un = priceOrder({ order: { items: [{ id: 'wings_6', quantity: 1 }] } }, WED);
  ok(!un.ok && /unknown/.test(un.errors[0]), 'the retired wings are gone — unknown item');
}

head('H · WHO IS ORDERING: CB NUMBER, NAME, SURNAME');
{
  const agent = { full_name: 'Ann Smith', username: 'cb999', cb: 'CB999' };
  const good = whoIsOrdering(agent, { cb: 'CB999', first_name: 'Ann', surname: 'Smith', phone: '082 123 4567' });
  ok(!good.error && good.cb === 'CB999' && good.first === 'Ann' && good.last === 'Smith',
    'the three typed fields are taken as typed', JSON.stringify(good));
  ok(!whoIsOrdering(agent, { cb: 'cb 999', first_name: 'Ann', surname: 'Smith', phone: '082 123 4567' }).error, 'the CB is matched however it is spelt (cb 999)');
  const other = whoIsOrdering(agent, { cb: 'CB998', first_name: 'Ann', surname: 'Smith', phone: '082 123 4567' });
  ok(/not the one you signed in with/.test(other.error || ''), 'a colleague’s CB is refused — an order is placed in your own name only', other.error);
  ok(/CB number/.test(whoIsOrdering(agent, { first_name: 'Ann', surname: 'Smith', phone: '082 123 4567' }).error || ''), 'a missing CB number is refused');
  ok(/name/.test(whoIsOrdering(agent, { cb: 'CB999', surname: 'Smith', phone: '082 123 4567' }).error || ''), 'a missing name is refused');
  ok(/surname/.test(whoIsOrdering(agent, { cb: 'CB999', first_name: 'Ann', phone: '082 123 4567' }).error || ''), 'a missing surname is refused');
  ok(/name/.test(whoIsOrdering(agent, { cb: 'CB999', first_name: 'A1', surname: 'Smith', phone: '082 123 4567' }).error || ''), 'digits in a name are refused');
  /* the phone number (Nick, 2026-09-14) — required, South African, normalised to 0XXXXXXXXX */
  ok(/phone/.test(whoIsOrdering(agent, { cb: 'CB999', first_name: 'Ann', surname: 'Smith' }).error || ''), 'a missing phone number is refused');
  ok(/phone number does not look right/.test(whoIsOrdering(agent, { cb: 'CB999', first_name: 'Ann', surname: 'Smith', phone: '12345' }).error || ''), 'a number that is not a South African number is refused');
  for (const [typed, want] of [['082 123 4567', '0821234567'], ['0821234567', '0821234567'], ['+27 82 123 4567', '0821234567'], ['27821234567', '0821234567'], ['031 555 0100', '0315550100']])
    ok(whoIsOrdering(agent, { cb: 'CB999', first_name: 'Ann', surname: 'Smith', phone: typed }).phone === want, 'phone "' + typed + '" travels as ' + want);
  const marks = whoIsOrdering(agent, { cb: 'CB999', first_name: 'O’Brien', surname: 'van der Merwe', phone: '082 123 4567' });
  ok(!marks.error, 'real names survive: apostrophes, spaces and lower-case particles', JSON.stringify(marks));
  /* management: no CB on the account, the username is the handle — everyone can order */
  const mgr = { full_name: 'Dalwin Naidoo', username: 'dalwin', cb: '' };
  const m1 = whoIsOrdering(mgr, { cb: 'dalwin', first_name: 'Dalwin', surname: 'Naidoo', phone: '082 123 4567' });
  ok(!m1.error && m1.cb === 'dalwin', 'a manager with no CB orders under their username', JSON.stringify(m1));
  ok(/username/.test(whoIsOrdering(mgr, { cb: 'CB1', first_name: 'Dalwin', surname: 'Naidoo', phone: '082 123 4567' }).error || ''), '...and cannot invent a CB number');
}

head('I · THE ORDER REACHES THE KITCHEN WITH ALL OF IT');
{
  const realFetch = globalThis.fetch;
  let sent = null, calls = 0;
  globalThis.fetch = async (url, opts) => { calls++; sent = JSON.parse(opts.body); return { ok: true, text: async () => '' }; };
  try {
    const NOW = inWindow(3);
    const user = { full_name: 'Ann Smith', username: 'cb999', cb: 'CB999' };
    const pick = todaysBigOne(NOW);
    const who = { cb: 'CB999', first_name: 'Annie', surname: 'Smith', phone: '082 123 4567' };     // a nickname, deliberately
    const body = { who, total_price: 1.00,                                  // a lying client
      order: { items: [{ id: pick.id, quantity: 2 }], additional_notes: 'collect at reception' } };
    const res = await submitWimpyOrder({}, user, body, NOW);
    ok(res.status === 200, 'a valid order for today (' + pick.name + ') submits', JSON.stringify(res.body).slice(0, 120));
    ok(calls === 1, 'ONE order, ONE webhook call', String(calls));
    ok(sent.total_price === +(pick.basePrice * 2).toFixed(2), 'the total sent is the SERVER’s figure, for the quantity ordered', sent.total_price);
    ok(sent.price_mismatch && sent.price_mismatch.client_total === 1.00, 'the client’s wrong figure travels as price_mismatch, never adopted');
    ok(sent.cb_number === 'CB999' && sent.first_name === 'Annie' && sent.surname === 'Smith' && sent.agent_name === 'Annie Smith',
      'the typed CB, name and surname reach the kitchen as typed', JSON.stringify({ cb: sent.cb_number, f: sent.first_name, s: sent.surname }));
    ok(sent.phone_number === '0821234567', 'the phone number reaches the kitchen as its own variable, normalised (phone_number)', JSON.stringify(sent.phone_number));
    ok(/Phone: 0821234567/.test(sent.order_formatted || ''), '…and is printed on the order sheet');
    ok(sent.list_name === 'Ann Smith', '...and the Agent List’s own name travels beside them, never silently correcting the typed one', sent.list_name);
    ok(/On the Agent List as: Ann Smith/.test(sent.order_formatted), 'the kitchen slip shows both names when they differ');
    ok(sent.order_formatted.includes('(TODAY’S BIG ONE)'), 'the slip marks the Big One');
    ok(!/Removed:|Added:/.test(sent.order_formatted), 'and carries no add-on or removal section — there is nothing to carry');
    ok(/\+02:00$/.test(sent.timestamp), 'timestamped in SAST');
    ok(sent.order.items.every((i) => !('customisations' in i)), 'no line carries a customisations field');

    const wrongCb = await submitWimpyOrder({}, user, { ...body, who: { cb: 'CB998', first_name: 'Ann', surname: 'Smith', phone: '082 123 4567' } }, NOW);
    ok(wrongCb.status === 400 && /not the one you signed in with/.test(wrongCb.body.error), 'an order for somebody else is refused', wrongCb.body.error);

    globalThis.fetch = async () => { throw new Error('boom'); };
    const down = await submitWimpyOrder({}, user, body, NOW);
    ok(down.status === 502 && /kept/.test(down.body.error), 'a dead webhook reports failure and says the order is kept');
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'err' });
    const err = await submitWimpyOrder({}, user, body, NOW);
    ok(err.status === 502 && /500/.test(err.body.error), 'a webhook error travels with its status, never as success');
  } finally { globalThis.fetch = realFetch; }
}

head('J · THE PAGE HOLDS NO PRICE OF ITS OWN');
{
  const fs = await import('node:fs');
  const page = fs.readFileSync(PAGE, 'utf8');
  const priced = ['45.90', '65.90', '77.90', '54.90', '82.90', '95.90', '49.90', '53.90', '55.90', '97.90', '103.90', '115.90', '127.90',
    '57.90', '68.90', '75.90', '80.90', '84.90', '119.90', '129.90', '144.90', '149.90', '159.90'];
  const inPage = priced.filter((p) => page.includes(p));
  ok(inPage.length === 0, 'none of the fourteen prices appears in the Wimpy page — one menu, one place', inPage.join(','));
  ok(page.includes('wp-hero') && page.includes('TODAY’S BIG ONE'), 'the page renders the Big One hero from the payload');
  ok(page.includes('wp-week'), 'and the week strip — the reason to come back tomorrow');
  /* the rendered page, not the comments that explain why there is nothing to render */
  const rendered = page.replace(/<!--[\s\S]*?-->/g, '');
  ok(!/customise|customize|add-on|addon|extra cheese/i.test(rendered.replace(/customisations?/gi, '')),
    'nothing the page renders offers a customisation or an add-on');
  ok(page.includes('cbx_wimpy_token') && !page.includes("'cbx_token'"),
    'the token is stored under its own key — a lunch session is never mistaken for a management one');
}
head('K · THE REAL PRICE, AND THE SAVING');
{
  const all = ALL_ITEMS;
  ok(all.every((i) => i.wasPrice > i.basePrice),
    'every one of the fourteen carries a pre-discount price above what it sells for',
    all.filter((i) => !(i.wasPrice > i.basePrice)).map((i) => i.name).join(','));

  /* The four Nick actually gave a Wimpy price for, in the first brief. These are
     the only ones claiming a real till price, and they must match it exactly. */
  const SUPPLIED = { toasted_chicken_mayo: 80.90,
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

head('K2 · THE WEEK IS READABLE, AND STILL NOT ORDERABLE');
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


head('N · THE WINDOW: 07:00–09:00 SAST, MONDAY TO FRIDAY (Spec Kit 020)');
{
  ok(WINDOW.hours === '07:00–09:00' && WINDOW.fromHour === 7 && WINDOW.toHour === 9, 'the module states the hours once', WINDOW.hours);
  ok(wimpyWindowOpen(inWindow(3)) === true, 'Wednesday 08:00 SAST is inside the window');
  ok(wimpyWindowOpen(inWindow(3) - 3600000) === true, 'so is 07:00');
  ok(wimpyWindowOpen(inWindow(3) - 3600000 - 1000) === false, '06:59:59 is before opening');
  ok(wimpyWindowOpen(inWindow(3) + 3600000 - 1000) === true, '08:59:59 is still inside');
  ok(wimpyWindowOpen(inWindow(3) + 3600000) === false, '09:00 is closed');
  ok(wimpyWindowOpen(outWindow(3)) === false, 'Wednesday 11:00 SAST is after closing');
  ok(wimpyWindowOpen(inWindow(6)) === false, 'Saturday is a weekend — closed');
  ok(wimpyWindowOpen(inWindow(0)) === false, 'Sunday too');
  const m = wimpyMenu(inWindow(2));
  ok(m.window && m.window.open === true && m.window.hours === '07:00–09:00', 'the menu payload carries the window, so the page never guesses from its own clock');
  ok(wimpyMenu(outWindow(2)).window.open === false, '...and says closed at 11:00');
  const realFetch = globalThis.fetch;
  let reached = false;
  globalThis.fetch = async () => { reached = true; return { ok: true, text: async () => '' }; };
  try {
    const user = { full_name: 'Ann Smith', username: 'cb999', cb: 'CB999' };
    const body = { who: { cb: 'CB999', first_name: 'Ann', surname: 'Smith', phone: '082 123 4567' }, total_price: 54.90, order: { items: [{ id: 'cheese_burger', quantity: 1 }] } };
    const late = await submitWimpyOrder({}, user, body, outWindow(3));
    ok(late.status === 403 && /07:00 and 09:00/.test(late.body.error), 'an order at 11:00 is refused and the message names the hours', late.body.error);
    const early = await submitWimpyOrder({}, user, body, inWindow(3) - 3600000 - 60000);
    ok(early.status === 403, 'an order at 06:59 is refused too');
    const sat = await submitWimpyOrder({}, user, body, inWindow(6));
    ok(sat.status === 403, 'a Saturday order is refused even at 08:00');
    ok(reached === false, 'the webhook was never called for a refused order');
  } finally { globalThis.fetch = realFetch; }
}

head('M · THE APP: SIGN IN WITH A CB NUMBER AND PASSWORD, ORDER, SEND');
{
  const fs2 = await import('node:fs');
  const http = await import('node:http');
  const { chromium } = await (await import('./_harness.mjs')).playwright();
  const pageSrc = fs2.readFileSync(PAGE, 'utf8');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(pageSrc); });
  await new Promise((r) => srv.listen(8298, '127.0.0.1', r));
  const b = await chromium.launch();
  try {
    const pg = await b.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    /* the Worker is stubbed: sign-in, /api/me and the menu answer; the order is captured */
    let posted = null, signins = 0, orders = 0, signinBody = null;
    await pg.route('**/api/**', async (route) => {   // same origin: the page calls /api/… on itself
      const u = route.request().url();
      const J = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
      const ME = { username: 'cb999', full_name: 'Ann Smith', cb: 'CB999', scope: 'wimpy' };
      if (u.includes('/api/wimpy/signin')) { signins++; signinBody = JSON.parse(route.request().postData() || '{}');
        if (signinBody.password !== 'right-pass-1') return J({ error: 'That CB number and password do not match.' }, 401);
        return J({ token: 'stub-token', user: ME }); }
      if (u.endsWith('/api/wimpy/me')) return J({ user: ME });
      if (u.includes('/api/wimpy/menu')) return J(MENU_FIXTURE);
      if (u.includes('/api/wimpy/order')) { orders++; posted = JSON.parse(route.request().postData() || '{}');
        return J({ ok: true, total_price: 91.80, order_formatted: 'WIMPY ORDER\n\nName: Ann Smith' }); }
      return J({ ok: true });
    });
    await pg.goto('http://127.0.0.1:8298/', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#cb', { timeout: 20000 });
    const signin = await pg.evaluate(() => ({
      label: (document.querySelector('label[for=cb]') || {}).textContent || '',
      pwLabel: (document.querySelector('label[for=pw]') || {}).textContent || '',
      text: document.body.innerText,
      pw: document.querySelectorAll('input[type=password]').length,
      pwId: (document.querySelector('input[type=password]') || {}).id || '',
    }));
    ok(/CB number/i.test(signin.label), 'the sign-in asks for a CB number', signin.label);
    ok(/managers: type your username/i.test(signin.text), '...and tells managers to use their username');
    /* Spec Kit 009 (Nick, 2026-10-06): "users must put this password as well" */
    ok(signin.pw === 1 && signin.pwId === 'pw', 'it asks for a password too — one hidden field, #pw', signin.pw + ' ' + signin.pwId);
    ok(/password/i.test(signin.pwLabel), '...labelled Password', signin.pwLabel);
    ok(/Wimpy password/i.test(signin.text) && /start password/i.test(signin.text) && /not your Agent Analytics password/i.test(signin.text), '...and says which password it means (the Wimpy start password until changed — never the Agent Analytics one; spec 025)');
    ok(/forgotten your password\? ask your team leader or manager/i.test(signin.text), 'it tells a person who forgot it what to do');
    ok(!/no password/i.test(signin.text) && !/no password/i.test(pageSrc), 'nothing on the page or in its source still says "no password"');
    await pg.fill('#cb', 'CB999');
    await pg.click('#go');
    await pg.waitForTimeout(300);
    ok(signins === 0, 'pressing with the password empty sends nothing', String(signins));
    ok(await pg.evaluate(() => document.querySelector('#pw').classList.contains('err')), '...and marks the password field');
    await pg.fill('#pw', 'not-it');
    await pg.click('#go');
    await pg.waitForSelector('.msg.bad', { timeout: 10000 });
    const refused = await pg.evaluate(() => ({ msg: document.querySelector('.msg.bad').innerText, cb: document.querySelector('#cb').value, pw: document.querySelector('#pw').value }));
    ok(/do not match/.test(refused.msg), 'a refusal shows the Worker\'s words', refused.msg);
    ok(refused.cb === 'CB999' && refused.pw === '', '...keeps the CB number typed and clears the password', JSON.stringify({ cb: refused.cb, pwEmpty: refused.pw === '' }));
    /* autofocus is ignored on markup put in by innerHTML once the page has focused something (review 2026-10-06) */
    const focused = await pg.evaluate(() => (document.activeElement || {}).id || '');
    ok(focused === 'pw', '...and puts the cursor in the password box, ready for the second try', focused);
    await pg.fill('#pw', 'right-pass-1');
    await pg.click('#go');
    await pg.waitForSelector('.wp-grid', { timeout: 20000 });
    const menu = await pg.evaluate(() => document.body.innerText);
    ok(signins === 2, 'the CB number and password sign in through /api/wimpy/signin', String(signins));
    ok(signinBody && signinBody.cb === 'CB999' && signinBody.password === 'right-pass-1', '...sending both, as typed', JSON.stringify(signinBody && { cb: signinBody.cb, hasPassword: 'password' in signinBody }));
    ok(await pg.evaluate(() => { try { return sessionStorage.getItem('cbx_wimpy_token') === 'stub-token'; } catch (e) { return false; } }), 'the token is kept under cbx_wimpy_token');
    ok(!(await pg.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).includes('right-pass-1'), 'the password is never stored in the browser');
    ok(/Ordering is open/.test(menu), 'the window state comes from the payload, not the page’s clock');
    ok(/07:00–09:00/.test(menu), '...and reads 07:00–09:00', (menu.match(/\d\d:\d\d–\d\d:\d\d/) || [])[0]);
    /* the header counts what the menu actually carries (Nick, 2026-09-14: "the toasteds still say 3 when there is 2") */
    const sub = await pg.evaluate(() => (document.querySelector('.wp-title .sub') || {}).innerText || '');
    ok(/3 breakfasts · 3 burgers · 2 toasteds/.test(sub), 'the header says 3 breakfasts · 3 burgers · 2 toasteds — counted from the menu, not typed', sub);
    /* and the category tab badges (Nick, 2026-09-16: "under toasteds it says 3 instead of 2") */
    const badges = await pg.evaluate(() => [...document.querySelectorAll('.wp-cat')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    ok(badges.join(' | ') === 'Breakfast 3 | Burgers 3 | Toasteds 2', 'the tab badges count the menu too: Breakfast 3 · Burgers 3 · Toasteds 2', badges.join(' | '));
    await pg.click('[data-wadd="mzansi_brekkie"]');
    await pg.waitForSelector('#wpReview', { timeout: 10000 });
    ok(/1 × Mzansi Brekkie/.test(await pg.evaluate(() => document.querySelector('.wp-cart').innerText)),
      'an item adds to the cart as it comes');
    await pg.click('[data-winc="0"]');
    ok(/2 × Mzansi Brekkie/.test(await pg.evaluate(() => document.querySelector('.wp-cart').innerText)),
      'and + raises the quantity — the one edit there is');
    await pg.click('#wpReview');
    await pg.waitForSelector('#fcb', { timeout: 10000 });
    const form = await pg.evaluate(() => ({
      cb: document.querySelector('#fcb').value, fn: document.querySelector('#ffn').value, ln: document.querySelector('#fln').value }));
    ok(form.cb === 'CB999' && form.fn === 'Ann' && form.ln === 'Smith',
      'the form asks for CB number, name and surname, pre-filled from the account', JSON.stringify(form));
    /* submitting without a phone number is refused on the page itself (2026-09-14) */
    await pg.click('#of button[type=submit]');
    await pg.waitForTimeout(300);
    ok(!(await pg.$('#wpSend')) && /phone/i.test(await pg.evaluate(() => (document.querySelector('.msg.bad') || {}).innerText || '')), 'the form refuses to go on without a phone number');
    await pg.fill('#fph', '082 123 4567');
    await pg.click('#of button[type=submit]');
    await pg.waitForSelector('#wpSend', { timeout: 10000 });
    await pg.click('#wpSend');
    await pg.waitForSelector('.wp-ok', { timeout: 10000 });
    ok(orders === 1, 'ONE press, ONE order posted', String(orders));
    ok(posted && posted.who && posted.who.cb === 'CB999' && posted.who.first_name === 'Ann' && posted.who.surname === 'Smith',
      'the order carries the typed fields', JSON.stringify(posted && posted.who));
    ok(posted && posted.who && posted.who.phone, 'the page sends the phone number the person typed', JSON.stringify(posted && posted.who && posted.who.phone));
    ok(posted && posted.order.items.length === 1 && posted.order.items[0].quantity === 2
      && !('added' in posted.order.items[0]) && !('customisations' in posted.order.items[0]),
      'a line is an id and a quantity, nothing else', JSON.stringify(posted && posted.order.items));
    ok(errs.length === 0, 'the page runs with no errors', errs[0]);
  } finally { await b.close(); srv.close(); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
