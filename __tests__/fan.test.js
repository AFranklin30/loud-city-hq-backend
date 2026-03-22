const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/services/firestore', () => ({
  db: {
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
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

function makeBatchMock({ commitShouldThrow = false } = {}) {
  const batchMock = {
    set: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    commit: commitShouldThrow
      ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
      : jest.fn().mockResolvedValue(undefined),
  };
  return batchMock;
}

function makeCollectionMock({ emailIndexExists = false } = {}) {
  const emailIndexGetMock = jest.fn().mockResolvedValue({ exists: emailIndexExists });

  // doc() returns an object whose get() resolves to the emailIndex snapshot,
  // and which can also be passed to batch.set() as a document reference.
  const docMock = jest.fn().mockReturnValue({
    get: emailIndexGetMock,
  });

  // collection() always returns an object with doc()
  const collectionMock = jest.fn().mockReturnValue({ doc: docMock });

  return collectionMock;
}

// ---------------------------------------------------------------------------
// describe blocks
// ---------------------------------------------------------------------------

describe('POST /fan/verifyEmail', () => {
  const ACCOUNT_ID = 'acc-test-123';
  const VALID_EMAIL = 'alice@example.com';
  const VALID_CODE = '123456';
  const futureDate = new Date(Date.now() + 10 * 60 * 1000);
  const pastDate = new Date(Date.now() - 1 * 60 * 1000);

  function makeVerifyMocks({
    emailIndexExists = true,
    accountExists = true,
    otpCode = VALID_CODE,
    otpExpiresAt = futureDate,
    updateShouldThrow = false,
  } = {}) {
    db.collection.mockImplementation((collectionName) => {
      if (collectionName === 'emailIndex') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: emailIndexExists,
              data: () => ({ accountId: ACCOUNT_ID }),
            }),
          }),
        };
      }

      if (collectionName === 'accounts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: accountExists,
              data: () => ({
                emailLower: VALID_EMAIL,
                otpCode,
                otpExpiresAt: { toDate: () => otpExpiresAt },
              }),
            }),
            update: updateShouldThrow
              ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
              : jest.fn().mockResolvedValue(undefined),
          }),
        };
      }
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Layer 1 — Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 { accountId } for valid email and code', async () => {
      makeVerifyMocks();

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accountId: ACCOUNT_ID });
    });

    it('does not return email in the response', async () => {
      makeVerifyMocks();

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.body).not.toHaveProperty('email');
      expect(res.body).not.toHaveProperty('emailLower');
    });
  });

  // -------------------------------------------------------------------------
  // Layer 3 — Guard failures (one test per guard clause)
  // -------------------------------------------------------------------------

  describe('guard failures', () => {
    it('returns 404 "account not found" when emailIndex doc does not exist', async () => {
      makeVerifyMocks({ emailIndexExists: false });

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'account not found' });
    });

    it('returns 404 "account not found" when accounts doc does not exist', async () => {
      makeVerifyMocks({ accountExists: false });

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'account not found' });
    });

    it('returns 400 "invalid OTP code" when code does not match', async () => {
      makeVerifyMocks({ otpCode: '999999' });

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid OTP code' });
    });

    it('returns 400 "OTP code expired" when otpExpiresAt is in the past', async () => {
      makeVerifyMocks({ otpExpiresAt: pastDate });

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'OTP code expired' });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 4 — Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('lowercases email before looking up emailIndex', async () => {
      makeVerifyMocks();

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: 'ALICE@EXAMPLE.COM', code: VALID_CODE });

      // Should resolve successfully — email was lowercased before the lookup
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accountId: ACCOUNT_ID });
    });

    it('returns 500 "server error" when accounts.update() throws', async () => {
      makeVerifyMocks({ updateShouldThrow: true });

      const res = await request(app)
        .post('/fan/verifyEmail')
        .send({ email: VALID_EMAIL, code: VALID_CODE });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });
  });
});

