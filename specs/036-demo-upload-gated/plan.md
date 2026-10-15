# Implementation Plan: 036 — the demo starts empty and fills from the Upload Station

**Branch**: `036-demo-upload-gated` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)
**Where the code lives**: `C:\Users\aarav\repos\agentos-demo` (GitHub budgetbloomers/agentos-demo). This repo only
holds the Spec Kit documents. Nothing from the demo is copied here.

## Summary

Rebuild the demo from the current upstream (the README's own upgrade path), stop seeding any dataset, generate the
ten upload files from the demo's fictional model in the real export shapes, offer them from a demo card on the
Upload Station, let PULSE's own publish feed Agent Analytics, and verify the whole path with a Chromium run that
uploads the files through the real station.

## Technical Context

- Build: `node build.mjs --repo <agentos>` reads `nicks_code/index.html`, `agent/index.html`,
  `Chatterbox_AgentOS_Analytics.html`, transforms (patches, brand, identity scrub, colours) and writes `public/`.
  Vercel serves `public/` statically (no build step).
- Runtime: `src/runtime/tb-demo.js` (IndexedDB store, `/api/*` router, portal routes), `tb-chat.js` (Ask), skins.
- Upstream drift since the last build (31 Aug → 14 Oct): PULSE patches still match; `agent/index.html` lost the
  Wimpy tab (the "remove the canteen ordering tab" patch no longer finds its text) — more may follow; iterate.
- Parsers (upstream, verified at commit time): `detectType` header rules and `INGEST.{bi,attendance,evals,roster,
  leaders,inactive,viciCalls,board,referrals,opencasesLM,closedcases}` column reads — the file writer targets exactly
  those columns (research below).
- Tooling: Playwright at `nicks_code/diagnostics/node_modules/playwright`; SheetJS at `site/xlsx.full.min.js`
  (works in Node for writing .xlsx).

## Research (R)

- **R1 Seeding**: `seedReady` compares `__tb_seeded` to the build id and walks `manifest.files`; `lazyFact` fetches
  `cb-*` on a miss. Change: on a build-id mismatch, delete every key first; manifest carries only the two config keys;
  `lazyFact` goes (no fact files exist).
- **R2 Frozen digest**: `FROZEN=/^(agent-digest|nba-digest|portal-cm|portal-logins)/` acknowledges writes without
  storing — exists only to protect the baked dataset. Deleted.
- **R3 PULSE empty boot**: the state read answers 404 → `{empty:true}` → fresh state; `agentDigestPayload()` returns
  `emptyMonthPayload()` with no model, and the publisher sends it (period = whole current month, SAST). The portal
  treats an `empty` digest as nothing published.
- **R4 Save path**: PULSE gzips `vas-state` and `vas-summary` bodies; the shim's `decodeBody` already inflates a
  gzip Blob by magic bytes. `/api/kv-meta` and `?meta=1` are answered from `META`.
- **R5 Digest consumers**: `portal()` reads `agent-digest` rows (`code,name,tl,campaign,gwpEx,sales,target,…`),
  `nba-digest` (optional), `portal-cm`, `portal-assist`, `portal-logins`. TL rows filter on `tl`; CM body was
  precomputed with `CM.cmOverviewBody(DIGEST, {scope:'campaign',campaigns:[key],rows,leaders:{}}, assist, ctx)` where
  `ctx={sla:CM_SLA_DEFAULTS, blockages:CM_BLOCKAGES_DEFAULTS, leaders:{}, assign:{}}`. `campaign.mjs` imports only
  `gwpFloorEx` from `rules.mjs` (no other imports) → both are browser-portable as one module.
- **R6 File contracts** (columns the parsers read; dates as ISO text):
  - Power BI Active: `Account Number, Account Name, Owner, Consultant, Charge Amount, Charge Code, Contract Status,
    Contract Number, Contract Create Date (YYYY-MM-DD HH:MM:SS), Contract Deactivate Date (blank), Case Number,
    Product Bundle, Sales Vertical`; detected by charge amount + create date + account number, Active when the
    deactivate date is blank on ≥ half the rows. Charges ex-VAT.
  - Cancellations (BI Inactive): same columns, `Contract Deactivate Date` filled on every row.
  - Attendance: `Date, Employee Code, Employee Name, Title, Employee Type ("Call Agent"), Department, Reports To,
    Status Code, Status`; codes from `attWeights`/`excusedStatuses` (P, HDCA, AL, SL, CA, UCA).
  - QA: `Record ID, Submitted At, Date of Assessment, Date of Call, QA Agent, Sales Agent, Sales Agent CB, Campaign,
    Call ID, Score %, Assessment Type, Escalation Decision, Priority, Coaching Category, Critical Fail Category,
    Status, Dispute Count, Dispute Status, Team Leader`; a Critical Fail scores 0. Filename carries
    `full-export` so retire-by-span applies as in production.
  - Agent List workbook: sheet `VAS` (`Employee Code, Agent Name, Sales Force, Team Leader, Campaign, Tenure,
    Target, Start Date, Call x, Job Title`), sheet `VT` (same shape; rows become VT), sheet `VAS TL`
    (`Employee Code, Team Leader Name, Sales Manager, Campaign, VICCI Dial`). As-of = date in the filename.
  - ViciDial `EXPORT_CALL_REPORT_<date>.txt`, tab-separated: `call_date (YYYY-MM-DD HH:MM:SS), user, full_name,
    status, status_name, lead_id, length_in_sec, phone_number_dialed, campaign_id, user_group, list_name`;
    detected by `call_date + length_in_sec + user`. Whole floor (CallX retired 1 Sep).
  - Manual Stats workbook: one sheet per working day named `DD.MM`: `Agent Name, Sale 1…Sale 27 (GWP incl VAT),
    Total Sales, Total GWP, Referrals`; agrees with the BI file so the Variance Report reads exact.
  - Lead Management Open Cases (filename contains "Lead Management"): `Case Number, Case Owner, Status, Date/Time
    Opened, Age (Hours), Case Record Type, Account Number`.
  - Lead Management Closed Cases: `Case Number, Case Owner, Status ("Closed - Sale" / "Closed - Not Interested" /
    "Closed - No Feedback" …), Date/Time Opened, Date/Time Closed`.
  - Referrals CSV: `Employee Code, Agent Name, Referral Count, Created`.
- **R7 Vercel**: the project is not in the Aarav team (`vercel inspect` cannot find it); the README's deploy is a
  CLI deploy from `public/`. Nick deploys.
- **R8 Identity**: `buildIdentity` pairs the real `DEFAULTS.roster` of PULSE with fictional names (99 agents, real CB
  codes kept — as the live demo already does). `identity.local.mjs` is absent on this machine; recreated locally from
  the individuals known to appear in the code (never committed).

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I Engine decides | PASS | Every figure the demo shows is computed by the real parsers, model and publish; the CM view by the Worker's own engine. No number is authored. |
| III Agent List is the record | PASS | The roster in the demo comes only from the uploaded Agent List. |
| V Locked down | PASS | Demo backend unchanged in reach; no secrets; no real names (audit). |
| VI Saves acknowledged | PASS | PULSE's own save/receipt path runs against the local store. |
| VII Guards | PASS | `tools/verify-demo.mjs` (Chromium) in the demo repo + build-time file checks. |

## Design

### Build (`build.mjs`)
1. Patches: make the canteen patch tolerant (skip with a log line when the text is gone); fix any other stale patch
   the current upstream exposes.
2. Dataset step: keep `buildModel` (the file writer's source of truth); drop `opsFacts`/`pulseState`/digest/hubs
   emission; emit only `hub-titles` and `help-stages`; manifest `files` = those two.
3. New `src/files.mjs` → `writeSampleFiles(MODEL, roster, period, outDir)` returns the sample manifest
   `[ {file, label, slot, bytes, rows} ]` + writes `demo-uploads.zip` (stored entries, CRC-32).
4. Inject `samples` + `period` into `TB_DEMO_CONFIG`; drop `TB_BRAIN` / `pulse-brain.js`; add `pulse-samples.js`.
5. Emit `public/tb-cm.mjs` = `rules.mjs` + `campaign.mjs` (import line removed) from the upstream checkout.
6. Audit unchanged. `vercel.json`: cache `sample-data` immutable except its manifest.

### Runtime (`tb-demo.js`)
- Wipe-on-new-build; no lazy facts; no FROZEN.
- `portalLogins()` → derived from the digest (TL/CM lists), memoised per digest `updatedAt`.
- CM overview → `import('/tb-cm.mjs')` then `cmOverviewBody(D, auth, emptyAssist, ctx)`.
- Portal 404 copy: "Nothing has been published yet — upload the sample files in VAS Analytics → Upload station."
- Login error copy lists the valid codes when a digest exists.

### Runtime (`pulse-samples.js`, new)
Wraps `PAGES.data`: prepends a card "Demo data — start here" with the ten files (name, slot, size, Download), a
Download-all (zip) button, the suggested order (Agent List first), and the sign-ins to try in Agent Analytics once
the station reports the files loaded. Pure DOM over the existing page; no upstream edit.

### Verification (`tools/verify-demo.mjs`, new, Playwright)
Serves `public/` on a local port; fresh context: sign in, assert empty state (no `vas-state`, "Nothing uploaded
yet"); download links resolve 200; `setInputFiles('#fileInput', all ten)`; wait for ten registry rows; assert MTD
rows > 0 with sales and talk, lead books present, board days present, referrals total > 0; wait for `agent-digest`;
open `/agent/`, sign in as TL1 → team rows; CM1 → `cm` body; agent → own row. Plus an "old build" context that
pre-writes a junk key under a different build id and asserts it is gone.

## Risks
- More stale patches in `agent/index.html` / Ops → fixed one by one; the build fails loudly by design.
- Upload speed: ~40k ViciDial rows and ~2k BI rows parse in a few seconds in-page; acceptable.
- Clock: a demo opened after month end still reads October thanks to the frozen clock.
