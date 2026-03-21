const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/firestore');

// POST /fan/registerStart
// TODO: add IP rate limiting
router.post('/registerStart', async (req, res) => {
  try {
    const { name, email, kidsCount } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'invalid email format' });
    }

    if (!Number.isInteger(kidsCount) || kidsCount < 0 || kidsCount > 3) {
      return res.status(400).json({ error: 'invalid kids count' });
    }

    const emailLower = email.toLowerCase();

    const emailIndexDoc = await db.collection('emailIndex').doc(emailLower).get();
    if (emailIndexDoc.exists) {
      return res.status(400).json({ error: 'email already registered' });
    }

    const accountId = uuidv4();
    const now = new Date();

    const batch = db.batch();

    batch.set(db.collection('accounts').doc(accountId), {
      emailLower,
      name,
      verified: false,
      profileCount: 0,
      activeCardCount: 0,
      lastIssuanceAt: null,
      createdAt: now,
    });

    batch.set(db.collection('emailIndex').doc(emailLower), {
      accountId,
      createdAt: now,
    });

    await batch.commit();

    // TODO: replace with real OTP service
    // OTP send simulated as success

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[registerStart] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
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