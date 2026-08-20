/**
 * Tank graphics — draw a tank as a tank.
 *
 * Two things are being said with a picture rather than a caption:
 *
 *   the level  — liquid fills the tank's actual cavity, so a sloped floor makes
 *                the liquid slope with it, and a nearly-empty settling tank
 *                looks like one rather than like a bar chart at 4%;
 *
 *   the purpose — a settling tank has a floor falling to a sump with a drain at
 *                the low corner, because that is what it is for. A service tank
 *                adds the suction standing clear above that sump, which is the
 *                whole point of the pair. Nothing writes "settling" on the
 *                drawing; the drawing is the word.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TankGraphics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- content colours ----------
   *
   * ISO 14726 (identification colours for the content of piping systems) gives
   * the MAIN colour: brown for flammable liquids — fuel and lube alike — blue
   * for fresh water, black/grey for waste and bilge. Those are the colours used
   * here for each family.
   *
   * The standard separates the grades within a family by additional colour
   * bands rather than by shading the brown. Shipping every band would leave
   * eight near-identical brown tanks on the screen, so the grades are shaded
   * instead: heaviest darkest, distillates lighter. That shading is a
   * legibility decision and is not itself the standard — the family colour is.
   */
  const CONTENT = {
    hfo:   { fill: '#3d2410', label: 'HFO',   family: 'Flammable liquid (ISO brown)' },
    lsfo:  { fill: '#5b3a1b', label: 'LSFO',  family: 'Flammable liquid (ISO brown)' },
    mdo:   { fill: '#8a5a24', label: 'MDO',   family: 'Flammable liquid (ISO brown)' },
    mgo:   { fill: '#b07f2e', label: 'MGO',   family: 'Flammable liquid (ISO brown)' },
    lsmgo: { fill: '#c29341', label: 'LSMGO', family: 'Flammable liquid (ISO brown)' },
    lube:  { fill: '#6f6327', label: 'LUBE',  family: 'Flammable liquid (ISO brown)' },
    water: { fill: '#2f6fb5', label: 'FW',    family: 'Fresh water (ISO blue)' },
    misc:  { fill: '#4a5261', label: 'MISC',  family: 'Waste / bilge (ISO black)' },
    other: { fill: '#6b5230', label: '—',     family: 'Unclassified' },
  };

  /** The colour this tank's contents print in. */
  function contentKey(tank) {
    if (!tank) return 'other';
    if (tank.category === 'water') return 'water';
    if (tank.category === 'lube') return 'lube';
    if (tank.category === 'misc') return 'misc';
    const grade = String(tank.fuelGrade || '').toLowerCase();
    if (CONTENT[grade]) return grade;
    if (/lsmgo/.test(grade)) return 'lsmgo';
    if (/mgo/.test(grade)) return 'mgo';
    if (/mdo/.test(grade)) return 'mdo';
    if (/lsfo|vlsfo|lshfo/.test(grade)) return 'lsfo';
    if (/hfo|rmg|ifo/.test(grade)) return 'hfo';
    return 'other';
  }
  function liquidColour(tank) { return CONTENT[contentKey(tank)].fill; }
  function contentLabel(tank) { return CONTENT[contentKey(tank)].label; }

  /* ---------- geometry ---------- */
  const W = 132;
  const H = 128;
  const L = 14;            // cavity left
  const R = 118;           // cavity right
  const T = 16;            // cavity top
  const B = 108;           // cavity bottom (the high side of any slope)

  function roleOf(tank) {
    const r = String((tank && tank.fuelRole) || '').toLowerCase();
    if (r === 'settling' || r === 'service' || r === 'overflow' || r === 'storage') return r;
    return 'storage';
  }

  /**
   * The inside of the tank, as a path. The liquid is clipped to this, so the
   * shape of the floor shapes the oil sitting on it.
   *
   * Settling and service floors fall to a sump on the right. Overflow tanks are
   * plain boxes — their character is the weir and downcomer drawn on top.
   */
  const SLOPE = 18;          // how far the floor falls across the tank
  const SUMP_W = 18;         // the flat catch at the low corner

  function cavityPath(role) {
    if (role === 'settling' || role === 'service') {
      // Floor falls left-to-right and ends in a short flat sump at the low
      // corner. Drawn as one closed path so the liquid, clipped to it, sits on
      // the slope instead of on an invented flat bottom.
      return `M${L} ${T} L${R} ${T} L${R} ${B} L${R - SUMP_W} ${B} L${L} ${B - SLOPE} Z`;
    }
    return `M${L} ${T} L${R} ${T} L${R} ${B} L${L} ${B} Z`;
  }

  /** Where the floor sits at a given x — used to place things on the slope. */
  function floorY(role, x) {
    if (role !== 'settling' && role !== 'service') return B;
    if (x >= R - SUMP_W) return B;
    return B - SLOPE + ((x - L) / (R - SUMP_W - L)) * SLOPE;
  }

  /** Fittings that say what the tank is for. */
  function fittings(role, uid) {
    const ink = 'var(--tg-ink)';
    const parts = [];
    if (role === 'settling' || role === 'service') {
      // Drain cock at the low corner — the point of the slope is that the water
      // and sludge collect here, so this is where they are let out.
      const dx = R - SUMP_W / 2;
      parts.push(`<path d="M${dx} ${B} L${dx} ${B + 7}" stroke="${ink}" stroke-width="2" fill="none"/>`);
      parts.push(`<path d="M${dx - 6} ${B + 7} L${dx + 6} ${B + 7} L${dx} ${B + 14} Z" fill="${ink}"/>`);
      // Heating coil, following the slope: these tanks are kept warm so the
      // heavy ends stay fluid enough to separate.
      const y0 = floorY(role, L + 12) - 12;
      const y1 = floorY(role, R - SUMP_W - 6) - 12;
      parts.push(`<path d="M${L + 12} ${y0} L${R - SUMP_W - 6} ${y1}"
        stroke="${ink}" stroke-width="1.6" fill="none" opacity=".55" stroke-dasharray="5 4"/>`);
    }
    if (role === 'service') {
      // Suction standing clear above the sump: clean oil is drawn from well
      // above whatever has settled out. This is the difference from a settling
      // tank, and the reason the pair exists.
      const x = L + 30;
      const bell = floorY(role, x) - 20;
      parts.push(`<path d="M${x} ${T - 8} L${x} ${bell}" stroke="${ink}" stroke-width="2.2" fill="none"/>`);
      parts.push(`<path d="M${x - 7} ${bell} L${x + 7} ${bell} L${x} ${bell + 7} Z" fill="${ink}"/>`);
    }
    if (role === 'overflow') {
      // Weir lip and downcomer: this tank catches what the others cannot hold.
      parts.push(`<path d="M${L - 6} ${T - 9} L${R - 30} ${T - 9} L${R - 30} ${T + 12} L${R - 22} ${T + 12}"
        stroke="${ink}" stroke-width="2.2" fill="none"/>`);
      parts.push(`<path d="M${R - 26} ${T + 12} L${R - 18} ${T + 12} L${R - 22} ${T + 19} Z" fill="${ink}"/>`);
      parts.push(`<path d="M${L} ${T + 22} L${L + 24} ${T + 22}" stroke="${ink}" stroke-width="2" fill="none" opacity=".8"/>`);
    }
    if (role === 'storage') {
      // A plain bottom suction — nothing else to say about a storage tank.
      parts.push(`<path d="M${(L + R) / 2} ${B} L${(L + R) / 2} ${B + 9}" stroke="${ink}" stroke-width="2" fill="none"/>`);
    }
    return parts.join('');
  }

  /**
   * Draw one tank.
   * `pct` is the fill percentage, or null when the tank has not been sounded.
   */
  function tankSvg(tank, pct, opts) {
    const options = opts || {};
    const role = roleOf(tank);
    const uid = 'tg' + Math.random().toString(36).slice(2, 9);
    const colour = liquidColour(tank);
    const known = pct != null && Number.isFinite(pct);
    const level = known ? Math.max(0, Math.min(100, pct)) : 0;
    const levelY = B - ((B - T) * level) / 100;
    const safeY = B - ((B - T) * (options.safeFill != null ? options.safeFill : 85)) / 100;
    const cavity = cavityPath(role);
    const settles = role === 'settling' || role === 'service';

    return `<svg class="tg-svg" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${esc(tank.name || 'tank')}, ${known ? Math.round(level) + '% full' : 'not sounded'}">
      <defs>
        <clipPath id="${uid}-cav"><path d="${cavity}"/></clipPath>
        <linearGradient id="${uid}-liq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${colour}" stop-opacity=".92"/>
          <stop offset="100%" stop-color="${colour}" stop-opacity="1"/>
        </linearGradient>
      </defs>

      <path d="${cavity}" class="tg-void"/>

      <g clip-path="url(#${uid}-cav)">
        ${known && level > 0 ? `<rect x="${L - 4}" y="${levelY}" width="${R - L + 8}" height="${B - levelY + 8}"
            fill="url(#${uid}-liq)"/>
          <rect x="${L - 4}" y="${levelY}" width="${R - L + 8}" height="2.5" fill="#fff" opacity=".28"/>` : ''}
        ${settles && known && level > 0
          ? `<path d="M${L - 4} ${B - SLOPE - 1} L${R - SUMP_W} ${B - 1} L${R + 4} ${B - 1} L${R + 4} ${B + 6} L${L - 4} ${B + 6} Z"
              fill="#000" opacity=".4"/>` : ''}
      </g>

      ${options.safeFill !== null ? `<path d="M${L - 5} ${safeY} L${R + 5} ${safeY}" class="tg-safe"/>` : ''}

      <path d="${cavity}" class="tg-shell"/>
      ${fittings(role, uid)}
    </svg>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** The purpose each silhouette is drawing, for the legend and the tooltip. */
  const ROLE_MEANING = {
    storage: 'Plain box, bottom suction',
    settling: 'Floor falling to a sump, drain at the low corner, heating coil',
    service: 'As settling, plus suction standing clear above the sump',
    overflow: 'Weir and downcomer — catches what the others cannot hold',
  };

  return {
    tankSvg, liquidColour, contentLabel, contentKey, roleOf,
    CONTENT, ROLE_MEANING,
  };
});
