# Feature Specification: the Wimpy address becomes phoenix-wimpy.vercel.app (024)

**Created**: 2026-10-09 · **Input**: Nick: "can we change https://chatterbox-wimpy.vercel.app/, and remove the chatterbox to phoenix wimpy"

## Decided
- Rename the Vercel project chatterbox-wimpy → phoenix-wimpy; the production address becomes https://phoenix-wimpy.vercel.app (the old one stops answering — Vercel releases it on rename).
- Move every reference: WIMPY_URL in worker/src/index.mjs, site/_redirects, README, quickstart, CLAUDE.md, the removal guard, the live suite's default address, memory. Redeploy Worker + Pages; smoke.
- The page's own wording ("Chatterbox × Wimpy") is NOT changed unless Nick asks — only the address.
