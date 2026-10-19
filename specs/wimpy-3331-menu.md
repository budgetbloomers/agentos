# Wimpy Weekday Value Menu — the 3–3–3–1 Operating Model

> **Changed 2026-10-19 (Nick: "add only the rib burger, crispy stack and the peri peri chicken").** Three burgers join
> the menu — **Rib Burger** (basted rib patty), **Crispy Stack** (crumbed chicken fillet) and **Peri-Peri Chicken
> Burger** (flame-grilled peri-peri fillet). Each centre is a new, single-use ingredient (14th–16th) by Nick's
> instruction — the three recorded exceptions to the overlap rule. Burgers are now 6. **No prices were given: all three
> are unpriced** (the card reads "Price not set yet", the pricer refuses the line) until Nick sets
> `basePrice`/`wasPrice` in `wimpy-service/src/wimpy.mjs`.

> **Changed 2026-10-06 (Nick, Spec Kit 009).** The sign-in now takes the CB number AND the person's own
> password (the Agent Analytics one), checked with the main sign-in's lock — the "no password" below is
> history. Spec: `specs/009-wimpy-password-signin/`; guard: `diagnostics/verify-wimpy-signin.mjs`.

> **Changed 2026-09-10 (Nick).** Ordering left Agent Analytics for its OWN app at `/wimpy/`, signed in
> with a CB number and no password (managers: their username); the session it mints reaches the Wimpy
> routes and nothing else. The order form asks for CB number, name and surname, which travel to the
> kitchen beside the Agent List’s own name. The add-on door is DELETED — a line is an id and a
> quantity (1–10); anything else is refused, never stripped. Orders 08:00–17:00 SAST, Monday to
> Friday (was the 08:00 hour alone). Everyone orders, management included. Plan:
> `specs/wimpy-vas-apps-plan.md`; guard: `diagnostics/verify-wimpy.mjs` (159 checks).

**Status: LIVE in the Agent Analytics Wimpy tab, 31 Aug 2026.**
The operational source is `worker/src/wimpy.mjs` — the menu, the prices, the
ingredient matrix and the day rotation all live there and nowhere else; the
page renders what the Worker serves. `diagnostics/verify-wimpy.mjs` (116
checks) enforces this document's core claims as invariants: every price to the
cent, exactly 3+3+3+1 per weekday, and **no ingredient used by fewer than two
items** — the overlap principle is a failing test, not an aspiration.

**THIS DOCUMENT IS THE OPERATING MODEL; THE TAB IS FOR ORDERING LUNCH.** The
analysis below was briefly rendered inside the tab and Nick removed it the same
day — an agent picking a breakfast has no use for a food-cost table. Sections
B–H live here and are maintained here. Anything in them that must not drift
(the prices, the 3+3+3+1 shape, zero single-use ingredients, the day rotation)
is enforced by the test suite rather than by this file being read.

Prices are the brief's, exactly (≈20% off Wimpy list, rounded clean). Where
the costing found a margin problem it is **flagged below, not fixed by moving
a selling price** (brief §5/§13).

### The struck-through price on the card

Each item shows its selling price with the pre-discount price struck through
and its own saving badge. Two provenances, and the gap between them is real:

| | Items | Saving shown |
|---|---|---|
| **SUPPLIED** — a real Wimpy list price Nick gave in the first Wimpy brief for the same build | the three toasteds, the Dagwood | **33–35%** |
| **DERIVED** — `basePrice ÷ 0.8` rounded up to the next .90, i.e. the brief's own "~20% off, rounded clean" rule run backwards | the other ten | **20.0–20.7%** |

The badge shows each item's **actual** saving rather than a uniform claim, so
the four that were cut harder read as cut harder. A derived figure is never
presented as a verified till price. **If the ten derived list prices can be
replaced with real Wimpy prices, put them in `wasPrice` and the cards update —
the test only requires a derived one to stay inside the 20% band.**

---

## A · The menu (what the customer sees — 10 choices)

| | | |
|---|---|---:|
| **BREAKFAST** | Mzansi Brekkie | **R45.90** |
| | Double Up Breakfast | **R65.90** |
| | Farmhouse Breakfast | **R77.90** |
| **BURGERS** | Cheese Burger | **R54.90** |
| | Bacon & Cheese Burger | **R82.90** |
| | Big Cheese Burger | **R95.90** |
| **TOASTEDS** | Cheese & Tomato | **R49.90** |
| | Chicken Mayo | **R53.90** |
| | Bacon & Egg | **R55.90** |
| **TODAY'S BIG ONE** | *rotates — see G* | **R95.90–R127.90** |

