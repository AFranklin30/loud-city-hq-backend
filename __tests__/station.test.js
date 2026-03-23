const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/services/firestore', () => ({
  db: {
    collection: jest.fn(),
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

const VALID_STATION_ID = 'station-001';
const VALID_API_KEY = 'secret-key-abc';
const VALID_TOKEN = 'tok-xyz';
const VALID_DEVICE_ID = 'device-001';
const VALID_PROFILE_ID = 'profile-abc';

function makeStampMocks({
  cardEmpty = false,
  cardData = { active: true, profileId: VALID_PROFILE_ID },
  profileData = { redeemed: false, stamps: {} },
  updatedProfileData = { stamps: { [VALID_STATION_ID]: new Date() } },
  totalStations = 5,
  firestoreShouldThrow = false,
  stationApiKey = VALID_API_KEY,
} = {}) {
  const stampEventSetMock = jest.fn().mockResolvedValue();

  const profileGetMock = jest.fn()
    .mockResolvedValueOnce({ data: () => profileData })  // pre-check read
    .mockResolvedValueOnce({ data: () => updatedProfileData }); // post-transaction read

  const profileRef = {
    get: profileGetMock,
  };

  db.runTransaction.mockImplementation(async (fn) => {
    const t = {
      get: jest.fn().mockResolvedValue({ data: () => profileData }),
      update: jest.fn(),
    };
    await fn(t);
  });

  db.collection.mockImplementation((collectionName) => {
    if (collectionName === 'cards') {
      if (firestoreShouldThrow) {
        return {
          where: jest.fn().mockReturnValue({
            get: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
          }),
        };
      }
      return {
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            empty: cardEmpty,
            docs: cardEmpty ? [] : [{ data: () => cardData }],
          }),
        }),
      };
    }

    if (collectionName === 'profiles') {
      return {
        doc: jest.fn().mockReturnValue(profileRef),
      };
    }

    if (collectionName === 'stampEvents') {
      return {
        doc: jest.fn().mockReturnValue({
          set: stampEventSetMock,
        }),
      };
    }

    if (collectionName === 'stations') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ apiKey: stationApiKey }),
          }),
        }),
        where: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ size: totalStations }),
        }),
      };
    }
  });

  return { stampEventSetMock };
}

function validBody(overrides = {}) {
  return {
    token: VALID_TOKEN,
    stationId: VALID_STATION_ID,
    deviceId: VALID_DEVICE_ID,
    ...overrides,
  };
}

