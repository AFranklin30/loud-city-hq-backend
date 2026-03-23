const { db } = require('../services/firestore');

module.exports = async function stationKeyMiddleware(req, res, next) {
  try {
    const stationKey = req.headers['x-station-key'];
    const { stationId } = req.body;

    if (!stationKey || !stationId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const stationDoc = await db
      .collection('stations')
      .doc(stationId)
      .get();

    if (!stationDoc.exists) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (stationDoc.data().apiKey !== stationKey) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.station = stationDoc.data();
    next();

  } catch (err) {
    console.error('[stationKeyMiddleware] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
};