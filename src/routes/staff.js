const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db, admin } = require('../services/firestore');
const staffAuth = require('../middleware/auth');

// Auth applied once — protects all staff routes
router.use(staffAuth);

router.post('/issueCard', async (req, res) => {
  try {
    // ── RECEIVE ────────────────────────────────────────────
    const { issuanceId, profileId } = req.body;

    // ── GUARD ──────────────────────────────────────────────
    if (!issuanceId || typeof issuanceId !== 'string') {
      return res.status(400).json({ error: 'issuanceId is required' });
    }
    if (!profileId || typeof profileId !== 'string') {
      return res.status(400).json({ error: 'profileId is required' });
    }

    const issuanceSnap = await db.collection('issuances').doc(issuanceId).get();
    if (!issuanceSnap.exists) {
      return res.status(404).json({ error: 'issuance not found' });
    }
    const issuance = issuanceSnap.data();

    if (issuance.expiresAt.toDate() < new Date()) {
      return res.status(400).json({ error: 'issuance expired' });
    }

    if (issuance.used === true) {
      return res.status(400).json({ error: 'issuance already used' });
    }

    if (!Array.isArray(issuance.profileIds) || !issuance.profileIds.includes(profileId)) {
      return res.status(400).json({ error: 'profile not in this issuance' });
    }

    // Query all existing cards for this issuance's profiles.
    // Result is reused in EXECUTE to determine if this is the last card.
    // FIRESTORE INDEX: single-field index on cards.profileId (auto-created by Firestore).
    // Verify in Firebase console on first deploy.
    const existingCardsSnap = await db.collection('cards')
      .where('profileId', 'in', issuance.profileIds)
      .get();

    const alreadyIssued = existingCardsSnap.docs.some(
      (doc) => doc.data().profileId === profileId
    );
    if (alreadyIssued) {
      return res.status(400).json({ error: 'card already issued' });
    }

    const accountSnap = await db.collection('accounts').doc(issuance.accountId).get();
    if (!accountSnap.exists) {
      return res.status(404).json({ error: 'account not found' });
    }
    const account = accountSnap.data();

    if (account.activeCardCount >= 4) {
      return res.status(400).json({ error: 'card limit reached' });
    }

    // ── EXECUTE ────────────────────────────────────────────
    const token = uuidv4();
    const now = new Date();

    const batch = db.batch();

    batch.set(db.collection('cards').doc(token), {
      token,
      accountId: issuance.accountId,
      profileId,
      active: true,
      issuedAt: now,
      returnedAt: null,
    });

    batch.update(db.collection('accounts').doc(issuance.accountId), {
      activeCardCount: admin.firestore.FieldValue.increment(1),
    });

    // If this is the last card to be issued, mark the issuance as used.
    // NOTE: race condition possible if two staff clients issue the last two cards
    // simultaneously — both read existingCardsSnap before either commits.
    // Acceptable for serial staff NFC-writing flow.
    const willBeFullyIssued = (existingCardsSnap.size + 1) === issuance.profileIds.length;
    if (willBeFullyIssued) {
      batch.update(db.collection('issuances').doc(issuanceId), { used: true });
    }

    await batch.commit();

    const tokenUrl = `${process.env.TAP_BASE_URL || 'https://tap.domain.com'}/t/${token}`;

    // ── RETURN ──────────────────────────────────────────────
    return res.status(200).json({ tokenUrl });

  } catch (err) {
    console.error('[POST /staff/issueCard] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

router.post('/redeem', async (req, res) => {
  try {
    // ── RECEIVE ────────────────────────────────────────────
    const { token } = req.body;

    // ── GUARD ──────────────────────────────────────────────
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }

    const cardSnap = await db.collection('cards').doc(token).get();
    if (!cardSnap.exists) {
      return res.status(404).json({ error: 'card not found' });
    }
    const card = cardSnap.data();

    if (card.active === false) {
      return res.status(400).json({ error: 'card already inactive' });
    }

    const profileSnap = await db.collection('profiles').doc(card.profileId).get();
    if (!profileSnap.exists) {
      return res.status(404).json({ error: 'profile not found' });
    }
    const profile = profileSnap.data();

    if (profile.redeemed === true) {
      return res.status(400).json({ error: 'already redeemed' });
    }

    const stationsSnap = await db.collection('stations').get();
    const totalStations = stationsSnap.size;
    const completedCount = Object.keys(profile.stamps || {}).length;
    if (completedCount < totalStations) {
      return res.status(400).json({ error: 'stamp card incomplete', missing: totalStations - completedCount });
    }

    // ── EXECUTE ────────────────────────────────────────────
    const now = new Date();

    const batch = db.batch();

    batch.update(db.collection('profiles').doc(card.profileId), { redeemed: true, redeemedAt: now });
    batch.update(db.collection('cards').doc(token), { active: false, returnedAt: now });
    batch.update(db.collection('accounts').doc(card.accountId), {
      activeCardCount: admin.firestore.FieldValue.increment(-1),
    });

    await batch.commit();

    // ── RETURN ──────────────────────────────────────────────
    return res.status(200).json({ redeemed: true, displayName: profile.displayName, stamps: profile.stamps });

  } catch (err) {
    console.error('[POST /staff/redeem] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

router.post('/manualStamp', async (req, res) => {
  try {
    // ── RECEIVE ────────────────────────────────────────────
    const { token, stationId } = req.body;

    // ── GUARD ──────────────────────────────────────────────
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }
    if (!stationId || typeof stationId !== 'string') {
      return res.status(400).json({ error: 'stationId is required' });
    }

    const cardSnap = await db.collection('cards').doc(token).get();
    if (!cardSnap.exists) {
      return res.status(404).json({ error: 'card not found' });
    }
    const card = cardSnap.data();

    if (card.active === false) {
      return res.status(400).json({ error: 'card not active' });
    }

    const profileSnap = await db.collection('profiles').doc(card.profileId).get();
    if (!profileSnap.exists) {
      return res.status(404).json({ error: 'profile not found' });
    }
    const profile = profileSnap.data();

    if (profile.redeemed === true) {
      return res.status(400).json({ error: 'already redeemed' });
    }

    const stationSnap = await db.collection('stations').doc(stationId).get();
    if (!stationSnap.exists) {
      return res.status(404).json({ error: 'station not found' });
    }

    if (profile.stamps && profile.stamps[stationId]) {
      return res.status(400).json({ error: 'duplicate stamp' });
    }

    // ── EXECUTE ────────────────────────────────────────────
    const now = new Date();
    const stampEventId = uuidv4();

    const batch = db.batch();

    batch.update(db.collection('profiles').doc(card.profileId), {
      [`stamps.${stationId}`]: now,
    });

    batch.set(db.collection('stampEvents').doc(stampEventId), {
      stampEventId,
      profileId: card.profileId,
      stationId,
      token,
      result: 'success',
      deviceId: 'manual',
      ts: now,
    });

    await batch.commit();

    // ── RETURN ──────────────────────────────────────────────
    const updatedStamps = { ...(profile.stamps || {}), [stationId]: now };
    const normalizedStamps = {};
    for (const [key, value] of Object.entries(updatedStamps)) {
      normalizedStamps[key] = value && value.toDate
        ? value.toDate().toISOString()
        : new Date(value).toISOString();
    }

    return res.status(200).json({ ok: true, stamps: normalizedStamps });

  } catch (err) {
    console.error('[POST /staff/manualStamp] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
