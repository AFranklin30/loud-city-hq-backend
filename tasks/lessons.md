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

## 2026-03-22 — Always pass the pseudocode to the validator agent

**What went wrong:** The first validator run for `GET /fan/issuance/:issuanceId` was run without `docs/step5-pseudocode.md`. It missed the entire EXECUTE section — the profiles `.where()` query, the response shape, the derived `status` string, and that `profileId` must come from `doc.id`. The validator produced a plausible-but-wrong implementation.

**Rule:** When invoking the validator agent, always include the relevant pseudocode section from `docs/step5-pseudocode.md` in the prompt. Without the spec, the validator checks pattern compliance only — it cannot catch wrong fields, missing queries, or incorrect response shapes.

---

## 2026-03-22 — Firestore Timestamps must be serialized before returning in responses

**What went wrong:** The validator caught that `expiresAt` is stored as a Firestore Timestamp (created via `new Date()` and auto-converted by Firestore). Returning `issuance.expiresAt` directly sends a raw Timestamp object to the client, not an ISO string.

**Rule:** Any Firestore Timestamp field returned in a response must be serialized: `field.toDate().toISOString()`. Confirm with the PWA what format it expects before choosing the serialization method.

**Applies to:** Any response field that originated as a `new Date()` write to Firestore — `expiresAt`, `createdAt`, `redeemedAt`, `lastIssuanceAt`, etc.

---

## 2026-03-22 — .where() queries require a separate mock branch in tests

**What went wrong:** The existing Firestore mock only covered `doc().get()`. When `GET /fan/issuance/:issuanceId` used `db.collection('profiles').where('issuanceId', '==', issuanceId).get()`, the profiles collection mock had no `.where()` method, which would have caused every test to throw `TypeError`.

**Rule:** When an endpoint uses a `.where()` collection query, add a dedicated mock branch for that collection that returns `{ where: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs: [...] }) }) }`. Do this before writing any tests.

---

## 2026-03-22 — Validator agent is read-only — never writes code

**What went wrong:** After producing a validation report, the validator agent attempted to edit fan.js to fix the failures it found.

**Rule:** The validator agent is read-only. It reads files and outputs a report only. It must never write or edit any file. If it attempts to do so, stop it immediately and redirect. Implementation is triggered separately by the user.

---

## 2026-03-22 — Never silently add logic beyond the pseudocode spec

**What went wrong:** During implementation of `POST /staff/issueCard`, the implementer added a defensive `404 account not found` guard (`accountSnap.exists` check) that is not in the pseudocode spec. It was added silently without flagging it or asking for approval. The gap was only discovered when writing tests.

**Rule:** If the implementer wants to add any logic not specified in the pseudocode — defensive guards, extra error cases, derived fields, fallbacks — it must stop and ask before adding it. Never silently add unspecced logic. Flag it, get approval, then add it.

**Why:** Unspecced logic can mask data integrity issues, introduce untested code paths, or diverge from the agreed API contract without the team knowing. The pseudocode is the source of truth.

---

## 2026-03-22 — Always checkout and pull dev before creating a new branch

**What went wrong:** A new feature branch was created directly from another feature branch (`feature/tap-token-endpoint`) instead of from an up-to-date `dev`. The branch would have contained unrelated commits if `dev` had diverged.

**Rule:** Always `git checkout dev && git pull` before `git checkout -b feature/...`. Never branch off another feature branch.

---

## 2026-03-22 — Middleware must be a single async function — not a nested inner function

**What went wrong:** The initial `stationKey.js` defined an outer function `stationKeyMiddleware(req, res, next)` that contained an inner async function `verifyStationKey` — but never called it. The outer function returned `undefined`, effectively bypassing all auth logic silently.

**Rule:** Middleware must be exported as a single `async function(req, res, next)`. Never define logic inside a nested inner function unless it is explicitly invoked. Always verify that `next()` is reachable on the happy path.

---

## 2026-03-22 — Validator catches double middleware application

**What went wrong:** `stationKey` was applied twice — once via `router.use(stationKey)` and again as a route-level argument in `router.post('/stamp', stationKey, ...)`. The validator caught this.

**Rule:** When a router already has `router.use(middleware)`, do not repeat the middleware as a route-level argument. One or the other — not both.

---

## 2026-03-23 — Collection-level .get() needs its own mock branch

**What happened:** `POST /staff/redeem` counts total stations via `db.collection('stations').get()` — no `.doc()`, no `.where()`. The existing mock pattern only covered `doc().get()` and `where().get()`, so `stations` needed a dedicated branch returning `{ get: jest.fn().mockResolvedValue({ size: N }) }`.

**Rule:** When an endpoint calls `.get()` directly on a collection (count query pattern), add a mock branch for that collection that returns `{ get: jest.fn().mockResolvedValue({ size: N }) }`. Don't confuse it with the `.doc().get()` or `.where().get()` patterns — those need different mock shapes.

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

---

## 2026-03-23 — cards collection uses token as document ID

**Rule:** Always look up cards via `db.collection('cards').doc(token)`. Never query with `.where('token', '==', token)` — the token IS the document ID, so a direct lookup is both faster and correct.

---

## 2026-03-23 — Normalize stamps map to ISO strings before returning

**Rule:** Any endpoint that returns a `stamps` map must serialize each value before sending it in the response:

```js
ts.toDate ? ts.toDate().toISOString() : new Date(ts).toISOString()
```

This handles both Firestore Timestamps and plain JS Dates.

**Applies to:** All endpoints that return `stamps` in the response body.

---

## 2026-03-23 — Count only active stations for totalStations

**Rule:** Always use `.where('active', '==', true)` when querying the stations collection to derive `totalStations`. A deactivated station must never count toward completion.

**Applies to:** Any endpoint that checks whether a stamp card is complete.

---

## 2026-03-23 — Use db.runTransaction() for redemption — concurrent writes are a real risk

**Rule:** The `POST /staff/redeem` endpoint must use `db.runTransaction()`, not `db.batch()`. A transaction re-reads `redeemed` inside the write, preventing double redemption when two staff members scan the same card simultaneously at a live event. `db.batch()` does not protect against this race.

**Applies to:** Any endpoint where the same action could be triggered concurrently for the same document (redemptions, stamp deduplication, etc.).

---

## 2026-03-23 — Throw typed errors inside transactions for clean catch handling

**Rule:** When a transaction must abort for a business reason (e.g. already redeemed), throw an error with a `code` property:

```js
const err = new Error('already redeemed');
err.code = 'ALREADY_REDEEMED';
throw err;
```

The outer `catch` can then distinguish business failures from real server errors without exposing internal details to the client.

**Applies to:** Any `db.runTransaction()` that checks a guard condition inside the write.

---

## 2026-03-23 — toHaveProperty() interprets dots as nested path separators

**What went wrong:** `expect(updateArg).toHaveProperty('stamps.station-abc-001')` failed because Jest's `toHaveProperty` treats dots as nested object path separators — it looked for `{ stamps: { 'station-abc-001': ... } }` instead of the literal key `'stamps.station-abc-001'`.

**Rule:** When asserting a literal dotted key (e.g. a Firestore field path like `stamps.stationId`), use `Object.keys` + `toContain` instead:

```js
expect(Object.keys(updateArg)).toContain(`stamps.${stationId}`);
expect(updateArg[`stamps.${stationId}`]).toBeInstanceOf(Date);
```

**Applies to:** Any test asserting Firestore dot-notation field paths in batch/transaction update arguments.
