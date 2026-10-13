# Quickstart: 033 — the Coaching Hub, exactly as it is, as a campaign manager tab

## Build (no credentials needed)

1. Baseline: `node nicks_code/diagnostics/verify-cm-view.mjs`, `verify-agent-analytics.mjs`, `verify-live-month-page.mjs`.
2. tasks.md T003–T004 red → T005–T007 → green (T008). Two files change: `agent/index.html`, `site/_headers`.

## Release (Nick or Aarav)

```
node tools/prepare-site.js                      # site/agent/index.html from agent/index.html; _headers is committed as is
npx wrangler pages deploy site --project-name <pages project> --branch main
node nicks_code/diagnostics/verify-cors-headers.mjs --live
node nicks_code/diagnostics/verify-live-save.mjs --live
node nicks_code/diagnostics/verify-cm-live.mjs --live       # + --ryan
```

No Worker deploy — the Worker is unchanged.

## Live check (real browser, mandatory)

1. Sign in at `/agent/` as `dalwin`. Sidebar: Campaign · Team Leaders · Assistance · Reports · **Coaching Hub** · Nikola ·
   Settings. "Team leaders' coaching" above the user card as before.
2. Click Coaching Hub: the Hub's own home appears filling the area under the header; no page scrollbar; header shows
   no pickers; the P1 marker shows if a P1 request is open.
3. In the Hub: pick a team leader → open a document → download its PDF → start a new session and type into a field.
   Open the browser console and run `render()`: the typed text is still there (no reload).
4. Click Reports, then Coaching Hub again: the Hub is where you left it.
5. Resize the window / open on a phone: the Hub fills the width under the header.
6. Sign out, sign in as a team leader (CB102): no Coaching Hub entry in the manager's place; their own Coaching Hub tab
   unchanged. Sign in as an agent: unchanged.
7. If the Hub ever shows the words "The Coaching Hub did not load" with Retry: check the Hub's response headers for
   `x-frame-options` / `frame-ancestors` (verify-cm-live reports it) — that is the Hub refusing, not this page.

## The colours (WP-B — needs the Hub repository)

1. DONE 2026-10-13: repo `budgetbloomers/coaching-hub`, clone at `C:\Users\aarav\repos\coaching-hub`, branch
   `feat/agentos-theme`, commit `9b9326b`, built and checked in a browser both ways.
2. Ship it: `cd C:\Users\aarav\repos\coaching-hub && git push -u origin feat/agentos-theme`, merge into `main` on
   GitHub (or push to main directly) — Vercel deploys the Hub from that.
3. Open `https://coaching-hub-psi.vercel.app/?theme=agentos` → navy / blue / `#F2F5FA` / Inter; the plain address →
   unchanged green. Then in the tab: header navy, primary buttons blue (SC-005). `verify-cm-live --live` finds the
   `[data-theme=agentos]` rule.
4. Until step 2 ships, the tab shows the Hub's current green — by design, nothing waits on it.

## Rollback

Redeploy the previous Pages build. Nothing else to reverse.
