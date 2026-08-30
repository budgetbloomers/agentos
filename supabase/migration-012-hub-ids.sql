-- ============================================================
-- Migration 012 — the external hub identities, resolved once
--
-- The Coaching Hub and the KPI Hub each keep their own team-leader table with
-- their own ids, and each spells people differently: our "Dhamendra Budhu" is
-- their "Dharmendra", our "Shane Methalal" is their "Shane". A team leader's
-- records can only be fetched by those ids.
--
-- WHY THIS IS A COLUMN AND NOT A NAME MATCH AT REQUEST TIME. Resolving a name
-- to an id on every request means a rename in either hub silently repoints a
-- team leader at somebody else's coaching records, or at nobody's. It is
-- resolved ONCE by tools/map-hub-ids.mjs, written here, and used verbatim
-- afterwards — so a mismatch shows up as an empty tab that a human can fix,
-- never as one leader quietly reading another's sessions.
--
-- Shape:  {"coaching":"jx742…","kpi":"j9728…"}
-- Either key may be absent: not every leader exists in both hubs.
-- ============================================================

alter table app_users add column if not exists hub_ids jsonb;

comment on column app_users.hub_ids is
  'Resolved external hub ids for a team leader: {"coaching": <Coaching Hub teamLeaders._id>, "kpi": <KPI Hub users._id>}. Written by tools/map-hub-ids.mjs. The Worker pins these from the session — a caller-supplied id is never trusted, because neither hub authenticates.';
