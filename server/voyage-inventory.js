/**
 * Scan / copy voyage-sync legs on disk for the vessel library + admin inventory.
 *
 * Layout (voyage sync-server):
 *   <voyage-sync>/users/<email-slug>/<vessel-slug>/<voyageNo>/<B|L>.json
 *   <voyage-sync>/<vessel-slug>/<voyageNo>/<B|L>.json   (legacy unscoped)
 */
'use strict';

const fs = require('fs');
const path = require('path');

function rootDataDir() {
  return (
    process.env.CHENG_PRO_DATA_DIR
    || process.env.TMS_DATA_DIR
    || path.join(__dirname, '..', '..', '..', 'data')
  );
}

function voyageSyncRoot() {
  return path.join(rootDataDir(), 'voyage-sync');
}

function safeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'vessel';
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listOwnerRoots() {
  const root = voyageSyncRoot();
  const out = [{ ownerSlug: null, dir: root }];
  const usersDir = path.join(root, 'users');
  if (!fs.existsSync(usersDir)) return out;
  let names;
  try {
    names = fs.readdirSync(usersDir);
  } catch (_) {
    return out;
  }
  for (const name of names) {
    const dir = path.join(usersDir, name);
    try {
      if (fs.statSync(dir).isDirectory()) out.push({ ownerSlug: name, dir });
    } catch (_) { /* skip */ }
  }
  return out;
}

function legUpdatedAt(file, data) {
  const fromData = data && (data.updatedAt || data.serverUpdatedAt || data.savedAt);
  if (fromData) return String(fromData);
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch (_) {
    return '';
  }
}

function scanVesselDir(ownerSlug, vesselSlug, vesselDir) {
  const legs = [];
  let entries;
  try {
    entries = fs.readdirSync(vesselDir);
  } catch (_) {
    return legs;
  }
  for (const voyageName of entries) {
    const voyagePath = path.join(vesselDir, voyageName);
    let st;
    try {
      st = fs.statSync(voyagePath);
    } catch (_) {
      continue;
    }
    if (st.isDirectory()) {
      let files;
      try {
        files = fs.readdirSync(voyagePath);
      } catch (_) {
        continue;
      }
      for (const file of files) {
        if (!/\.json$/i.test(file)) continue;
        const stem = file.replace(/\.json$/i, '').toUpperCase();
        let condition = null;
        if (stem === 'B' || stem === 'BALLAST') condition = 'B';
        else if (stem === 'L' || stem === 'LADEN' || stem === 'LOADED') condition = 'L';
        if (!condition) continue;
        const full = path.join(voyagePath, file);
        const data = readJson(full);
        legs.push({
          ownerSlug,
          vesselSlug,
          voyageNo: voyageName,
          condition,
          updatedAt: legUpdatedAt(full, data),
          path: full,
          data,
        });
      }
    } else if (st.isFile() && /\.json$/i.test(voyageName)) {
      /* Legacy flat: <voyageNo>-B.json */
      const m = voyageName.match(/^(.+)-(B|L|BALLAST|LADEN|LOADED)\.json$/i);
      if (!m) continue;
      const condition = /^(L|LADEN|LOADED)$/i.test(m[2]) ? 'L' : 'B';
      const full = voyagePath;
      const data = readJson(full);
      legs.push({
        ownerSlug,
        vesselSlug,
        voyageNo: m[1],
        condition,
        updatedAt: legUpdatedAt(full, data),
        path: full,
        data,
      });
    }
  }
  return legs;
}

function listAllVoyageLegs() {
  const out = [];
  for (const { ownerSlug, dir } of listOwnerRoots()) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const name of names) {
      if (name === 'users' || name === 'accounts.db' || name.startsWith('accounts.db')) continue;
      const vesselDir = path.join(dir, name);
      try {
        if (!fs.statSync(vesselDir).isDirectory()) continue;
      } catch (_) {
        continue;
      }
      out.push(...scanVesselDir(ownerSlug, name, vesselDir));
    }
  }
  return out;
}

function vesselSlugCandidates(vessel) {
  const v = vessel || {};
  const out = [];
  const push = (s) => {
    const slug = safeSlug(s);
    if (slug && !out.includes(slug)) out.push(slug);
  };
  push(v.voyageSlug);
  push(v.voyageRegistryId);
  push(v.id);
  push(v.name);
  if (v.name) push(String(v.name).replace(/^(m\s*[./]?\s*v\.?)\s+/i, ''));
  return out;
}

function findLatestLegForVessel(ownerSlug, vessel) {
  const candidates = new Set(vesselSlugCandidates(vessel));
  const legs = listAllVoyageLegs().filter((leg) => {
    if (ownerSlug) {
      if (leg.ownerSlug !== ownerSlug) return false;
    } else if (leg.ownerSlug) {
      /* Prefer unscoped when ownerSlug is null, but also accept any if unique match. */
    }
    return candidates.has(leg.vesselSlug);
  });
  if (!legs.length && ownerSlug) {
    /* Fall back: any owner with matching vessel slug */
    const any = listAllVoyageLegs().filter((leg) => candidates.has(leg.vesselSlug));
    legs.push(...any);
  }
  if (!legs.length) return null;
  legs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return legs[0];
}

function copyLegToOwner(leg, destOwnerSlug, destVesselSlug) {
  if (!leg || !leg.data) return null;
  const owner = safeSlug(destOwnerSlug);
  const vessel = safeSlug(destVesselSlug || leg.vesselSlug);
  const voyage = safeSlug(leg.voyageNo);
  const condition = leg.condition === 'L' ? 'L' : 'B';
  const destDir = path.join(voyageSyncRoot(), 'users', owner, vessel, voyage);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, `${condition}.json`);
  const payload = {
    ...leg.data,
    voyageNumber: leg.data.voyageNumber || leg.voyageNo,
    condition,
    updatedAt: new Date().toISOString(),
    copiedFrom: {
      ownerSlug: leg.ownerSlug,
      vesselSlug: leg.vesselSlug,
      voyageNo: leg.voyageNo,
      condition: leg.condition,
      at: new Date().toISOString(),
    },
  };
  fs.writeFileSync(destFile, JSON.stringify(payload, null, 2));
  return {
    ownerSlug: owner,
    vesselSlug: vessel,
    voyageNo: voyage,
    condition,
    path: destFile,
    updatedAt: payload.updatedAt,
  };
}

function summarizeLegsByOwner() {
  const byOwner = new Map();
  for (const leg of listAllVoyageLegs()) {
    const key = leg.ownerSlug || '(root)';
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push({
      vesselSlug: leg.vesselSlug,
      voyageNo: leg.voyageNo,
      condition: leg.condition,
      updatedAt: leg.updatedAt,
    });
  }
  return byOwner;
}

module.exports = {
  voyageSyncRoot,
  listAllVoyageLegs,
  findLatestLegForVessel,
  copyLegToOwner,
  summarizeLegsByOwner,
  vesselSlugCandidates,
  safeSlug,
};
