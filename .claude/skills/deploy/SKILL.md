---
name: deploy
description: Prepare and deploy the Chatterbox analytics dashboard to Cloudflare Pages — regenerate site/index.html with the storage shim, run pre-flight checks, deploy with wrangler. Use when asked to deploy, publish, or push the dashboard live.
---

# Deploy (Cloudflare Pages)

Ship `site/` to Cloudflare Pages. The deployable `site/index.html` is GENERATED from `Chatterbox_AgentOS_Analytics.html` — treat the root HTML as source, site/ as build output.

## Steps

1. **Prepare**: `node tools/prepare-site.js` — copies the dashboard to `site/index.html` and injects the localStorage persistence shim (the app's `window.storage` API doesn't exist in a normal browser; without the shim nothing persists).
2. **Pre-flight checks** (all must pass):
   - `site/index.html` exists, contains the shim marker `cbx-storage-shim`, and `site/_headers` is present (CSP allowing cdnjs + inline).
   - Run `.claude/hooks/dashboard-guard.js` logic mentally-free: `echo '{"tool_input":{"file_path":"site/index.html"}}' | node .claude/hooks/dashboard-guard.js` — exit 0 required.
   - Grep confirms PII masking defaults ON (`unmasked:false` in state).
   - **Access check**: ask the user to confirm Cloudflare Access (Zero Trust) is configured in front of the project domain — the app has its own login (worker/src/auth.mjs + site/auth-gate.js); Cloudflare Access has never been enabled on the account, so that login is the only lock. First-ever deploy: walk them through it (Cloudflare dash → Zero Trust → Access → Applications → Add self-hosted app → domain = the Pages URL → policy = allow company emails). Do not skip this for a production deploy with real data.
3. **Deploy**:
   - Preview (default): `npx wrangler pages deploy site --project-name chatterbox-agentos --branch preview`
   - Production (only if the user said "prod"/"production"): `npx wrangler pages deploy site --project-name chatterbox-agentos`
   - First run: `npx wrangler login` if not authenticated; `npx wrangler pages project create chatterbox-agentos` if the project doesn't exist.
4. **Verify**: fetch the deployment URL wrangler prints (expect HTTP 200 and the `<title>` string); report the URL, deployment type (preview/prod), and the Access status.
5. **Post-deploy smoke (REQUIRED for production — the deploy is not done until this passes).** A Node fetch proves nothing about what a browser will refuse (Node does not enforce CORS — that gap is how the 28–31 Aug save loss shipped and ran for four days), so a real browser must perform the real write through the deployed pair:
   - `node nicks_code/diagnostics/verify-cors-headers.mjs --live` — every header any client sends is named in the Worker preflight, and a real Chromium performs a cross-origin write.
   - `node nicks_code/diagnostics/verify-live-save.mjs --live` — real Chromium at the deployed origin saves a gzipped probe through `/api/kv`, reads back the exact bytes, and the write appears in `kv_write_log`.
   If either fails, the deploy is broken for browsers even though every Node test passed: fix and redeploy before reporting done. When the Worker changed too, deploy the Worker (`npx wrangler deploy` in `worker/`) BEFORE running the smoke, so the pair being smoked is the pair that will serve users.

## Constraints & known limits

- localStorage caps ~5MB — heavy fact tables may exceed it; the app degrades gracefully (`persistOk=false` banner) but flag it in the deploy report. The real fix (Workers/D1 or Convex backend) is on the roadmap in AGENTIC-OS-PLAN.md.
- Never deploy with demo data loaded into a shim-persisted build if the user intends real uploads same-day — demo is cleared automatically on first real upload, but say so.
- CSP in `site/_headers` must keep `https://cdnjs.cloudflare.com` (XLSX, PapaParse, Chart.js) and `'unsafe-inline'`; tightening it breaks the app.
