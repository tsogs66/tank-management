/**
 * Seed vessels from workbook-extracted JSON under seed/.
 * - captain-veniamis from seed/{vessel,tanks,readings}.json
 * - mv-giorgis from seed/giorgis/ when present
 */
const fs = require('fs');
const path = require('path');
const store = require('../server/store');

const SEED = path.join(__dirname, '..', 'seed');

function upsertVessel(id, { vesselPath, tanksPath, readingsPath, voyage, setActive }) {
  const vessel = JSON.parse(fs.readFileSync(vesselPath, 'utf8'));
  const tanks = JSON.parse(fs.readFileSync(tanksPath, 'utf8'));
  const readings = fs.existsSync(readingsPath)
    ? JSON.parse(fs.readFileSync(readingsPath, 'utf8'))
    : { fuel: [], lube: [], misc: [], water: [] };

  const existing = store.listVessels().find((v) => v.id === id);
  if (existing) {
    store.saveVesselPart(id, 'tanks', tanks);
    store.saveVesselPart(id, 'readings', readings);
    console.log(`Updated vessel ${id}`);
  } else {
    const created = store.createVessel({
      ...vessel,
      id,
      tanks,
      readings,
      voyage: voyage || {
        vessel: vessel.name,
        voyageNo: '',
        port: '',
        reportType: 'Noon',
        date: new Date().toISOString().slice(0, 10),
        time: '12:00',
        draftFwd: 0,
        draftAft: 0,
        trim: 0,
        heel: 0,
      },
    });
    console.log('Seeded vessel:', created.id, created.name);
  }
  if (setActive) store.setActiveVessel(id);
}

function main() {
  store.ensureDirs();

  upsertVessel('captain-veniamis', {
    vesselPath: path.join(SEED, 'vessel.json'),
    tanksPath: path.join(SEED, 'tanks.json'),
    readingsPath: path.join(SEED, 'readings.json'),
    voyage: {
      vessel: 'MV CAPTAIN VENIAMIS',
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
    setActive: true,
  });

  const giorgisDir = path.join(SEED, 'giorgis');
  if (fs.existsSync(path.join(giorgisDir, 'tanks.json'))) {
    upsertVessel('mv-giorgis', {
      vesselPath: path.join(giorgisDir, 'vessel.json'),
      tanksPath: path.join(giorgisDir, 'tanks.json'),
      readingsPath: path.join(giorgisDir, 'readings.json'),
      voyage: {
        vessel: 'MV GIORGIS',
        voyageNo: '61-L',
        port: '',
        reportType: 'Noon',
        date: new Date().toISOString().slice(0, 10),
        time: '12:00',
        draftFwd: 11.98,
        draftAft: 12.34,
        trim: -0.36,
        heel: 0,
      },
      setActive: false,
    });
  } else {
    console.log('No seed/giorgis yet — run: python scripts/build-giorgis-seed.py');
  }
}

main();
