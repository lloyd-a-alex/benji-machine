/**
 * Toolpath ordering — the single source of truth for "what order do we punch
 * these holes in?"
 *
 * There used to be two copies of this logic: one in the CNC preview viewer and
 * one in the G-code exporter. They had drifted apart (different start point,
 * different distance metric, different iteration caps, different reversal
 * bookkeeping), which meant the rapid distance shown on screen was not the
 * rapid distance the exported program would actually produce. Optimise in the
 * preview, then export, and the numbers moved under your feet - precisely the
 * kind of surprise a machinist can get hurt by. Both call sites now come
 * through here.
 *
 * The behaviour kept is the viewer's, because it is the more correct one:
 *   - the tour starts at machine home (0, 0), not at "whichever hole came first"
 *   - the path is treated as OPEN (the tool does not fly home after the last
 *     hole), so reversing a segment that touches the tail is scored correctly
 */

/** GRBL-style default home, in card-local millimetres. */
const HOME = { x: 0, y: 0 };

/**
 * Total traverse distance of an open path, measured from `home`.
 * Same metric the preview HUD reports and the exporter estimates cycle time
 * from, so the two can never disagree again.
 */
export function pathLengthMm(points, home = HOME) {
  let total = 0;
  let px = home.x;
  let py = home.y;
  for (const p of points) {
    total += Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2);
    px = p.x;
    py = p.y;
  }
  return total;
}

/**
 * Nearest-neighbour construction + 2-opt refinement for a set of XY points.
 *
 * Returns a NEW array of the same point objects in visit order; the input is
 * never mutated or sorted in place, because callers keep these objects around
 * (the viewer re-renders from them, the exporter annotates the G-code with
 * them).
 *
 * options:
 *   home       {x,y} the tool starts here (default 0,0 = card origin)
 *   maxRounds  cap on 2-opt sweeps (default 40)
 */
export function optimizeToolpath(points, options = {}) {
  const home = options.home || HOME;
  const maxRounds = Number.isFinite(options.maxRounds) ? options.maxRounds : 40;
  const n = points.length;
  if (n < 3) return points.slice();

  // Flat coordinate copies: the 2-opt inner loop runs millions of times on a
  // dense card and going through object property chains every iteration is the
  // difference between a snappy preview and a frozen tab.
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < points.length; i++) {
    xs[i] = points[i].x;
    ys[i] = points[i].y;
  }

  // ── 1. Nearest neighbour, seeded at home ───────────────────────────────────
  const used = new Uint8Array(n);
  const tour = new Int32Array(n);
  let curX = home.x;
  let curY = home.y;
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const dx = xs[i] - curX;
      const dy = ys[i] - curY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    used[best] = 1;
    tour[step] = best;
    curX = xs[best];
    curY = ys[best];
  }

  // ── 2. 2-opt: un-cross segments by reversing them ─────────────────────────
  // Index -1 is the home anchor, which is the only reason a tour position can
  // have no preceding point.
  const ax = i => (i < 0 ? home.x : xs[tour[i]]);
  const ay = i => (i < 0 ? home.y : ys[tour[i]]);
  const dist = (i, j) => Math.sqrt((ax(i) - ax(j)) ** 2 + (ay(i) - ay(j)) ** 2);

  let rounds = 0;
  for (;;) {
    if (rounds++ >= maxRounds) break;
    let improved = false;
    for (let i = 0; i < n && !improved; i++) {
      const before = dist(i - 1, i);
      for (let j = i + 1; j < n; j++) {
        const tailIsOpen = j === n - 1;
        const gain = tailIsOpen
          ? before - dist(i - 1, j)
          : before + dist(j, j + 1) - (dist(i - 1, j) + dist(i, j + 1));
        if (gain > 1e-6) {
          for (let lo = i, hi = j; lo < hi; lo++, hi--) {
            const tmp = tour[lo];
            tour[lo] = tour[hi];
            tour[hi] = tmp;
          }
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  const ordered = new Array(n);
  for (let i = 0; i < n; i++) ordered[i] = points[tour[i]];
  return ordered;
}

/**
 * Order points as straight column sweeps, alternating direction (boustrophedon)
 * so each pass starts where the previous one ended.
 *
 * This is what fixturing features want. Tractor-feed sprocket holes must NOT go
 * through a TSP optimiser: reordering them means punching the strip out of
 * sequence and leaving the card held by nothing while the head crosses an
 * unsupported span, and it lets the tour start mid-card on a feed hole. Cheap,
 * predictable, monotone is correct here.
 */
export function orderColumnSweep(points) {
  if (points.length < 2) return points.slice();

  const columns = new Map();
  for (const p of points) {
    // 0.01mm buckets: same physical hole, whatever float noise produced it.
    const key = p.x.toFixed(2);
    let col = columns.get(key);
    if (!col) columns.set(key, (col = []));
    col.push(p);
  }

  const keys = [...columns.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
  const ordered = [];
  keys.forEach((key, index) => {
    const col = columns.get(key).sort((a, b) => a.y - b.y);
    if (index % 2 === 1) col.reverse();
    ordered.push(...col);
  });
  return ordered;
}
