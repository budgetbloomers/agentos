# Spec 040 — BR-2: Auditors score evaluations and escalate for remediation (QA tool)

**Status:** DRAFT — awaiting Nick's approval and the Open Questions · **Date:** 2026-10-28 · **App:** QA tool (`budgetbloomers/qa-ops`, Next.js 16 + its own Supabase), linked to Vercel project `qa-ops` via the CLI on 28 Oct.

## The request (Nick, 28 Oct — BR-2)

> Allow Auditors to input evaluation scores & escalate for remediation. Inputs: Date Of Call (calendar) · Week (auto from date) · Date of Assessment (calendar) · QA Agent Name (auto from staff list) · QA Agent Tenure (auto) · Call ID · Call Duration · Score % original · QA Audit Score = accuracy + feedback percentage · Error Priority · Details of error · based on Priority, an FC document to auto-populate. Auditor sends the document with the above details to the QA assessor. QA assessor includes comments on intervention provided. Document logged against the agent and stored for reference. QA TL accesses audits and initiates disciplinary action; template warnings available. QA TL sends the document to the QA assessor to acknowledge.
>
> "score % original to stay the same · qa audit score = accuracy + Feedback percentage"

## What already exists (code-explorer read of the repo, 28 Oct)

- **Audit form** `src/components/forms/AuditForm.tsx` → `audits` table (`data` jsonb). Already captures 10 of the 12 inputs: date of call, week (auto, `getWeekFromDate`: Monday-start weeks within the month, from the CALL date), date of assessment, QA agent (dropdown), call ID, call duration (free text), original score %, audit score %, capture accuracy, feedback accuracy, error priority (passed / 1 / 2 / 3), error details. **Missing:** QA agent tenure, the FC document.
- **The audit score today** is the AVERAGE of audit score + capture accuracy + feedback accuracy (pass ≥ 90), duplicated in `AuditForm.tsx` and `AuditsTable.tsx`. BR-2 replaces it with accuracy + feedback.
- **Unused workflow already in the schema:** `audits.assessor_comments`, `audits.warning_issued`, and statuses `submitted → sent_to_assessor → assessor_commented → tl_review → disciplinary_issued → closed` (`07_constraints.sql`). Every status change is already logged in `status_history` with the actor.
- **Gaps:** no QA-agent tenure anywhere (tenure exists only for sales agents); no document/PDF generation of any kind; no audit inbox; no acknowledgement status; and **no per-step permission on the server** — any signed-in, non-scoped user can PATCH any audit's status or warning today.
- **Roles:** `auditor`, `qa_tl` (in the role list but marked "unused" in code), `qa_evaluator` = the QA assessor being audited (a scoped QA login already sees only audits about themselves).

## Capability map (Phase 0 — approve before any module spec is built)

| Module id | Responsibility | Depends on |
|---|---|---|
| `audit-capture` | The auditor's form: the 12 inputs, tenure auto-filled, **Score % original stored exactly as typed**, **QA Audit Score = accuracy + feedback** computed (one shared function), validation on the server | — |
| `qa-staff-tenure` | A start date per QA agent (Add People + backfill for the 9 coded names) so tenure auto-fills | — |
| `fc-document` | The FC document generated from the audit by error priority (template per priority), printable / downloadable PDF, stored against the agent | `audit-capture` |
| `remediation-flow` | Auditor → sends to QA assessor (inbox) → assessor adds intervention comments → QA TL reviews, picks a **warning template** and issues disciplinary action → assessor **acknowledges** → closed. Server-enforced: each step only by its role, on its own records. Agent history view. | `audit-capture`, `fc-document` |

Build order: `qa-staff-tenure` + `audit-capture` (parallel) → `fc-document` → `remediation-flow`.

## Success criteria (testable)

1. An auditor captures an audit with all 12 inputs; week and tenure fill themselves from the call date and the chosen QA agent; nothing else is auto-changed.
2. **Score % original** is stored and shown exactly as entered, never recomputed. **QA Audit Score** = accuracy + feedback (per the rule in Q1), computed in one function used by the form, the table and the document; the old 3-way average is gone everywhere.
3. On submit, the FC document for that priority is produced with every captured detail filled in; it can be printed/downloaded as PDF and is stored against the QA agent.
4. The auditor's "Send to assessor" puts it in that assessor's inbox; only that assessor can add the intervention comments.
5. A QA TL sees every audit, opens one, chooses a warning template (text pre-filled with the audit's details, editable), issues it, and sends it back; only the assessor can acknowledge it; acknowledgement is stamped with who and when.
6. Every step is enforced on the server (a wrong role or someone else's audit → 403), recorded in `status_history`, and visible as a timeline on the audit and on the agent's history.
7. Existing audits keep working (they read as "submitted", their scores display); `npm run check` and `npm run build` green; new logic covered by vitest.

## Boundaries

- **Always:** keep Score % original untouched; one score function; server-side permission per step; migrations numbered (`09_…`), re-runnable, applied before the app deploys; tests for every rule.
- **Ask first:** template wording for FC documents and warnings (HR/legal content); any change to the sales-agent evaluation flow; deploying.
- **Never:** change existing evaluations; let the browser write a status the server has not authorised; put personal data in logs.

## Open questions (need Nick)

1. **QA Audit Score = accuracy + feedback** — is that a SUM of two parts that together make 100 (e.g. accuracy out of 50 + feedback out of 50 → 45 + 40 = 85%), or the AVERAGE of two percentages ((90 + 80) ÷ 2 = 85%)? Today both are captured as 0–100.
2. **What is the "FC document"** (Feedback & Coaching? Formal Counselling?) and what should it say for Priority 1, 2 and 3 (and "passed" — no document?). If you have the current Word/PDF template, send it and I'll reproduce it.
3. **Warning templates** — which ones (e.g. Verbal, Written, Final Written, Disciplinary Enquiry) and their wording? Does the warning level depend on priority and repeat count (like the sales offense ladder)?
4. **QA agent tenure** — store each QA agent's start date and compute tenure (recommended), or a fixed label (Training / M0 / M1 / M2 / Exp) set on Add People? I'll need start dates for the 9 current QA agents.
5. **Who are the QA TLs?** The `qa_tl` role is unused today — which logins should hold it (e.g. Shameem Chetty, QA Team Leader)?
6. **"Send" = in-app inboxes** (recommended — the tool has no email/notifications) — or also email / a HighLevel card like today's audit sync?
