# Ops (AgentOS Analytics) — full audit, Monday 14 September 2026

Scope: every Ops dashboard page on the deployed build, the data behind them (all ten fact
stores vs PULSE, day by day), the Upload Station and the relay from the VAS station, the
health sentinel, the NBA digest. Everything below was checked against live data; nothing
was taken from the code alone.

## Verdict

- **Dashboards:** all 13 pages render on the deployed build with no page errors and no
  placeholder values, on both the "all data" and the month-to-date windows.
- **Data:** sales, GWP, attendance, QA and cancellations agree with PULSE day for day.
  September GWP ex VAT is **R319,467 in both apps, to the rand**.
- **Two real faults found and fixed today** (both live now):
  1. **Ops silently lost whole days of ViciDial calls** — a race between concurrent Ops
     sessions writing the same store (details below). 27, 28, 29 Aug and 3 Sep are restored;
     the race cannot recur.
  2. **The Executive page reported "Total Calls 0 ↓100%" for all of September** — its tiles
     read the retired CallX source. It now reads ViciDial after the cutover.
- **Upload Station / relay:** working end to end. All 128 archived files are decided by Ops;
  the browser-level upload probe passed 10/10 against production.
- **Three items need a decision from Nick** (bottom).

## 1 · The lost-update race (CRITICAL — fixed)

Every Ops session — a browser tab, and the headless relay that GitHub Actions boots every
15 minutes — merges a file into the copy of a fact store it loaded at boot and writes the
**whole store** back. There was no version check on `/api/kv`, so the last writer won and
silently dropped whatever the other session had loaded since.

Proof from the batch audit vs the store (rows carry their batch id):

| file | audit says | store held |
|---|---|---|
| `EXPORT_CALL_REPORT_20260903-192627.txt` (3 Sep) | B0160, 19,121 rows loaded 7 Sep 08:37 | **0 rows** |
| `EXPORT_CALL_REPORT_20260831-072402.txt` (28–31 Aug) | B0122, 19,982 rows | 0 rows (28 Aug read 1,188) |
| `EXPORT_CALL_REPORT/LEAD_REPORT_20260827-*.txt` (27 Aug) | B0105+B0106, 20,969 rows | **0 rows** |

Against PULSE per day: Ops had nothing for 27 Aug, 29 Aug, 3 Sep and a twentieth of 28 Aug.
Sales Production's dialler KPIs, the TL view and the NBA digest were all understated for those
days. (The lost files were the ones a second session happened to save over — nothing about
those days themselves.)

**Fix (Worker `4617acf9`→`0503aff4`, Pages `mu0sioa2`+):**
- `/api/kv` POST honours `X-Cbx-Base` — the pointer row is *claimed* with one filtered
  PATCH on the base version (atomic), the blob is uploaded, the claim becomes the new version.
  A stale base gets `409 version_conflict`; a read during a claim gets `425` and waits;
  claims expire after 120 s. Proved on production: two simultaneous writers on one base →
  exactly one wins (`verify-kv-cas-live.mjs`, 10/10).
- Ops: each session remembers the batches it applied; on a conflict it reloads the other
  session's copy and **replays its own batches on top** (re-minting a batch id both sessions
  minted for different files). Config and audit merge as unions. `verify-ops-cas.mjs` 33/33.
- The relay now re-applies a ViciDial file whose audit record survives but whose rows are
  gone — the lost-update signature heals itself.

**Repair:** the four files were re-queued and relayed through the new build — ViciDial went
from 238,804 to 298,855 rows: 27 Aug 20,969 · 28 Aug 20,947 · 29 Aug 196 · 3 Sep 19,121,
matching PULSE's call counts for those days.

**Still missing, not repairable from here:** ViciDial **18–25 Aug** (≈ 150k calls). Those
files were uploaded to VAS before the upload relay existed (26 Aug) and were never archived;
PULSE has the aggregates but not the raw files. If the exports are still on Nick's Drive,
dropping them into either Upload Station fills the gap.

## 2 · Executive Command Centre after the CallX cutover (HIGH — fixed)

On any window starting 1 Sep or later the page led with **Total Calls 0 ↓100%**, **Answer
Rate —** (the ring at the top too), "0 calls at — answered → 2,887 sales" in the nutshell,
and two amber banners naming CallX as stale / "no rows in the selected period". All of it
read `CALLX_CALL_RECORDS`, retired on 1 Sep, while the ViciDial figures sat on the Sales page.