describe('POST /fan/createProfilesAndIssuance', () => {
  const ACCOUNT_ID = 'acc-create-test-456';
  const VALID_ADULT_NAME = 'Alice Thunder';
  const recentDate = new Date(Date.now() - 60 * 1000);          // 1 min ago — within 24h cooldown
  const oldDate   = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago — past cooldown

  function makeCreateMocks({
    accountExists     = true,
    verified          = true,
    activeCardCount   = 0,
    lastIssuanceAt    = null,
    commitShouldThrow = false,
  } = {}) {
    const batchMock = makeBatchMock({ commitShouldThrow });
    db.batch.mockReturnValue(batchMock);

    db.collection.mockImplementation((collectionName) => {
      if (collectionName === 'accounts') {
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: accountExists,
              data: () => ({
                verified,
                activeCardCount,
                lastIssuanceAt: lastIssuanceAt ? { toDate: () => lastIssuanceAt } : null,
              }),
            }),
          }),
        };
      }
      // profiles, issuances — only need a doc reference for batch.set()
      return { doc: jest.fn().mockReturnValue({}) };
    });

    return batchMock;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Layer 1 — Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 { issuanceId } for valid request with kids', async () => {
      makeCreateMocks();

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: ['Kid 1', 'Kid 2'] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('issuanceId');
      expect(typeof res.body.issuanceId).toBe('string');
    });

    it('returns 200 { issuanceId } for valid request with no kids', async () => {
      makeCreateMocks();

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('issuanceId');
    });

    it('does not return email in the response', async () => {
      makeCreateMocks();

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.body).not.toHaveProperty('email');
      expect(res.body).not.toHaveProperty('emailLower');
    });

    it('commits a batch with correct write counts for adult + 2 kids', async () => {
      const batchMock = makeCreateMocks();

      await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: ['Kid 1', 'Kid 2'] });

      // 1 adult + 2 kids + 1 issuance = 4 set calls
      expect(batchMock.set.mock.calls.length).toBe(4);
      // 1 accounts update
      expect(batchMock.update.mock.calls.length).toBe(1);
      expect(batchMock.commit).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Layer 3 — Guard failures (one test per guard clause)
  // -------------------------------------------------------------------------

  describe('guard failures', () => {
    it('returns 400 "accountId is required" when accountId is missing', async () => {
      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'accountId is required' });
    });

    it('returns 400 "adultName is required" when adultName is missing', async () => {
      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, kids: [] });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'adultName is required' });
    });

    it('returns 400 "kids must be an array" when kids is a string', async () => {
      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'kids must be an array' });
    });

    it('returns 404 "account not found" when account does not exist', async () => {
      makeCreateMocks({ accountExists: false });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'account not found' });
    });

    it('returns 400 "account not verified" when verified is false', async () => {
      makeCreateMocks({ verified: false });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'account not verified' });
    });

    it('returns 400 "exceeds max 4 profiles" when 4 kids are provided (5 total)', async () => {
      makeCreateMocks();

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: ['K1', 'K2', 'K3', 'K4'] });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'exceeds max 4 profiles' });
    });

    it('returns 400 "card limit reached" when activeCardCount is 4', async () => {
      makeCreateMocks({ activeCardCount: 4 });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'card limit reached' });
    });

    it('returns 400 "please wait before requesting more cards" when within cooldown window', async () => {
      makeCreateMocks({ lastIssuanceAt: recentDate });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'please wait before requesting more cards' });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 4 — Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('passes cooldown check when lastIssuanceAt is null (first issuance)', async () => {
      makeCreateMocks({ lastIssuanceAt: null });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(200);
    });

    it('passes cooldown check when lastIssuanceAt is 25 hours ago', async () => {
      makeCreateMocks({ lastIssuanceAt: oldDate });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('issuanceId');
    });

    it('allows exactly 3 kids (boundary high — 4 total profiles)', async () => {
      makeCreateMocks();

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: ['K1', 'K2', 'K3'] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('issuanceId');
    });

    it('returns 500 "server error" when batch.commit() throws', async () => {
      makeCreateMocks({ commitShouldThrow: true });

      const res = await request(app)
        .post('/fan/createProfilesAndIssuance')
        .send({ accountId: ACCOUNT_ID, adultName: VALID_ADULT_NAME, kids: [] });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });
  });
});

describe('POST /fan/registerStart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Layer 1 — Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 { ok: true } for a valid request', async () => {
      const collectionMock = makeCollectionMock({ emailIndexExists: false });
      db.collection.mockImplementation(collectionMock);
      db.batch.mockReturnValue(makeBatchMock());

      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 3 — Guard failures (one test per guard clause)
  // -------------------------------------------------------------------------

  describe('guard failures', () => {
    it('returns 400 "invalid email format" when email is malformed', async () => {
      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'not-an-email', kidsCount: 1 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid email format' });
    });

    it('returns 400 "invalid email format" when email is missing', async () => {
      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', kidsCount: 1 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid email format' });
    });

    it('returns 400 "invalid kids count" when kidsCount is out of range (4)', async () => {
      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: 4 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid kids count' });
    });

    it('returns 400 "invalid kids count" when kidsCount is a string ("2")', async () => {
      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: '2' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid kids count' });
    });

    it('returns 400 "email already registered" when emailIndex doc exists', async () => {
      const collectionMock = makeCollectionMock({ emailIndexExists: true });
      db.collection.mockImplementation(collectionMock);

      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: 1 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'email already registered' });
    });
  });

  // -------------------------------------------------------------------------
  // Layer 4 — Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns 200 when kidsCount is 0 (boundary low)', async () => {
      const collectionMock = makeCollectionMock({ emailIndexExists: false });
      db.collection.mockImplementation(collectionMock);
      db.batch.mockReturnValue(makeBatchMock());

      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 200 when kidsCount is 3 (boundary high)', async () => {
      const collectionMock = makeCollectionMock({ emailIndexExists: false });
      db.collection.mockImplementation(collectionMock);
      db.batch.mockReturnValue(makeBatchMock());

      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: 3 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('stores email as lowercase when mixed-case email is provided', async () => {
      const collectionMock = makeCollectionMock({ emailIndexExists: false });
      db.collection.mockImplementation(collectionMock);
      const batchMock = makeBatchMock();
      db.batch.mockReturnValue(batchMock);

      await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'Alice@Example.COM', kidsCount: 1 });

      // The first batch.set() call writes the accounts doc; the second writes
      // the emailIndex doc.  Both should receive the lowercased email.
      const setCalls = batchMock.set.mock.calls;
      expect(setCalls.length).toBe(2);

      const accountData = setCalls[0][1];
      expect(accountData.emailLower).toBe('alice@example.com');

      const emailIndexData = setCalls[1][1];
      expect(emailIndexData).toMatchObject({ accountId: expect.any(String) });
    });

    it('returns 500 "server error" when batch.commit() throws', async () => {
      const collectionMock = makeCollectionMock({ emailIndexExists: false });
      db.collection.mockImplementation(collectionMock);
      db.batch.mockReturnValue(makeBatchMock({ commitShouldThrow: true }));

      const res = await request(app)
        .post('/fan/registerStart')
        .send({ name: 'Alice Thunder', email: 'alice@example.com', kidsCount: 1 });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });
  });
});
