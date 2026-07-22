/**
 * Live bunkering operation helpers — progress, tank projections, apply intake.
 */
const store = require('./store');
const { computeTank, bunkerProgress, volumeFromMT, blendFuels, mtFromVolume } = require('./calc');

function listOps(vesselId) {
  const bundle = store.getVesselBundle(vesselId);
  return bundle.bunkerOps || [];
}

function saveOps(vesselId, ops) {
  store.saveVesselPart(vesselId, 'bunkerOps', ops);
  return ops;
}

function findOp(ops, opId) {
  return (ops || []).find((o) => o.id === opId) || null;
}

function getActiveOp(vesselId) {
  const ops = listOps(vesselId);
  return ops.find((o) => o.status === 'active' || o.status === 'paused') || null;
}

function enrichOp(op, now = Date.now()) {
  if (!op) return null;
  const terminal = op.status === 'completed' || op.status === 'cancelled';
  const progress = bunkerProgress({
    plannedMT: op.quantityMT ?? op.plannedMT,
    // Use stored intake when manual, paused snapshot, or terminal; else estimate from rate
    receivedMT: (terminal || op.intakeMode === 'manual' || op.status === 'paused')
      ? (op.receivedMT ?? 0)
      : null,
    rateMTPerHour: op.rateMTPerHour,
    startedAt: op.startedAt,
    pausedAt: op.status === 'paused' ? (op.pausedAt || now) : null,
    elapsedPausedMs: op.elapsedPausedMs || 0,
    now,
  });

  const received = progress.receivedMT;

  const planned = progress.plannedMT || 1;
  const dens = op.density15;
  const tempC = op.tempC ?? 15;

  const liveTanks = (op.allocations || []).map((a) => {
    const share = (Number(a.mt) || 0) / planned;
    const receivedTank = Math.round(received * share * 1000) / 1000;
    const currentWeight = Math.round(((a.beforeWeight || 0) + receivedTank) * 1000) / 1000;
    const addVol = dens ? volumeFromMT(receivedTank, dens, tempC) : null;
    const currentVolume = addVol != null
      ? Math.round(((a.beforeVolume || 0) + addVol) * 1000) / 1000
      : null;
    const targetWeight = Math.round(((a.beforeWeight || 0) + (Number(a.mt) || 0)) * 1000) / 1000;
    return {
      ...a,
      receivedMT: receivedTank,
      remainingMT: Math.round(Math.max(0, (Number(a.mt) || 0) - receivedTank) * 1000) / 1000,
      currentWeight,
      currentVolume,
      targetWeight,
      targetVolume: dens
        ? Math.round(((a.beforeVolume || 0) + (volumeFromMT(a.mt, dens, tempC) || 0)) * 1000) / 1000
        : null,
      fillPercent: a.capacity
        ? Math.round(((currentVolume != null ? currentVolume : a.beforeVolume || 0) / a.capacity) * 1000) / 10
        : null,
    };
  });

  return {
    ...op,
    receivedMT: received,
    progress,
    liveTanks,
  };
}

function buildOpFromDistribute(distributeResult, extras = {}) {
  const base = distributeResult.operation || {};
  const now = new Date().toISOString();
  return {
    ...base,
    id: extras.id || base.id || ('bop_' + Date.now().toString(36)),
    status: 'active',
    plannedMT: base.quantityMT,
    receivedMT: 0,
    rateMTPerHour: Number(extras.rateMTPerHour) || 0,
    intakeMode: extras.intakeMode === 'manual' ? 'manual' : 'rate',
    startedAt: now,
    pausedAt: null,
    completedAt: null,
    elapsedPausedMs: 0,
    live: true,
    applied: false,
    createdAt: base.createdAt || now,
  };
}

