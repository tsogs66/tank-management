'use strict';
// Route map helpers (the drawing itself is checked in the browser): land data, projection, antimeridian unwrap, scale bar.
const assert = require('assert'), fs = require('fs'), path = require('path');
const M = require('../public/sea-distance/sea-map.js');
const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/sea-distance/land.json'), 'utf8'));
assert.strictEqual(json.format, 'land-v1');
const land = M.decodeLand(json);
assert(land.length > 1000 && land.length === json.rings.length, 'rings decoded');
assert(land.every(r => r.pts.length >= 8 && r.minx >= -180.01 && r.maxx <= 180.01 && r.miny >= -90.01 && r.maxy <= 90.01), 'coordinates in range');
const inRing = (pts, lon, lat) => { let c = false; for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) { if ((pts[i + 1] > lat) !== (pts[j + 1] > lat) && lon < (pts[j] - pts[i]) * (lat - pts[i + 1]) / (pts[j + 1] - pts[i + 1]) + pts[i]) c = !c; } return c; };
const isLand = (lon, lat) => land.some(r => lon >= r.minx && lon <= r.maxx && lat >= r.miny && lat <= r.maxy && inRing(r.pts, lon, lat));
assert(isLand(10, 50) && isLand(-100, 40) && isLand(25, 0) && isLand(-60, -10), 'Germany, USA, Africa and Brazil are land');
assert(!isLand(-30, 30) && !isLand(70, -20) && !isLand(-150, 20) && !isLand(3, 54), 'mid-Atlantic, Indian Ocean, Pacific and the North Sea are sea');
// the simplified coast stays close to the real one: a ship in the Strait of Dover is at sea, Dover and Calais are land
assert(!isLand(0.5, 50.3) && isLand(-1.0, 51.0) && isLand(1.0, 49.6), 'English Channel stays open');
// projection and helpers
assert(Math.abs(M.myInv(M.my(45)) - 45) < 1e-9 && Math.abs(M.my(0)) < 1e-12 && M.my(60) > M.my(30) * 1.9, 'Mercator round trip');
assert.deepStrictEqual(M.unwrap([[1, 170], [2, -170], [3, -160]]).map(p => p[1]), [170, 190, 200], 'a route across the 180th meridian is made continuous');
assert.deepStrictEqual(M.unwrap([[1, -170], [2, 170]]).map(p => p[1]), [-170, -190], 'and the other way round');
assert(M.niceNm(180) === 100 && M.niceNm(320) === 200 && M.niceNm(750) === 500 && M.niceNm(12) === 10, 'scale bar lengths');
assert(M.PASSAGE_NAMES.includes('suez') && M.PASSAGE_NAMES.includes('panama'), 'passage markers');
// detailed layers (Natural Earth 1:10m)
const DL = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/sea-distance/detail-land.json'), 'utf8')), DW = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/sea-distance/detail-water.json'), 'utf8'));
assert(DL.format === 'detail-land-v1' && DW.format === 'detail-water-v1', 'detail formats');
const fine = M.decodeLand({ q: DL.q, rings: DL.fine }), mid = M.decodeLand({ q: DL.q, rings: DL.mid });
assert(fine.length > 5000 && mid.length > 5000 && fine.reduce((a, r) => a + r.pts.length, 0) > mid.reduce((a, r) => a + r.pts.length, 0), 'the fine coastline has more points than the mid one');
const inAny = (rings, lon, lat) => rings.some(r => lon >= r.minx && lon <= r.maxx && lat >= r.miny && lat <= r.maxy && inRing(r.pts, lon, lat));
assert(inAny(fine, 103.85, 1.37) && !inAny(fine, 103.75, 1.15), 'Singapore island is land and the strait south of it is sea');
const lines = M.decodeLines(DW.rivers, DW.q); assert(lines.length > 1000 && lines.every(l => l.pts.length >= 4), 'rivers decode');
assert(DW.names.some(n => /Strait of Gibraltar|Gibraltar/i.test(n[0])) && DW.names.some(n => /Malacca/i.test(n[0])), 'names of straits are there');
assert(M.decodeLand({ q: DW.q, rings: DW.lakes }).length > 100 && M.decodeLand({ q: DW.q, rings: DW.shelf }).length > 0, 'lakes and the 200 m line decode');
assert(M.gridStep(4) === 30 && M.gridStep(2000) === 0.05 && M.gridStep(9000) === 0.01, 'grid step follows the zoom');
assert(M.fmtDeg(12.5083, true, 0.01) === "12°30.5'N" && M.fmtDeg(-3.2, false, 1) === '3°W' && M.fmtDeg(0, true, 1) === '0°', 'degree labels');
assert(Math.abs(M.zoomLevel(256 / 360) ) < 1e-9 && M.zoomLevel(4 * 256 / 360) === 2, 'zoom level scale');
console.log('sea-map OK (' + land.length + ' land rings)');
