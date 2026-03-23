const request = require('supertest');
const app = require('../src/app');

// Bypass staffAuth middleware — auth is tested at the middleware level, not here
jest.mock('../src/middleware/auth', () => (req, res, next) => next());

jest.mock('../src/services/firestore', () => ({
  db: {
    collection: jest.fn(),
    batch: jest.fn(),
  },
  admin: {
    auth: jest.fn(),
    firestore: {
      FieldValue: {
        increment: jest.fn((n) => ({ _increment: n })),
      },
    },
  },
}));

const { db } = require('../src/services/firestore');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISSUANCE_ID = 'issuance-abc-123';
const PROFILE_ID  = 'profile-adult-001';
const PROFILE_ID2 = 'profile-kid-002';
const ACCOUNT_ID  = 'account-xyz-456';

function makeBatchMock({ commitShouldThrow = false } = {}) {
  return {
    set:    jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    commit: commitShouldThrow
      ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
      : jest.fn().mockResolvedValue(undefined),
  };
}

function makeIssueMocks({
  issuanceExists        = true,
  issuanceExpired       = false,
  issuanceUsed          = false,
  profileIds            = [PROFILE_ID, PROFILE_ID2],
  existingCardProfileIds = [],   // profileIds that already have a card
  accountExists         = true,
  activeCardCount       = 0,
  commitShouldThrow     = false,
  firestoreThrows       = false,
} = {}) {
  const expiresAt = issuanceExpired
    ? new Date(Date.now() - 60 * 1000)          // 1 min ago — expired
    : new Date(Date.now() + 30 * 60 * 1000);    // 30 min from now — valid

  const batchMock = makeBatchMock({ commitShouldThrow });
  db.batch.mockReturnValue(batchMock);

  const cardDocs = existingCardProfileIds.map((pid) => ({
    data: () => ({ profileId: pid }),
  }));

  db.collection.mockImplementation((collectionName) => {
    if (collectionName === 'issuances') {
      return {
        doc: jest.fn().mockReturnValue({
          get: firestoreThrows
            ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
            : jest.fn().mockResolvedValue({
                exists: issuanceExists,
                data: () => ({
                  accountId:  ACCOUNT_ID,
                  profileIds,
                  used:       issuanceUsed,
                  expiresAt:  { toDate: () => expiresAt },
                }),
              }),
        }),
      };
    }

    if (collectionName === 'cards') {
      return {
        doc:   jest.fn().mockReturnValue({}),    // ref for batch.set
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            docs: cardDocs,
            size: cardDocs.length,
          }),
        }),
      };
    }

    if (collectionName === 'accounts') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: accountExists,
            data:   () => ({ activeCardCount }),
          }),
        }),
      };
    }

    return { doc: jest.fn().mockReturnValue({}) };
  });

  return batchMock;
}

// ---------------------------------------------------------------------------
// describe block
// ---------------------------------------------------------------------------

