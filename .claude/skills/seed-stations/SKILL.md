Purpose
One-time script to seed the 6 stations into Firestore before any stamp logic can be tested.
Run once before testing /station/stamp or /staff/manualStamp.
The 6 Stations
Per the PRD:

4 tap-to-earn stations
1 digital wall (interactive game)
1 touchscreen kiosk (interactive game)

Seed Script
Create this file at scripts/seedStations.js:
jsrequire('dotenv').config();
const { db } = require('../src/services/firestore');

const stations = [
  {
    stationId: 'station-tap-1',
    name: 'Tap Station 1',
    type: 'tap',
    active: true,
    oncePerEvent: true,
    cooldownSeconds: 0
  },
  {
    stationId: 'station-tap-2',
    name: 'Tap Station 2',
    type: 'tap',
    active: true,
    oncePerEvent: true,
    cooldownSeconds: 0
  },
  {
    stationId: 'station-tap-3',
    name: 'Tap Station 3',
    type: 'tap',
    active: true,
    oncePerEvent: true,
    cooldownSeconds: 0
  },
  {
    stationId: 'station-tap-4',
    name: 'Tap Station 4',
    type: 'tap',
    active: true,
    oncePerEvent: true,
    cooldownSeconds: 0
  },
  {
    stationId: 'station-wall',
    name: 'Digital Wall',
    type: 'game',
    active: true,
    oncePerEvent: true,
    cooldownSeconds: 0
  },
  {
    stationId: 'station-kiosk',
    name: 'Touchscreen Kiosk',
    type: 'game',
    active: true,
    oncePerEvent: true,
    cooldownSeconds: 0
  }
];

async function seedStations() {
  const batch = db.batch();

  for (const station of stations) {
    const ref = db.collection('stations').doc(station.stationId);
    batch.set(ref, {
      name: station.name,
      type: station.type,
      active: station.active,
      oncePerEvent: station.oncePerEvent,
      cooldownSeconds: station.cooldownSeconds,
      createdAt: new Date()
    });
  }

  await batch.commit();
  console.log('✅ 6 stations seeded successfully');
  process.exit(0);
}

seedStations().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
How to Run
bash# From project root
node scripts/seedStations.js
Verify in Firestore Console
Go to console.cloud.google.com → Firestore → Data
You should see a stations collection with 6 documents.
When to Run

Once before testing any stamp endpoint
Again if you wipe your Firestore database
Do NOT run multiple times — it will overwrite existing station docs (safe but unnecessary)

Add to package.json scripts
json"seed:stations": "node scripts/seedStations.js"
Then run with:
bashnpm run seed:stations