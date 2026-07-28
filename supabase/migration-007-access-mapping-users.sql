-- ============================================================
-- Migration 007 — Accounts from Access_Mapping.xlsx (2026-07-28)
-- Run in the Supabase SQL Editor (the Worker is the only other thing
-- that touches these tables; there is no admin UI — README pattern).
--
-- Usernames = first names per the sheet. TWO RYANS: 'ryan' cannot be
-- both, so they are ryann (Ryan N) and ryang (Ryan G).
-- Password for every account: agentos123 (PBKDF2-hashed below, never
-- plaintext in the DB) with must_change_password=true — each person
-- sets their own on first sign-in, so the shared bootstrap password
-- dies on first use.
--
-- Column → tab-id mapping (sheet vocabulary → app ids):
--   OPS  : Executive Tab→exec · Sales Production→sales · Lead Management→leads
--          Session Dashboard→session · QA & Compliance→qa · QA Agent Performance→qaperf
--          Agent Discipline→discipline · TL View→tl · Workforce→workforce
--          Agent Performance→brain  [ASSUMPTION: the Visual Brain IS the per-agent
--          performance view; OPS has no page literally named "Agent Performance"]
--          Upload center full→uploads · Session Upload→sess_uploads
--   VAS  : Dashboard→dashboard  [the sheet's "Dashboard" column sits inside the OPS
--          merge, but OPS has no Dashboard page and the VAS group lacks one — it is
--          PULSE's landing tab] · MTD→mtd · Weekly→weekly · Daily→daily
--          Sales heatmap→pivot · workforce→attend · agent performance→agents
--          leaderboard→leaderboard · coaching→coaching · compare agents→compare
--          manual→manual · upload station→data
--   TRACK: Input→input,tracker  [the entry form and the saved-EOD grid are one
--          workflow — Input implies seeing the grid] · VT MTD Report→vt
--   "*" = every tab in that app (and future ones). Full-access rows get "*".
--
-- pii_unmask stays FALSE for everyone here (masking defaults ON —
-- non-negotiable; grant it per person, deliberately, when needed).
-- Existing usernames: the upsert updates name/role/apps/tabs but NEVER
-- overwrites a password or PII flag of an account that already exists.
-- ============================================================

insert into app_users (username, full_name, password_hash, role, apps, tabs, pii_unmask, must_change_password, created_by)
values
  -- ---- full access (every OPS/VAS/Tracker tab) ----
  ('ryann',    'Ryan N',    'pbkdf2h$100000$6745d5a9834d3fd533c1abfd5b74589f$cbf204883be0d10dbb5aa98c592713c9f9d797e7962db35180881e3fb8263503', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('aarav',    'Aarav',     'pbkdf2h$100000$929e4fcdc78d0a96517777942572b4f6$8ddd7100efb6ad47da1f933dee42d6a4d461169f7bb662634c6ce22e9ac7eda0', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('nick',     'Nick',      'pbkdf2h$100000$90c6bbfa8e062447e487eb17b7022eef$12c98e1ade5d4b16b8398c350a8cba45baf3be6d145f9ee302d352d197c202e1', 'admin', '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('panday',   'Panday',    'pbkdf2h$100000$83af916e764e6c87133c7dc88862d53c$8b281ef9463fa1acc5f1a47bebc8fdb91a505bc68e5bc3def9466232583071f4', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('max',      'Max',       'pbkdf2h$100000$a436b6c670bca8c02ec9c2a95139c256$5ebd0dafd0572efaf753259ae1ec4e6f4ccebcc08b9655138804f0e769df5f3e', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('claudell', 'Claudell',  'pbkdf2h$100000$19e9271f836e1117f1d738fc5471b0ec$76c52ba40dc16486dfb4d6a45577ebf8d41b820f5b9d34ff8902593b8b575c9b', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('jared',    'Jared',     'pbkdf2h$100000$1689693eb31cf05b0f728fce1ca609b4$aef67166f51095cbcb453b9df6d67f0711a7c589cc7ee07c0c03271f3445bb3e', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  ('leon',     'Leon',      'pbkdf2h$100000$bbfae8f3700df2504b620ea806ad3df0$5620ac708f25cc24ebe2bc2a4db5e41f4ac50135c4942cf4c2af3148d8dd8c70', 'exec',  '{ops,vas,tracker}', '{"ops":["*"],"vas":["*"],"tracker":["*"]}', false, true, 'migration-007'),
  -- ---- scoped access, exactly the sheet's X marks ----
  ('ashton',   'Ashton',    'pbkdf2h$100000$2466bec4cc2aaef5c070c0c18796ef25$f348b2f8cc979f44fa9bea1350e642808670c21ae2df217609b8219e394346e4', 'viewer', '{ops,vas,tracker}', '{"ops":["leads","session","tl","brain","uploads","sess_uploads"],"vas":["dashboard","data"],"tracker":["vt"]}', false, true, 'migration-007'),
  ('dalwin',   'Dalwin',    'pbkdf2h$100000$b0f7013b0e9be215c7d9b2157a2e7c53$e7506e9bcc6c33aa1e41d65ca034e772e2a0588b5fa5190eb688480a7246d67b', 'viewer', '{ops,vas}',         '{"ops":["session","tl","brain","sess_uploads"],"vas":["dashboard"]}', false, true, 'migration-007'),
  ('abigail',  'Abigail',   'pbkdf2h$100000$522e0fcc98af3c7263b0f0a278bfbdb9$10e02550b6c6a71073b0a28843b46e8b7eb66a8d9de0653e974ce0763e52c721', 'viewer', '{ops,vas}',         '{"ops":["tl","brain","uploads"],"vas":["mtd","weekly","daily","pivot","attend","agents","leaderboard","coaching","compare","manual","data"]}', false, true, 'migration-007'),
  ('ryang',    'Ryan G',    'pbkdf2h$100000$e8c2659cbd30bf4160bc2ac046851e4d$3ba98086c1c493a17ef1f41f033c4787ab0b5a3bea41c44db20feb25b9f86965', 'viewer', '{ops,vas,tracker}', '{"ops":["tl","brain"],"vas":["dashboard","mtd","weekly","daily","pivot","attend","agents","leaderboard","coaching","compare","manual","data"],"tracker":["input","tracker","vt"]}', false, true, 'migration-007'),
  ('keshree',  'Keshree',   'pbkdf2h$100000$fe397bd3c624cd287dc8f5b349753400$3f6a3dac23ca11fdc7d5aaab1a1e22d71b95ede4240690aaaff7e74df51c50ef', 'qa',     '{ops}',             '{"ops":["qa","discipline","workforce"]}', false, true, 'migration-007')
on conflict (username) do update set
  full_name = excluded.full_name,
  role      = excluded.role,
  apps      = excluded.apps,
  tabs      = excluded.tabs;
  -- deliberately NOT updated on conflict: password_hash, pii_unmask,
  -- must_change_password — re-running this file can never reset a
  -- password or widen PII for an account that already exists.

-- ---- "TLs" row (generic) — TEMPLATE, one insert per real team leader ----
-- The sheet grants team leaders: TL View + Agent Performance (ops) and the VAS
-- analytics tabs. Use role 'tl' — it data-scopes the Ops app to THEIR OWN TEAM
-- and blocks admin/data tabs. IMPORTANT: full_name must EXACTLY match the
-- Team Leader column of the daily Agent List, or the scope fails closed and
-- they see no rows. Generate a fresh hash per person (worker/README.md).
--
-- insert into app_users (username, full_name, password_hash, role, apps, tabs, pii_unmask, must_change_password, created_by)
-- values ('<first name>', '<EXACT Team Leader name from the Agent List>', '<pbkdf2h$... fresh hash>', 'tl',
--         '{ops,vas}', '{"ops":["tl","brain"],"vas":["dashboard","mtd","weekly","daily","pivot","attend","agents","leaderboard","coaching","compare","manual","data"]}',
--         false, true, 'migration-007')
-- on conflict (username) do nothing;
