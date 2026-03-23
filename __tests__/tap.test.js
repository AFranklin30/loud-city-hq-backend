const request = require('supertest');
const app = require('../src/app');

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

function makeTapMocks({
  cardExists = true,
  cardData = { active: true, profileId: 'profile-abc' },
  profileExists = true,
  profileData = {
    displayName: 'Alice',
    stamps: { station1: true, station2: true },
    redeemed: false,
    email: 'alice@example.com',
    emailLower: 'alice@example.com',
    accountId: 'acc-123',
  },
  stationCount = 5,
  cardShouldThrow = false,
} = {}) {
  db.collection.mockImplementation((collectionName) => {
    if (collectionName === 'cards') {
      return {
        doc: jest.fn().mockReturnValue({
          get: cardShouldThrow
            ? jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
            : jest.fn().mockResolvedValue({
                exists: cardExists,
                data: () => cardData,
              }),
        }),
      };
    }

    if (collectionName === 'profiles') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: profileExists,
            data: () => profileData,
          }),
        }),
      };
    }

    if (collectionName === 'stations') {
      return {
        get: jest.fn().mockResolvedValue({
          size: stationCount,
        }),
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /t/:token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('happy path', () => {
    it('returns 200 with the correct response shape', async () => {
      makeTapMocks();
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('displayName');
      expect(res.body).toHaveProperty('stamps');
      expect(res.body).toHaveProperty('redeemed');
      expect(res.body).toHaveProperty('totalStations');
      expect(res.body).toHaveProperty('completed');
    });

    it('returns completed equal to the number of keys in profile.stamps', async () => {
      const stamps = { station1: true, station2: true, station3: true };
      makeTapMocks({
        profileData: {
          displayName: 'Alice',
          stamps,
          redeemed: false,
        },
        stationCount: 5,
      });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(Object.keys(stamps).length);
    });

    it('returns totalStations equal to the size of the stations collection', async () => {
      makeTapMocks({ stationCount: 7 });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.totalStations).toBe(7);
    });

    it('reflects the profile redeemed value in the response', async () => {
      makeTapMocks({
        profileData: {
          displayName: 'Alice',
          stamps: { s1: true },
          redeemed: true,
        },
        stationCount: 3,
      });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.redeemed).toBe(true);
    });

    it('does not leak email or emailLower in the response', async () => {
      makeTapMocks();
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('email');
      expect(res.body).not.toHaveProperty('emailLower');
    });

    it('does not leak accountId in the response', async () => {
      makeTapMocks();
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('accountId');
    });
  });

  describe('guard failures', () => {
    it('returns 404 with error "token not found" when card does not exist', async () => {
      makeTapMocks({ cardExists: false });
      const res = await request(app).get('/t/missing-token');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'token not found' });
    });

    it('returns 400 with error "card inactive" when card active is false', async () => {
      makeTapMocks({
        cardData: { active: false, profileId: 'profile-abc' },
      });
      const res = await request(app).get('/t/inactive-token');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'card inactive' });
    });

    it('returns 404 with error "profile not found" when profile does not exist', async () => {
      makeTapMocks({ profileExists: false });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'profile not found' });
    });
  });

  describe('edge cases', () => {
    it('returns 200 with completed 0 when stamps is an empty map', async () => {
      makeTapMocks({
        profileData: {
          displayName: 'Alice',
          stamps: {},
          redeemed: false,
        },
        stationCount: 5,
      });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(0);
      expect(res.body.stamps).toEqual({});
    });

    it('returns completed 3 when stamps has 3 keys', async () => {
      makeTapMocks({
        profileData: {
          displayName: 'Alice',
          stamps: { s1: true, s2: true, s3: true },
          redeemed: false,
        },
        stationCount: 5,
      });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(3);
    });

    it('returns 200 with totalStations 0 when no stations exist in the collection', async () => {
      makeTapMocks({ stationCount: 0 });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.totalStations).toBe(0);
    });

    it('returns redeemed true when profile has redeemed: true', async () => {
      makeTapMocks({
        profileData: {
          displayName: 'Bob',
          stamps: { s1: true },
          redeemed: true,
        },
        stationCount: 4,
      });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(200);
      expect(res.body.redeemed).toBe(true);
    });

    it('returns 500 with error "server error" when Firestore throws — no stack trace leak', async () => {
      makeTapMocks({ cardShouldThrow: true });
      const res = await request(app).get('/t/some-token');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('message');
    });
  });
});
