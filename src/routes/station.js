const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/firestore');
const stationKey = require('../middleware/stationKey');

router.use(stationKey);

// POST /station/stamp
router.post('/stamp', async (req, res) => {
  // RECEIVE
  const { token, stationId, deviceId } = req.body;

  try {
    // GUARD

    // Read card by token
    const cardsSnapshot = await db.collection('cards').where('token', '==', token).get();

    if (cardsSnapshot.empty) {
      await db.collection('stampEvents').doc(uuidv4()).set({
        profileId: null,
        stationId,
        token,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        result: 'error',
        deviceId,
        ts: new Date(),
      });
      return res.status(200).json({ result: 'error', message: 'token not found' });
    }

    const cardDoc = cardsSnapshot.docs[0];
    const card = cardDoc.data();

    if (card.active === false) {
      await db.collection('stampEvents').doc(uuidv4()).set({
        profileId: card.profileId,
        stationId,
        token,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        result: 'inactive',
        deviceId,
        ts: new Date(),
      });
      return res.status(200).json({ result: 'inactive', message: 'card not active' });
    }

    const profileRef = db.collection('profiles').doc(card.profileId);
    const profileDoc = await profileRef.get();
    const profile = profileDoc.data();

    if (profile.redeemed === true) {
      await db.collection('stampEvents').doc(uuidv4()).set({
        profileId: card.profileId,
        stationId,
        token,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        result: 'redeemed',
        deviceId,
        ts: new Date(),
      });
      return res.status(200).json({ result: 'redeemed', message: 'profile already redeemed' });
    }

    if (profile.stamps && profile.stamps[stationId]) {
      await db.collection('stampEvents').doc(uuidv4()).set({
        profileId: card.profileId,
        stationId,
        token,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        result: 'duplicate',
        deviceId,
        ts: new Date(),
      });
      return res.status(200).json({ result: 'duplicate', message: 'duplicate stamp' });
    }

    // EXECUTE

    // Write stamp to profile using transaction
    await db.runTransaction(async (t) => {
      const freshProfileDoc = await t.get(profileRef);
      const freshProfile = freshProfileDoc.data();
      if (freshProfile.stamps?.[stationId]) {
        throw new Error('duplicate');
      }
      t.update(profileRef, {
        [`stamps.${stationId}`]: new Date(),
      });
    });

    // Write stampEvent for success
    await db.collection('stampEvents').doc(uuidv4()).set({
      profileId: card.profileId,
      stationId,
      token,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      result: 'success',
      deviceId,
      ts: new Date(),
    });

    // Calculate stampsCompletedCount
    const updatedProfileDoc = await profileRef.get();
    const updatedProfile = updatedProfileDoc.data();
    const stampsCompletedCount = Object.keys(updatedProfile.stamps || {}).length;

    // Calculate totalStations
    const activeStationsSnapshot = await db.collection('stations').where('active', '==', true).get();
    const totalStations = activeStationsSnapshot.size;

    // RETURN
    return res.status(200).json({ result: 'success', stampsCompletedCount, totalStations });
  } catch (err) {
    console.error('[POST /station/stamp] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
