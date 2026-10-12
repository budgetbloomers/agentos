# Spec 032 — A Claude Code Desktop session can reach the AgentOS data

**Status:** investigated 2026-10-12 · **decided (Nick, 12 Oct): option 1 — run Desktop sessions locally**; branch pushed to GitHub the same day
**Asked by:** Nick, 12 Oct: "I have this repo opend on claude code, desktop app query and got an error, please intevestigate"

## What happened

A Claude Code Desktop session was asked for two PDFs for Denise Haripersad's team (the full October analytics
report and a 5-page summary for Denise and the campaign manager). It produced nothing and reported:

- the network refused `chatterbox-agentos-api.chatterbox-agentos.workers.dev`, `services.leadconnectorhq.com`
  and `*.supabase.co`;
- no Worker / HighLevel / Supabase credentials;
- `uploads/` empty, `../reference/` missing "in this container";
- the Google Drive connector failed to sign in ("does not support dynamic client registration").

## Root cause

The session ran in a **cloud environment** (a container on Anthropic's side), not on this PC. A cloud
session does not open the folder on the PC: it clones the repository from GitHub. So:

| What the session needed | Where it lives | Why the cloud copy had none of it |
|---|---|---|
| Current code | this PC (branch `feature/campaign-manager-theme-wimpy`) | GitHub `main` stopped at 22 Sep; 37 local commits were never pushed |
| Credentials | `supabase.env`, `highlevel.env`, `help-highlevel.env` | git-ignored on purpose — secrets never leave the PC |
| Uploaded exports | `uploads/` | git-ignored (agent PII / POPIA) |
| Reference material | `../reference/` | outside the repository altogether |
| The live system | Worker, Supabase, HighLevel | the cloud environment's network allow-list does not include them |

Nothing in AgentOS is broken: the Worker, Supabase and HighLevel were up; the session simply could not see them.
The Google Drive failure is a separate connector-sign-in issue on the claude.ai side.

## Requirements

- **FR-1** A Desktop session asked about AgentOS data reaches the same code, credentials and data a terminal
  session on this PC does.
- **FR-2** No secret (Supabase service key, HighLevel keys) is copied anywhere it is not today.
- **FR-3** Company data (exports in `uploads/`, `../reference/`) is never pushed to GitHub (the `.gitignore` rule).

## Options

1. **Run the Desktop session locally (recommended).** In the Desktop app, start the session on this PC's folder
   (`…\Chatterbox Agent OS\agentos`) instead of a cloud environment. It then has the code as it is now, the
   env files, `uploads/`, `../reference/` and the network — FR-1, FR-2 and FR-3 hold with no change.
2. **Make the cloud environment work.** Push the branch; allow the three hosts in the environment's network
   settings; put the Supabase service key and HighLevel keys into the cloud environment's secrets; give it a way to
   reach the exports. Breaks FR-2 (keys copied to the cloud) and needs care with FR-3.

## Success

The same request ("both PDFs for Denise's team") run from the Desktop app returns the reports from live data.
