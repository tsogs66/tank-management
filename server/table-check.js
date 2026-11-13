/**
 * Table checking for imported calibration books (PDF, and the same rules for
 * CSV/Excel patches).
 *
 * A calibration table is read off a printed page. Whatever reads it - the PDF
 * text layer, OCR, a typist - will now and then get a digit wrong, drop a
 * decimal point or lose a row, and the app then books fuel against the wrong
 * curve on a sheet somebody signs. A tank's volume can only grow as the
 * sounding grows, a step is the same size all the way down, and the book's own
 * pages should agree with each other; none of that needs the original PDF to
 * check.
 *
 * This module turns those facts into a review of every imported table:
 *   - repairs the slips that can be repaired with certainty (a shifted
 *     decimal, a single value that breaks the curve) and says which cells it
 *     touched, so the preview can show them;
 *   - refuses what it cannot repair (a run of bad rows, a curve that falls, a
 *     volume far over the tank's capacity);
 *   - cross-checks against whatever second source exists: another table of the
 *     same tank in the same book, the tank's capacity, the tank as it is
 *     stored now, and the rows two pages share where a table was spliced.
 *
 * Pure functions, no I/O.
 */
'use strict';

const SEVERITY = { error: 'error', warn: 'warn', info: 'info' };

/* A repair is only made when the replacement is this close to what the
   neighbours say it should be, as a share of one step of the curve. */
const REPAIR_TOLERANCE = 0.2;
/* Cross-checks: fraction of the larger value. */
const CROSS_WARN = 0.01;
const CROSS_FAIL = 0.05;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function median(arr) {
  const a = arr.filter(isNum).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function round(n, d = 4) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** The step a sounding axis is printed in: its most common difference. */
function modalStep(axis) {
  const counts = new Map();
  for (let i = 1; i < axis.length; i++) {
    const d = round(Math.abs(axis[i] - axis[i - 1]), 3);
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 0;
  let n = 0;
  for (const [d, c] of counts) if (c > n || (c === n && d < best)) { best = d; n = c; }
  return { step: best, share: axis.length > 1 ? n / (axis.length - 1) : 0 };
}

function issue(list, severity, code, message, extra = {}) {
  list.push({ severity, code, message, ...extra });
}

/* ------------------------------------------------------------------ */
/* Axis                                                                */
/* ------------------------------------------------------------------ */

/** Indices of a longest strictly rising run in `xs` (patience sorting). */
function longestRising(xs) {
  const tails = [];
  const tailIdx = [];
  const prev = new Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < xs[i]) lo = mid + 1; else hi = mid;
    }
    tails[lo] = xs[i];
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const keep = new Set();
  let k = tailIdx[tails.length - 1];
  while (k != null && k >= 0) { keep.add(k); k = prev[k]; }
  return keep;
}

/**
 * Put a sounding axis in order and note what was wrong with it.
 * `rows` is an array of { x, v } so a fixed axis carries its volume with it.
 */
