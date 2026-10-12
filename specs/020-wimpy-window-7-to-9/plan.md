# Implementation Plan: 020 — the 07:00–09:00 window

`WINDOW` in `wimpy-service/src/wimpy.mjs` → `{ fromHour: 7, toHour: 9, hours: '07:00–09:00' }` and the refusal
message; `public/index.html` flip clock (`>=7 && <9`) and footer; `nicks_code/index.html` Apps card text; CLAUDE.md row;
README. Tests re-based: menu.test (the in-window instant becomes 08:00 SAST, out-of-window 11:00; section N rewritten),
history.test (every ordering instant moved from 10:xx/11:xx SAST into 07:00–08:59; the "closed" instant stays 17:30),
page-sweep.test (WED_OPEN 08:00, WED_SHUT 09:00:05, THU_OPEN 07:00:05), verify-wimpy-live (expectOpen 7..9). Then
`npm test`, deploy from the out-of-repo copy, `verify-wimpy-live`. Constitution: I (the server decides), VII (guards first).
