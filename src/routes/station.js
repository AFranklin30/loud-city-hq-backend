const router = require('express').Router();
const stationKey = require('../middleware/stationKey');

// POST /station/stamp
router.post('/stamp', stationKey, async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

module.exports = router;