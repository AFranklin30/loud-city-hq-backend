# Lessons Learned

## 2026-03-21 — Always add CORS manually after scaffolding

**Rule:** After scaffolding any Express app, immediately add CORS — Claude Code does not add it by default.

```
npm install cors
const cors = require('cors')
app.use(cors())
```

---

## 2026-03-21 — Always verify guards against pseudocode

**What went wrong:** Claude Code writes plausible guards, not spec-accurate guards. A guard may look correct but check the wrong field or condition.

**Rule:** Read every guard against the pseudocode before accepting the code.

---

## 2026-03-21 — Trace null values forward before accepting

**Rule:** Before accepting any code that reads from Firestore or a lookup, ask: what happens if this value is null and it flows into the next line?

**Applies to:** Firestore document IDs especially — they cannot be null. A null ID passed to `db.doc()` or `db.collection().doc(null)` will silently misbehave or throw.

---

## 2026-03-21 — What Claude Code got right

- `applicationDefault()` for Firebase — correct credential pattern for Cloud Run / GCP environments
- Batch writes for atomicity — reached for `db.batch()` appropriately when multiple documents needed to be written together
- `console.error` with endpoint name prefix — made logs grep-able (e.g. `[POST /fan/registerStart]`)

---

## 2026-03-22 — Update the firestore mock before writing tests for a new endpoint

**What went wrong:** The top-level `jest.mock('../src/services/firestore', ...)` only mocked what prior endpoints used. When a new endpoint used `admin.firestore.FieldValue.increment()`, the test-agent started writing tests without first checking whether the mock covered it — which would have caused every test to throw `TypeError: Cannot read properties of undefined (reading 'FieldValue')`.

**Rule:** Before writing tests for a new endpoint, read the implementation and ask: does it use any part of `db` or `admin` that the current mock doesn't cover? Update the mock first, then write tests.

**Applies to:** Any new use of `admin.*` (e.g. `FieldValue.increment`, `FieldValue.arrayUnion`), new batch methods (e.g. `batch.update` was missing), or `db.runTransaction`.

---

## 2026-03-21 — Atomic writes require db.batch()

**What went wrong:** The validator caught that `accounts` and `emailIndex` were being written as separate `.set()` calls in `POST /fan/registerStart` with no atomicity guarantee. If the first write succeeded and the second failed, the system would be left in an inconsistent state — an account with no reserved email index, allowing duplicate registrations on retry.

**Rule:** Any endpoint with 2+ document writes in EXECUTE must use `db.batch()` — UNLESS the writes are already inside a `db.runTransaction()`. A transaction already guarantees atomicity; do not wrap it in a batch too.

**Applies to:** All endpoints with multiple document writes:
- `POST /fan/registerStart` — accounts + emailIndex
- `POST /fan/createProfilesAndIssuance` — profiles + issuances + accounts update
- `POST /staff/issueCard` — cards + accounts update + conditional issuances update
- `POST /staff/redeem` — profiles + cards + accounts update
- `POST /staff/manualStamp` — profiles + stampEvents
