const router = require('express').Router();
const { db } = require('../services/firestore');

// GET /t/:token
// TODO: add IP rate limiting
router.get('/:token', async (req, res) => {

  // ── RECEIVE ────────────────────────────────────────────
  const { token } = req.params;

  // ── GUARD ──────────────────────────────────────────────
  try {
    const cardSnap = await db.collection('cards').doc(token).get();
    if (!cardSnap.exists) {
      return res.status(404).json({ error: 'token not found' });
    }
    const cardData = cardSnap.data();

    if (cardData.active === false) {
      return res.status(400).json({ error: 'card inactive' });
    }

    const profileSnap = await db.collection('profiles').doc(cardData.profileId).get();
    if (!profileSnap.exists) {
      return res.status(404).json({ error: 'profile not found' });
    }
    const profileData = profileSnap.data();

    // ── EXECUTE ────────────────────────────────────────────
    const stationsSnap = await db.collection('stations').get();
    const totalStations = stationsSnap.size;

    const completedCount = Object.keys(profileData.stamps).length;

    // ── RETURN ──────────────────────────────────────────
    return res.status(200).json({
      displayName: profileData.displayName,
      stamps: profileData.stamps,
      redeemed: profileData.redeemed,
      totalStations,
      completed: completedCount,
    });

  } catch (err) {
    console.error('[GET /t/:token] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
