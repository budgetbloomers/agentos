---

description: "Task list — 013 a store larger than the server's memory is kept compressed"
---

# Tasks: Ops large store

**Input**: spec.md, plan.md (C1–C4). **Tests**: REQUIRED (Constitution VII), red first.

- [x] T001 Baseline: verify-ops-cas, verify-save-acks, verify-roster-of-record, verify-store-freshness
- [x] T002 [US1] [US2] NEW verify-kv-large-store.mjs: small gzip → stored plain (unchanged); > 32 MiB gzip →
  stored as the same gzip bytes, 200 + version, write log = unpacked size; not-JSON / corrupt → 400, nothing stored;
  server-read key over the line → 413; GET of a gzip object → Content-Encoding gzip + identical bytes; GET of a plain
  object unchanged; snapshot copies gzip as is; tools read through storeText / backup copies as is — RED
- [x] T003 [US1] Worker C1 + C2
- [x] T004 [US2] health.mjs C3; tools C4
- [x] T005 GREEN + related suites
- [ ] T006 Release (needs the go-ahead) + watch the next relay land ViciDial + commit
