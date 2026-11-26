// Offline port lookup over data/ports/ports.json. Works in Node (require) and browsers (window.PortList).
(function (root) {
  'use strict';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const SIZE_RANK = { L: 4, M: 3, S: 2, V: 1 };
  function create(data) {
    const ports = (data.ports || data).map(p => Object.assign({ key: norm(p.name) }, p));
    return {
      all: () => ports,
      // Type-ahead search for From/To pickers: prefix matches first, then word-prefix, then substring; larger harbours win ties.
      search(q, opts) {
        opts = opts || {}; const n = norm(q); if (!n) return [];
        const limit = opts.limit || 20, cc = opts.country ? String(opts.country).toUpperCase() : null;
        const scored = [];
        for (const p of ports) {
          if (cc && p.cc !== cc) continue;
          let s = -1;
          if (p.key === n) s = 0; else if (p.key.startsWith(n)) s = 1;
          else if (p.key.includes(' ' + n)) s = 2; else if (p.key.includes(n)) s = 3;
          if (s >= 0) scored.push([s, -(SIZE_RANK[p.size] || 0), p.key, p]);
        }
        scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
        return scored.slice(0, limit).map(x => x[3]);
      },
      byId: id => ports.find(p => p.id === +id) || null,
      nearest(lat, lon, n) {
        const rad = Math.PI / 180, out = ports.map(p => {
          const a = Math.sin((p.lat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(p.lat * rad) * Math.sin((p.lon - lon) * rad / 2) ** 2;
          return [3440.065 * 2 * Math.asin(Math.sqrt(a)), p]; // nautical miles (great-circle)
        });
        out.sort((a, b) => a[0] - b[0]);
        return out.slice(0, n || 5).map(x => Object.assign({ distNm: Math.round(x[0] * 10) / 10 }, x[1]));
      },
    };
  }
  const api = { create, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PortList = api;
})(typeof self !== 'undefined' ? self : this);