function applyReceivedToReadings(vesselId, op, receivedMT) {
  const bundle = store.getVesselBundle(vesselId);
  const dens = op.density15 || store.getSettings().defaultDensity?.[op.fuelGrade] || 0.95;
  const tempC = op.tempC ?? 15;
  const planned = Number(op.quantityMT) || 0;
  const received = Math.max(0, Number(receivedMT) || 0);
  if (!(planned > 0)) throw new Error('Operation has no planned quantity');

  for (const a of op.allocations || []) {
    const tank = store.findTankInBundle(bundle.tanks, a.tankId);
    if (!tank) continue;
    const share = (Number(a.mt) || 0) / planned;
    const tankMT = received * share;
    const addVol = volumeFromMT(tankMT, dens, tempC) || 0;
    const newVol = Math.min((tank.capacity || Infinity) * 1.02, (a.beforeVolume || 0) + addVol);

    // Blend density if tank already had fuel with different density
    let useDens = dens;
    const prev = bundle.readings[a.tankId];
    const prevDens = prev?.density15;
    const beforeMT = a.beforeWeight || 0;
    if (prevDens && beforeMT > 0.01 && Math.abs(prevDens - dens) > 1e-5) {
      const blend = blendFuels([
        { label: 'ROB', density15: prevDens, quantityMT: beforeMT },
        { label: 'Bunker', density15: dens, quantityMT: tankMT },
      ]);
      if (blend.blendedDensity15) useDens = blend.blendedDensity15;
      a.blendedDensity15 = useDens;
    }

    const inputs = {
      reading: newVol,
      trim: bundle.voyage?.trim || 0,
      list: bundle.voyage?.heel || 0,
      tempC,
      density15: useDens,
      gaugeType: 'volume',
    };
    const result = computeTank(tank, inputs);
    bundle.readings[a.tankId] = {
      ...inputs,
      result,
      savedAt: new Date().toISOString(),
      fromBunkerOp: op.id,
      bunkerLive: op.status === 'active' || op.status === 'paused',
    };
    a.currentVolume = result.volumeObserved;
    a.currentWeight = result.weightMT;
    a.receivedMT = Math.round(tankMT * 1000) / 1000;
  }

  store.saveVesselPart(vesselId, 'readings', bundle.readings);
  return bundle.readings;
}

