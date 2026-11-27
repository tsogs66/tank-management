// Route exchange for ECDIS and chart plotters: writes and reads a route (a list of waypoints) as RTZ, GPX, KML, CSV and NMEA 0183.
//   RouteExchange.FORMATS                      [{ id, label, ext, mime, hint }]
//   RouteExchange.write(id, route, opts)       -> text            route = { name, vessel, imo, voyage, points: [{ lat, lon, name }] }
//   RouteExchange.parse(text, filename)        -> { format, name, points: [{ lat, lon, name }] }   (throws Error with a plain sentence)
//   opts (RTZ): { xtd: nm each side (0.5), radius: nm (1), geometry: 'Orthodrome' | 'Loxodrome', author }
// RTZ is the IEC 61174 / CIRM route exchange format (versions 1.0 and 1.1) that current ECDIS import and export. Planning aid: a route taken into an ECDIS
// must be checked there against the official charts. Browser (window.RouteExchange) and Node (module.exports).
(function (root) {
  'use strict';
  const xml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unxml = (s) => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const f6 = (v) => (Math.round(v * 1e6) / 1e6).toFixed(6);
  const names = (r) => r.points.map((p, i) => String(p.name || 'WP' + String(i + 1).padStart(2, '0')));
  const clean = (r) => {
    const pts = (r && r.points || []).filter((p) => p && isFinite(p.lat) && isFinite(p.lon));
    if (pts.length < 2) throw new Error('A route needs at least two points.');
    return { name: String(r.name || 'Route'), vessel: r.vessel || '', imo: r.imo || '', voyage: r.voyage || '', points: pts.map((p) => ({ lat: Number(p.lat), lon: ((Number(p.lon) + 540) % 360) - 180, name: p.name })) };
  };

  /* ---- degrees and minutes ---- */
  function ddm(v, isLat) {
    const a = Math.abs(v); let d = Math.floor(a); let m = (a - d) * 60; if (m >= 59.9995) { d += 1; m = 0; }
    const hemi = isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
    return { d, m, hemi, text: String(d).padStart(isLat ? 2 : 3, '0') + m.toFixed(3).padStart(6, '0'), pretty: d + '\u00B0 ' + m.toFixed(3) + "' " + hemi };
  }
  /** "47 12.5 N", "47°12'30\"N", "4712.500N", "-47.2083", "N 47 12.5", "W 001 30.0": degrees, minutes, seconds in any of these writings -> decimal degrees, or null. */
  function parseCoord(text, isLat) {
    let t = String(text == null ? '' : text).trim(); if (!t) return null;
    let sign = 1;
    const hemi = t.match(/[NSEW]/i); if (hemi) { const h = hemi[0].toUpperCase(); if (h === 'S' || h === 'W') sign = -1; t = t.replace(/[NSEW]/gi, ' ').trim(); }
    if (/^[-\u2212]/.test(t)) { sign = -sign; t = t.replace(/^[-\u2212]\s*/, ''); }
    t = t.replace(/[\u00B0\u00BA'"\u2032\u2033,]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = t.split(' ').filter(Boolean);
    if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
    let v;
    if (parts.length === 1) {
      const m = parts[0].match(/^(\d{2,3})(\d{2}\.\d+)$/); /* ddmm.mmm for a latitude, dddmm.mmm for a longitude (NMEA) */
      v = m && Number(m[2]) < 60 && m[1].length === (isLat ? 2 : 3) ? Number(m[1]) + Number(m[2]) / 60 : Number(parts[0]);
    } else if (parts.length === 2) v = Number(parts[0]) + Number(parts[1]) / 60;
    else v = Number(parts[0]) + Number(parts[1]) / 60 + Number(parts[2]) / 3600;
    v *= sign;
    if (!isFinite(v) || Math.abs(v) > (isLat ? 90 : 180)) return null;
    return v;
  }

  /* ---- writers ---- */
  function toRTZ(route, o) {
    const r = clean(route); o = o || {}; const nm = names(r);
    const xtd = o.xtd != null ? Number(o.xtd) : 0.5; const rad = o.radius != null ? Number(o.radius) : 1; const geo = o.geometry === 'Loxodrome' ? 'Loxodrome' : 'Orthodrome';
    const info = [`routeName="${xml(r.name)}"`, o.author ? `routeAuthor="${xml(o.author)}"` : '', r.vessel ? `vesselName="${xml(r.vessel)}"` : '', r.imo ? `vesselIMO="${xml(String(r.imo).replace(/\D/g, ''))}"` : '', r.voyage ? `vesselVoyage="${xml(r.voyage)}"` : ''].filter(Boolean).join(' ');
    const wps = r.points.map((p, i) => `    <waypoint id="${i + 1}" revision="1" name="${xml(nm[i])}">\n      <position lat="${f6(p.lat)}" lon="${f6(p.lon)}"/>\n    </waypoint>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<route xmlns="http://www.cirm.org/RTZ/1/1" version="1.1">\n  <routeInfo ${info}/>\n  <waypoints>\n    <defaultWaypoint radius="${rad}">\n      <leg starboardXTD="${xtd}" portsideXTD="${xtd}" geometryType="${geo}"/>\n    </defaultWaypoint>\n${wps}\n  </waypoints>\n</route>\n`;
  }
  function toGPX(route) {
    const r = clean(route); const nm = names(r);
    const pts = r.points.map((p, i) => `    <rtept lat="${f6(p.lat)}" lon="${f6(p.lon)}"><name>${xml(nm[i])}</name></rtept>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Voyage Chief / Tank Chief" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xml(r.name)}</name></metadata>\n  <rte>\n    <name>${xml(r.name)}</name>\n${pts}\n  </rte>\n</gpx>\n`;
  }
  function toKML(route) {
    const r = clean(route); const nm = names(r);
    const line = r.points.map((p) => `${f6(p.lon)},${f6(p.lat)},0`).join(' ');
    const marks = r.points.map((p, i) => `    <Placemark><name>${xml(nm[i])}</name><Point><coordinates>${f6(p.lon)},${f6(p.lat)},0</coordinates></Point></Placemark>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${xml(r.name)}</name>\n    <Placemark><name>${xml(r.name)}</name><LineString><tessellate>1</tessellate><coordinates>${line}</coordinates></LineString></Placemark>\n${marks}\n  </Document>\n</kml>\n`;
  }
  const csvq = (v) => { const t = String(v == null ? '' : v); return /[",;\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function toCSV(route) {
    const r = clean(route); const nm = names(r);
    const rows = [['No', 'Name', 'Latitude (decimal degrees)', 'Longitude (decimal degrees)', 'Latitude (deg min.mmm)', 'Longitude (deg min.mmm)']];
    r.points.forEach((p, i) => rows.push([i + 1, nm[i], p.lat.toFixed(6), p.lon.toFixed(6), ddm(p.lat, true).pretty, ddm(p.lon, false).pretty]));
    return '\ufeff' + rows.map((x) => x.map(csvq).join(',')).join('\r\n') + '\r\n';
  }
  const nmeaSum = (body) => { let c = 0; for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i); return c.toString(16).toUpperCase().padStart(2, '0'); };
  const nmeaLine = (body) => '$' + body + '*' + nmeaSum(body);
  function toNMEA(route) {
    const r = clean(route); const nm = names(r).map((n) => n.replace(/[^A-Za-z0-9 _.-]/g, '').trim().replace(/\s+/g, '_').slice(0, 12) || 'WP');
    const ids = nm.map((n, i) => (n + '_' + (i + 1)).slice(0, 14));
    const out = r.points.map((p, i) => { const la = ddm(p.lat, true), lo = ddm(p.lon, false); return nmeaLine(`GPWPL,${la.text},${la.hemi},${lo.text},${lo.hemi},${ids[i]}`); });
    const routeId = (r.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'ROUTE');
    const per = 6; const total = Math.ceil(ids.length / per);
    for (let k = 0; k < total; k++) out.push(nmeaLine(`GPRTE,${total},${k + 1},c,${routeId},${ids.slice(k * per, k * per + per).join(',')}`));
    return out.join('\r\n') + '\r\n';
  }
  const FORMATS = [
    { id: 'rtz', label: 'RTZ — ECDIS route exchange (IEC 61174)', ext: 'rtz', mime: 'application/xml', hint: 'The standard route file of current ECDIS (Furuno, JRC, Transas / Wärtsilä, Kongsberg, Sperry, SAM and others).' },
    { id: 'gpx', label: 'GPX — GPS exchange', ext: 'gpx', mime: 'application/gpx+xml', hint: 'Chart plotters, OpenCPN, phones.' },
    { id: 'kml', label: 'KML — Google Earth', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', hint: 'Shows the route on Google Earth.' },
    { id: 'csv', label: 'CSV — spreadsheet / ECDIS list import', ext: 'csv', mime: 'text/csv', hint: 'Latitude and longitude in decimal degrees and in degrees and minutes.' },
    { id: 'nmea', label: 'NMEA 0183 — WPL / RTE sentences', ext: 'txt', mime: 'text/plain', hint: 'Plain text waypoints and route for older equipment.' },
  ];
  function write(id, route, opts) {
    switch (id) { case 'rtz': return toRTZ(route, opts); case 'gpx': return toGPX(route); case 'kml': return toKML(route); case 'csv': return toCSV(route); case 'nmea': return toNMEA(route); default: throw new Error('Unknown route format: ' + id); }
  }

  /* ---- readers (small tolerant scanners: no DOM needed) ---- */
  const attrs = (tag) => { const o = {}; tag.replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (m, k, a, b, c) => { o[k.replace(/^.*:/, '')] = unxml(b != null ? b : c); return m; }); return o; };
  const tags = (text, name, closing) => {
    const re = new RegExp('<(?:[\\w.-]+:)?' + name + '\\b([^>]*?)(/?)>', 'g'); const close = new RegExp('</(?:[\\w.-]+:)?' + name + '>', 'g'); const out = []; let m;
    while ((m = re.exec(text))) {
      let inner = '';
      if (closing && !m[2]) { close.lastIndex = re.lastIndex; const c = close.exec(text); if (c) { inner = text.slice(re.lastIndex, c.index); re.lastIndex = c.index + c[0].length; } }
      out.push({ attrs: attrs(m[1]), self: m[2] === '/', inner });
    }
    return out;
  };
  const textOf = (inner, name) => { const m = inner.match(new RegExp('<(?:[\\w.-]+:)?' + name + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '>')); return m ? unxml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : ''; };
  const point = (lat, lon, name) => { const la = Number(lat), lo = Number(lon); return isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? { lat: la, lon: lo, name: name || '' } : null; };
  function parseRTZ(text) {
    const info = tags(text, 'routeInfo', false)[0]; const name = info ? info.attrs.routeName || '' : '';
    // each <waypoint ...> ... </waypoint>; the position is a child
    const pts = tags(text, 'waypoint', true).map((w) => { const pos = tags(w.inner, 'position', false)[0]; return pos ? point(pos.attrs.lat, pos.attrs.lon, w.attrs.name) : null; }).filter(Boolean);
    return { format: 'rtz', name, points: pts };
  }
  function parseGPX(text) {
    const name = textOf((text.match(/<(?:\w+:)?rte\b[\s\S]*?<\/(?:\w+:)?rte>/) || [text])[0], 'name') || textOf(text, 'name');
    const pick = (el) => tags(text, el, true).map((x) => point(x.attrs.lat, x.attrs.lon, textOf(x.inner, 'name'))).filter(Boolean);
    let pts = pick('rtept'); if (!pts.length) pts = pick('wpt'); if (!pts.length) pts = pick('trkpt');
    return { format: 'gpx', name, points: pts };
  }
  function parseKML(text) {
    const places = tags(text, 'Placemark', true); const pts = []; let name = '';
    places.forEach((p) => {
      const nm = textOf(p.inner, 'name'); const ls = p.inner.match(/<(?:\w+:)?LineString\b[\s\S]*?<(?:\w+:)?coordinates[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/);
      if (ls) { if (!name) name = nm; ls[1].trim().split(/\s+/).forEach((c, i) => { const q = c.split(','); const x = point(q[1], q[0], 'WP' + String(pts.length + i + 1).padStart(2, '0')); if (x) pts.push(x); }); }
    });
    if (!pts.length) places.forEach((p) => { const c = p.inner.match(/<(?:\w+:)?Point\b[\s\S]*?<(?:\w+:)?coordinates[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/); if (c) { const q = c[1].trim().split(','); const x = point(q[1], q[0], textOf(p.inner, 'name')); if (x) pts.push(x); } });
    return { format: 'kml', name, points: pts };
  }
  function parseNMEA(text) {
    const wp = {}; const order = []; const rte = [];
    text.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim(); if (line[0] !== '$') return; const body = line.slice(1).split('*')[0]; const f = body.split(',');
      const type = f[0].slice(-3);
      if (type === 'WPL') { const la = parseCoord(f[1] + ' ' + f[2], true), lo = parseCoord(f[3] + ' ' + f[4], false); if (la != null && lo != null) { wp[f[5]] = { lat: la, lon: lo, name: f[5] }; order.push(f[5]); } }
      else if (type === 'RTE') f.slice(5).forEach((id) => { if (id) rte.push(id); });
    });
    const ids = (rte.length ? rte : order).filter((id) => wp[id]);
    return { format: 'nmea', name: '', points: ids.map((id) => wp[id]) };
  }
  function splitCsv(line, d) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"' && cur === '') q = true; else if (c === d) { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur); return out.map((x) => x.trim());
  }
  function parseCSV(text) {
    const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { format: 'csv', name: '', points: [] };
    const d = [',', ';', '\t'].map((c) => [c, (lines[0].match(new RegExp(c === '\t' ? '\\t' : '\\' + c, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    const first = splitCsv(lines[0], d); const hasHeader = first.some((x) => /[a-z]{3}/i.test(x) && !/^[NSEW]$/i.test(x) && parseCoord(x, true) == null);
    let li = -1, oi = -1, ni = -1, dli = -1, doi = -1;
    if (hasHeader) {
      first.forEach((h, i) => { const t = h.toLowerCase(); const dec = /decimal|dec\b|\bdd\b/.test(t); if (/^lat|latitude/.test(t)) { if (dec || li < 0) li = i; if (/min|dm/.test(t)) dli = i; } else if (/^lon|longitude|^lng/.test(t)) { if (dec || oi < 0) oi = i; if (/min|dm/.test(t)) doi = i; } else if (/name|wpt|waypoint|id|label/.test(t) && ni < 0 && !/^no\b/.test(t)) ni = i; });
      const dec = first.findIndex((h) => /lat.*decimal|decimal.*lat/i.test(h)); if (dec >= 0) li = dec; const dno = first.findIndex((h) => /lon.*decimal|decimal.*lon/i.test(h)); if (dno >= 0) oi = dno;
    }
    const pts = [];
    lines.slice(hasHeader ? 1 : 0).forEach((l) => {
      const c = splitCsv(l, d);
      let la, lo, nm = '';
      if (li >= 0 && oi >= 0) { la = parseCoord(c[li], true); lo = parseCoord(c[oi], false); nm = ni >= 0 ? c[ni] : ''; }
      else { // no header: the first two cells that read as a coordinate, or a latitude cell with a hemisphere letter in the next one
        const cells = c.map((x, i) => [i, x]); const nums = [];
        cells.forEach(([i, x]) => { if (nums.length < 2 && /\d/.test(x) && /^[NSEW\d\s.\u00B0'"\u2032\u2033-]+$/i.test(x)) nums.push(i); });
        if (nums.length === 2) { la = parseCoord(c[nums[0]], true); lo = parseCoord(c[nums[1]], false); nm = c.find((x, i) => !nums.includes(i) && /[a-z]/i.test(x)) || ''; }
      }
      if (la != null && lo != null) pts.push({ lat: la, lon: lo, name: nm });
    });
    return { format: 'csv', name: '', points: pts };
  }
  function parse(text, filename) {
    const t = String(text == null ? '' : text); const ext = (String(filename || '').match(/\.(\w+)$/) || [, ''])[1].toLowerCase();
    let res;
    if (/<\s*(?:\w+:)?route\b[^>]*RTZ|<\s*(?:\w+:)?waypoints\b/i.test(t) || ext === 'rtz') res = parseRTZ(t);
    else if (/<\s*(?:\w+:)?gpx\b/i.test(t) || ext === 'gpx') res = parseGPX(t);
    else if (/<\s*(?:\w+:)?kml\b/i.test(t) || ext === 'kml') res = parseKML(t);
    else if (/^\s*\$\w{2}(WPL|RTE)/m.test(t)) res = parseNMEA(t);
    else if (/<\s*\?xml|<\s*route\b/i.test(t)) res = parseRTZ(t);
    else res = parseCSV(t);
    if (!res.points.length && res.format !== 'rtz') { const alt = [parseRTZ, parseGPX, parseKML, parseNMEA, parseCSV].map((f) => f(t)).find((x) => x.points.length); if (alt) res = alt; }
    if (!res.points.length) throw new Error('No waypoints were found in this file. Supported: RTZ, GPX, KML, CSV and NMEA 0183 (WPL / RTE).');
    if (res.points.length > 400) res.points = res.points.slice(0, 400);
    return res;
  }

  const api = { FORMATS, write, parse, parseCoord, ddm, toRTZ, toGPX, toKML, toCSV, toNMEA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RouteExchange = api;
})(typeof self !== 'undefined' ? self : this);
