# Obsidian ↔ Supabase Brain — Sync Runbook (Phase 5)

The `brain` bucket in Supabase Storage is the live vault. The Worker writes to it
(digests, NBA cards, actions, decisions, KB answers); you view/edit it in Obsidian
on any device via the **Remotely-Save** community plugin over Supabase's S3 API.
Nothing runs on your PC — Obsidian just syncs.

## 1. Generate Supabase S3 access keys (2 clicks, once)
Supabase dashboard → **Project Settings → Storage → S3 access keys** → **New access key**
→ copy the **Access key ID** and **Secret access key** (shown once).
Note your S3 endpoint (same page): `https://fxvnjhfdenycxxuklord.supabase.co/storage/v1/s3`
Region: `us-east-1` (Supabase default — any value works, it's ignored).

## 2. Install Obsidian + Remotely-Save
1. Install Obsidian (free): https://obsidian.md
2. Create/open a vault named e.g. `ChatterboxOS` (an empty local folder).
3. Settings → Community plugins → Browse → **Remotely-Save** → Install → Enable.

## 3. Configure Remotely-Save
Remotely-Save settings → **Choose a remote service: S3 (compatible)**:
- **Endpoint**: `https://fxvnjhfdenycxxuklord.supabase.co/storage/v1/s3`
- **Region**: `us-east-1`
- **Access Key ID**: (from step 1)
- **Secret Access Key**: (from step 1)
- **Bucket name**: `brain`
- **S3 URL style**: **Path-style** (required for Supabase)
- Leave the rest default. Click **Check connectivity** → should pass.

## 4. First sync
Click the Remotely-Save sync icon (circular arrows) in the left ribbon. It pulls
the vault: `CLAUDE.md`, `hot.md`, `log.md`, and the folders
`Agents/ NBA-Reports/ Actions/ Decisions/ KB-Answers/ System/` as they get written.
Open **Graph view** — as weekly digests and NBA cards accumulate, the graph fills
with agents linked to their teams, campaigns and the rules that fired.

## 5. Ongoing
- The Worker writes new notes to the bucket (Monday digest, daily health, cards).
- Sync (manual, or enable auto-sync on interval in Remotely-Save) to pull them.
- Your own notes/edits sync back up — but never edit `raw/` sources; treat
  `Agents/ NBA-Reports/ Actions/` as automation-owned (you annotate, the Worker writes).

## Notes
- Same keys work on the phone app — one vault across devices, R2/S3 egress is free.
- If Check-connectivity fails: confirm **Path-style** is on and the bucket is exactly `brain`.
- The vault is private (bucket is private); the S3 keys are the only access — treat them like a password.