Now: a CallX tile is swapped for its ViciDial twin (Vici Dials 179,440 · Vici Answer Rate
21.8% · Vici Talk Time) when the window starts after the cutover, CallX-only tiles are hidden
with a one-line note, a window spanning the cutover keeps both (August's history still counts),
the rings / nutshell / value-leak checks read through the same mapping, and the banners no
longer name a retired source — the one banner left names the one source that *is* stale.

## 3 · What agrees with PULSE (checked day by day, 26 Aug → 13 Sep)

| measure | result |
|---|---|
| GWP ex VAT, September | **R319,467 in both** |
| Sales per day | Ops distinct accounts ≈ PULSE net cases (e.g. 11 Sep: 400 vs 405) — see item A |
| Attendance rows per day | identical (e.g. 11 Sep: 180 / 180) |
| QA evaluations per day | identical (e.g. 4 Sep: 224 / 224) |
| Cancellations | Ops SF_INACTIVE has every weekday; PULSE keys them by deactivation day |
| Roster | 126 agents in both, **0** TL / campaign / tenure differences |
| Manifest | 128 files archived, **128** decided by Ops; 4 re-queued today |
| Health sentinel | last run 06:10, **0 alerts** |
| NBA digest | 126 agents, period 1–13 Sep, 0 penalised (R2A penalties are 0 by rule) |

## 4 · Upload Station and relay

- The VAS→Ops relay works: every file in the archive is decided; the four re-queued today
  loaded under their original batch ids.
- Browser-level probe against production (`test-upload-live --live`): upload-sized save
  allowed and byte-identical round trip, 20,000 rows survive, write on the server ledger,
  ViciDial parse accepted — 10/10.
- CORS (`verify-cors-headers --live`) 13/13 including the new `X-Cbx-Base` header;
  `verify-ops-intake` 33/33 (7 sources load, empty SF shell and duplicate Vici files refused).
- Today's package (Friday 12 Sep's full ViciDial pull, Monday's exports) had not been
  uploaded at audit time (last archive 13 Sep 17:01); the 366-row Saturday pull is what
  12 Sep shows until it lands.

## 5 · Needs Nick

**A. "Sales" means two different things in the two apps.** Ops' headline *Sales (Unique
Accounts)* counts distinct account numbers; VAS counts **cases net of cancellations** (the
18 Aug money-model decision). September MTD: Ops 2,887 · VAS 3,093. Nobody's arithmetic is
wrong — it is a definition. Say which one Ops should show and it is a one-line Dictionary
change (`activations`: `account_number` → `case_number`, minus cancellations).

**B. "Total Open Cases" on the Executive page is a 20-day-old snapshot** (data to 25 Aug,
stamped "as of 8/31"). Lead Management moved to the lake on 10 Sep and nothing feeds Ops.
The lake book is a different universe: PULSE holds 81,766 unique cases from it; Ops' old file
gave 26,086. A lake feed is drafted (an Ops twin of PULSE's sync) but not shipped — say what
the tile should count (all agent-held open cases? the roster's agents only? an age cut?) and
it ships.

**C. ViciDial 18–25 Aug** — see §1; needs the raw exports from your Drive.

Minor: the Session Dashboard's SES_* slots have been empty since 31 Aug (known open item);
the Discipline tile "Agents in Process" has a target of 2, so it always reads thousands of
percent over target — a threshold to set in the Dictionary.

## 6 · Test state

verify-ops-cas 33 · verify-kv-cas-live 10 (production) · verify-ops-formulas 56 ·
verify-ops-intake 33 · verify-upload-relay 13 · verify-roster-propagation 14 (fixture fixed:
a Storage LIST is a read) · verify-referrals-sync 8 · verify-ops-no-bi 10 · verify-pulse-trust 24
(fixture fixed: the 13/08 package judged by its own date) · verify-save-acks 16 ·
verify-cors-headers --live 13 · verify-live-save --live 5 · test-upload-live --live 10.
All green. New read-only tools: `audit-ops-stores.mjs`, `audit-ops-vs-pulse.mjs`,
`audit-ops-pages.mjs` (screenshots in `shots/` and `shots-mtd/`).

Commits: 752afe1 (compare-and-set), + claim filter, + relay self-heal, + Executive CallX→Vici
(tiles), + rings/nutshell/banners. Branch `feature/campaign-manager-theme-wimpy`, not pushed.