function checkAxis(rows, issues, repairs) {
  let out = rows.filter((r) => isNum(r.x));
  if (out.length < rows.length) {
    issue(issues, SEVERITY.warn, 'axis-unreadable',
      `${rows.length - out.length} row(s) had a sounding that could not be read and were dropped`);
  }

  // One sounding that cannot be right: the rows either side are exactly two
  // steps apart, so the one between them can only be the middle. This is a
  // digit misread (410 for 40) and is mended before anything is re-ordered.
  {
    const { step: s0, share: sh0 } = modalStep(out.map((r) => r.x));
    if (s0 > 0 && sh0 >= 0.6 && out.length >= 6) {
      out = out.map((r) => ({ ...r }));
      for (let i = 1; i < out.length - 1; i++) {
        const span = out[i + 1].x - out[i - 1].x;
        const mid = out[i - 1].x + s0;
        if (Math.abs(span - 2 * s0) < s0 * 0.02 && Math.abs(out[i].x - mid) > s0 * 0.02) {
          repairs.push({
            code: 'axis-repaired', row: i, from: out[i].x, to: round(mid, 6),
            message: `Sounding ${out[i].x} did not fit the ${s0} step and was read as ${round(mid, 6)}`,
          });
          out[i].x = round(mid, 6);
          out[i].axisRepaired = true;
        }
      }
    }
  }

  // A row whose sounding has nothing to do with the rest (a speckle read as 1324
  // or -65): if sorting does not make the volumes run smoothly, drop the few rows
  // that break an otherwise rising axis.
  if (out.length >= 10 && out.every((r) => isNum(r.v))) {
    let breaks = 0;
    for (let i = 1; i < out.length; i++) if (out[i].x <= out[i - 1].x) breaks++;
    if (breaks > 0) {
      const sorted = out.slice().sort((a, b) => a.x - b.x);
      const dirGuess = sorted[sorted.length - 1].v >= sorted[0].v ? 1 : -1;
      let wrong = 0;
      for (let i = 1; i < sorted.length; i++) if (dirGuess * (sorted[i].v - sorted[i - 1].v) < -1e-9) wrong++;
      if (wrong > Math.max(1, sorted.length * 0.01)) {
        const keep = longestRising(out.map((r) => r.x));
        const dropped = out.filter((_, i) => !keep.has(i));
        if (dropped.length && dropped.length <= Math.max(3, Math.ceil(out.length * 0.06))) {
          out = out.filter((_, i) => keep.has(i));
          for (const d of dropped) {
            repairs.push({
              code: 'row-dropped', x: d.x, value: d.v,
              message: `Row "${d.x}  ${d.v}" does not belong to the table (its sounding is out of sequence) and was left out`,
            });
          }
        }
      }
    }
  }

  // Out of order? Sort only when most of the axis already runs one way.
  let ascending = 0;
  let descending = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].x > out[i - 1].x) ascending++;
    else if (out[i].x < out[i - 1].x) descending++;
  }
  if (descending > 0 && descending <= Math.max(2, Math.floor(out.length * 0.1)) && ascending > descending) {
    out = out.slice().sort((a, b) => a.x - b.x);
    repairs.push({ code: 'axis-sorted', message: 'Soundings were out of order and have been sorted' });
  } else if (descending > ascending) {
    // A table printed from the top down: ullage 0 at the top is normal.
    const flip = out.slice().reverse();
    let flipOk = 0;
    for (let i = 1; i < flip.length; i++) if (flip[i].x > flip[i - 1].x) flipOk++;
    if (flipOk >= flip.length - 1) {
      out = flip;
      repairs.push({ code: 'axis-reversed', message: 'Table was printed from the bottom up and has been turned round' });
    }
  }

  // The same sounding twice.
  const seen = new Map();
  const dedup = [];
  for (const r of out) {
    const k = round(r.x, 6);
    if (seen.has(k)) {
      const first = seen.get(k);
      const same = r.v == null || first.v == null || Math.abs(r.v - first.v) <= 1e-9 * Math.max(1, Math.abs(first.v));
      if (!same) {
        issue(issues, SEVERITY.warn, 'axis-duplicate-conflict',
          `Sounding ${r.x} appears twice with different values (${first.v} and ${r.v}); the first was kept`,
          { x: r.x });
      }
      continue;
    }
    seen.set(k, r);
    dedup.push(r);
  }
  if (dedup.length < out.length) {
    repairs.push({ code: 'axis-duplicates', message: `${out.length - dedup.length} repeated row(s) removed` });
  }
  out = dedup;

  // Rows missing from the run.
  const { step, share } = modalStep(out.map((r) => r.x));
  if (step > 0 && share >= 0.6 && out.length >= 6) {
    const gaps = [];
    for (let i = 1; i < out.length; i++) {
      const d = out[i].x - out[i - 1].x;
      if (d > step * 1.5) gaps.push({ i, from: out[i - 1].x, to: out[i].x, missing: Math.round(d / step) - 1 });
    }
    if (gaps.length) {
      const total = gaps.reduce((s, g) => s + g.missing, 0);
      // One or two lost rows in a long table sit on a line the rows either side
      // draw: put them back, say so, and show them as filled. More than that,
      // or a table that is coarse in places on purpose, is only reported.
      const fillable = out.length >= 20 && total <= Math.max(3, Math.ceil(out.length * 0.1)) &&
        gaps.every((g) => g.missing <= 2);
      if (fillable) {
        const filled = [];
        const next = [];
        let gi = 0;
        for (let i = 0; i < out.length; i++) {
          if (gi < gaps.length && gaps[gi].i === i) {
            const a = out[i - 1];
            const b = out[i];
            for (let k = 1; k <= gaps[gi].missing; k++) {
              const t = (k * step) / (b.x - a.x);
              const x = round(a.x + k * step, 6);
              const row = { x, v: null, filled: true };
              if (a.ref && b.ref) {
                row.ref = { cells: a.ref.cells.map((c, j) => round(c + (b.ref.cells[j] - c) * t, 4)), pad: 0 };
              } else if (isNum(a.v) && isNum(b.v)) {
                row.v = round(a.v + (b.v - a.v) * t, 4);
              }
              next.push(row);
              filled.push(x);
            }
            gi++;
          }
          next.push(out[i]);
        }
        out = next;
        issue(issues, SEVERITY.warn, 'row-filled',
          `${filled.length} row(s) were missing (sounding ${filled.slice(0, 6).join(', ')}) and were filled by interpolation - check them against the book`,
          { xs: filled.slice(0, 30) });
      } else {
        issue(issues, SEVERITY.warn, 'axis-gap',
          `${total} row(s) look to be missing (step ${step}): ${gaps.slice(0, 4).map((g) => `${g.from}→${g.to}`).join(', ')}${gaps.length > 4 ? '…' : ''}`,
          { gaps: gaps.slice(0, 20).map(({ from, to, missing }) => ({ from, to, missing })) });
      }
    }
  }
  // The row for sounding 0 is the first the scan tends to lose. A table that starts exactly one
  // step above zero has probably lost it; say so, since what it held cannot be guessed for a grid.
  if (step > 0 && share >= 0.6 && out.length >= 6 && out[0].x > 0 && out[0].x <= step * 1.5 && !out[0].filled) {
    issue(issues, SEVERITY.warn, 'no-zero-row',
      `There is no row for sounding 0 - the table starts at ${out[0].x}, one step up. The first row may have been lost.`,
      { first: out[0].x });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Volume curve                                                        */
/* ------------------------------------------------------------------ */

/**
 * Readings a figure could have been before the scan changed it: one digit that
 * is not really there (a decimal point read as a 7: 50.983 -> 507983), with the
 * point put back where it belongs. Used only to pick the reading that lands on
 * the line the rows either side draw.
 */
function digitCandidates(value) {
  const digits = String(Math.abs(value)).replace('.', '');
  if (!/^\d{3,12}$/.test(digits)) return [];
  const out = [];
  for (let d = 0; d < digits.length; d++) {
    const rest = digits.slice(0, d) + digits.slice(d + 1);
    for (let p = 1; p <= rest.length; p++) {
      out.push(Number(`${rest.slice(0, p)}.${rest.slice(p) || '0'}`));
    }
  }
  return out;
}

/** Linear estimate of row i from its two neighbours. */
function neighbourEstimate(x, v, i) {
  const x0 = x[i - 1];
  const x1 = x[i + 1];
  if (x1 === x0) return v[i - 1];
  return v[i - 1] + ((v[i + 1] - v[i - 1]) * (x[i] - x0)) / (x1 - x0);
}

/**
 * Check one curve of volume against sounding and mend what can be mended.
 *
 * @param {number[]} xIn   sounding axis
 * @param {number[]} vIn   volume at each sounding
 * @param {object}   opts  { direction: 1 | -1 (volume rising or falling with x),
 *                           capacity, label }
 */
function reviewCurve(xIn, vIn, opts = {}) {
  const issues = [];
  const repairs = [];
  const rows = [];
  for (let i = 0; i < Math.min(xIn.length, vIn.length); i++) {
    rows.push({ x: Number(xIn[i]), v: Number(vIn[i]) });
  }
  if (xIn.length !== vIn.length) {
    issue(issues, SEVERITY.warn, 'length-mismatch',
      `Soundings (${xIn.length}) and volumes (${vIn.length}) are not the same length`);
  }

  let work = checkAxis(rows, issues, repairs).map((r) => ({ ...r }));
  let n = work.length;
  if (n < 2) {
    issue(issues, SEVERITY.error, 'too-short', 'Fewer than two rows could be read');
    return finish(work, issues, repairs, opts);
  }
  if (n < 8) issue(issues, SEVERITY.warn, 'short-table', `Only ${n} rows - a full table is usually much longer`);

  // Direction of the curve: rising with sounding, or falling for an ullage book.
  let direction = opts.direction;
  if (direction !== 1 && direction !== -1) {
    const half = Math.max(1, Math.floor(n / 4));
    const head = median(work.slice(0, half).map((r) => r.v));
    const tail = median(work.slice(n - half).map((r) => r.v));
    direction = tail >= head ? 1 : -1;
  }

  // The first row (sounding 0, volume 0) is the one most often lost: the line
  // starts at the margin, where a scan is darkest. A sounding table starts at
  // zero, so when the first row left is exactly one step up it is put back.
  if (direction === 1 && n >= 20 && isNum(work[0].v) && isNum(work[1].v)) {
    const { step: st0, share: sh0 } = modalStep(work.map((r) => r.x));
    if (st0 > 0 && sh0 >= 0.6 && Math.abs(work[0].x - st0) < st0 * 0.01) {
      const v0 = Math.max(0, 2 * work[0].v - work[1].v);
      if (v0 <= Math.max(work[0].v * 0.25, 1e-6)) {
        work.unshift({ x: 0, v: round(v0, 4), filled: true });
        issue(issues, SEVERITY.warn, 'row-filled',
          'The first row (sounding 0) was missing and has been added', { xs: [0] });
      }
    }
  }
  n = work.length;

  // Unreadable or negative volumes.
  work.forEach((r, i) => {
    if (!isNum(r.v)) {
      r.bad = true;
      r.badWhy = 'unreadable';
    } else if (r.v < -0.005) {
      r.bad = true;
      r.badWhy = 'negative';
    }
  });

  // Whole-curve scale: values far above the rest are blow-ups.
  const sortedPos = work.filter((r) => !r.bad && r.v > 0).map((r) => r.v).sort((a, b) => a - b);
  const p90 = percentile(sortedPos, 0.9);
  const cap = isNum(opts.capacity) && opts.capacity > 0 ? opts.capacity : 0;
  const ceiling = Math.max(p90 * 3, cap * 1.5, p90 + 50);
  if (p90 > 0) {
    work.forEach((r) => {
      if (!r.bad && r.v > ceiling) {
        r.bad = true;
        r.badWhy = 'blow-up';
      }
    });
  }

  // The step each volume is expected to take: used to size every tolerance.
  const diffs = [];
  for (let i = 1; i < n; i++) {
    if (!work[i].bad && !work[i - 1].bad) diffs.push(Math.abs(work[i].v - work[i - 1].v));
  }
  const typicalStep = median(diffs.filter((d) => d > 0)) || 0;

  // A block of rows lifted off the curve and put back: a jump far bigger than
  // any ordinary step, followed soon after by the same jump the other way.
  if (typicalStep > 0) {
    const K = typicalStep * 12;
    for (let i = 1; i < n; i++) {
      if (work[i].bad || work[i - 1].bad) continue;
      const d = work[i].v - work[i - 1].v;
      if (Math.abs(d) <= K) continue;
      for (let j = i + 1; j < Math.min(n, i + 40); j++) {
        if (work[j].bad || work[j - 1].bad) break;
        const e = work[j].v - work[j - 1].v;
        if (e * d < 0 && Math.abs(e) > K * 0.5 && Math.abs(work[j].v - work[i - 1].v) < Math.abs(d) * 0.5) {
          for (let k = i; k < j; k++) { work[k].bad = true; work[k].badWhy = 'off-curve'; }
          i = j;
          break;
        }
      }
    }
  }

  // A value that goes the wrong way, or sits off the line its neighbours draw.
  for (let i = 0; i < n; i++) {
    const r = work[i];
    if (r.bad) continue;
    const prev = i > 0 ? work[i - 1] : null;
    const next = i < n - 1 ? work[i + 1] : null;
    const wrongWay = (a, b) => direction * (b.v - a.v) < -1e-9 - Math.abs(a.v) * 1e-6;
    const breaksPrev = prev && !prev.bad && wrongWay(prev, r);
    const breaksNext = next && !next.bad && wrongWay(r, next);
    if (prev && next && !prev.bad && !next.bad) {
      const est = neighbourEstimate(work.map((w) => w.x), work.map((w) => w.v), i);
      const off = Math.abs(r.v - est);
      const local = Math.max(Math.abs(next.v - prev.v) / 2, typicalStep, 1e-9);
      // A real curve bends; a misread digit does not follow it at all.
      if (breaksPrev && breaksNext) { r.bad = true; r.badWhy = 'breaks-curve'; r.estimate = est; }
      else if (off > 4 * local && off > Math.abs(est) * 0.02) { r.bad = true; r.badWhy = 'off-curve'; r.estimate = est; }
    } else if (breaksPrev && (!next || next.bad)) {
      r.bad = true;
      r.badWhy = 'breaks-curve';
    } else if (!prev && breaksNext) {
      // First row above the second: either it or the second is wrong. Zero at
      // the bottom is the usual case, so a lone high first row is the slip.
      r.bad = true;
      r.badWhy = 'breaks-curve';
    }
  }

  // Two neighbours where the volume goes the wrong way: one of them is wrong.
  // The line through the good rows either side of the pair says which.
  for (let i = 1; i < n - 2; i++) {
    const a = work[i];
    const b = work[i + 1];
    if (a.bad || b.bad) continue;
    if (direction * (b.v - a.v) >= -1e-9) continue;
    const pr = work[i - 1];
    const qr = work[i + 2];
    if (pr.bad || qr.bad || qr.x === pr.x) continue;
    const lineAt = (x) => pr.v + ((qr.v - pr.v) * (x - pr.x)) / (qr.x - pr.x);
    const offA = Math.abs(a.v - lineAt(a.x));
    const offB = Math.abs(b.v - lineAt(b.x));
    const floor = 0.2 * Math.max(typicalStep, 1e-9);
    if (offA > offB * 2 && offA > floor) { a.bad = true; a.badWhy = 'breaks-curve'; }
    else if (offB > offA * 2 && offB > floor) { b.bad = true; b.badWhy = 'breaks-curve'; }
  }

  // Mend what is certain; list what is not. A run of three or more bad rows
  // cannot be told from a real change in the curve, so it is never guessed at.
  const badIdx = work.map((r, i) => (r.bad ? i : -1)).filter((i) => i >= 0);
  const runs = [];
  for (const i of badIdx) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i); else runs.push([i]);
  }
  for (const run of runs) {
    const first = run[0];
    const lastI = run[run.length - 1];
    const prevGood = first > 0 ? work[first - 1] : null;
    const nextGood = lastI < n - 1 ? work[lastI + 1] : null;
    const mendable = run.length <= 2 && prevGood && nextGood && !prevGood.bad && !nextGood.bad &&
      badIdx.length <= Math.max(3, Math.floor(n * 0.08));
    for (const i of run) {
      const r = work[i];
      let fixed = null;
      let how = '';
      if (mendable) {
        const est = prevGood.v + ((nextGood.v - prevGood.v) * (r.x - prevGood.x)) / (nextGood.x - prevGood.x);
        const stepHere = Math.max(Math.abs(nextGood.v - prevGood.v) / (run.length + 1), typicalStep, 1e-9);
        // A shifted decimal point, or a digit that was never on the page: of every
        // reading that lands between the good rows either side, take the one that
        // sits closest to the line they draw.
        if (run.length === 1 && isNum(r.v) && r.v !== 0) {
          const tol = stepHere * REPAIR_TOLERANCE + Math.abs(est) * 0.002;
          const lo = Math.min(prevGood.v, nextGood.v) - stepHere * 0.05;
          const hi = Math.max(prevGood.v, nextGood.v) + stepHere * 0.05;
          const ks = r.v < 0
            ? [-1, -10, -0.1, -100, -0.01, -1000, -0.001, -10000, -0.0001]
            : [10, 0.1, 100, 0.01, 1000, 0.001, 10000, 0.0001];
          const cands = ks.map((k) => ({ cand: r.v * k, how: k === -1 ? 'a minus sign that is not there' : `decimal point (x${k})` }));
          for (const d of digitCandidates(r.v)) cands.push({ cand: d, how: 'a digit that is not on the page' });
          let best = null;
          for (const c of cands) {
            if (c.cand < lo || c.cand > hi) continue;
            const off = Math.abs(c.cand - est);
            if (off <= tol && (best == null || off < best.off - 1e-12)) best = { ...c, off };
          }
          if (best) {
            fixed = round(best.cand, 4);
            how = best.how;
          }
        }
        // Otherwise the line the good rows either side of it draw.
        if (fixed == null) {
          fixed = round(est, 4);
          how = 'estimated from the rows either side';
        }
      }
      if (fixed != null && fixed >= -0.005) {
        repairs.push({
          code: 'value-repaired', row: i, x: r.x, from: isNum(r.v) ? r.v : null, to: fixed,
          message: `Volume at sounding ${r.x} read ${isNum(r.v) ? r.v : 'unreadable'} (${r.badWhy}); corrected to ${fixed} via ${how}`,
        });
        r.original = r.v;
        r.v = fixed;
        r.repaired = true;
        r.bad = false;
      } else {
        issue(issues, SEVERITY.error, 'value-bad',
          `Volume at sounding ${r.x} is ${isNum(r.v) ? r.v : 'unreadable'} (${r.badWhy}) and cannot be corrected from its neighbours`,
          { row: i, x: r.x, value: isNum(r.v) ? r.v : null });
      }
    }
  }

  // How many corrections a page needed says how far to trust the rest of it: the
  // slips that were caught were the ones that broke the curve; others may not have.
  const repaired = work.filter((r) => r.repaired && !r.filled).length;
  if (repaired > Math.max(6, Math.ceil(n * 0.1))) {
    issue(issues, SEVERITY.error, 'too-many-repairs',
      `${repaired} of ${n} rows needed correcting - this page is not being read reliably; re-scan it or import it by hand`);
  } else if (repaired > Math.max(3, Math.ceil(n * 0.03))) {
    issue(issues, SEVERITY.warn, 'many-repairs',
      `${repaired} of ${n} rows needed correcting - compare the table with the book before relying on it`);
  }

  // Whatever the repairs did, the curve that is left must not run backwards. If it still
  // does, a figure is wrong that could not be told from its neighbour: refuse, do not guess.
  {
    const left = work.filter((r) => isNum(r.v));
    const back = [];
    for (let i = 1; i < left.length; i++) {
      if (direction * (left[i].v - left[i - 1].v) < -1e-6 - Math.abs(left[i - 1].v) * 1e-6) back.push(left[i].x);
    }
    if (back.length) {
      issue(issues, SEVERITY.error, 'runs-backwards',
        `The volume still runs backwards after correction at sounding ${back.slice(0, 5).join(', ')}${back.length > 5 ? '…' : ''} - some figures here are wrong and cannot be corrected`,
        { xs: back.slice(0, 20) });
    }
    // Slightly off the smooth line the rows round it draw: not wrong enough to correct, enough to look at.
    if (left.length >= 12) {
      const resid = [];
      for (let i = 1; i < left.length - 1; i++) {
        const a = left[i - 1]; const b = left[i + 1];
        if (b.x === a.x) continue;
        const est = a.v + ((b.v - a.v) * (left[i].x - a.x)) / (b.x - a.x);
        resid.push({ x: left[i].x, r: left[i].v - est });
      }
      // A wrong figure is a spike: its neighbours lean the other way. A kink in a real tank
      // (a hopper's slope changing) moves one point and leaves the rest alone.
      const spike = (i) => {
        const q = resid[i];
        const a = resid[i - 1];
        const b = resid[i + 1];
        return !!a && !!b && a.r * q.r < 0 && b.r * q.r < 0 &&
          Math.abs(a.r) >= 0.25 * Math.abs(q.r) && Math.abs(b.r) >= 0.25 * Math.abs(q.r);
      };
      const absr = resid.map((q) => Math.abs(q.r)).sort((x, y) => x - y);
      const mad = absr[absr.length >> 1] || 0;
      const limit = Math.max(10 * mad, 0.2 * typicalStep, 1e-9);
      const odd = resid.filter((q, i) => Math.abs(q.r) > limit && spike(i) && !work.find((w) => w.x === q.x && w.repaired));
      if (odd.length && odd.length <= Math.max(6, left.length * 0.05)) {
        issue(issues, SEVERITY.warn, 'suspect-values',
          `${odd.length} figure(s) sit a little off the line the rows beside them draw (sounding ${odd.slice(0, 6).map((q) => q.x).join(', ')}) - check them against the book`,
          { xs: odd.slice(0, 20).map((q) => q.x) });
      }
    }
  }

  // Shape checks that make no change.
  const live = work.filter((r) => !r.bad && isNum(r.v));
  if (live.length >= 2) {
    const first = live[0];
    const vmax = Math.max(...live.map((r) => r.v));
    // A table of soundings starts at the bottom. One that starts well above it has lost its
    // first pages (or was read from a page range): what it holds cannot be the whole tank.
    {
      const stepX = modalStep(live.map((r) => r.x)).step || 0;
      const range = live[live.length - 1].x - first.x;
      if (stepX > 0 && range > 0 && first.x > Math.max(4 * stepX, 0.05 * range)) {
        issue(issues, SEVERITY.warn, 'starts-mid-table',
          `The table starts at sounding ${first.x}, not at the bottom of the tank - the pages before it may be missing`,
          { first: first.x });
      }
    }
    if (direction === 1 && first.x === 0 && first.v > Math.max(0.05 * vmax, 0.05)) {
      issue(issues, SEVERITY.info, 'nonzero-start',
        `Volume at sounding 0 is ${first.v}, not zero - check the first row`, { value: first.v });
    }
    // Slope jumps that stay monotonic (a digit misread to a plausible value).
    const slopes = [];
    for (let i = 1; i < live.length; i++) {
      const dx = live[i].x - live[i - 1].x;
      if (dx > 0) slopes.push({ i, s: (live[i].v - live[i - 1].v) / dx, x: live[i].x });
    }
    const ms = median(slopes.map((s) => Math.abs(s.s)));
    if (ms > 0 && slopes.length >= 8) {
      const jumps = slopes.filter((s) => Math.abs(s.s) > ms * 6);
      const isolated = jumps.filter((s) => {
        const nb = slopes.filter((t) => Math.abs(t.i - s.i) === 1);
        return nb.every((t) => Math.abs(t.s) <= ms * 3);
      });
      if (isolated.length) {
        issue(issues, SEVERITY.warn, 'slope-jump',
          `Volume jumps abruptly near sounding ${isolated.slice(0, 3).map((s) => s.x).join(', ')} - check those rows`,
          { xs: isolated.slice(0, 10).map((s) => s.x) });
      }
    }
    // Capacity.
    if (cap) {
      const ratio = vmax / cap;
      if (ratio > 3 || ratio < 0.2) {
        issue(issues, SEVERITY.error, 'capacity-mismatch',
          `Largest volume ${round(vmax, 3)} is ${round(ratio * 100, 0)}% of the tank capacity ${round(cap, 3)} - a decimal point or a page is wrong`,
          { max: vmax, capacity: cap });
      } else if (ratio > 1.15) {
        issue(issues, SEVERITY.warn, 'over-capacity',
          `Largest volume ${round(vmax, 3)} is ${round((ratio - 1) * 100, 1)}% over the tank capacity ${round(cap, 3)}`,
          { max: vmax, capacity: cap });
      } else if (ratio < 0.6) {
        issue(issues, SEVERITY.warn, 'under-capacity',
          `Table tops out at ${round(ratio * 100, 0)}% of the tank capacity ${round(cap, 3)} - a page may be missing`,
          { max: vmax, capacity: cap });
      }
    }
  }

  work = work.map(({ x, v, repaired: rp, original, filled }) => ({ x, v, repaired: !!rp || !!filled, original }));
  return finish(work, issues, repairs, { ...opts, direction });
}

