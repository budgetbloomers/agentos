# Feature Specification: turn on "Allow Duplicate Opportunity" in the Wimpy HighLevel sub-account (022)

**Created**: 2026-10-09 · **Input**: Nick: "please go in and do it you have the highlevel private key and location id"

## Why
A person's SECOND Wimpy order gets no card while this is off (HighLevel: "Can not create duplicate opportunity for the contact"); 2 rows are failed/stuck today.

## Facts found
- GET /locations/{id}: allowDuplicateContact=true (Nick, this morning), allowDuplicateOpportunity=false.
- PUT /locations/{id} with the Wimpy private-integration key -> 401 "token is not authorized for this scope" (no locations.write).
- The toggle is not on the Business Profile screen Nick showed.

## Plan
1. Drive the HighLevel UI in a browser (gstack /browse) to find and switch the setting; else widen the private integration's scopes to Locations: Write and set it over the API.
2. Read it back over the API (allowDuplicateOpportunity=true).
3. Re-queue the failed/stuck rows (hl_state=pending, hl_tries=0, hl_next_at=now()).
4. Run the retry with its secret; confirm both rows written; re-run verify-wimpy-live if inside the window.