function updateOp(vesselId, opId, patch = {}) {
  const ops = listOps(vesselId);
  const idx = ops.findIndex((o) => o.id === opId);
  if (idx < 0) throw new Error('Bunker operation not found');
  const op = ops[idx];
  if (op.status === 'completed' || op.status === 'cancelled') {
    throw new Error('Operation already ' + op.status);
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  if (patch.rateMTPerHour != null) op.rateMTPerHour = Math.max(0, Number(patch.rateMTPerHour) || 0);
  if (patch.intakeMode === 'manual' || patch.intakeMode === 'rate') op.intakeMode = patch.intakeMode;
  if (patch.receivedMT != null) {
    op.receivedMT = Math.max(0, Number(patch.receivedMT) || 0);
    op.intakeMode = 'manual';
  }
  if (patch.density15 != null) op.density15 = Number(patch.density15) || op.density15;
  if (patch.tempC != null) op.tempC = Number(patch.tempC) || op.tempC;
  if (patch.bdn) op.bdn = { ...op.bdn, ...patch.bdn };

  if (patch.action === 'pause' && op.status === 'active') {
    // Freeze intake at current estimate so pause doesn't keep climbing
    const snap = enrichOp(op, nowMs);
    op.receivedMT = snap.receivedMT;
    op.intakeMode = op.intakeMode || 'rate';
    op.status = 'paused';
    op.pausedAt = nowIso;
  } else if (patch.action === 'resume' && op.status === 'paused') {
    if (op.pausedAt) {
      op.elapsedPausedMs = (op.elapsedPausedMs || 0) + Math.max(0, nowMs - new Date(op.pausedAt).getTime());
    }
    op.pausedAt = null;
    op.status = 'active';
  }

  // Tank sounding updates → recompute received from weight deltas
  if (Array.isArray(patch.tankUpdates) && patch.tankUpdates.length) {
    let sum = 0;
    for (const u of patch.tankUpdates) {
      const a = (op.allocations || []).find((x) => x.tankId === u.tankId);
      if (!a) continue;
      let weight = u.weightMT != null ? Number(u.weightMT) : null;
      if (weight == null && u.volumeM3 != null) {
        const dens = op.density15 || store.getSettings().defaultDensity?.[op.fuelGrade] || 0.95;
        weight = mtFromVolume(Number(u.volumeM3), dens, op.tempC ?? 15);
      }
      if (weight == null) continue;
      const receivedTank = Math.max(0, weight - (a.beforeWeight || 0));
      a.receivedMT = Math.round(receivedTank * 1000) / 1000;
      a.currentWeight = weight;
      if (u.volumeM3 != null) a.currentVolume = Number(u.volumeM3);
      sum += a.receivedMT;
    }
    op.receivedMT = Math.round(sum * 1000) / 1000;
    op.intakeMode = 'manual';
  }

  op.updatedAt = nowIso;
  ops[idx] = op;
  saveOps(vesselId, ops);

  const syncTanks = patch.syncTanks === true || patch.syncTanks === 'true';
  if (syncTanks) {
    const enriched = enrichOp(op, nowMs);
    applyReceivedToReadings(vesselId, op, enriched.receivedMT);
  }

  return enrichOp(ops[idx], nowMs);
}

function completeOp(vesselId, opId, opts = {}) {
  const ops = listOps(vesselId);
  const idx = ops.findIndex((o) => o.id === opId);
  if (idx < 0) throw new Error('Bunker operation not found');
  const op = ops[idx];
  if (op.status === 'completed') throw new Error('Already completed');
  if (op.status === 'cancelled') throw new Error('Operation was cancelled');

  const enriched = enrichOp(op);
  const usePlanned = opts.usePlanned === true || opts.usePlanned === 'true';
  const finalMT = opts.receivedMT != null && opts.receivedMT !== ''
    ? Math.max(0, Number(opts.receivedMT) || 0)
    : enriched.receivedMT;

  const planned = Number(op.quantityMT ?? op.plannedMT) || 0;
  const applyMT = usePlanned ? planned : finalMT;

  applyReceivedToReadings(vesselId, op, applyMT);

  op.receivedMT = applyMT;
  op.status = 'completed';
  op.applied = true;
  op.completedAt = new Date().toISOString();
  op.pausedAt = null;
  op.updatedAt = op.completedAt;

  // Clear live flags on readings
  const bundle = store.getVesselBundle(vesselId);
  for (const a of op.allocations || []) {
    if (bundle.readings[a.tankId]) {
      delete bundle.readings[a.tankId].bunkerLive;
    }
  }
  store.saveVesselPart(vesselId, 'readings', bundle.readings);

  const bunk = bundle.bunkering || store.emptyBunkering();
  if (bunk[op.fuelGrade]) {
    bunk[op.fuelGrade].received = (Number(bunk[op.fuelGrade].received) || 0) + applyMT;
    store.saveVesselPart(vesselId, 'bunkering', bunk);
  }

  ops[idx] = op;
  saveOps(vesselId, ops);
  return enrichOp(op);
}

function cancelOp(vesselId, opId) {
  const ops = listOps(vesselId);
  const idx = ops.findIndex((o) => o.id === opId);
  if (idx < 0) throw new Error('Bunker operation not found');
  const op = ops[idx];
  op.status = 'cancelled';
  op.cancelledAt = new Date().toISOString();
  op.updatedAt = op.cancelledAt;
  ops[idx] = op;
  saveOps(vesselId, ops);
  return enrichOp(op);
}

module.exports = {
  listOps,
  getActiveOp,
  enrichOp,
  buildOpFromDistribute,
  updateOp,
  completeOp,
  cancelOp,
  applyReceivedToReadings,
  blendFuels,
};