function finish(rows, issues, repairs, opts) {
  const x = rows.map((r) => r.x);
  const v = rows.map((r) => r.v);
  const repairedRows = rows.map((r, i) => (r.repaired ? i : -1)).filter((i) => i >= 0);
  return { x, v, issues, repairs, repairedRows, direction: opts.direction || 1 };
}

/* ------------------------------------------------------------------ */
/* Sounding x trim grid                                                */
/* ------------------------------------------------------------------ */

/**
 * Does the grid hold volumes (grows with sounding, tens of cubic metres) or
 * small corrections to be added to a volume curve? Same test the Excel
 * importer applies to a book before it decides how to read it.
 */
function looksLikeVolumeGrid(axis, grid, volumeCurve) {
  if (!grid || !grid.length || !grid[0] || !grid[0].length) return false;
  const flat = [];
  for (const row of grid) for (const v of row) if (isNum(v)) flat.push(v);
  if (flat.length < 8) return false;
  const vmax = Math.max(...flat.map(Math.abs));
  const vc = ((volumeCurve && volumeCurve.v) || []).filter(isNum);
  const vcMax = vc.length ? Math.max(...vc.map(Math.abs)) : 0;
  if (vc.length >= 20 && vcMax >= 20 && vcMax >= vmax * 0.8) return false;
  const first = grid[0].filter(isNum);
  if (first.length) {
    const fm = median(first.map(Math.abs));
    const span = Math.max(...first) - Math.min(...first);
    if (fm >= 20 && span <= Math.max(fm * 0.2, 5)) return true;
  }
  if (axis && axis.length >= 6) {
    const col = grid.map((r) => (r.length > 1 ? r[1] : r[0])).filter(isNum);
    if (col.length >= 6) {
      const head = (col[0] + col[1] + col[2]) / 3;
      const tail = (col[col.length - 1] + col[col.length - 2] + col[col.length - 3]) / 3;
      if (tail > head * 1.5 && tail >= 5 && vcMax < tail * 0.5) return true;
    }
  }
  return vmax >= 40 && vcMax < vmax * 0.5;
}

