# Loud City HQ Backend

Backend API for an NFC-based digital stamp card loyalty system built for OKC Thunder fans. Fans collect stamps at physical stations and redeem them for prizes.

## Tech Stack

- **Runtime:** Node.js + Express.js
- **Database:** Google Cloud Firestore (Firebase Admin SDK)
- **Auth:** Firebase Auth (staff) + API key (station devices)
- **Testing:** Jest + Supertest
- **Deployment:** Docker / Cloud Run

## Project Structure

```
loud-city-hq-backend/
├── server.js                    # Entry point
├── Dockerfile
├── .env.example
├── src/
│   ├── app.js                   # Express app setup and routes
│   ├── middleware/
│   │   ├── auth.js              # Firebase ID token verification (staff)
│   │   └── stationKey.js        # X-Station-Key validation (devices)
│   ├── routes/
│   │   ├── fan.js               # Fan registration and profile management
│   │   ├── staff.js             # Staff tools (card issuance, redemption, manual stamp)
│   │   ├── station.js           # NFC stamp collection
│   │   └── tap.js               # Public progress view
│   └── services/
│       └── firestore.js         # Firebase Admin initialization
├── __tests__/                   # Jest test suites
├── scripts/
│   └── seedStations.js          # Seed 6 test stations
└── docs/
    └── step5-pseudocode.md      # API spec and design notes
```

## API Endpoints

### Fan (`/fan`) — Public

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/fan/registerStart` | Begin registration, generate OTP |
| `POST` | `/fan/verifyEmail` | Verify 6-digit OTP |
| `POST` | `/fan/createProfilesAndIssuance` | Create adult + kid profiles, generate issuance |
| `GET` | `/fan/issuance/:issuanceId` | Fetch issuance and profile list |

### Staff (`/staff`) — Firebase Auth required (`Authorization: Bearer <token>`)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/staff/issueCard` | Assign NFC card token to a profile |
| `POST` | `/staff/redeem` | Mark profile as redeemed after all stamps collected |
| `POST` | `/staff/manualStamp` | Award a stamp manually (admin override) |

### Station (`/station`) — Station API key required (`X-Station-Key: <key>`)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/station/stamp` | Record an NFC tap and award a stamp |

### Public

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/t/:token` | Fan-facing progress view (triggered by NFC tap) |
| `GET` | `/health` | Cloud Run health check |

## Environment Variables

Copy `.env.example` and fill in your values:

```env
GCP_PROJECT_ID=your-firebase-project-id
STATION_API_KEY=your-station-device-key
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
PORT=8080
TAP_BASE_URL=https://your-tap-domain.com
```

A `service-account.json` file (Firebase credentials) is required and must be kept out of version control.

## Getting Started

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Seed Firestore with test stations
npm run seed:stations

# Start development server (auto-reload)
npm run dev

# Start production server
npm start
```

## Testing

```bash
npm test
```

Tests use Jest and Supertest with full Firestore mocking — no real Firebase calls are made.

## Authentication

| Route Group | Method | Header |
|-------------|--------|--------|
| `/staff/*` | Firebase Auth | `Authorization: Bearer <id-token>` |
| `/station/*` | Station API key | `X-Station-Key: <key>` |
| `/fan/*`, `/t/*` | None (public) | — |

## Firestore Collections

| Collection | Purpose |
|------------|---------|
| `accounts` | Fan accounts |
| `profiles` | Individual fan profiles (adult + kids) |
| `cards` | NFC card tokens linked to profiles |
| `issuances` | Batch card issuance requests (30-min expiration) |
| `stations` | Physical stations with API keys |
| `stampEvents` | Audit log of every stamp attempt |
| `emailIndex` | Denormalized index for fast email lookups |

## Deployment

The app is Docker-ready and compatible with Google Cloud Run.

```bash
docker build -t loud-city-hq-backend .
docker run -p 8080:8080 loud-city-hq-backend
```

Ensure `service-account.json` and environment variables are available in your deployment environment.
