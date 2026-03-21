Collection Names (exact, case-sensitive)
emailIndex
accounts
profiles
issuances
cards
stations
stampEvents
Never pluralize differently. Never use camelCase variants. These are the names.
Basic Read Pattern
jsconst { db } = require('../services/firestore');

// Read single document
const docRef = db.collection('accounts').doc(accountId);
const docSnap = await docRef.get();

if (!docSnap.exists) {
  return res.status(404).json({ error: 'account not found' });
}

const data = docSnap.data();
Basic Write Pattern
js// Create new document with generated ID
const newRef = db.collection('profiles').doc(profileId);
await newRef.set({
  field: value,
  createdAt: new Date()
});

// Update existing document
await db.collection('accounts').doc(accountId).update({
  verified: true
});

// Update nested map field (stamps)
await db.collection('profiles').doc(profileId).update({
  [`stamps.${stationId}`]: new Date()
});
Transaction Pattern (REQUIRED for profile.stamps)
jsawait db.runTransaction(async (t) => {
  const profileRef = db.collection('profiles').doc(profileId);
  const profileSnap = await t.get(profileRef);

  if (!profileSnap.exists) {
    throw Object.assign(new Error('profile not found'), { code: 'NOT_FOUND' });
  }

  const profile = profileSnap.data();

  // Check inside transaction — race condition safe
  if (profile.stamps && profile.stamps[stationId]) {
    throw Object.assign(new Error('duplicate stamp'), { code: 'DUPLICATE' });
  }

  t.update(profileRef, {
    [`stamps.${stationId}`]: new Date()
  });
});
Batch Write Pattern (multiple documents atomically)
jsconst batch = db.batch();

// Queue multiple writes
batch.set(db.collection('profiles').doc(profileId), profileData);
batch.set(db.collection('issuances').doc(issuanceId), issuanceData);
batch.update(db.collection('accounts').doc(accountId), { profileCount: newCount });

// Commit all at once
await batch.commit();
Query Pattern (when you need to find by field, not ID)
js// Find card by token
const cardSnap = await db.collection('cards')
  .where('token', '==', token)
  .limit(1)
  .get();

if (cardSnap.empty) {
  return res.status(404).json({ error: 'card not found' });
}

const cardData = cardSnap.docs[0].data();
Timestamp Rule
Always use new Date() for timestamps — NOT Date.now() or strings.
Firestore stores it as a Firestore Timestamp automatically.
Rules

NEVER reinitialize Firebase inside a route — always import from services/firestore.js
NEVER use non-transactional writes on profile.stamps — race condition
NEVER read inside a loop — batch your reads
stampEvents collection gets a write on EVERY result including failures
Use batch writes when updating 2+ documents in the same operation
Cards collection uses token as the document ID (not a generated ID)