/** Column whose trim is closest to even keel. */
function evenKeelColumn(vals) {
  if (!vals || !vals.length) return 0;
  let best = 0;
  for (let i = 1; i < vals.length; i++) if (Math.abs(vals[i]) < Math.abs(vals[best])) best = i;
  return best;
}

function reviewGrid(axisIn, valsIn, gridIn, opts = {}) {
  const issues = [];
  const repairs = [];
  const nCols = (valsIn || []).length;
  const nRows = Math.min((axisIn || []).length, (gridIn || []).length);
  if (!nRows || !nCols) {
    issue(issues, SEVERITY.error, 'grid-empty', 'The grid has no rows or no trim columns');
    return { axis: axisIn || [], vals: valsIn || [], grid: gridIn || [], issues, repairs, repairedCells: [], volume: false };
  }

  // The trims are a run of distinct values; a repeat or a reversal means the header was misread,
  // and every column would then be filed under the wrong trim.
  {
    let up = true;
    let down = true;
    for (let i = 1; i < valsIn.length; i++) {
      if (!(valsIn[i] > valsIn[i - 1])) up = false;
      if (!(valsIn[i] < valsIn[i - 1])) down = false;
    }
    if (!up && !down) {
      issue(issues, SEVERITY.error, 'trim-header',
        `The trim columns read ${valsIn.join(', ')}, which is not a run of distinct values - the header was misread, so the columns cannot be told apart`);
    }
  }

  const volume = opts.volume != null ? !!opts.volume : looksLikeVolumeGrid(axisIn, gridIn, opts.volumeCurve);
  const rows = [];
  for (let i = 0; i < nRows; i++) {
    rows.push({ x: Number(axisIn[i]), cells: (gridIn[i] || []).slice(0, nCols).map(Number), pad: nCols - (gridIn[i] || []).length });
  }
  const axisRows = checkAxis(rows.map((r) => ({ x: r.x, v: null, ref: r })), issues, repairs);
  const grid = axisRows.map((r) => r.ref.cells.slice());
  const axis = axisRows.map((r) => r.x);
  const repairedCells = [];
  const short = rows.filter((r) => r.pad > 0).length;
  if (short) issue(issues, SEVERITY.warn, 'ragged-rows', `${short} row(s) have fewer values than the header has columns; the gaps were read as 0`);

  if (!volume) {
    // Corrections: signed and small. Only the impossible is flagged.
    const flat = grid.flat().filter(isNum);
    const med = median(flat.map(Math.abs)) || 0;
    const bad = [];
    grid.forEach((row, r) => row.forEach((v, c) => {
      if (!isNum(v)) bad.push([r, c]);
      else if (med > 0 && Math.abs(v) > Math.max(med * 50, 25)) bad.push([r, c]);
    }));
    if (bad.length) {
      // A few wild values are a slip to look at; a table full of them was read out of register
      // (columns slid, digits lost) and must not be stored on a reviewer's glance.
      const tooMany = bad.length >= 3 && bad.length >= 0.03 * Math.max(1, flat.length);
      issue(issues, tooMany ? SEVERITY.error : SEVERITY.warn, 'correction-outlier',
        `${bad.length} correction value(s) are far larger than the rest (e.g. at sounding ${axis[bad[0][0]]}, trim ${valsIn[bad[0][1]]})`,
        { cells: bad.slice(0, 20) });
    }
    return { axis, vals: valsIn.slice(), grid, issues, repairs, repairedCells, volume: false };
  }

  // Volume grid: every trim column is a curve of volume against sounding.
  const cap = isNum(opts.capacity) && opts.capacity > 0 ? opts.capacity : 0;
  const direction = opts.direction === -1 ? -1 : (opts.direction === 1 ? 1 : 0);
  let colWorst = 0;
  for (let c = 0; c < nCols; c++) {
    const col = grid.map((row) => row[c]);
    const res = reviewCurve(axis, col, { direction: direction || undefined, capacity: cap, label: `trim ${valsIn[c]}` });
    // reviewCurve may re-order rows; here the axis was already fixed, so rows line up.
    if (res.x.length === axis.length) {
      res.v.forEach((v, r) => { grid[r][c] = v; });
      res.repairedRows.forEach((r) => repairedCells.push([r, c]));
    }
    for (const it of res.issues) {
      if (it.code === 'axis-gap' || it.code === 'short-table' || it.code === 'axis-sorted' || it.code === 'axis-duplicates') continue;
      if (c > 0 && issues.some((i) => i.code === it.code && i.message === it.message)) continue;   // the same finding in every column is one finding
      if (c > 0 && issues.some((i) => i.code === it.code && i.column !== undefined && i.column !== c && c > 2)) { colWorst++; continue; }
      issues.push({ ...it, column: c, trim: valsIn[c] });
    }
    colWorst += res.issues.filter((i) => i.severity === SEVERITY.error).length;
  }
  // Report each repair once with its column.
  for (const [r, c] of repairedCells) {
    repairs.push({
      code: 'value-repaired', row: r, col: c, x: axis[r], trim: valsIn[c],
      message: `Volume at sounding ${axis[r]}, trim ${valsIn[c]} was corrected`,
    });
  }

  // Across the trim columns a row changes smoothly: check each cell against the
  // columns either side of it.
  if (nCols >= 3) {
    const sus = [];
    for (let r = 0; r < axis.length; r++) {
      const rowMax = Math.max(...grid[r].filter(isNum), 0);
      for (let c = 1; c < nCols - 1; c++) {
        const a = grid[r][c - 1];
        const b = grid[r][c + 1];
        const v = grid[r][c];
        if (![a, b, v].every(isNum)) continue;
        const dx = valsIn[c + 1] - valsIn[c - 1];
        const est = dx ? a + ((b - a) * (valsIn[c] - valsIn[c - 1])) / dx : (a + b) / 2;
        const off = Math.abs(v - est);
        const spread = Math.abs(b - a) / 2 + Math.max(rowMax * 0.01, 0.05);
        if (off > spread * 4 && off > rowMax * 0.05) sus.push([r, c]);
      }
    }
    if (sus.length) {
      issue(issues, SEVERITY.warn, 'trim-inconsistent',
        `${sus.length} cell(s) do not fit the trim columns beside them (first at sounding ${axis[sus[0][0]]}, trim ${valsIn[sus[0][1]]})`,
        { cells: sus.slice(0, 30) });
    }
  }
  return { axis, vals: valsIn.slice(), grid, issues, repairs, repairedCells, volume: true, errors: colWorst };
}

