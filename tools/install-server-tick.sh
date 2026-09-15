#!/usr/bin/env bash
# install-server-tick.sh — make an always-on Ubuntu box THE scheduled runner (Nick, 2026-09-15:
# "the github and my pc cannot be always on").
#
#   On a fresh Ubuntu 22.04/24.04 server (any 2 GB / 1 vCPU VPS is enough), as root:
#     curl -fsSL https://raw.githubusercontent.com/budgetbloomers/agentos/main/tools/install-server-tick.sh | bash
#   then paste the two credential files it asks for:
#     /opt/agentos/agentos/supabase.env     (SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL)
#     /opt/agentos/agentos/highlevel.env    (HL_API_KEY, HL_LOCATION_ID — referrals; optional)
#   and a read-only deploy key for the repo in /root/.ssh (the script prints the public key to add).
#
# What it installs: Node 22, Playwright's Chromium + system libs, the repo at /opt/agentos, and a
# cron that runs tools/tick-local.mjs --primary every 15 minutes (06:00–20:00 SAST, Mon–Sat) — the
# same steps the GitHub workflow runs: rake, agent digest, Ops relay, NBA digest — plus the daily
# jobs (coaching snapshot, lake load, referrals) and a `git pull` before each tick so the server
# always runs the deployed engine. The GitHub workflow keeps only the nightly verification.
set -euo pipefail
DIR=/opt/agentos
REPO_SSH=git@github.com:budgetbloomers/agentos.git

echo "== packages"
apt-get update -qq && apt-get install -y -qq git curl ca-certificates cron tzdata >/dev/null
timedatectl set-timezone Africa/Johannesburg || true
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

echo "== deploy key"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f /root/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519 -C agentos-tick >/dev/null
ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null
echo "add this READ-ONLY deploy key to github.com/budgetbloomers/agentos → Settings → Deploy keys:"; cat /root/.ssh/id_ed25519.pub

echo "== repo"
mkdir -p "$DIR"
if [ ! -d "$DIR/agentos/.git" ]; then
  git clone -q "$REPO_SSH" "$DIR/agentos" 2>/dev/null || { echo "clone failed — add the deploy key above, then re-run"; exit 1; }
fi
cd "$DIR/agentos"
git pull -q --ff-only origin main || true
(cd nicks_code/diagnostics && npm ci --silent --no-audit --no-fund && npx --yes playwright install --with-deps chromium >/dev/null)
mkdir -p reports

echo "== credentials"
for f in supabase.env highlevel.env; do
  [ -f "$f" ] || { touch "$f"; chmod 600 "$f"; echo "  paste $DIR/agentos/$f"; }
done

echo "== cron"
cat > /etc/cron.d/agentos-tick <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
CRON_TZ=Africa/Johannesburg
# the 15-minute tick, working hours, Mon–Sat — pull first so the server runs what is deployed
*/15 6-20 * * 1-6  root  cd /opt/agentos/agentos && git pull -q --ff-only origin main; node tools/tick-local.mjs --primary >> reports/tick-server.log 2>&1
# daily jobs the GitHub workflow used to carry
13 */2 * * *       root  cd /opt/agentos/agentos && node tools/sync-coaching-hub.mjs >> reports/tick-server.log 2>&1 && node tools/job-status.mjs coaching-snapshot success server || node tools/job-status.mjs coaching-snapshot failure server
41 21 * * *        root  cd /opt/agentos/agentos && node tools/lake-load.mjs >> reports/tick-server.log 2>&1 && node tools/job-status.mjs lake-load success server || node tools/job-status.mjs lake-load failure server
41 6 * * *         root  cd /opt/agentos/agentos && node tools/fetch-referrals.mjs >> reports/tick-server.log 2>&1 && node tools/job-status.mjs referrals success server || node tools/job-status.mjs referrals failure server
9 7 * * 1          root  cd /opt/agentos/agentos && node tools/reach-report.mjs --write >> reports/tick-server.log 2>&1
CRON
chmod 644 /etc/cron.d/agentos-tick && systemctl restart cron
echo "installed. First tick within 15 minutes once supabase.env is in place. Log: $DIR/agentos/reports/tick-server.log"
