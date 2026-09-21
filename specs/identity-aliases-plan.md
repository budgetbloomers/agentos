# Identity aliases — a renamed agent must never lose their sales (2026-09-21)

## What happened
The Agent List published on 18 Sep re-spelt twelve agents (Surprise Lucky Cwele → Surprize Cwele,
Lindokuhle → Lindokhule Phakathi, Nolulamo Mazaka → Mazeka, Nonhlanhlo → Nonhlanhla Sokhela, …) and
re-issued two people under new CB numbers (Delano Rajagopal CB233 → Delano Rajagopaul CB413,
Nuluthando Ngcobo CB340 → CB342). Salesforce still books their sales under the old spelling.
PULSE joins the Power BI Owner to the roster BY NAME (`resolveKey`: exact name, then every token of
the owner present in exactly one roster name). Every renamed agent's September sales fell to the
Data tab's "Unmatched" table — a badge — and their Daily/MTD rows read 0 sales, 0 GWP. On 21 Sep,
371 September sales / R50,950 GWP on the live state were attributed to nobody; ~206 of them by the
renames alone. Nick saw four zero rows on Dhamendra Budhu's Daily view.

## Why it was quiet
* The list's Sales Force column IS the join key, and the list re-typed it.
* PULSE forgot the old spelling the moment the new list landed — nothing remembered that CB242 had
  carried "Surprise Lucky Cwele" on every list since August.
* A single typo or a dropped middle name defeated the token rule (one direction, exact tokens).
* Unattributed money was a `warn` (V14) and a count badge on the Data tab; MTD/Weekly/Daily said
  nothing at all.

## The fix (three layers)
1. **The record remembers every name a code has carried.** `agent_list_aliases()` (migration-044)
   reads the `agent_list` archive: for every code on the CURRENT list, every earlier spelling of its
   Agent Name / Sales Force. Served on `/api/roster` (and the publish reply) as `aliases[]`, beside
   `leavers[]`. The Worker's publish also names `renamed[]` in the reply and the record.
2. **PULSE resolves like Ops does, and remembers.** `S.aliases` (persisted, merged as a row-keyed
   union): captured by `INGEST.roster` whenever a list renames a code, adopted from the record on
   every poll. `resolveKey` order is now: manual map → bare code → dialler label → exact name →
   spec label table (`diallerLabelCorrections`, whole-label, keeps its old precedence) → **alias** →
   exact-token subset → spec name aliases → **near spelling**
   (either-direction token subset with per-token edit distance ≤ 1 incl. one transposition,
   tokens ≥ 4 letters, UNIQUE-OR-NOTHING — the Ops `_ownerCandidates` doctrine of 14 Aug) →
   embedded code. Near matches are REPORTED: `M.near` → Data tab card "Matched by spelling" with
   an Ignore / Map-to control (the manual map wins on every rebuild; Ignore asks first and names the
   sales it hides), an amber line on every report page, and V24a (warn). ONE typo per name, not one
   per word ("Ayanda Zulu" is not "Amanda Xulu"); a known leaver's name never near-matches unless that
   spelling is itself live again (a re-issued code); `leaverMatch` is unique-or-nothing too. An alias
   needs CONTINUITY — old and new spelling share a word of 4+ letters or fit on one typo (`sameHuman`,
   and migration-045 in SQL) — otherwise the code was reassigned and nothing is aliased.
   A failed archive lookup travels as `extras_degraded[]` and is toasted, never read as "no aliases".
3. **Loud, where the numbers are.** `unattributedBanner()`: in-period SALES whose owner resolves to
   nobody and whom the archive does not know as a leaver → a red banner on Month to date, Weekly,
   Daily and the Upload Station naming the owners and the sales they carry. Known leavers are
   reported in one muted line (off the report by rule, Nick 15 Sep). V24 is a warn-level ledger entry (the August reference data legitimately carries a stranger); the banner is the loud part.

## Guard
`nicks_code/diagnostics/verify-identity-aliases.mjs` replays the incident on the real engine:
rename a list → sales still land; a new starter's typo resolves; a transposed name resolves; a
middle name on either side resolves; two look-alikes stay unmatched; a bare surname stays
unmatched; a stranger's sales raise the banner and V24; Ignore clears both; a manual map beats an
alias and a near match; a live name beats an alias; aliases survive mergeStates and normalizeState.
With `--live`: `agent_list_aliases()` names CB242/CB263/CB275's earlier spellings and the deployed
Worker serves `aliases[]`. Added to the nightly list.

## Not changed (named so nobody hunts for it)
* Ops keeps its own `_ownerCandidates`; it does not read `aliases[]` yet and its `_refLev1` counts a
  transposition as two edits. Same fix, next pass.
* Thokozile Irene Maphumulo (CB14) is on the VT sheet and has 73 Salesforce sales / R15,787 in
  September that the VT rules do not count (VT sales come from dialler dispositions). A list
  question for Nick, not a resolver bug.

## Amendment 2026-09-21 PM — the Agent Name is the identity
Nick: "the only thing must match is the agent name, the sales force name will be the same as the agent
name." The list is now maintained with Sales Force = Agent Name, so **Agent Name** is the name of record
(`publish_agent_list`, migration-046; PULSE `INGEST.roster`; `verify-list-vs-uploads --file`), and the
Sales Force cell is filed as the second spelling — still indexed by both apps, so the one historical
row where they differ (CB156) keeps resolving either way. A sheet where the two columns disagree is
named on upload ("Sales Force differs from Agent Name") as a list-content error. The unattributed /
near-spelling notices show on the Upload Station only; the report pages stay clean.
