# Feature Specification: The Wimpy Order Standard Operating Procedure (SOP)

**Feature Branch**: `038-wimpy-sop` · **Created**: 2026-10-16 · **Status**: DELIVERED (see tasks.md)

**Input**: Nick, 2026-10-16: "For the wimpy app that was built on vercel can you create me a full SOP on its functionality
etc, as if this was a million dollar sop, use the wimpy branding for creating this pdf and put it in my downloads"

## Context

Wimpy Order is the floor's lunch app, its own service on Vercel at https://phoenix-wimpy.vercel.app since 9 Oct 2026
(specs 009, 015, 018, 020–025). Its behaviour is spread over nine Spec Kit features, the service README and the code.
Nothing a team leader, the kitchen or management can hand to a new person describes the whole thing in one place.

## Decision

One controlled document, `SOP-WIMPY-001`, written from the code and the specs (not from memory), branded with the app's
own Wimpy tokens (red `#d0021b`, dark red `#a30015`, yellow `#ffc72c`, cream `#fff7e8`, ink `#231f20`, Nunito), rendered
to an A4 PDF with a cover, document control, a clickable table of contents, running footer with page numbers, and a
one-page quick-reference card. Source of truth: `specs/038-wimpy-sop/wimpy-sop.html` (so the next revision is a diff);
output: `C:\Users\aarav\Downloads\Wimpy Order SOP v1.0.pdf`.

## User Stories

- **US1 (P1) The floor**: an agent reads one page (the quick-reference card) and can sign in, order, read their history
  and change their password without asking anyone.
- **US2 (P1) Team leaders**: onboarding, the start password, password resets and leavers are written procedures.
- **US3 (P1) Kitchen and management**: how an order reaches the kitchen, how the HighLevel board is worked, what the
  daily, weekly and monthly checks are, what every error means and who to escalate to.
- **US4 (P2) Change control**: how a price, the menu or the window is changed, tested and released, and how this SOP is
  revised.

## Requirements

- **FR-001** Every figure, hour, message and rule in the SOP is taken from `wimpy-service/src/*.mjs`, `public/index.html`
  or the specs — nothing invented; prices and the window are quoted from `src/wimpy.mjs`.
- **FR-002** Sections: document control · purpose and scope · system overview · definitions · roles (RACI) · access and
  passwords · ordering window · menu and prices · placing an order · My orders · change password · kitchen procedure ·
  team-leader procedures · management procedures (daily/weekly/monthly) · troubleshooting matrix · escalation · data,
  privacy and security · change control · known limitations · technical reference · version history and sign-off ·
  quick-reference card.
- **FR-003** Rendered through the Chromium already on this machine (the gstack `make-pdf` renderer has a fixed theme and
  cannot carry the brand palette); A4, printBackground, footer "Wimpy Order · SOP-WIMPY-001 · v1.0 · Internal · page n".
- **FR-004** The PDF is checked page by page after rendering (cover, TOC, tables, card) before it is handed over, and the
  `ecc:agent-evaluator` scores it against its rubric (accuracy, completeness, clarity, actionability, conciseness).

## Amendment 2026-10-16 (Nick)

- One page for staff in SOP-001: buying on credit, staff prices, the account terms (settlement cycle, monthly cap, leavers tagged for Operations to confirm — nothing recorded in the app or specs).
- **SOP-WIMPY-002, Process Flow: Order to Payroll** (`wimpy-process-flow.html` → `DownloadsWimpy Order Process Flow - Order to Payroll v1.0.pdf`, 5 pages): the simple end-to-end flow management asked for — order → n8n automation → kitchen board → collection → Google Sheet → payroll (Romano) → verified deduction. The n8n workflow (Webhook → Code → HTTP Request to HighLevel + Append row in sheet) is drawn with the sheet called out as the payroll record; the sheet has no date column, so a date column is recommended; verification = sheet totals per CB must equal the order ledger before loading; test rows (`Test`, `wimpy.livecheck`) are never deducted.

## Out of scope

Changing the app; a brand sheet from Wimpy (the tokens are the app's own placeholders in the Wimpy family); translation.