describe('POST /staff/issueCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Layer 1 — Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 { tokenUrl } for a valid single-profile issuance', async () => {
      makeIssueMocks({ profileIds: [PROFILE_ID], existingCardProfileIds: [] });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tokenUrl');
      expect(typeof res.body.tokenUrl).toBe('string');
    });

    it('tokenUrl contains the generated token as the last path segment', async () => {
      makeIssueMocks({ profileIds: [PROFILE_ID], existingCardProfileIds: [] });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(200);
      // tokenUrl must end with /t/<uuid>
      expect(res.body.tokenUrl).toMatch(/\/t\/[0-9a-f-]{36}$/);
    });

    it('marks issuance as used when this is the last profile to be issued', async () => {
      // 2 profiles, 1 already has a card — this call issues the last one
      const batchMock = makeIssueMocks({
        profileIds:             [PROFILE_ID, PROFILE_ID2],
        existingCardProfileIds: [PROFILE_ID2],
      });

      await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      // batch.update called twice: accounts (activeCardCount) + issuances (used=true)
      expect(batchMock.update.mock.calls.length).toBe(2);
      const issuancesUpdateArg = batchMock.update.mock.calls[1][1];
      expect(issuancesUpdateArg).toEqual({ used: true });
    });

    it('does NOT mark issuance as used when more profiles still need cards', async () => {
      // 2 profiles, none has a card yet — this call issues the first one
      const batchMock = makeIssueMocks({
        profileIds:             [PROFILE_ID, PROFILE_ID2],
        existingCardProfileIds: [],
      });

      await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      // batch.update called once: only accounts (activeCardCount)
      expect(batchMock.update.mock.calls.length).toBe(1);
    });

    it('commits a batch with a set (cards) and an update (accounts)', async () => {
      const batchMock = makeIssueMocks({
        profileIds:             [PROFILE_ID],
        existingCardProfileIds: [],
      });

      await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(batchMock.set.mock.calls.length).toBe(1);
      expect(batchMock.update.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(batchMock.commit).toHaveBeenCalled();
    });

    it('card document contains all required fields', async () => {
      const batchMock = makeIssueMocks({
        profileIds:             [PROFILE_ID],
        existingCardProfileIds: [],
      });

      await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      const cardData = batchMock.set.mock.calls[0][1];
      expect(cardData).toMatchObject({
        token:      expect.any(String),
        accountId:  ACCOUNT_ID,
        profileId:  PROFILE_ID,
        active:     true,
        issuedAt:   expect.any(Date),
        returnedAt: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 3 — Guard failures (one test per guard clause)
  // -------------------------------------------------------------------------

  describe('guard failures', () => {
    it('returns 400 "issuanceId is required" when issuanceId is missing', async () => {
      const res = await request(app)
        .post('/staff/issueCard')
        .send({ profileId: PROFILE_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'issuanceId is required' });
    });

    it('returns 400 "profileId is required" when profileId is missing', async () => {
      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'profileId is required' });
    });

    it('returns 404 "issuance not found" when issuance doc does not exist', async () => {
      makeIssueMocks({ issuanceExists: false });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'issuance not found' });
    });

    it('returns 400 "issuance expired" when expiresAt is in the past', async () => {
      makeIssueMocks({ issuanceExpired: true });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'issuance expired' });
    });

    it('returns 400 "issuance already used" when issuance.used is true', async () => {
      makeIssueMocks({ issuanceUsed: true });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'issuance already used' });
    });

    it('returns 400 "profile not in this issuance" when profileId is not in profileIds', async () => {
      makeIssueMocks({ profileIds: [PROFILE_ID2] });   // only profile-2 in issuance

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });  // profile-1 not in list

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'profile not in this issuance' });
    });

    it('returns 400 "card already issued" when a card exists for this profileId', async () => {
      makeIssueMocks({
        profileIds:             [PROFILE_ID, PROFILE_ID2],
        existingCardProfileIds: [PROFILE_ID],    // this profile already has a card
      });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'card already issued' });
    });

    it('returns 404 "account not found" when issuance exists but accounts doc does not', async () => {
      makeIssueMocks({ accountExists: false });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'account not found' });
    });

    it('returns 400 "card limit reached" when activeCardCount is 4', async () => {
      makeIssueMocks({ activeCardCount: 4 });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'card limit reached' });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 4 — Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns 500 "server error" when batch.commit() throws', async () => {
      makeIssueMocks({
        profileIds:         [PROFILE_ID],
        commitShouldThrow:  true,
      });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });

    it('returns 500 "server error" and does not leak stack trace when Firestore throws', async () => {
      makeIssueMocks({ firestoreThrows: true });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('message');
    });

    it('activeCardCount of 3 passes the card limit guard (boundary)', async () => {
      makeIssueMocks({
        activeCardCount:        3,
        profileIds:             [PROFILE_ID],
        existingCardProfileIds: [],
      });

      const res = await request(app)
        .post('/staff/issueCard')
        .send({ issuanceId: ISSUANCE_ID, profileId: PROFILE_ID });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tokenUrl');
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers — redeem
// ---------------------------------------------------------------------------

const TOKEN = 'test-token-uuid-001';

// Sentinel used to distinguish "caller explicitly passed undefined stamps"
// from "caller did not pass stamps at all", since JS destructuring defaults
// replace undefined with the default value.
const STAMPS_UNDEFINED = Symbol('STAMPS_UNDEFINED');

function makeRedeemMocks({
  cardExists        = true,
  cardActive        = true,
  profileExists     = true,
  profileRedeemed   = false,
  stamps            = { 'station-1': new Date(), 'station-2': new Date() },
  displayName       = 'Test Fan',
  totalStations     = 2,
  commitShouldThrow = false,
  firestoreThrows   = false,
} = {}) {
  // Resolve the actual stamps value — sentinel means the profile has no stamps field
  const resolvedStamps = stamps === STAMPS_UNDEFINED ? undefined : stamps;

  const batchMock = makeBatchMock({ commitShouldThrow });
  db.batch.mockReturnValue(batchMock);

  db.collection.mockImplementation((collectionName) => {
    if (collectionName === 'cards') {
      return {
        doc: jest.fn().mockReturnValue({
          get: firestoreThrows
            ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
            : jest.fn().mockResolvedValue({
                exists: cardExists,
                data: () => ({ active: cardActive, profileId: PROFILE_ID, accountId: ACCOUNT_ID }),
              }),
        }),
      };
    }

    if (collectionName === 'profiles') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: profileExists,
            data: () => ({ redeemed: profileRedeemed, stamps: resolvedStamps, displayName }),
          }),
        }),
      };
    }

    if (collectionName === 'stations') {
      return {
        get: jest.fn().mockResolvedValue({ size: totalStations }),
      };
    }

    if (collectionName === 'accounts') {
      return {
        doc: jest.fn().mockReturnValue({}),   // ref only — batch.update doesn't call get()
      };
    }

    return { doc: jest.fn().mockReturnValue({}) };
  });

  return batchMock;
}