Burgers and toasteds are served **with chips**; breakfasts with toast
(Farmhouse adds chips). In the tab, the Big One renders as the hero card with
the day name, and a five-day strip underneath shows the week's rhythm.
**Weekends** (the brief defines none): the nine core items stay orderable, the
hero slot trails Monday's feature, and the pricer refuses a Big One outright —
nothing was invented to fill Saturday.

---

## B · Ingredient matrix

Machine-readable in `wimpy.mjs` (`ing:` per item); this is the same data.

| Item | Eggs | Bacon | Patty | Cheese | Banger | Bread | Bun | Chips | Tomato | Onion | Lettuce | Relish | Ck-Mayo |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Mzansi Brekkie | 1 | 2 | | | | 2 | | | ● | | | | |
| Double Up | 2 | 2 | | | 1 | 2 | | | ● | | | | |
| Farmhouse | 2 | 2 | | | 2 | 2 | | ● | ● | ● | | | |
| Cheese Burger | | | 1 | 1 | | | ● | ● | ● | ● | ● | ● | |
| Bacon & Cheese | | 2 | 1 | 1 | | | ● | ● | ● | ● | ● | ● | |
| Big Cheese | | | 2 | 2 | | | ● | ● | ● | ● | ● | ● | |
| Cheese & Tomato T. | | | | 1 | | 2 | | ● | ● | | | | |
| Chicken Mayo T. | | | | | | 2 | | ● | | | | | ● |
| Bacon & Egg T. | 1 | 2 | | | | 2 | | ● | | | | | |
| Mega Breakfast (Mon) | 3 | 3 | | | 2 | 2 | | ● | ● | ● | | | |
| Dagwood (Tue) | 1 | 2 | 1 | 1 | | 3 | | ● | ● | ● | ● | ● | |
| Big Bacon & Cheese (Wed) | | 3 | 2 | 2 | | | ● | ● | ● | ● | ● | ● | |
| Big Champion (Thu) | 1 | | 2 | 2 | | | ● | ● | ● | ● | ● | ● | |
| Fully Loaded Dagwood (Fri) | 1 | 2 | 2 | 2 | | 3 | | ● | ● | ● | ● | ● | ● |

## C · Ingredient overlap analysis

Utilisation across the 14 definitions (from the module, test-enforced):

| Ingredient | Items | Spread |
|---|---:|---|
| Chips | 12 | every category |
| Tomato | 12 | every category |
| Bacon | 9 | breakfast + burger + toasted + Big One |
| Bread | 9 | breakfast + toasted + Big One |
| Onion | 9 | breakfast + burger + Big One |
| Eggs | 8 | breakfast + toasted + Big One |
| Cheese | 8 | burger + toasted + Big One |
| Beef patty | 7 | burger + Big One |
| Lettuce | 7 | burger + Big One |
| Wimpy Relish | 7 | burger + Big One |
| Burger bun | 5 | burger + Big One |
| **Banger** | **3** | breakfast + Big One (Monday) |
| **Chicken mayo** | **2** | toasted + Big One (Friday) |

- **Most used:** chips and tomato (12 of 14) — chips are the universal side,
  tomato is on every plate in some form.
- **Least used:** chicken mayo (2). It was *deliberately* written into the
  Fully Loaded Dagwood so it crosses categories — the test fails if it ever
  becomes single-use.
- **Single-use ingredients: NONE.** This is the enforced invariant.
- **Watch items:** banger (3 uses, breakfast-side only) and chicken mayo (2)
  are the two lines with the least cover — see wastage.
- **Consolidation already done:** wings (two bastings + two dips for one
  category), mince and gherkins were removed with the old menu; the add-on
  pool now contains *only* the thirteen core lines, so no new stock item can
  enter through the add-on door.

## D · Kitchen prep matrix

Stations: **flat-top** (eggs, bacon, bangers, patties, onions), **fryer**
(chips), **press** (toasteds), **assembly**. Every protein on the flat-top and
chips in one fryer is what makes the model fast — one cook can run the board.

