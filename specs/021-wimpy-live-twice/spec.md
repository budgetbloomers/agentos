# Feature Specification: a person orders twice; two people never see each other (021)

**Created**: 2026-10-09 · **Input**: Nick: "run test for the wimpy, for example order from a candidate twice, make sure the history is working etc"

## Stories (live, inside the 07:00-09:00 window)
- US1 (P1): the same person places a SECOND order (two lines, quantity 2 on one); My orders shows BOTH, newest first, each with its own items, quantities, total and SA time; the first is still at "New Order"; the second is on the board or honestly "not on the kitchen board yet" (HighLevel still refuses a second card per person until "Allow duplicate opportunities" is turned on).
- US2 (P1): refusals hold while signed in: quantity 11, another day's Big One by name, an add-on.
- US3 (P1): a SECOND throwaway person signs in, sees an empty history with nothing of the first person's, orders once, sees exactly one; the first person still sees exactly two.
- Cleanup: both throwaway accounts removed; the kitchen gets slips marked TEST.

## Success
- every check green; verify-wimpy-live.mjs section F carries them from now on.
