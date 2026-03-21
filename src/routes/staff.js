const router = require('express').Router();
const staffAuth = require('../middleware/auth');

router.post('/issueCard', staffAuth, async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/redeem', staffAuth, async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/manualStamp', staffAuth, async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

module.exports = router;