# Quickstart: Wimpy Order as its own service (018)

## Run the tests (no credentials)

```powershell
cd "C:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos\wimpy-service"
npm test                      # menu · signin · history · page-sweep (Chromium from ../nicks_code/diagnostics/node_modules)
cd ..
node nicks_code/diagnostics/verify-wimpy-service-drift.mjs    # the copied sign-in code is the Worker's, byte for byte
node nicks_code/diagnostics/verify-wimpy-removal.mjs          # nothing of Wimpy remains in the suite
```

## Run the service locally (real database, real kitchen webhook — orders go to the kitchen!)

```powershell
cd wimpy-service
# the two git-ignored env files already hold every variable; load them into this shell:
Get-Content ..\supabase.env, ..\wimpy-highlevel.env | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] } }
$env:WIMPY_WEBHOOK_URL = 'http://127.0.0.1:9/nowhere'   # unless you MEAN to send a real order
node src/server.mjs           # http://localhost:8080  — the page; /api/health; /api/wimpy/*
```

## Container

```bash
cd agentos/wimpy-service
docker build -t chatterbox-wimpy .
docker compose up -d          # reads ../supabase.env and ../wimpy-highlevel.env; port 8080; retry timer every 20 min
curl -s localhost:8080/api/health
```

## Vercel — DONE 2026-10-09 (live at https://phoenix-wimpy.vercel.app). To redeploy after a change:

```powershell
# deploy from a COPY outside the git repo: from inside agentos/ Vercel attaches the last commit's author and blocks the
# deployment when that author is not a member of the Vercel account (it did, on the second deploy)
$D = "$env:TEMP\wimpy-deploy"; Remove-Item -Recurse -Force $D -ErrorAction SilentlyContinue; New-Item -ItemType Directory $D | Out-Null
Copy-Item -Recurse wimpy-service\api,wimpy-service\public,wimpy-service\scripts,wimpy-service\src,wimpy-service\package.json,wimpy-service\vercel.json,wimpy-service\README.md,wimpy-service\.gitignore,wimpy-service\.vercel $D
Set-Location $D; vercel --prod --yes
```

Variables are already set (`node scripts/env.mjs --vercel` re-pushes them, sensitive). The project is linked (`.vercel/project.json`).

The address is `https://phoenix-wimpy.vercel.app`. If Nick picks another name, change `WIMPY_URL` in
`worker/src/index.mjs`, the line in `site/_redirects`, and the Apps card in `nicks_code/index.html` (the removal guard
fails until all three agree).

## Release order (the removal)

1. Deploy the Wimpy service (Vercel or container) and smoke it: `/api/health`, a sign-in, a test order with
   "TEST - please ignore" in the notes, My orders.
2. `cd worker && npx wrangler deploy` — the Worker that refuses Wimpy sessions and answers 410 on `/api/wimpy/*`.
3. `node tools/apply-migration.mjs supabase/migration-058-wimpy-service.sql` — ends every old Wimpy session.
4. `node tools/prepare-site.js` then `/deploy` — the Pages site without `/wimpy/`, with the redirect and the new Apps card.
5. `npx wrangler secret delete WIMPY_HL_API_KEY` and `… WIMPY_HL_LOCATION_ID` in `worker/` — the Worker no longer needs them.
6. Post-deploy smoke: `verify-cors-headers --live`, `verify-live-save --live`; open `/wimpy/` on Pages → forwards.
