# Lessons Learned

## 2026-03-21 — Atomic writes require db.batch()

**What went wrong:** The validator caught that `accounts` and `emailIndex` were being written as separate `.set()` calls in `POST /fan/registerStart` with no atomicity guarantee. If the first write succeeded and the second failed, the system would be left in an inconsistent state — an account with no reserved email index, allowing duplicate registrations on retry.

**Rule:** Any endpoint with 2+ document writes in EXECUTE must use `db.batch()` — UNLESS the writes are already inside a `db.runTransaction()`. A transaction already guarantees atomicity; do not wrap it in a batch too.

**Applies to:** All endpoints with multiple document writes:
- `POST /fan/registerStart` — accounts + emailIndex
- `POST /fan/createProfilesAndIssuance` — profiles + issuances + accounts update
- `POST /staff/issueCard` — cards + accounts update + conditional issuances update
- `POST /staff/redeem` — profiles + cards + accounts update
- `POST /staff/manualStamp` — profiles + stampEvents
