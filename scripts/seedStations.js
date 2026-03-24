require('dotenv').config();
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