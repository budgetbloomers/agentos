---
name: upload-check
description: Validate a raw export (CSV/XLS/XLSX) against the dashboard's source contracts before it is uploaded — headers, required fields, date parseability, row counts, known quirks. Use when a file fails to load, before a Monday upload run, or when an export "changed shape".
---

# Upload Check

Pre-flight a data file against the dashboard's `SOURCES` contracts so bad files are caught with a precise reason instead of dying in the upload modal.

## Steps

1. **Identify the source type** from the filename/headers, or ask. Contracts live in the dashboard file — Grep `Chatterbox_AgentOS_Analytics.html` for `const SOURCES` and read that block only (never the whole file). Key contracts:
   - SF_OPEN_CASES / SF_CLOSED_CASES — Salesforce HTML `.xls` (secretly an HTML table); required: Case Number + Date/Time Opened (Closed for closed)
   - BI_ACTIVE_CASES — Power BI "Active Cases", `.xlsx`/`.csv`; required: Account Number, Owner, Charge Amount, Contract Create Date. **THE money source** — sales and GWP come from this file only; charges are EX-VAT; each row is dated by its own Contract Create Date. Watch the duplicate `Charge Amount`/`Contract Status` headers (first wins) and Excel serial dates
   - CALLX_CALL_RECORDS — `.xlsx`; required: Date & Time, Call Type
   - SF_INACTIVE — required: Account Number, Contract Status, Contract Create Date
   - AGENT_LIST — required: Employee Code, Agent Name (all matching sheets are read; THE identity base)
   - QA_EVALUATIONS — `.csv`; required: Record ID, Sales Agent, Score %
   - ATTENDANCE — required: Date, Employee Code, Status Code (full header: Date, Employee Code, Employee Name, Title, Employee Type, Department, Reports To, Status Code, Status; UTF-8 BOM, CRLF). Both apps key on **Status Code** — the long `Status` text was reworded on 2026-09-21 and is never required. Only `Employee Type = Call Agent` rows count in PULSE. **Check the register end, not just the last date:** HR files leave ahead, so report (a) the file's own end (the last date in its name, else its last row), (b) the last REGISTER day — someone marked at work (P/T/L/HD*) or ≥ max(3, 10% of the floor) rows — and (c) the working days between them with the count of rows filed ahead on them. A file whose register stops short of its own end LOADS CLEAN but leaves those days uncaptured: the verdict says so and names HR as the fix (re-export once the register is completed), never the parser. Also flag zero new employee-days against the previous file, and far fewer rows over the same span (a partial pull)
2. **Write a small Node script** (Bash) to parse the file the way the app does — handle: HTML-table .xls, comma-decimal numbers (`3002,00…`), durations in MM:SS and HH:MM:SS, BOM on CSVs, duplicate header names.
3. **Report**: header diff (missing required / missing expected / extra), rows that would be rejected and why (first 10 with row numbers), date-range detected, row count, and a duplicate-file warning if an identical file was checked before.
4. **Verdict**: LOADS CLEAN / LOADS WITH n REJECTS / WILL NOT LOAD — plus the exact fix (e.g. "export changed 'Case Owner' to 'Owner Name' — update the SOURCES contract via /dashboard-fix, don't rename columns in Excel").

## Rules

- Never tell the user to open-and-resave in Excel — that corrupts the Salesforce quirks the parser already handles.
- An Activated Services or GWP-table file is **RETIRED** (2026-07, superseded by BI_ACTIVE_CASES) — verdict is WILL NOT LOAD: the app purges these sources on load. Ask for the Power BI Active Cases export instead.
- A file with PII stays local; quote at most masked samples in output.
