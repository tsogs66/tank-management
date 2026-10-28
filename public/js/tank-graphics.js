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
   * Engine-room pipe colours, the ones a chief reads on the lines themselves.
   * Residual fuel stays brown. Distillate is pale red (MDO), pale orange (MGO)
   * or pale pink (LSMGO), so a diesel line is not the same brown as heavy fuel
   * and the three distillates stay apart. Lubricating oil is yellow. Fresh
   * water is blue. Waste and bilge stay black.
   *
   * Within a family the role still shades the fill (storage darkest, service
   * lightest) so the chain reads at a glance. That shading is for the screen,
   * not an extra pipe band. The same hexes paint the ROB gauges.
   */
  const CONTENT = {
    hfo:   { fill: '#6B3A1F', label: 'HFO',   family: 'Fuel (brown)' },
    lsfo:  { fill: '#8A5530', label: 'LSFO',  family: 'Fuel (brown)' },
    mdo:   { fill: '#E07A7A', label: 'MDO',   family: 'Distillate (pale red)' },
    mgo:   { fill: '#E8926A', label: 'MGO',   family: 'Distillate (pale orange)' },
    lsmgo: { fill: '#E8A8B8', label: 'LSMGO', family: 'Distillate (pale pink)' },
    lube:  { fill: '#F0C14A', label: 'LUBE',  family: 'Lubricating oil (yellow)' },
    water: { fill: '#1F6FB2', label: 'FW',    family: 'Fresh water (ISO 14726 blue)' },
    misc:  { fill: '#2A2E33', label: 'MISC',  family: 'Waste / bilge (ISO 14726 black)' },
    other: { fill: '#6B5230', label: '—',     family: 'Unclassified' },
  };

  /* Role shading follows the oil through the system. Storage is darkest; it
     lightens as the fuel is drawn off to settle and again as it goes to the
     service tank, so the chain reads as a chain at a glance and you can see
     where any parcel has got to without reading a word.
     Overflow sits outside that run and keeps the plain family colour.
     One rule rather than a hand-kept matrix, so adding a grade cannot forget
     to add its shades. */
  const ROLE_SHADE = {
    storage: -0.30,
    settling: 0.12,
    service: 0.34,
    overflow: 0,
    other: 0,
  };

  /** Move a hex colour toward black (amount < 0) or white (amount > 0). */
  function shade(hex, amount) {
    if (!amount) return hex;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = (c) => {
      const target = amount > 0 ? 255 : 0;
      return Math.round(c + (target - c) * Math.abs(amount));
    };
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Grade written on the tank plate. Dots and spaces are ignored so
   * "M.G.O." and "L.S.M.G.O." match the same as "MGO" / "LSMGO".
   * "LS H.F.O." is low-sulphur heavy fuel, not a distillate.
   */
  function fuelGradeFromName(name) {
    const u = String(name || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (!u) return null;
    if (/\bLSMGO\b|LS\s*MGO/.test(u)) return 'lsmgo';
    if (/\bMGO\b|GAS OIL/.test(u)) return 'mgo';
    if (/\bMDO\b|\bDIESEL\b/.test(u)) return 'mdo';
    if (/VLSFO|ULSFO|\bLSFO\b|LS HFO|LS FO/.test(u)) return 'lsfo';
    if (/\bHFO\b/.test(u)) return 'hfo';
    return null;
  }

  function isDistillateKey(grade) {
    return grade === 'mdo' || grade === 'mgo' || grade === 'lsmgo';
  }

  /**
   * Grade the drawing should use.
   *
   * A fuel the tank is carrying wins: an HFO tank transferred onto LSMGO
   * paints as LSMGO, not leftover brown. A stored distillate wins over the
   * plate. A plate that says MDO, MGO or LSMGO wins over a leftover hfo
   * default. A stale report that still says HFO does not paint over that plate.
   *
   * The report bucket "mdo" is MDO/MGO. An MGO tank stays MGO.
   */
  function identityGrade(tank, carriedFuelType) {
    const stored = String((tank && tank.fuelGrade) || '').toLowerCase().trim();
    const inferred = fuelGradeFromName(tank && tank.name);
    const carried = String(carriedFuelType || '').toLowerCase().trim();
    const leftover = !stored || stored === 'hfo' || stored === 'other';

    if (carried === 'lsmgo' || carried === 'lsfo' || carried === 'mgo') return carried;
    if (carried === 'hfo') {
      if (leftover && isDistillateKey(inferred)) return inferred;
      return 'hfo';
    }
    if (carried === 'mdo') {
      if (stored === 'mgo' || inferred === 'mgo') return 'mgo';
      return 'mdo';
    }
    if (isDistillateKey(stored)) return stored;
    if (isDistillateKey(inferred)) return inferred;
    if (stored && stored !== 'other') return stored;
    return inferred || stored || '';
  }

  /** Copy of the tank whose fuelGrade is the grade the drawing should show. */
  function withIdentity(tank, carriedFuelType) {
    if (!tank) return tank;
    const grade = identityGrade(tank, carriedFuelType);
    if (!grade || grade === String(tank.fuelGrade || '').toLowerCase().trim()) return tank;
    return Object.assign({}, tank, { fuelGrade: grade });
  }

  /** The colour this tank's contents print in. */
  function contentKey(tank) {
    if (!tank) return 'other';
    if (tank.category === 'water') return 'water';
    if (tank.category === 'lube') return 'lube';
    if (tank.category === 'misc') return 'misc';
    const grade = String(identityGrade(tank, tank.carriedFuelType) || '').toLowerCase();
    if (CONTENT[grade]) return grade;
    if (/lsmgo/.test(grade)) return 'lsmgo';
    if (/mgo/.test(grade)) return 'mgo';
    if (/mdo/.test(grade)) return 'mdo';
    if (/lsfo|vlsfo|lshfo/.test(grade)) return 'lsfo';
    if (/hfo|rmg|ifo/.test(grade)) return 'hfo';
    return 'other';
  }

  /** The family colour, before the tank's role shades it. */
  function baseColour(tank) { return CONTENT[contentKey(tank)].fill; }

  function liquidColour(tank) {
    return shade(baseColour(tank), ROLE_SHADE[roleOf(tank)] || 0);
  }
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
   * Settling tanks take a 45° cut on the bottom-left (drain at the low corner).
   * Service tanks take a 45° cut on the bottom-right (suction clear of the sump).
   * Overflow tanks stay plain boxes — their character is the weir on top.
   */
  const CUT = 28;            // equal x/y → true 45° corner cut

  function cavityPath(role) {
    if (role === 'settling') {
      // Bottom-left 45° cut: floor drops into a sump on the port/left side.
      return `M${L} ${T} L${R} ${T} L${R} ${B} L${L + CUT} ${B} L${L} ${B - CUT} Z`;
    }
    if (role === 'service') {
      // Bottom-right 45° cut: floor drops into a sump on the starboard/right side.
      return `M${L} ${T} L${R} ${T} L${R} ${B - CUT} L${R - CUT} ${B} L${L} ${B} Z`;
    }
    return `M${L} ${T} L${R} ${T} L${R} ${B} L${L} ${B} Z`;
  }

  /** Where the floor sits at a given x — used to place things on the slope. */
  function floorY(role, x) {
    if (role === 'settling') {
      if (x <= L + CUT) return B - CUT + (x - L);
      return B;
    }
    if (role === 'service') {
      if (x >= R - CUT) return B - (R - x);
      return B;
    }
    return B;
  }

  /** Fittings that say what the tank is for. */
  function fittings(role, uid) {
    const ink = 'var(--tg-ink)';
    const parts = [];
    if (role === 'settling' || role === 'service') {
      // Drain cock at the low corner of the 45° cut.
      const dx = role === 'settling' ? L + CUT * 0.35 : R - CUT * 0.35;
      const dy = floorY(role, dx);
      parts.push(`<path d="M${dx} ${dy} L${dx} ${dy + 7}" stroke="${ink}" stroke-width="2" fill="none"/>`);
      parts.push(`<path d="M${dx - 6} ${dy + 7} L${dx + 6} ${dy + 7} L${dx} ${dy + 14} Z" fill="${ink}"/>`);
      // Heating coil along the flat floor, clear of the cut corner.
      const x0 = role === 'settling' ? L + CUT + 8 : L + 12;
      const x1 = role === 'settling' ? R - 12 : R - CUT - 8;
      parts.push(`<path d="M${x0} ${B - 12} L${x1} ${B - 12}"
        stroke="${ink}" stroke-width="1.6" fill="none" opacity=".55" stroke-dasharray="5 4"/>`);
    }
    if (role === 'service') {
      // Suction standing clear above the right-hand sump.
      const x = L + (R - L) * 0.38;
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

  /* Figures drawn in the cavity. Each one keeps its own ink so a reader can
     tell fill, volume, weight and temperature apart without a caption. */
  const READING_INK = {
    grade: '#e7d3b0',
    pct: '#ffffff',
    volume: '#7ec8ff',
    weight: '#ffd36a',
    temp: '#ff9a7a',
  };

  function haloText(x, y, size, weight, fill, text) {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" stroke="#0b1220" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round">${esc(text)}</text>`;
  }

  function insideReadings(options) {
    const d = options && options.details;
    if (!d) return '';
    const cx = (L + R) / 2;
    const parts = [];
    if (d.grade) parts.push(haloText(cx, 36, 8, 700, READING_INK.grade, d.grade));
    if (d.pct) parts.push(haloText(cx, 56, 16, 800, READING_INK.pct, d.pct));
    if (d.volume) parts.push(haloText(L + 28, 78, 8, 700, READING_INK.volume, d.volume));
    if (d.weight) parts.push(haloText(R - 28, 78, 8, 700, READING_INK.weight, d.weight));
    if (d.temp) parts.push(haloText(cx, 96, 8, 700, READING_INK.temp, d.temp));
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
        ${known && level > 0 ? `<rect class="tg-liquid" x="${L - 4}" y="${levelY}" width="${R - L + 8}" height="${B - levelY + 8}"
            fill="url(#${uid}-liq)" style="color:${colour}"/>
          <rect class="tg-surface" x="${L - 4}" y="${levelY}" width="${R - L + 8}" height="2.5" fill="#fff" opacity=".28"/>` : ''}
        ${settles && known && level > 0
          ? (role === 'settling'
            ? `<path d="M${L - 4} ${B - CUT - 1} L${L + CUT} ${B - 1} L${R + 4} ${B - 1} L${R + 4} ${B + 6} L${L - 4} ${B + 6} Z" fill="#000" opacity=".4"/>`
            : `<path d="M${L - 4} ${B - 1} L${R - CUT} ${B - 1} L${R + 4} ${B - CUT - 1} L${R + 4} ${B + 6} L${L - 4} ${B + 6} Z" fill="#000" opacity=".4"/>`)
          : ''}
      </g>

      ${options.safeFill !== null ? `<path d="M${L - 5} ${safeY} L${R + 5} ${safeY}" class="tg-safe"/>` : ''}

      <path d="${cavity}" class="tg-shell"/>
      ${fittings(role, uid)}
      ${insideReadings(options)}
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
    settling: '45° bottom-left cut, drain at the low corner, heating coil',
    service: '45° bottom-right cut, suction standing clear above the sump',
    overflow: 'Weir and downcomer — catches what the others cannot hold',
  };

  return {
    tankSvg, liquidColour, baseColour, shade, contentLabel, contentKey, roleOf,
    fuelGradeFromName, identityGrade, withIdentity,
    CONTENT, ROLE_MEANING, ROLE_SHADE,
  };
});
