# Lead Allocation page + Open Cases upload — Implementation Plan v1

*2026-08-16 · Ops Analytics (`Chatterbox_AgentOS_Analytics.html`). Nick's ask, verbatim:*

> *"Under ops analytics above lead management add lead allocation and this must be the function:
> Lead allocation — match to cb number to get the first table view on the status field pivoted per person.
> And in the upload station add an upload for open cases."*

*Status: **BUILT** 2026-08-16, reviewed and cleared. Guarded by `nicks_code/diagnostics/verify-lead-allocation.mjs` (44 checks).*

> **What the real data changed about this plan.** Building it against the 13 Aug package turned up
> something the plan did not anticipate: of 2,815 open cases, **1,684 (59.8%) are owned by a
> Salesforce *queue*, not a person** — `Cuddle Call` (1,619) and `VIP Welcome Calls` (65). They are
> not a mapping defect; they are the **unallocated pool**, and on this book the pool is the majority
> of it. Reporting them as "owners the roster cannot place" would have sent someone hunting an
> Agent List bug that does not exist. So the page splits the two (§3.5), driven by a new editable
> `leadQueueOwners` rule. With that split the roster has **zero** genuine attribution defects:
> 1,131 allocated + 1,684 queued + 0 unmatched = 2,815, exactly. Only **24 of 95 roster agents hold
> any leads at all** — that is now the first thing the page says.

---

## 1. What the page is

**Lead Allocation** answers one question: *who is holding which leads right now, and at what
stage.* It is the Salesforce **Open Cases** snapshot, joined to the roster on the **CB number**,
with the **Status** field pivoted into columns and one row per person.

