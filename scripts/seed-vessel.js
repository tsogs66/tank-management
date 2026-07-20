/**
 * Seed the default CAPTAIN VENIAMIS vessel from extracted workbook data.
 */
const fs = require('fs');
const path = require('path');
const store = require('../server/store');

const SEED = path.join(__dirname, '..', 'seed');

function main() {
  store.ensureDirs();
  const existing = store.listVessels().find((v) => v.id === 'captain-veniamis');
  if (existing) {
    console.log('Vessel captain-veniamis already exists — refreshing tanks/readings from seed…');
    const tanks = JSON.parse(fs.readFileSync(path.join(SEED, 'tanks.json'), 'utf8'));
    const readings = JSON.parse(fs.readFileSync(path.join(SEED, 'readings.json'), 'utf8'));
    store.saveVesselPart('captain-veniamis', 'tanks', tanks);
    store.saveVesselPart('captain-veniamis', 'readings', readings);
    store.setActiveVessel('captain-veniamis');
    console.log('Updated.');
    return;
  }

  const vessel = JSON.parse(fs.readFileSync(path.join(SEED, 'vessel.json'), 'utf8'));
  const tanks = JSON.parse(fs.readFileSync(path.join(SEED, 'tanks.json'), 'utf8'));
  const readings = JSON.parse(fs.readFileSync(path.join(SEED, 'readings.json'), 'utf8'));

  const created = store.createVessel({
    ...vessel,
    id: 'captain-veniamis',
    tanks,
    readings,
    voyage: {
      vessel: vessel.name,
      voyageNo: '11-B',
      port: 'AT SEA',
      reportType: 'Departure',
      date: '2025-10-31',
      time: '08:00',
      draftFwd: 6.74,
      draftAft: 8.65,
      trim: -1.91,
      heel: 0,
      seaTemp: 32,
      engineRoomTemp: 41,
    },
  });
  store.setActiveVessel(created.id);
  console.log('Seeded vessel:', created.id, created.name);
}

main();
