// Route files for ECDIS: write and read RTZ, GPX, KML, CSV and NMEA 0183.
'use strict';
const assert = require('assert');
const RX = require('./route-exchange.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const route = { name: 'Nantes to New Orleans', vessel: 'MV TEST', imo: 'IMO 9722101', voyage: '08', points: [
  { lat: 47.2, lon: -1.55, name: 'NANTES' }, { lat: 48.5, lon: -5.2 }, { lat: 25.9, lon: -79.7 }, { lat: -33.9, lon: 151.2, name: 'Cape & "Bay" <1>' }, { lat: 29.95, lon: -90.07, name: 'NEW ORLEANS' }] };
const near = (a, b) => Math.abs(a - b) < 1e-5;
RX.FORMATS.forEach((f) => {
  const back = RX.parse(RX.write(f.id, route, { xtd: 0.3, radius: 2 }), 'route.' + f.ext);
  ok(back.format === f.id && back.points.length === 5 && back.points.every((p, i) => near(p.lat, route.points[i].lat) && near(p.lon, route.points[i].lon)), f.id + ': a written route is read back with the same positions');
});
const rtz = RX.write('rtz', route, { xtd: 0.3, radius: 2, geometry: 'Loxodrome', author: 'Chief' });
ok(/xmlns="http:\/\/www\.cirm\.org\/RTZ\/1\/1" version="1\.1"/.test(rtz) && /<routeInfo routeName="Nantes to New Orleans" routeAuthor="Chief" vesselName="MV TEST" vesselIMO="9722101" vesselVoyage="08"\/>/.test(rtz), 'RTZ 1.1 with the route information');
ok(/<defaultWaypoint radius="2">\s*<leg starboardXTD="0\.3" portsideXTD="0\.3" geometryType="Loxodrome"\/>/.test(rtz) && /<waypoint id="1" revision="1" name="NANTES">\s*<position lat="47\.200000" lon="-1\.550000"\/>/.test(rtz), 'cross-track limit, turn radius and leg geometry are written, waypoints numbered from 1');
ok(/name="Cape &amp; &quot;Bay&quot; &lt;1&gt;"/.test(rtz) && RX.parse(rtz).points[3].name === 'Cape & "Bay" <1>', 'names with XML characters are escaped and read back');
// a file written by another system: namespace prefix, RTZ 1.0, single quotes, extra elements
const other = `<?xml version="1.0" encoding="utf-8"?><rtz:route xmlns:rtz="http://www.cirm.org/RTZ/1/0" version="1.0"><rtz:routeInfo routeName='Ex A'/><rtz:waypoints><rtz:defaultWaypoint radius="0.5"/><rtz:waypoint id='7' name='Start'><rtz:position lat='51.5' lon='1.2'/><rtz:leg speedMin='10'/></rtz:waypoint><rtz:waypoint id='8'><rtz:position lat='52' lon='2'/></rtz:waypoint></rtz:waypoints><rtz:extensions/></rtz:route>`;
const po = RX.parse(other, 'a.rtz');
ok(po.name === 'Ex A' && po.points.length === 2 && po.points[0].name === 'Start' && po.points[1].lat === 52, 'RTZ 1.0 with a namespace prefix and single quotes');
const gpx = `<gpx version="1.1"><wpt lat="1" lon="2"><name>A</name></wpt><wpt lat="3" lon="4"/></gpx>`;
ok(RX.parse(gpx).points.length === 2, 'GPX with plain waypoints and no route');
ok(RX.parse('<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>').points.length === 2, 'GPX track points');
ok(RX.parse('<kml><Document><Placemark><name>Fix 1</name><Point><coordinates>10.5,50.25,0</coordinates></Point></Placemark></Document></kml>').points[0].lat === 50.25, 'KML points: longitude first');
const nmea = RX.write('nmea', route); const lines = nmea.trim().split(/\r?\n/);
ok(lines.length === 6 && lines.every((l) => /^\$GP(WPL|RTE),.*\*[0-9A-F]{2}$/.test(l)), 'NMEA: five waypoints and one route sentence, each with a checksum');
ok(lines.every((l) => { const b = l.slice(1, l.indexOf('*')); let c = 0; for (const ch of b) c ^= ch.charCodeAt(0); return c.toString(16).toUpperCase().padStart(2, '0') === l.slice(-2); }), 'the checksums are right');
ok(RX.parse('$GPWPL,4916.45,N,12311.12,W,ALFA*2D\n$GPWPL,4917.00,N,12312.00,W,BRAVO*00').points.length === 2 && near(RX.parse('$GPWPL,4916.45,N,12311.12,W,ALFA*2D').points[0].lat, 49 + 16.45 / 60), 'NMEA waypoint sentences are read');
// CSV: several writings
ok(RX.parse('Name;Lat;Lon\nA;47 12.5 N;001 30.0 W\nB;48°30\'00"N;5°12\'W').points.map((p) => p.lat.toFixed(4) + ',' + p.lon.toFixed(4)).join(' ') === '47.2083,-1.5000 48.5000,-5.2000', 'CSV with degrees and minutes in two writings, semicolon separated');
ok(RX.parse('47.5,-3.25\n48,-4').points.length === 2, 'CSV without a header');
ok(RX.parse('ID,Latitude,Longitude\nWP1,4712.50N,00130.00W').points[0].lon === -1.5, 'CSV with ddmm.mm and a hemisphere letter');
ok(RX.parseCoord('91', true) === null && RX.parseCoord('abc', true) === null && RX.parseCoord('', false) === null, 'impossible coordinates are refused');
let err = ''; try { RX.parse('hello world'); } catch (e) { err = e.message; }
ok(/No waypoints were found/.test(err), 'a file without waypoints says so in a sentence');
try { RX.write('rtz', { name: 'x', points: [{ lat: 1, lon: 2 }] }); } catch (e) { err = e.message; }
ok(/at least two points/.test(err), 'a route needs two points');
ok(RX.parse(RX.write('rtz', { name: 'x', points: [{ lat: 10, lon: 185 }, { lat: 11, lon: 190 }] })).points[0].lon === -175, 'longitudes past 180 are wrapped');
// a real Furuno ECDIS export (RTZ 1.0, XML comments, vendor extensions, empty waypoint names, first waypoint without a leg)
const furuno = `<?xml version="1.0" encoding="UTF-8"?>
<!--route node-->
<route version="1.0" xmlns="http://www.cirm.org/RTZ/1/0">
  <routeInfo routeName="NOLA TO SINGAPORE VIA GALLEON PASS" optimizationMethod="MAX speed"><extensions><extension manufacturer="Furuno" name="AdditionalRouteInfo" version="1.0"><property income="0" safetyContour="16"/></extension></extensions></routeInfo>
  <waypoints>
    <!--No.1 waypoint--><waypoint id="1" name="" radius="1.000000"><position lat="28.877667" lon="-89.436667"/></waypoint>
    <!--No.2 waypoint--><waypoint id="2" name="" radius="1.000000"><position lat="28.850000" lon="-89.435000"/>
      <leg portsideXTD="1.000000" starboardXTD="1.000000" geometryType="Loxodrome" speedMax="14.000000"/>
      <extensions><extension manufacturer="Furuno" name="AdditionalLegInfo" version="1.0"><property margin="185.000000"/></extension></extensions></waypoint>
    <!--No.3 waypoint--><waypoint id="3" name="" radius="1.000000"><position lat="-34.953333" lon="18.296667"/><leg portsideXTD="1.000000" starboardXTD="1.000000" geometryType="Loxodrome"/></waypoint>
  </waypoints><schedules/></route>`;
const fr = RX.parse(furuno, 'x.rtz');
ok(fr.name === 'NOLA TO SINGAPORE VIA GALLEON PASS' && fr.points.length === 3 && fr.points[2].lat === -34.953333 && fr.points[0].lon === -89.436667, 'Furuno RTZ 1.0 export is read (comments, extensions, empty names)');
ok(RX.parse(RX.write('rtz', fr), 'y.rtz').points.length === 3, 'and written back as RTZ');
console.log(`route exchange OK (${n} checks)`);