// ---------------------------------------------------------------------------
// describe block
// ---------------------------------------------------------------------------

describe('POST /staff/redeem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Layer 1 — Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 { redeemed, displayName, stamps } for a valid fully-stamped card', async () => {
      makeRedeemMocks();

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('redeemed');
      expect(res.body).toHaveProperty('displayName');
      expect(res.body).toHaveProperty('stamps');
    });

    it('response body has redeemed: true (exact value, not truthy)', async () => {
      makeRedeemMocks();

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body.redeemed).toBe(true);
    });

    it('response body has displayName matching the profile displayName', async () => {
      makeRedeemMocks({ displayName: 'Test Fan' });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Test Fan');
    });

    it('response body has stamps object matching the profile stamps', async () => {
      const stamps = { 'station-1': 'ts1', 'station-2': 'ts2' };
      makeRedeemMocks({ stamps });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body.stamps).toEqual(stamps);
    });

    it('batch commits exactly 3 update calls (profiles, cards, accounts)', async () => {
      const batchMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(batchMock.update.mock.calls.length).toBe(3);
    });

    it('profile batch update contains redeemed: true and redeemedAt as a Date instance', async () => {
      const batchMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      // profiles update is the first batch.update call
      const profileUpdateArg = batchMock.update.mock.calls[0][1];
      expect(profileUpdateArg.redeemed).toBe(true);
      expect(profileUpdateArg.redeemedAt).toBeInstanceOf(Date);
    });

    it('card batch update contains active: false and returnedAt as a Date instance', async () => {
      const batchMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      // cards update is the second batch.update call
      const cardUpdateArg = batchMock.update.mock.calls[1][1];
      expect(cardUpdateArg.active).toBe(false);
      expect(cardUpdateArg.returnedAt).toBeInstanceOf(Date);
    });

    it('accounts batch update contains activeCardCount: { _increment: -1 }', async () => {
      const batchMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      // accounts update is the third batch.update call
      const accountsUpdateArg = batchMock.update.mock.calls[2][1];
      expect(accountsUpdateArg).toEqual({ activeCardCount: { _increment: -1 } });
    });

    it('batch.commit() is called once', async () => {
      const batchMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(batchMock.commit).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Layer 3 — Guard failures (one test per guard clause)
  // -------------------------------------------------------------------------

  describe('guard failures', () => {
    it('returns 400 "token is required" when token is missing from body', async () => {
      const res = await request(app)
        .post('/staff/redeem')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'token is required' });
    });

    it('returns 400 "token is required" when token is not a string (e.g. 123)', async () => {
      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: 123 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'token is required' });
    });

    it('returns 404 "card not found" when card does not exist', async () => {
      makeRedeemMocks({ cardExists: false });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'card not found' });
    });

    it('returns 400 "card already inactive" when card.active === false', async () => {
      makeRedeemMocks({ cardActive: false });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'card already inactive' });
    });

    it('returns 404 "profile not found" when profile does not exist', async () => {
      makeRedeemMocks({ profileExists: false });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'profile not found' });
    });

    it('returns 400 "already redeemed" when profile.redeemed === true', async () => {
      makeRedeemMocks({ profileRedeemed: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'already redeemed' });
    });

    it('returns 400 "stamp card incomplete" with missing: 1 when 1 stamp is missing', async () => {
      // completedCount=1, totalStations=2 → missing=1
      makeRedeemMocks({
        stamps:        { 'station-1': new Date() },
        totalStations: 2,
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'stamp card incomplete', missing: 1 });
    });

    it('returns 400 "stamp card incomplete" with missing: 2 when stamps is undefined', async () => {
      // profile.stamps not set → completedCount=0, totalStations=2 → missing=2
      // Use sentinel so the helper doesn't fall back to the default stamps value
      makeRedeemMocks({
        stamps:        STAMPS_UNDEFINED,
        totalStations: 2,
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'stamp card incomplete', missing: 2 });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 4 — Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns 200 when completedCount === totalStations exactly (boundary)', async () => {
      // 2 stamps, 2 stations — passes the incomplete guard
      makeRedeemMocks({
        stamps:        { 'station-1': new Date(), 'station-2': new Date() },
        totalStations: 2,
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body.redeemed).toBe(true);
    });

    it('returns 200 when profile.stamps is empty object and totalStations === 0', async () => {
      // No stations configured — 0 stamps needed, card is complete
      makeRedeemMocks({
        stamps:        {},
        totalStations: 0,
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body.redeemed).toBe(true);
    });

    it('returns 500 "server error" when batch.commit() throws', async () => {
      makeRedeemMocks({ commitShouldThrow: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });

    it('returns 500 "server error" and does not leak stack trace or message when Firestore throws on card read', async () => {
      makeRedeemMocks({ firestoreThrows: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('message');
    });

    it('response body does NOT include redeemedAt or returnedAt', async () => {
      makeRedeemMocks();

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: TOKEN });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('redeemedAt');
      expect(res.body).not.toHaveProperty('returnedAt');
    });
  });
});
