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

const ISSUANCE_ID  = 'issuance-abc-123';
const PROFILE_ID   = 'profile-adult-001';
const PROFILE_ID2  = 'profile-kid-002';
const ACCOUNT_ID   = 'account-xyz-456';
const MANUAL_TOKEN = 'card-token-001';
const STATION_ID   = 'station-001';

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
// POST /staff/redeem
// ---------------------------------------------------------------------------

const DISPLAY_NAME = 'Test Fan';

const STAMPS_FIXTURE = {
  'station-001': { toDate: () => new Date('2025-01-01T12:00:00.000Z') },
  'station-002': { toDate: () => new Date('2025-01-01T13:00:00.000Z') },
  'station-003': { toDate: () => new Date('2025-01-01T14:00:00.000Z') },
};

function makeRedeemMocks({
  tokenExists          = true,
  cardActive           = true,
  profileExists        = true,
  profileRedeemed      = false,
  totalStations        = 3,
  stamps               = STAMPS_FIXTURE,
  txProfileRedeemed    = false,
  runTransactionThrows = false,
  firestoreThrows      = false,
} = {}) {
  const cardData = {
    profileId:  PROFILE_ID,
    accountId:  ACCOUNT_ID,
    active:     cardActive,
  };

  const profileData = {
    displayName: DISPLAY_NAME,
    redeemed:    profileRedeemed,
    stamps,
  };

  // profileRef stub — returned whenever collection('profiles').doc(PROFILE_ID) is called
  const profileRef = {};

  const txMock = {
    get:    jest.fn().mockResolvedValue({ data: () => ({ redeemed: txProfileRedeemed }) }),
    update: jest.fn(),
  };

  if (runTransactionThrows) {
    db.runTransaction = jest.fn().mockRejectedValue(new Error('Firestore transaction failed'));
  } else {
    db.runTransaction = jest.fn().mockImplementation(async (fn) => fn(txMock));
  }

  db.collection.mockImplementation((collectionName) => {
    if (collectionName === 'cards') {
      return {
        doc: jest.fn().mockReturnValue({
          get: firestoreThrows
            ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
            : jest.fn().mockResolvedValue({
                exists: tokenExists,
                data:   () => cardData,
              }),
        }),
      };
    }

    if (collectionName === 'profiles') {
      return {
        doc: jest.fn().mockReturnValue(
          Object.assign(profileRef, {
            get: jest.fn().mockResolvedValue({
              exists: profileExists,
              data:   () => profileData,
            }),
          })
        ),
      };
    }

    if (collectionName === 'stations') {
      return {
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ size: totalStations }),
        }),
      };
    }

    if (collectionName === 'accounts') {
      return {
        doc: jest.fn().mockReturnValue({}),
      };
    }

    return { doc: jest.fn().mockReturnValue({}) };
  });

  return txMock;
}

describe('POST /staff/redeem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 { redeemed: true, displayName, stamps } when all conditions pass', async () => {
      makeRedeemMocks();

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        redeemed:    true,
        displayName: DISPLAY_NAME,
      });
      expect(res.body).toHaveProperty('stamps');
    });

    it('stamps values in response are ISO strings, not raw Timestamp objects', async () => {
      makeRedeemMocks();

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(200);
      for (const value of Object.values(res.body.stamps)) {
        expect(typeof value).toBe('string');
        expect(() => new Date(value)).not.toThrow();
        expect(new Date(value).toISOString()).toBe(value);
      }
    });

    it('transaction updates profiles with { redeemed: true, redeemedAt: Date }', async () => {
      const txMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      const profileUpdateCall = txMock.update.mock.calls.find(
        ([, data]) => data.redeemed === true
      );
      expect(profileUpdateCall).toBeDefined();
      expect(profileUpdateCall[1]).toMatchObject({
        redeemed:    true,
        redeemedAt:  expect.any(Date),
      });
    });

    it('transaction updates cards with { active: false, returnedAt: Date }', async () => {
      const txMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      const cardUpdateCall = txMock.update.mock.calls.find(
        ([, data]) => data.active === false
      );
      expect(cardUpdateCall).toBeDefined();
      expect(cardUpdateCall[1]).toMatchObject({
        active:     false,
        returnedAt: expect.any(Date),
      });
    });

    it('transaction updates accounts with { activeCardCount: { _increment: -1 } }', async () => {
      const txMock = makeRedeemMocks();

      await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      const accountUpdateCall = txMock.update.mock.calls.find(
        ([, data]) => data.activeCardCount !== undefined
      );
      expect(accountUpdateCall).toBeDefined();
      expect(accountUpdateCall[1]).toEqual({
        activeCardCount: { _increment: -1 },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Guard failures (one test per guard clause)
  // -------------------------------------------------------------------------

  describe('guard failures', () => {
    it('returns 400 "token is required" when token is missing', async () => {
      const res = await request(app)
        .post('/staff/redeem')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'token is required' });
    });

    it('returns 400 "token is required" when token is not a string', async () => {
      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: 123 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'token is required' });
    });

    it('returns 404 "card not found" when card doc does not exist', async () => {
      makeRedeemMocks({ tokenExists: false });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'card not found' });
    });

    it('returns 400 "card already inactive" when card.active is false', async () => {
      makeRedeemMocks({ cardActive: false });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'card already inactive' });
    });

    it('returns 404 "profile not found" when profile doc does not exist', async () => {
      makeRedeemMocks({ profileExists: false });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'profile not found' });
    });

    it('returns 400 "already redeemed" when profile.redeemed is true', async () => {
      makeRedeemMocks({ profileRedeemed: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'already redeemed' });
    });

    it('returns 400 "stamp card incomplete" with missing: 2 when completedCount=1 and totalStations=3', async () => {
      makeRedeemMocks({
        totalStations: 3,
        stamps:        { 'station-001': { toDate: () => new Date('2025-01-01T12:00:00.000Z') } },
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'stamp card incomplete', missing: 2 });
    });

    it('returns 400 "stamp card incomplete" with missing: 1 when completedCount=2 and totalStations=3 (boundary)', async () => {
      makeRedeemMocks({
        totalStations: 3,
        stamps: {
          'station-001': { toDate: () => new Date('2025-01-01T12:00:00.000Z') },
          'station-002': { toDate: () => new Date('2025-01-01T13:00:00.000Z') },
        },
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'stamp card incomplete', missing: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns 400 "already redeemed" when transaction re-read detects concurrent redemption', async () => {
      makeRedeemMocks({ txProfileRedeemed: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'already redeemed' });
    });

    it('returns 500 "server error" when db.runTransaction throws an unexpected error', async () => {
      makeRedeemMocks({ runTransactionThrows: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });

    it('returns 500 and does not leak stack trace or message when Firestore read throws before transaction', async () => {
      makeRedeemMocks({ firestoreThrows: true });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('message');
    });

    it('returns 200 when completedCount equals totalStations (missing would be 0, guard passes)', async () => {
      makeRedeemMocks({
        totalStations: 3,
        stamps:        STAMPS_FIXTURE,   // 3 stamps, 3 stations — exactly complete
      });

      const res = await request(app)
        .post('/staff/redeem')
        .send({ token: MANUAL_TOKEN });

      expect(res.status).toBe(200);
      expect(res.body.redeemed).toBe(true);
    });
  });
});
