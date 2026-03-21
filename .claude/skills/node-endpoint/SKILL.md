# Skill: node-endpoint
## Loud City HQ — Node.js/Express Endpoint Pattern

## Activates For
Any request to implement or modify an endpoint in this project.

## The Pattern — Always In This Order

```js
router.post('/routeName', [middleware], async (req, res) => {

  // ── RECEIVE ────────────────────────────────────────────
  // Parse inputs only. No logic. No reads.
  const { field1, field2 } = req.body;

  // ── GUARD ──────────────────────────────────────────────
  // Validate → check existence → check business rules
  // Cheapest operations first. Return early on every failure.
  // NO writes until all guards pass.

  if (!field1) {
    return res.status(400).json({ error: 'field1 is required' });
  }

  const doc = await db.collection('collection').doc(id).get();
  if (!doc.exists) {
    return res.status(404).json({ error: 'not found' });
  }

  const data = doc.data();
  if (data.someRule === false) {
    return res.status(400).json({ error: 'business rule violated' });
  }

  // ── EXECUTE ────────────────────────────────────────────
  // Reads and writes only after all guards pass.
  // Use transactions for anything touching profile.stamps.

  try {
    await db.collection('collection').doc(id).update({ field: value });

    // ── RETURN ──────────────────────────────────────────
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[routeName] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});
```

## Firestore Transaction Template (for profile.stamps)
```js
await db.runTransaction(async (t) => {
  const profileRef = db.collection('profiles').doc(profileId);
  const profileDoc = await t.get(profileRef);

  if (!profileDoc.exists) throw new Error('profile not found');

  const profile = profileDoc.data();

  // guard inside transaction
  if (profile.stamps && profile.stamps[stationId]) {
    throw Object.assign(new Error('duplicate'), { code: 'DUPLICATE' });
  }

  t.update(profileRef, {
    [`stamps.${stationId}`]: new Date()
  });
});
```

## Status Code Reference
| Situation | Code |
|-----------|------|
| Success | 200 |
| Validation / business rule | 400 |
| Auth missing or invalid | 401 |
| Not found | 404 |
| Server error | 500 |
| /station/stamp business failure | 200 (result field carries outcome) |

## Imports Every Route File Needs
```js
const router = require('express').Router();
const { db } = require('../services/firestore');
```

## Do Not
- Do not reinitialize Firebase inside a route file
- Do not write before all guards pass
- Do not expose err.message or stack traces to client
- Do not return email in any fan-facing response
- Do not use non-transactional writes on profile.stamps