function validRequest(bodyOverrides = {}) {
  return request(app)
    .post('/station/stamp')
    .set('x-station-key', VALID_API_KEY)
    .send(validBody(bodyOverrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /station/stamp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 with result:success, stampsCompletedCount, and totalStations', async () => {
      makeStampMocks({
        updatedProfileData: { stamps: { [VALID_STATION_ID]: new Date(), 'station-002': new Date() } },
        totalStations: 5,
      });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.result).toBe('success');
      expect(res.body).toHaveProperty('stampsCompletedCount');
      expect(res.body).toHaveProperty('totalStations');
    });

    it('stampsCompletedCount equals number of keys in updated stamps map', async () => {
      makeStampMocks({
        updatedProfileData: {
          stamps: {
            [VALID_STATION_ID]: new Date(),
            'station-002': new Date(),
            'station-003': new Date(),
          },
        },
        totalStations: 5,
      });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.stampsCompletedCount).toBe(3);
    });

    it('totalStations equals active station count', async () => {
      makeStampMocks({
        updatedProfileData: { stamps: { [VALID_STATION_ID]: new Date() } },
        totalStations: 8,
      });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.totalStations).toBe(8);
    });
  });

  // -------------------------------------------------------------------------
  // Auth failures (Layer 2)
  // -------------------------------------------------------------------------

  describe('auth failures', () => {
    it('returns 401 when X-Station-Key header is missing', async () => {
      makeStampMocks();

      const res = await request(app)
        .post('/station/stamp')
        .send(validBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    });

    it('returns 401 when stationId is missing from body', async () => {
      makeStampMocks();

      const res = await request(app)
        .post('/station/stamp')
        .set('x-station-key', VALID_API_KEY)
        .send({ token: VALID_TOKEN, deviceId: VALID_DEVICE_ID });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    });

    it('returns 401 when X-Station-Key does not match station apiKey', async () => {
      makeStampMocks({ stationApiKey: 'correct-key' });

      const res = await request(app)
        .post('/station/stamp')
        .set('x-station-key', 'wrong-key')
        .send(validBody());

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    });
  });

  // -------------------------------------------------------------------------
  // Business failures — all must return 200
  // -------------------------------------------------------------------------

  describe('business failures', () => {
    it('returns 200 with result:error when token not found (cardsSnapshot.empty)', async () => {
      makeStampMocks({ cardEmpty: true });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.result).toBe('error');
      expect(res.body.message).toBe('token not found');
    });

    it('returns 200 with result:inactive when card.active is false', async () => {
      makeStampMocks({
        cardData: { active: false, profileId: VALID_PROFILE_ID },
      });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.result).toBe('inactive');
      expect(res.body.message).toBe('card not active');
    });

    it('returns 200 with result:redeemed when profile.redeemed is true', async () => {
      makeStampMocks({
        profileData: { redeemed: true, stamps: {} },
      });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.result).toBe('redeemed');
      expect(res.body.message).toBe('profile already redeemed');
    });

    it('returns 200 with result:duplicate when stationId already in profile.stamps', async () => {
      makeStampMocks({
        profileData: { redeemed: false, stamps: { [VALID_STATION_ID]: new Date() } },
      });

      const res = await validRequest();

      expect(res.status).toBe(200);
      expect(res.body.result).toBe('duplicate');
      expect(res.body.message).toBe('duplicate stamp');
    });
  });

  // -------------------------------------------------------------------------
  // stampEvent audit trail
  // -------------------------------------------------------------------------

  describe('stampEvent audit trail', () => {
    it('writes a stampEvent on token-not-found failure', async () => {
      const { stampEventSetMock } = makeStampMocks({ cardEmpty: true });

      await validRequest();

      expect(stampEventSetMock).toHaveBeenCalledTimes(1);
      expect(stampEventSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'error',
          token: VALID_TOKEN,
          stationId: VALID_STATION_ID,
          deviceId: VALID_DEVICE_ID,
          profileId: null,
        })
      );
    });

    it('writes a stampEvent on inactive failure', async () => {
      const { stampEventSetMock } = makeStampMocks({
        cardData: { active: false, profileId: VALID_PROFILE_ID },
      });

      await validRequest();

      expect(stampEventSetMock).toHaveBeenCalledTimes(1);
      expect(stampEventSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'inactive',
          token: VALID_TOKEN,
          stationId: VALID_STATION_ID,
          profileId: VALID_PROFILE_ID,
        })
      );
    });

    it('writes a stampEvent on redeemed failure', async () => {
      const { stampEventSetMock } = makeStampMocks({
        profileData: { redeemed: true, stamps: {} },
      });

      await validRequest();

      expect(stampEventSetMock).toHaveBeenCalledTimes(1);
      expect(stampEventSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'redeemed',
          token: VALID_TOKEN,
          stationId: VALID_STATION_ID,
          profileId: VALID_PROFILE_ID,
        })
      );
    });

    it('writes a stampEvent on duplicate failure', async () => {
      const { stampEventSetMock } = makeStampMocks({
        profileData: { redeemed: false, stamps: { [VALID_STATION_ID]: new Date() } },
      });

      await validRequest();

      expect(stampEventSetMock).toHaveBeenCalledTimes(1);
      expect(stampEventSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'duplicate',
          token: VALID_TOKEN,
          stationId: VALID_STATION_ID,
          profileId: VALID_PROFILE_ID,
        })
      );
    });

    it('writes a stampEvent on success', async () => {
      const { stampEventSetMock } = makeStampMocks({
        updatedProfileData: { stamps: { [VALID_STATION_ID]: new Date() } },
      });

      await validRequest();

      expect(stampEventSetMock).toHaveBeenCalledTimes(1);
      expect(stampEventSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'success',
          token: VALID_TOKEN,
          stationId: VALID_STATION_ID,
          profileId: VALID_PROFILE_ID,
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns 500 when Firestore throws', async () => {
      makeStampMocks({ firestoreShouldThrow: true });

      const res = await validRequest();

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('message');
    });

    it('returns 500 when transaction detects a race condition duplicate stamp', async () => {
      makeStampMocks();

      // Override runTransaction to simulate the race: fn throws Error('duplicate')
      db.runTransaction.mockImplementation(async (fn) => {
        const t = {
          get: jest.fn().mockResolvedValue({
            data: () => ({ redeemed: false, stamps: { [VALID_STATION_ID]: new Date() } }),
          }),
          update: jest.fn(),
        };
        await fn(t);
      });

      const res = await validRequest();

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'server error' });
    });
  });
});
