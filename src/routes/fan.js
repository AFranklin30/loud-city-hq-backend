const router = require('express').Router();

// POST /fan/registerStart
router.post('/registerStart', async (req, res) => {
  // STUB — wire in your Step 5 pseudocode here
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /fan/verifyEmail
router.post('/verifyEmail', async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /fan/createProfilesAndIssuance
router.post('/createProfilesAndIssuance', async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// GET /fan/issuance/:issuanceId
router.get('/issuance/:issuanceId', async (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

module.exports = router;