| Item | Prep | Cook | Assemble | Complexity | Est. time* |
|---|---|---|---|---|---:|
| Cheese & Tomato T. | slice (batch) | press 3 min + chips | plate | **LOW** | 4 min |
| Chicken Mayo T. | mayo mix (batch AM) | press + chips | plate | **LOW** | 4 min |
| Bacon & Egg T. | — | bacon+egg flat-top, press | plate | **LOW** | 5 min |
| Mzansi Brekkie | — | egg+bacon+tomato flat-top, toast | plate | **LOW** | 5 min |
| Cheese Burger | salad (batch AM) | patty 6 min + chips | build | **LOW** | 6 min |
| Double Up | — | +1 banger vs Mzansi | plate | **MEDIUM** | 7 min |
| Bacon & Cheese Burger | salad (batch) | patty+bacon parallel | build | **MEDIUM** | 7 min |
| Big Cheese Burger | salad (batch) | 2 patties | build | **MEDIUM** | 7 min |
| Big Champion (Thu) | salad (batch) | 2 patties + egg | build | **MEDIUM** | 8 min |
| Big Bacon & Cheese (Wed) | salad (batch) | 2 patties + 3 bacon | build | **MEDIUM** | 8 min |
| Farmhouse | — | full flat-top load + chips | plate | **MEDIUM/HIGH** | 9 min |
| Mega Breakfast (Mon) | — | 3 eggs, 3 bacon, 2 bangers | plate | **HIGH** | 10 min |
| Dagwood (Tue) | salad (batch) | patty+egg+bacon, 3 toast | 3-deck build | **HIGH** | 10 min |
| Fully Loaded Dagwood (Fri) | salad + mayo (batch) | 2 patties+egg+bacon | 3-deck build | **HIGH** | 12 min |

\* time on a warm flat-top with chips dropped on order receipt; chips (~5 min)
run in parallel with the protein, so they gate nothing.

**Batch-preppable each morning:** salad line (lettuce/tomato/onion), chicken
mayo mix, cheese slices, relish portions. **9 of 14 items are LOW/MEDIUM**;
every HIGH item is a Big One — complexity is where the price and the theatre
are, one item per day, never in the everyday nine.

## E · Food cost model

**Assumptions — estimates, not supplier invoices** (per portion, ZAR, stated
in `wimpy.mjs ING`): egg 2.20 · bacon rasher 3.80 · 100 g patty 9.50 · cheese
slice 2.80 · banger 5.00 · bread slice 0.90 · bun 2.80 · chips portion 5.00 ·
tomato 1.20 · onion 0.60 · lettuce 0.80 · relish 1.20 · chicken mayo 7.50 ·
plus R1.20/meal overhead (butter, oil, gas, wrap). Replace with real supplier
costs before treating any % below as fact; the model recomputes from the one
table.

| Item | Selling | Cost | Food cost % | Gross profit | Margin |
|---|---:|---:|---:|---:|---:|
| Cheese & Tomato T. | R49.90 | R12.00 | 24.0% | R37.90 | 76.0% |
| Chicken Mayo T. | R53.90 | R15.50 | 28.8% | R38.40 | 71.2% |
| Mzansi Brekkie | R45.90 | R14.00 | 30.5% | R31.90 | 69.5% |
| Bacon & Egg T. | R55.90 | R17.80 | 31.8% | R38.10 | 68.2% |
| Double Up | R65.90 | R21.20 | 32.2% | R44.70 | 67.8% |
| Big Champion (Thu) | R115.90 | R39.60 | 34.2% | R76.30 | 65.8% |
| Dagwood (Tue) | R97.90 | R34.80 | 35.5% | R63.10 | 64.5% |
| Big Cheese Burger | R95.90 | R37.40 | 39.0% | R58.50 | 61.0% |
| Bacon & Cheese Burger | R82.90 | R32.70 | 39.4% | R50.20 | 60.6% |
| Mega Breakfast (Mon) | R95.90 | R37.80 | 39.4% | R58.10 | 60.6% |
| Farmhouse | R77.90 | R31.80 | 40.8% | R46.10 | 59.2% |
| Fully Loaded Dagwood (Fri) | R127.90 | R54.60 | 42.7% | R73.30 | 57.3% |
| **Cheese Burger** | **R54.90** | **R25.10** | **45.7%** | **R29.80** | **54.3%** |
| **Big Bacon & Cheese (Wed)** | **R103.90** | **R48.80** | **47.0%** | **R55.10** | **53.0%** |

Mean food cost across the fourteen: **36.5%**.

**Margin flags (per §13 — flagged, prices untouched):**

- **Strong (≤35%):** all three toasteds, Mzansi, Double Up, Big Champion,
  Dagwood. The toasteds are the engine room — R38 GP at 4-minute execution.
- **Acceptable (35–43%):** the mid burgers, Mega, Farmhouse, Fully Loaded.
- **Weak — Cheese Burger, 45.7%.** Driver: a R9.50 patty plus R5.00 chips
  against the entry price. Levers, in order: hold the patty at a strict 100 g
  spec; a 100 g chips portion (−R1) takes it to ~43.9%; substitution is not
  recommended (the patty *is* the product). Strategically it stays: it is the
  door price that makes the board read as value, and its buyers trade up.