That pivot already exists — but buried. `pageLeads()` builds it as `a.sts` and renders it as a
handful of columns inside the 21-column funnel table
([Chatterbox_AgentOS_Analytics.html:3472-3508](../Chatterbox_AgentOS_Analytics.html#L3472-L3508)),
capped at ten status columns and squeezed between Tenure and Total Open. Lead Allocation promotes
it to its own page, uncapped, as the primary table.

**This is a new view over existing facts. It computes no new number and changes no existing one.**

---

## 2. Findings from the codebase that shape the build

### 2.1 The CB join is already solved — do not invent a second one

`Case Owner` in the Open Cases export is a display name, not a code — the 2026-08-02 sample carries
`"Aamira Marion - EC3"`, with no CB anywhere in the row. The join therefore runs through the Agent
List, exactly as every other source does (non-negotiable #7):

```
cbOfOwner(r.case_owner) → normName() → state.sfOwnerMap → CB
```

`sfOwnerMap` is built in `buildIdentity()` ([:1498-1505](../Chatterbox_AgentOS_Analytics.html#L1498-L1505))
from **both** the Agent List's `Sales Force` column and its `Agent Name` column. `cbOfOwner`
([:1518](../Chatterbox_AgentOS_Analytics.html#L1518)) is name-only by design — it deliberately does
**not** fall through to `extractCB()`, because an embedded number can contradict the roster (the
CB-138 collision, `vas_variance_report_rules.json` `dialler_label_rule`). **Lead Allocation uses
`cbOfOwner` unchanged.** Owners that resolve to nothing are surfaced, never guessed.

### 2.2 Status values are already canonicalised — lift the helper, don't copy it

`pageLeads` folds case/whitespace variants into a canonical list
([:3472-3475](../Chatterbox_AgentOS_Analytics.html#L3472-L3475)):

```
1st attempt · 2nd attempt · 3rd attempt · 4th attempt · 5th attempt · New · In Progress · Escalated
```

Anything else keeps its own name; blanks become `(blank)`. Two pages pivoting the same field on two
private copies of that list is a drift bug waiting to happen, so **`CANON` and `canonSt` get lifted
to module scope** (§3.1) and both pages call the one helper.

### 2.3 Open Cases is a snapshot — that is correct for allocation

`SF_OPEN_CASES` is `snapshot:true` ([:537](../Chatterbox_AgentOS_Analytics.html#L537)), so
`rowsForRaw` serves only the newest batch's rows ([:1736-1739](../Chatterbox_AgentOS_Analytics.html#L1736-L1739))
and a re-upload replaces rather than stacks. Allocation is a point-in-time position, so snapshot
semantics are exactly right — no change needed.

The date range still bites through `openInWin()` ([:1803-1806](../Chatterbox_AgentOS_Analytics.html#L1803-L1806)),
which is a no-op unless the `leadWindow` rule is set to `opened`. Lead Allocation honours it
identically to Lead Management, so the two pages can never disagree on which cases are in scope.

### 2.4 ⚠ A second Open-Cases source would break bulk upload

This is the load-bearing finding for the upload half of the ask.

`detectSource()` scores each contract by header overlap and **returns `null` when two sources tie**
([:1386-1389](../Chatterbox_AgentOS_Analytics.html#L1386-L1389)). A new source declaring the same
13 headers as `SF_OPEN_CASES` would tie at a perfect score on every open-cases file, so
`detectSource` would return `null` and **bulk upload would stop recognising open cases altogether** —
including the file that feeds Lead Management, the Sales page, the Scorecard and `acCtx`. The daily
intake would silently start dropping a source.

The codebase has met this before: the Power BI Active/Inactive pair is header-identical and is
separated by a hand-written data tiebreak, with a comment explaining that picking on score once
routed an Inactive file into the money source and wiped a month of charges
([:1372-1385](../Chatterbox_AgentOS_Analytics.html#L1372-L1385)).

**So: an Open Cases upload already exists in the Upload Station, and duplicating it is a
regression, not a feature.** `SF_OPEN_CASES` is rendered as a slot by `pageUploads()` (it is in
`SRC_KEYS`, [:583](../Chatterbox_AgentOS_Analytics.html#L583)), it is in `BULK_ORDER`
([:1394](../Chatterbox_AgentOS_Analytics.html#L1394)), and it is confirmed present in the deployed
`site/index.html`. §4 therefore makes the existing upload serve Lead Allocation properly rather
than cloning it — with §4.3 as the contingency if the allocation export turns out to be a
different Salesforce report.

---

## 3. Build — the page

### 3.1 Lift the status helper to module scope

Above `pageLeads`, add:

```js
/* The Open Cases Status field, canonical order. Lead Allocation and Lead Management pivot the
   SAME field, so the list and the folding rule live here once — two private copies drift. */
const LEAD_STATUS_CANON=['1st attempt','2nd attempt','3rd attempt','4th attempt','5th attempt','New','In Progress','Escalated'];
function canonLeadStatus(s){const n=String(s==null?'':s).replace(/\s+/g,' ').trim();
  return LEAD_STATUS_CANON.find(c=>c.toLowerCase()===n.toLowerCase())||(n||'(blank)')}
```

Then delete the local `CANON`/`canonSt` from `pageLeads` and point it at the new pair. Behaviour
is byte-identical — this is a pure extraction, and the Lead Management funnel must render exactly
the same numbers before and after.

### 3.2 Register the page

In `PAGES` ([:2061-2077](../Chatterbox_AgentOS_Analytics.html#L2061-L2077)), insert **between
`sales` and `leads`** — that is "above lead management" in the nav, and because the new entry
carries no `sect` it stays under the existing **Sales Ops** heading:

```js
{id:'leadalloc',label:'Lead Allocation',icon:'inbox',title:'Lead Allocation',
 sub:'Who is holding which leads right now — the Open Cases status field pivoted per person, matched on the CB number'},
```

In `render()` ([:4338-4352](../Chatterbox_AgentOS_Analytics.html#L4338-L4352)), add
`else if(p.id==='leadalloc')html=pageLeadAlloc(win);` immediately before the `leads` branch.

No `TL_BLOCK` change — team leaders should see allocation for their own team, and `rowsFor`
already scopes them via `userScopeTeam()`.

### 3.3 `pageLeadAlloc(win)` — the pivot

Modelled on `pageLeads` lines 3459-3492 so the two agree by construction.

**Row set.** Seed from `state.facts.AGENT_LIST`, applying `cbInScope` and the four global filters
(tenure / team / campaign / agent) exactly as `pageLeads` does at
[:3465-3471](../Chatterbox_AgentOS_Analytics.html#L3465-L3471). **Roster agents holding zero cases
stay in the table with a zero row** — an agent allocated nothing is the single most actionable
thing this page can show, and dropping them would hide it.

**Fact pass.**

```js
rowsFor('SF_OPEN_CASES',win).forEach(r=>{
  const cb=cbOfOwner(r.case_owner);
  if(!cb){unmatched[String(r.case_owner||'(blank)')]=(…||0)+1; return}   // surfaced, never dropped
  if(!A[cb])return;                                                      // filtered out of scope
  if(!openInWin(r,win))return;
  const a=A[cb], k=String(r.case_number||'').trim();
  if(k){if(a.seen.has(k))return; a.seen.add(k)}                          // one row per case
  a.sts[canonLeadStatus(r.status)]=(…||0)+1; a.n++;
  if(r.age_hours!=null){a.ageSum+=r.age_hours; a.ageN++}
});
```

**Columns.** `LEAD_STATUS_CANON` first, then any other status present, sorted.
**No `.slice(0,10)` cap** — Lead Management truncates at ten because the pivot is a guest in a
21-column table; here the pivot *is* the table, so every status gets a column.

**Table shape** (`class="tbl"`, `style="font-size:11.5px"`, `overflow-x:auto` wrapper — the funnel
table's own styling):

| Team Leader | Data Set | Tenure | Agent Name | *…one column per status…* | Total Allocated | Share of book | Avg age (h) | Oldest (h) | 3rd+ attempt |
|---|---|---|---|---|---|---|---|---|---|

- Agent cell wrapped in `aName(cb, maskName(a.name))` for the drill-through.
- Empty cells render `·`, matching [:3508](../Chatterbox_AgentOS_Analytics.html#L3508).
- **`ALL AGENTS` total row** in the same bold/`#F4F8FE` style as `cell(G,true)`, column-summing
  every status. Its `Total Allocated` must equal the sum of the status columns — that is the
  page's own internal reconciliation and should be visible.
- Sort: default `Total Allocated` desc, then TL, then name. Wire the headers through the existing
  `sortBy('leadalloc',key,'total')` / `state.sort` pattern ([:2528](../Chatterbox_AgentOS_Analytics.html#L2528)).
- `Avg age` / `Oldest` come from `r.age_hours`, already parsed by the transform
  ([:995](../Chatterbox_AgentOS_Analytics.html#L995)). Format `hoursnum` via `fmtVal`.
- `3rd+ attempt` = sum of the `3rd`/`4th`/`5th attempt` columns — the ageing-lead flag. RAG it off
  a **new editable rule**, not a literal (dashboard convention): `leadAllocStale`, default 25 (%).

**Header strip** above the table: total allocated · agents holding leads · agents holding zero ·
avg per holder · snapshot batch date from `freshness('SF_OPEN_CASES')`. An `info` tooltip states
the join rule and the dedupe rule in plain English, in the style of the funnel card's tooltip
([:3598](../Chatterbox_AgentOS_Analytics.html#L3598)).

**Unmatched card.** Where `pageLeads` prints a one-line `stale-banner` count
([:3611](../Chatterbox_AgentOS_Analytics.html#L3611)), Lead Allocation prints a **table**: raw
`Case Owner` string × case count, descending. This is the page where an unmapped Salesforce name
actually costs someone their leads, so it names names and links to Dictionary → identity for the
fix.

**Empty state.** If `(state.facts.SF_OPEN_CASES||[]).length` is 0:
`emptyState('Lead Allocation reads the Salesforce Open Cases snapshot and matches Case Owner to the CB number through the Agent List')`,
plus the inline drop zone from §4.2 so the file can be loaded without leaving the page.

**CSV export.** Mirror the `window.__leadsCsv` pattern
([:3582-3594](../Chatterbox_AgentOS_Analytics.html#L3582-L3594)): build `window.__allocCsv` inside
the render closure from the *same* rows the table draws — filters, dedupe, masking and the totals
row included — and add `exportAlloc()` beside `exportLeads()` at
[:4311](../Chatterbox_AgentOS_Analytics.html#L4311).

### 3.5 Queue owners vs mapping defects (added during the build)

An owner that resolves to no CB is two completely different things, and merging them makes the
page lie. The split is a rule, not a heuristic — a name-sniffing regex would misfile the day
Salesforce adds a queue called "Renewals Team" or an agent called "Call Centre":

```js
leadQueueOwners: ['Cuddle Call','VIP Welcome Calls']   // DEFAULT_RULES, editable in Dictionary → Rules
```

- **On the list** → *Unallocated — sitting in a queue.* Its own card: queue, leads waiting, share
  of book, and the reconciliation line `allocated + waiting = book total`. Amber chip in the
  header strip, because a pool this size is an operational fact, not a fault.
- **Not on the list and still unmatched** → *Owners the roster cannot place.* Red chip, named
  rows, and the fix stated (add the Salesforce name to that agent's Sales Force column — or add
  the queue to the rule).

The invariant the diagnostic enforces: **allocated + queued + unmatched == every unique case in
the snapshot.** Nothing spread, nothing invented, nothing dropped.

### 3.4 Explicitly out of scope

No new KPI in `DEFAULT_KPIS`, no NBA input, no composite change, no money. `open_backlog` and
`avg_case_age` already cover open cases in the KPI dictionary. Lead Allocation is a view.

---

## 4. Build — the Open Cases upload

### 4.1 Upload Station: make the existing slot own Lead Allocation

`SOURCES.SF_OPEN_CASES` ([:535-538](../Chatterbox_AgentOS_Analytics.html#L535-L538)) —
rewrite `purpose` so the slot states what it now feeds:

> *"THE LEAD BOOK — every lead currently allocated to an agent. Feeds **Lead Allocation** (Status
> pivoted per person), the Lead Management funnel and case ageing. Case Owner is a display name,
> so agents are matched to the CB number through the Agent List's Sales Force / Agent Name
> columns; an owner matching nobody is listed on Lead Allocation, never dropped. Snapshot — a
> re-upload replaces the previous position."*

In `pageUploads()` ([:4115-4129](../Chatterbox_AgentOS_Analytics.html#L4115-L4129)), give this one
slot an extra chip line, computed only when rows are loaded: **`N leads · M agents holding ·
K owners unmatched`**, with the unmatched chip amber when non-zero and clicking through to
`go('leadalloc')`. That turns the slot from "a file arrived" into "the file joins" — the thing
that actually breaks on a Monday.

### 4.2 An Open Cases upload on the Lead Allocation page itself

The page carries its own drop zone and file picker, wired straight to the existing plumbing —
no new source, no new parse path:

```html
ondrop="dropFile(event,'SF_OPEN_CASES')"
<input type="file" onchange="handleFile('SF_OPEN_CASES',this.files[0])">
```

Rendered in the empty state, and as a small `⟳ Update allocation` control in the card header when
data is present. It routes through `handleFile` → `readUpload` → `validateHeaders` → the confirm
modal → `applyLoad`, so batch audit, exception capture and supersede behave exactly as they do in
the Upload Station.

### 4.3 Contingency — if the allocation export is a *different* Salesforce report

Only if Nick's lead-allocation file is not the `SF Open Cases - Current.xls` shape already
uploaded. Do **not** register it by cloning the headers (§2.4). Required, in order:

1. `SOURCES.SF_LEAD_ALLOC` with a `required` set containing **at least one header
   `SF_OPEN_CASES` does not have** — that is what keeps `detectSource` unambiguous.
2. If the requireds still overlap fully, add a data-based tiebreak in `detectSource` modelled on
   the BI Active/Inactive clause at [:1380-1385](../Chatterbox_AgentOS_Analytics.html#L1380-L1385),
   with a comment saying why.
3. `TRANSFORM.SF_LEAD_ALLOC` — canonical mapping, `_d` set, rejects to exceptions with a reason.
4. `BULK_ORDER` — insert after `SF_OPEN_CASES`.
5. `rowsForRaw`'s `resolveCB` switch ([:1742-1751](../Chatterbox_AgentOS_Analytics.html#L1742-L1751)) —
   a `case 'SF_LEAD_ALLOC'` arm.
6. `GFMAP` only if the export carries its own team/campaign columns; otherwise the row resolves
   through `cbRow` for free.
7. `pageLeadAlloc` reads `SF_LEAD_ALLOC` and **falls back to `SF_OPEN_CASES`** when the dedicated
   slot is empty, so the page works from day one.

**Recommendation: ship §4.1 + §4.2 first.** They satisfy the ask with the file Nick already
uploads daily, and §4.3 stays available if the export turns out to differ.

---

## 5. Verification

| Check | Expectation |
|---|---|
| Extraction is inert | Lead Management funnel renders identical numbers before/after the §3.1 lift — status columns, order, `(blank)` handling, ALL AGENTS row |
| Pivot reconciles | Lead Allocation `Total Allocated` per agent == that agent's `Total Open` on Lead Management, for the same window and filters |
| Grand total | ALL AGENTS total == Σ status columns == Total Open on the funnel's ALL AGENTS row |
| Dedupe | A case number appearing twice in the export counts once (matches `seenO`) |
| Unmatched | Unmatched owner counts + allocated total == loaded snapshot row count. Nothing invented, nothing silently dropped |
| Filters | Team / campaign / tenure / agent filters and the date range move both pages the same way |
| Zero rows | A roster agent with no open cases appears with a zero row, not absent |
| Masking | Agent and TL names go through `maskName()`; PII toggle flips both pages together |
| TL scope | Signed in as a `tl` role, only that team's agents appear and the page is reachable |
| Empty state | With Open Cases cleared, the page shows the empty state and its inline uploader — never a stack trace |
| Upload round-trip | Upload from the page → confirm modal → batch audit row → chips update → pivot repopulates |
| CSV | Exported rows match the rendered rows exactly, including the totals row |
| Bulk intake | `SF Open Cases 5 - 13.xls` still auto-detects as `SF_OPEN_CASES` in a bulk drop (guards §2.4) |

Run `node tools/upload-station-validate.mjs uploads/2026-08-13` afterwards and confirm no new
warnings, then `node tools/prepare-site.js` before any deploy — `site/index.html` is generated,
never hand-edited.

---

## 6. Touch list

| File | Change |
|---|---|
| `Chatterbox_AgentOS_Analytics.html` | `LEAD_STATUS_CANON` + `canonLeadStatus()` + `leadStatusCols()` (module scope); `pageLeads` uses them; `PAGES` entry; `render()` branch; `pageLeadAlloc()`; `allocEmpty()`; `allocHealthChips()`; `exportAlloc()`; `leadQueueOwners` + `leadAllocStale` rules in `DEFAULT_RULES`; `SF_OPEN_CASES.purpose` rewrite; join-health chips in `pageUploads()` |
| `nicks_code/diagnostics/verify-lead-allocation.mjs` | New — 32 checks, the reconciliation guard |
| `site/index.html` | Regenerated by `tools/prepare-site.js` — never edited directly |
| `specs/lead-allocation-plan.md` | This file |

One extraction, no change to any existing calculation — `verify-ops-intake` and `verify-render`
both still pass unchanged.

## 6a. Review findings and what changed because of them

`dashboard-reviewer` returned **DO-NOT-SHIP** on the first cut. Both blockers are fixed and both
now have a test that fails if they come back.

1. **Raw status text in an `onclick` attribute** (found independently during the build and by the
   review). The column *label* was escaped; the *sort key* was not, and for status columns the key
   was the raw Salesforce Status string. A stage containing `"` closes the attribute outright.
   Status columns now sort on **column index** (`st0`, `st1`…), which cannot carry a quote — and
   that also removed a latent collision where a stage literally named `age`, `old`, `late`, `tl`
   or `name` would have hijacked a built-in sort key. Guarded by the hostile-input checks.
2. **The inline uploader was a way around the Upload Station lock.** `TL_BLOCK` hides `uploads`
   from a scoped team leader, but `leadalloc` is not in it and `handleFile()` has no role check —
   so the new "⟳ Update allocation" control handed a TL the ability to replace `SF_OPEN_CASES`,
   which is `snapshot:true` and therefore **the whole company's lead book**, audited under their
   name. Both uploaders (card header and empty state) are now behind `canUploadHere()`, defined as
   `!pageBlockedForUser('uploads')` so it can never drift from the gate it mirrors. The TL empty
   state says who to ask instead. Guarded by five permission checks.

Also fixed from the review:

- **A pre-existing XSS in `pageLeads`** — its status headers went into innerHTML with no `esc()`
  at all. Not introduced here, but the two pages now share a status helper, so it was fixed in the
  same pass: `stCols.map(c=>head(esc(c)))`.
- **No-Agent-List was a dead end.** It read "No roster agents match the current filters" (no
  filters were at fault) and rendered nothing else — burying the queue/unmatched cards in exactly
  the situation they exist for. It now names the missing roster **and still renders the side
  cards**, and clears `window.__allocCsv` so no early return leaves the previous page's export
  behind.
- **`LATE` is derived, not hardcoded** — read off the columns present via `/^(\d+)\w{0,2} attempt$/`,
  so a future "6th attempt" stage counts as ageing instead of appearing as a column and silently
  vanishing from the ratio.
- **`leadAllocStale` accepts a deliberate `0`** (`parseFloat` + `Number.isFinite`, not `||25`).
- **`allocHealthChips` honours `openInWin`**, so the Upload Station chip and the page cannot
  disagree if `leadWindow` is ever flipped to `opened`.
- A dead `scoped` counter was deleted — `rowsFor` already applies the same global filters, so the
  branch could never print.

## 6b. What the verification actually proved (2026-08-16)

`node nicks_code/diagnostics/verify-lead-allocation.mjs` — 44 checks, all passing, driving the real
app at `file://` with `Matrix - Agent List.xlsx` + `SF Open Cases 5 - 13.xls` through the real bulk
upload path. Highlights:

- Every agent's **Total Allocated == that agent's Total Open** on Lead Management, keyed on CB.
- ALL AGENTS total == Σ status columns == Σ agent rows == the funnel's own grand total (1,131).
- **allocated + queued + unmatched == unique cases** (1,131 + 1,684 + 0 = 2,815).
- Open Cases still auto-detects as `SF_OPEN_CASES` in a bulk drop — the §2.4 hazard, guarded.
- Empty state, its inline uploader, masking, and zero-holder rows all behave.
- **Hostile upload data cannot inject.** Status values and Case Owners are upload data that reach
  table headers, `title=`, `onclick=` and the CSV. Rows are force-fed `Bad" onmouseover="…` and
  `<img src=x onerror=…>`, then the DOM is checked for surviving handlers. Caught a real hole
  during the build: the status sort key was written into the `onclick` attribute **unescaped**, so
  a Salesforce stage containing a quote would have broken out of it. Status columns now sort by
  **column index**, which cannot carry a quote at all.
- **A scoped team leader gets no uploader** on either the populated page or the empty state.
- **No Agent List** still renders the queue/unmatched cards and leaves no stale CSV behind.
- `verify-ops-intake.mjs` (33) and `verify-render.mjs` (37) still fully green — no regression.

*Harness note:* the first run "failed" the per-agent reconciliation because the test keyed rows on
the **displayed** name, and masking collapses `Threza Chetty` and `Theo Chetty` onto the same
`T. Ch•••` label. The app was right; the test was wrong. It now keys on the CB code from the
row's `agentOpen(...)` handler — worth remembering for any future table diagnostic.

## 7. Open question for Nick

**Is the lead-allocation file the same Salesforce Open Cases export already uploaded daily
(`SF Open Cases - Current.xls`), or a separate report?** The plan assumes *same* — §4.1/§4.2 —
because that file already carries the Status field the pivot needs (`1st attempt` … `Escalated`)
and adding a header-identical twin would break bulk detection for both (§2.4). If it is a
separate report, §4.3 is the route and the file's headers are all that is needed to start.