/* ------------------------------------------------------------------ */
/* Cross-checks                                                        */
/* ------------------------------------------------------------------ */

function interpAt(x, v, at) {
  if (!x.length || at < x[0] || at > x[x.length - 1]) return null;
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= at) lo = mid; else hi = mid;
  }
  if (x[hi] === x[lo]) return v[lo];
  return v[lo] + ((v[hi] - v[lo]) * (at - x[lo])) / (x[hi] - x[lo]);
}

/**
 * Compare two curves where they overlap. Returns null when they share too
 * little to say anything.
 */
function crossCheckCurves(a, b, opts = {}) {
  if (!a || !b || !a.x || !b.x || a.x.length < 2 || b.x.length < 2) return null;
  const lo = Math.max(a.x[0], b.x[0]);
  const hi = Math.min(a.x[a.x.length - 1], b.x[b.x.length - 1]);
  if (hi <= lo) return null;
  const vmax = Math.max(...a.v.filter(isNum), ...b.v.filter(isNum), 0);
  if (!(vmax > 0)) return null;
  // Ignore the first and last 2% where a curve is mostly zero or mostly full:
  // a small slip in sounding there is a large relative difference.
  const floor = vmax * 0.02;
  let worst = { rel: 0, x: null, a: null, b: null };
  let compared = 0;
  for (let i = 0; i < a.x.length; i++) {
    if (a.x[i] < lo || a.x[i] > hi) continue;
    const bv = interpAt(b.x, b.v, a.x[i]);
    if (bv == null || !isNum(a.v[i])) continue;
    if (Math.max(Math.abs(a.v[i]), Math.abs(bv)) < floor) continue;
    compared++;
    const rel = Math.abs(a.v[i] - bv) / Math.max(Math.abs(a.v[i]), Math.abs(bv));
    if (rel > worst.rel) worst = { rel, x: a.x[i], a: a.v[i], b: bv };
  }
  if (compared < 3) return null;
  return {
    compared,
    worst,
    status: worst.rel > (opts.fail || CROSS_FAIL) ? 'fail' : worst.rel > (opts.warn || CROSS_WARN) ? 'warn' : 'ok',
  };
}

