const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/services/firestore', () => ({
  db: {
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
  admin: { auth: jest.fn() },
}));

const { db } = require('../src/services/firestore');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBatchMock({ commitShouldThrow = false } = {}) {
  const batchMock = {
    set: jest.fn().mockReturnThis(),
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
// describe block
// ---------------------------------------------------------------------------

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
