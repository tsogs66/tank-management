/**
 * Verify spoof-resistant license scope headers for tank/AIO data APIs.
 */
'use strict';

const crypto = require('crypto');

function signingSecret() {
  return process.env.LICENSE_SIGNING_SECRET
    || process.env.CHENG_PRO_LICENSE_SECRET
    || '';
}

function verifyEntitlement(ent) {
  if (!ent || !ent.sig) return false;
  const secret = signingSecret();
  if (!secret || secret === 'dev-only-change-me-cheng-aio-license') {
    /* Without a real secret, refuse scoped master/email claims. */
    return false;
  }
  const { sig, ...rest } = ent;
  const expect = crypto.createHmac('sha256', secret).update(JSON.stringify(rest)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
  }
}

function parseScopedEntitlement(req, res) {
  const emailHdr = (req.get('x-license-email') || '').trim().toLowerCase();
  const masterHdr = req.get('x-license-master') === '1';
  const actAs = masterHdr ? (req.get('x-act-as-user') || '').trim().toLowerCase() : '';
  if (!emailHdr && !masterHdr) {
    return { email: null, master: false, actAs: null };
  }
  const raw = req.get('x-license-entitlement');
  if (!raw) {
    res.status(401).json({ error: 'Signed X-License-Entitlement required for scoped access' });
    return null;
  }
  let ent;
  try {
    ent = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    res.status(401).json({ error: 'Invalid entitlement encoding' });
    return null;
  }
  if (!verifyEntitlement(ent)) {
    res.status(401).json({ error: 'Invalid entitlement signature' });
    return null;
  }
  if (ent.graceUntil && ent.graceUntil < new Date().toISOString()) {
    res.status(401).json({ error: 'Entitlement grace expired' });
    return null;
  }
  const isMaster = ent.master === true || ent.sku === 'cheng-admin'
    || (Array.isArray(ent.addons) && ent.addons.includes('master'));
  if (masterHdr && !isMaster) {
    res.status(403).json({ error: 'Master claim rejected' });
    return null;
  }
  if (emailHdr && !isMaster && String(ent.email || '').toLowerCase() !== emailHdr) {
    res.status(403).json({ error: 'Email does not match entitlement' });
    return null;
  }
  return {
    email: emailHdr || String(ent.email || '').toLowerCase() || null,
    master: !!(masterHdr && isMaster),
    actAs: actAs || null,
    entitlement: ent,
  };
}

function requireSyncAuth(req, res, next) {
  const token = (process.env.SYNC_API_TOKEN || process.env.TMS_SYNC_TOKEN || '').trim();
  const must = process.env.NODE_ENV === 'production'
    || process.env.TMS_REQUIRE_SYNC_AUTH === '1'
    || !!token;
  if (!must) return next();
  if (!token) {
    return res.status(503).json({ error: 'SYNC_API_TOKEN / TMS_SYNC_TOKEN not configured' });
  }
  const auth = req.get('authorization') || '';
  if (auth !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

module.exports = { parseScopedEntitlement, requireSyncAuth, verifyEntitlement };