/** The even-keel curve of a sounding x trim volume grid. */
function evenKeelCurve(parsed) {
  const axis = parsed.trimAxis || [];
  const vals = parsed.trimVals || [];
  const grid = parsed.trimGrid || [];
  if (!axis.length || !vals.length) return null;
  const c = evenKeelColumn(vals);
  return { x: axis.slice(), v: grid.map((r) => Number(r[c])), trim: vals[c] };
}

/** The curve a tank is stored with, whichever way it holds it. */
function storedCurve(tank) {
  if (!tank) return null;
  const vc = tank.volumeCurve;
  if (vc && vc.x && vc.x.length >= 2 && Math.max(...vc.v.filter(isNum), 0) > 0) return { x: vc.x, v: vc.v };
  if ((tank.trimAxis || []).length && (tank.trimGrid || []).length &&
      looksLikeVolumeGrid(tank.trimAxis, tank.trimGrid, vc)) {
    return evenKeelCurve(tank);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Whole table                                                         */
/* ------------------------------------------------------------------ */

function scoreOf(issues, repairs) {
  const errors = issues.filter((i) => i.severity === SEVERITY.error).length;
  const warns = issues.filter((i) => i.severity === SEVERITY.warn).length;
  const mends = repairs.filter((r) => /value|axis-repaired/.test(r.code)).length;
  return Math.max(0, Math.min(100, 100 - errors * 30 - warns * 7 - Math.min(mends, 10) * 2));
}

function statusOf(issues) {
  if (issues.some((i) => i.severity === SEVERITY.error)) return 'fail';
  if (issues.some((i) => i.severity === SEVERITY.warn)) return 'warn';
  return 'ok';
}

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/**
 * Review one imported table's parsed calibration, return the repaired copy
 * and what was found. The input is not modified.
 *
 * @param {object} parsed   fields as the importer / a calibration patch holds them
 * @param {object} ctx      { capacity, existing (stored tank), soundingMethod,
 *                            siblings: other parsed tables of the same tank,
 *                            overlap: rows two spliced pages disagreed on }
 */
function reviewParsed(parsed, ctx = {}) {
  const out = clone(parsed || {});
  const issues = [];
  const repairs = [];
  const cross = [];
  const dir = ctx.soundingMethod === 'ullage' ? -1 : undefined;
  const capacity = ctx.capacity > 0 ? ctx.capacity : (ctx.existing && ctx.existing.capacity > 0 ? ctx.existing.capacity : 0);

  const vc = out.volumeCurve;
  if (vc && vc.x && vc.x.length) {
    const res = reviewCurve(vc.x, vc.v, { direction: dir, capacity, label: 'volume' });
    out.volumeCurve = { x: res.x, v: res.v };
    issues.push(...res.issues);
    repairs.push(...res.repairs);
    out.reviewRepairedRows = res.repairedRows;
    const vmax = Math.max(...res.v.filter(isNum), 0);
    if (vmax > 0) out.capacity = vmax;
    if (res.x.length > 1) out.soundingIncrement = modalStep(res.x).step || out.soundingIncrement;
  }

  if ((out.trimGrid || []).length && (out.trimVals || []).length) {
    // A heeling table holds corrections, some of them negative, with a dash where the book has
    // nothing: it is not held to the rules of a volume.
    const res = reviewGrid(out.trimAxis, out.trimVals, out.trimGrid, {
      capacity, direction: dir, volumeCurve: out.volumeCurve,
      volume: out.gridKind === 'correction' || out.tableRole === 'heel' ? false : (out.gridKind === 'volume' ? true : undefined),
    });
    out.trimAxis = res.axis;
    out.trimGrid = res.grid;
    issues.push(...res.issues);
    repairs.push(...res.repairs);
    out.reviewRepairedCells = res.repairedCells;
    if (res.volume) {
      const flat = res.grid.flat().filter(isNum).filter((v) => v > 0).sort((a, b) => a - b);
      const p90 = percentile(flat, 0.9);
      const clean = flat.filter((v) => v <= Math.max(p90 * 3, p90 + 50));
      if (clean.length) out.capacity = Math.max(...clean);
    }
    if (res.axis.length > 1) out.soundingIncrement = modalStep(res.axis).step || out.soundingIncrement;
    out.reviewGridKind = res.volume ? 'volume' : 'correction';

    // Second source in the same table: the grid's even-keel column against its own volume curve.
    if (res.volume && out.volumeCurve && out.volumeCurve.x.length > 1) {
      const ek = evenKeelCurve(out);
      const x = crossCheckCurves(ek, out.volumeCurve);
      if (x) cross.push({ against: 'volume curve in the same table', ...x });
    }
  }

  // Other tables of the same tank in the same book. Corrections are not capacities, so a table of
  // corrections is neither compared with the capacity tables nor used to check them.
  const isCorrection = out.gridKind === 'correction' || out.tableRole === 'heel';
  for (const sib of isCorrection ? [] : (ctx.siblings || []).filter((q) => q.gridKind !== 'correction' && q.tableRole !== 'heel')) {
    const a = (out.volumeCurve && out.volumeCurve.x && out.volumeCurve.x.length > 1)
      ? out.volumeCurve : ((out.trimGrid || []).length ? evenKeelCurve(out) : null);
    const b = sib.volumeCurve && sib.volumeCurve.x && sib.volumeCurve.x.length > 1
      ? sib.volumeCurve : ((sib.trimGrid || []).length ? evenKeelCurve(sib) : null);
    const x = crossCheckCurves(a, b);
    if (x) cross.push({ against: sib.label || 'another table of this tank', ...x });
  }

  // The tank as it is stored now.
  if (ctx.existing) {
    const cur = storedCurve(ctx.existing);
    const mine = (out.volumeCurve && out.volumeCurve.x && out.volumeCurve.x.length > 1)
      ? out.volumeCurve : ((out.trimGrid || []).length ? evenKeelCurve(out) : null);
    if (cur && mine) {
      const x = crossCheckCurves(mine, cur, { warn: 0.005, fail: 0.2 });
      if (x) cross.push({ against: 'the tank as it is stored now', existing: true, ...x });
    }
  }

  if ((out.blankCells || []).length) {
    issue(issues, SEVERITY.info, 'blank-cells',
      `${out.blankCells.length} cell(s) are a dash in the book (no figure there) and are stored as 0`,
      { count: out.blankCells.length });
  }

  // Rows the two pages of a spliced table disagreed about.
  for (const o of ctx.overlap || []) {
    issue(issues, SEVERITY.warn, 'splice-conflict',
      `Pages ${o.pages ? o.pages.join(' and ') : ''} both print sounding ${o.x}: ${o.a} against ${o.b}`, o);
  }

  for (const c of cross) {
    if (c.status === 'ok') continue;
    const where = `at sounding ${c.worst.x} (${round(c.worst.a, 3)} against ${round(c.worst.b, 3)}, ${round(c.worst.rel * 100, 1)}% apart)`;
    issue(issues, c.status === 'fail' && !c.existing ? SEVERITY.error : SEVERITY.warn,
      c.existing ? 'differs-from-stored' : 'cross-check',
      `Disagrees with ${c.against} ${where}`, { against: c.against, rel: c.worst.rel });
  }

  // Anything that was corrected means the table is no longer exactly as read: say so,
  // so a table that needed mending is never shown as if it had not.
  const mended = repairs.filter((r) => /^value|^axis-repaired|^row-dropped/.test(r.code)).length;
  if (mended && !issues.some((i) => i.severity !== SEVERITY.info)) {
    issue(issues, SEVERITY.warn, 'values-corrected',
      `${mended} figure(s) were corrected from their neighbours - compare them with the book (listed under the corrections)`);
  }
  const status = statusOf(issues);
  const review = {
    status,
    score: scoreOf(issues, repairs),
    issues,
    repairs,
    cross: cross.map((c) => ({ against: c.against, status: c.status, compared: c.compared, maxDiffPercent: round(c.worst.rel * 100, 2), atSounding: c.worst.x })),
    repaired: repairs.filter((r) => /^value|^axis-repaired/.test(r.code)).length,
    reviewedAt: new Date().toISOString(),
  };
  return { parsed: out, review };
}

/** A line a person can read for a review's findings. */
function summarizeReview(review) {
  if (!review) return '';
  const bits = [];
  const e = review.issues.filter((i) => i.severity === SEVERITY.error).length;
  const w = review.issues.filter((i) => i.severity === SEVERITY.warn).length;
  if (e) bits.push(`${e} problem${e > 1 ? 's' : ''}`);
  if (w) bits.push(`${w} warning${w > 1 ? 's' : ''}`);
  if (review.repaired) bits.push(`${review.repaired} value${review.repaired > 1 ? 's' : ''} corrected`);
  return bits.length ? bits.join(', ') : 'checks passed';
}

module.exports = {
  reviewParsed,
  reviewCurve,
  reviewGrid,
  crossCheckCurves,
  evenKeelCurve,
  storedCurve,
  looksLikeVolumeGrid,
  modalStep,
  summarizeReview,
  SEVERITY,
};
