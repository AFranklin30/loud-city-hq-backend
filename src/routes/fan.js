const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { db, admin } = require('../services/firestore');

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // TODO: ask TPM what this should be

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
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    const batch = db.batch();

    batch.set(db.collection('accounts').doc(accountId), {
      emailLower,
      name,
      verified: false,
      profileCount: 0,
      activeCardCount: 0,
      lastIssuanceAt: null,
      createdAt: now,
      otpCode,
      otpExpiresAt,
    });

    batch.set(db.collection('emailIndex').doc(emailLower), {
      accountId,
      createdAt: now,
    });

    await batch.commit();

    // TODO: replace with nodemailer — send otpCode to email
    console.log(`[registerStart] OTP for ${emailLower}: ${otpCode}`);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[registerStart] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// POST /fan/verifyEmail
// TODO: add IP rate limiting
router.post('/verifyEmail', async (req, res) => {
  try {
    const { email, code } = req.body;

    // GUARD — cheapest checks first
    const emailLower = email ? email.toLowerCase() : null;

    const emailIndexSnap = await db.collection('emailIndex').doc(emailLower).get();
    if (!emailIndexSnap.exists) {
      return res.status(404).json({ error: 'account not found' });
    }

    const { accountId } = emailIndexSnap.data();

    const accountSnap = await db.collection('accounts').doc(accountId).get();
    if (!accountSnap.exists) {
      return res.status(404).json({ error: 'account not found' });
    }

    const account = accountSnap.data();

    if (account.otpCode !== code) {
      return res.status(400).json({ error: 'invalid OTP code' });
    }

    if (account.otpExpiresAt.toDate() < new Date()) {
      return res.status(400).json({ error: 'OTP code expired' });
    }

    // EXECUTE
    await db.collection('accounts').doc(accountId).update({ verified: true });

    // RETURN
    return res.status(200).json({ accountId });
  } catch (err) {
    console.error('[verifyEmail] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// POST /fan/createProfilesAndIssuance
// TODO: add IP rate limiting
router.post('/createProfilesAndIssuance', async (req, res) => {
  try {
    // ── RECEIVE ────────────────────────────────────────────
    const { accountId, adultName, kids } = req.body;

    // ── GUARD ──────────────────────────────────────────────
    if (!accountId || typeof accountId !== 'string') {
      return res.status(400).json({ error: 'accountId is required' });
    }
    if (!adultName || typeof adultName !== 'string') {
      return res.status(400).json({ error: 'adultName is required' });
    }
    if (!Array.isArray(kids)) {
      return res.status(400).json({ error: 'kids must be an array' });
    }

    const accountSnap = await db.collection('accounts').doc(accountId).get();
    if (!accountSnap.exists) {
      return res.status(404).json({ error: 'account not found' });
    }

    const account = accountSnap.data();

    if (account.verified === false) {
      return res.status(400).json({ error: 'account not verified' });
    }

    const totalProfiles = 1 + kids.length;
    if (totalProfiles > 4) {
      return res.status(400).json({ error: 'exceeds max 4 profiles' });
    }

    if (account.activeCardCount >= 4) {
      return res.status(400).json({ error: 'card limit reached' });
    }

    if (account.lastIssuanceAt !== null) {
      const lastIssuanceMs = account.lastIssuanceAt.toDate().getTime();
      if (Date.now() - lastIssuanceMs < COOLDOWN_MS) {
        return res.status(400).json({ error: 'please wait before requesting more cards' });
      }
    }

    // ── EXECUTE ────────────────────────────────────────────
    const now = new Date();
    const issuanceId = uuidv4();

    const profileIds = [];
    const batch = db.batch();

    // Adult profile
    const adultProfileId = uuidv4();
    profileIds.push(adultProfileId);
    batch.set(db.collection('profiles').doc(adultProfileId), {
      accountId,
      issuanceId,
      type: 'adult',
      displayName: adultName,
      stamps: {},
      redeemed: false,
      redeemedAt: null,
      createdAt: now,
    });

    // Kid profiles
    for (const nickname of kids) {
      const kidProfileId = uuidv4();
      profileIds.push(kidProfileId);
      batch.set(db.collection('profiles').doc(kidProfileId), {
        accountId,
        issuanceId,
        type: 'kid',
        displayName: nickname,
        stamps: {},
        redeemed: false,
        redeemedAt: null,
        createdAt: now,
      });
    }

    // Issuance
    batch.set(db.collection('issuances').doc(issuanceId), {
      accountId,
      profileIds,
      profileCount: totalProfiles,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      used: false,
      createdAt: now,
    });

    // Account update
    batch.update(db.collection('accounts').doc(accountId), {
      profileCount: admin.firestore.FieldValue.increment(totalProfiles),
      lastIssuanceAt: now,
    });

    await batch.commit();

    // ── RETURN ──────────────────────────────────────────────
    return res.status(200).json({ issuanceId });

  } catch (err) {
    console.error('[POST /fan/createProfilesAndIssuance] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// GET /fan/issuance/:issuanceId
router.get('/issuance/:issuanceId', async (req, res) => {
  try {
    // ── RECEIVE ──────────────────────────────────────────────
    const { issuanceId } = req.params;

    // ── GUARD ────────────────────────────────────────────────
    if (!issuanceId) {
      return res.status(400).json({ error: 'issuanceId is required' });
    }

    const issuanceSnap = await db.collection('issuances').doc(issuanceId).get();
    if (!issuanceSnap.exists) {
      return res.status(404).json({ error: 'issuance not found' });
    }

    const issuance = issuanceSnap.data();

    // ── EXECUTE ──────────────────────────────────────────────
    // FIRESTORE INDEX REQUIRED
    // Collection: profiles
    // Field: issuanceId (Ascending)
    // This query will fail without a composite index.
    // Index has been created in Firebase console.
    // If deploying to a new Firebase project,
    // create this index before testing:
    // Firebase console > Firestore > Indexes > Composite > Add index
    const profilesSnap = await db.collection('profiles')
      .where('issuanceId', '==', issuanceId)
      .get();

    const profiles = profilesSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        profileId: doc.id,
        displayName: data.displayName,
        type: data.type,
      };
    });

    // ── RETURN ───────────────────────────────────────────────
    return res.status(200).json({
      issuanceId,
      status: issuance.used ? 'used' : 'pending',
      expiresAt: issuance.expiresAt.toDate().toISOString(),
      profileCount: issuance.profileCount,
      profiles,
    });

  } catch (err) {
    console.error('[GET /fan/issuance/:issuanceId] error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;