- **Weak — Big Bacon & Cheese, 47.0%.** Driver: double patty **plus** three
  rashers (R30.40 of protein in one build). Two rashers instead of three takes
  it to 43.3%. It is Wednesday's hero and the mid-week traffic reason, so the
  weak margin buys something real — but it is the first item to re-cost when
  supplier prices are known.

## F · Wastage model

| Ingredient | Risk | Why |
|---|---|---|
| Chips, tomato, bread, bacon, eggs, cheese, onion | **LOW** | 8–12 items each, every daypart; stock turns daily |
| Patty, bun, lettuce, relish | **LOW** | 5–7 items; patties/buns freeze or hold well |
| **Banger** | **MEDIUM** | 3 items, breakfast-side only; a slow breakfast day strands the line. Mitigation already built in: Monday's Mega Breakfast burns banger stock into the week. Order small, twice weekly. |
| **Chicken mayo** | **MEDIUM** | 2 items and it is a *prepared* mix with a short fridge life. Mitigation built in: Friday's Fully Loaded Dagwood clears the week's mix; batch small, mix daily. |

The rule going forward: **a new item must reuse the thirteen or displace one**
— the verify-wimpy overlap check makes adding a single-use ingredient a
failing build.

## G · Daily Big One strategy

| Day | Feature | Price | The pitch |
|---|---|---:|---|
| Monday | **Mega Breakfast** | R95.90 | Start-the-week plate; burns the weekend's breakfast stock into service |
| Tuesday | **Dagwood** | R97.90 | The classic triple-decker; first patty day |
| Wednesday | **Big Bacon & Cheese** | R103.90 | Mid-week peak; the indulgence bump |
| Thursday | **Big Champion** | R115.90 | The heavyweight; best GP on the board (R76.30) |
| Friday | **Fully Loaded Dagwood** | R127.90 | The week's finale; everything on the board in one stack |

How it is executed in the tab (all live): the hero card carries the day name
and the strongest visual weight on the page; the five-day strip beneath it
prints the whole week's rhythm — *"there's a reason to come back tomorrow"* —
without making any off-day item orderable; the Worker refuses an off-day Big
One **by name** ("Mega Breakfast is Monday's Big One — today's is the Big
Champion"), so even a tab left open overnight tells the truth. Prices climb
Monday→Friday with the week's appetite, and Thursday's Champion carries the
best gross profit on the whole menu — the promotion peak and the margin peak
are the same day.

Copy rules (§19, and test-enforced on the page header): *Weekday Value ·
Today's Big One · Made Fresh · Weekday Favourite* — never cheap/bargain/
budget/discount.

## H · Stock complexity & operational assessment

**vs the previous tab menu** (8 items: 2 bastings + 2 dips for wings alone,
mince, gherkins, an unpriced platter): sauces 5→1 (relish; mayo lives inside
the chicken-mayo mix), proteins 6→5 with every one on the flat-top, zero
unpriced items, zero single-use lines. **vs a full Wimpy-style menu** (~60+
items, ~45+ ingredients, 8+ sauces, ribs/grills/shakes/desserts stations):
this runs on **13 ingredients + 1 sauce + 2 breads + 3 stations**.

| Dimension | Verdict |
|---|---|
| 1 · Menu simplicity | 10 visible choices, 3 decisions — strongest possible |
| 2 · Ingredient overlap | 13 lines, zero single-use, **test-enforced** |
| 3 · Kitchen speed | 9 of 14 LOW/MEDIUM; toasteds at ~4 min; HIGH confined to one hero/day |
| 4 · Food cost | 36.5% blended on stated assumptions — healthy for value QSR |
| 5 · Gross profit | R29.80–R76.30/plate; Thursday peaks GP and promotion together |
| 6 · Wastage | Two MEDIUM lines, each with a built-in weekly burn-down day |
| 7 · Stock complexity | 13 core lines vs ~45+ full-menu; one sauce |
| 8 · Value perception | Clean price points, premium copy, hero-of-the-day framing |
| 9 · Big One potential | The weekly rhythm is the marketing engine; day-locking makes it real |
| 10 · **Overall viability** | **Sound.** Two margin flags (Cheese Burger, Big B&C) are known, priced-in strategy, and first in line for re-costing against real supplier numbers |

**The chain the brief asked for, delivered:** fewer ingredients (13) → fewer
prep steps (4 batch preps) → faster kitchen (LOW/MED core) → less wastage (no
single-use lines) → easier stock (one sauce, two breads) → stronger margins
(36.5% blended) → simple decisions (3+3+3+1) → strong weekday value.
