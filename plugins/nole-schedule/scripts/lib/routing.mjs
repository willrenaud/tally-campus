/**
 * Walking estimates over the shipped walk graph -- and the one place where the
 * systematic optimism of that graph is corrected for. Node builtins only.
 *
 * ==================================================================
 * THE SAFETY MARGIN, AND WHY IT IS A CONSTANT IN THIS FILE
 * ==================================================================
 *
 * Every duration in walk-edges.json is COMPUTED, never measured:
 *
 *     distanceMeters      = haversine(centroid, centroid) x PATH_FACTOR(1.3)
 *     baseDurationSeconds = round(distanceMeters / WALK_SPEED_MPS(1.4))
 *
 * That model omits five things, and it omits ALL FIVE IN THE OPTIMISTIC
 * DIRECTION. Nothing in the shipped data pushes an estimate the other way, so the
 * error is not noise around a true value -- it is a floor sitting some unknown
 * distance below one. DATA-GAPS.md sections 1 and 6 list the omissions:
 *
 *   1. No entrance is a real door. Every building routes from its centroid, so
 *      each end of a trip is short by the distance from the middle of a building
 *      to whichever door is actually used.
 *   2. No time is counted inside either building -- leaving the room, corridors,
 *      stairs, waiting for a lift. floorCount and typicalClassroomFloors ship but
 *      nothing consumes them.
 *   3. No time is counted waiting to cross a road.
 *   4. Class-change crowding is entirely unmodelled, and the class change is the
 *      exact moment this question gets asked.
 *   5. PATH_FACTOR and WALK_SPEED_MPS are themselves assumptions, chosen and
 *      documented rather than measured.
 *
 * There is no measurement block on any edge, so there is no medianSeconds and no
 * p90Seconds. The p90 is the honest number for "will I make it", and the data
 * does not have one. This constant is what stands in for it.
 *
 * It lives here, once, as data rather than as arithmetic scattered through the
 * feasibility logic, for three reasons: a reader can find out what the number is
 * without reading the algorithm, a test can assert on it, and when measured edges
 * eventually ship there is exactly one place to delete.
 *
 * ------------------------------------------------------------------
 * fixedSeconds = 180, as three stated 60-second components
 * ------------------------------------------------------------------
 * Distance-independent, because none of it scales with how far apart the two
 * buildings are:
 *
 *   60s  centroid to door, both ends. DATA-GAPS.md section 1 puts this at "10 to
 *        40 m at each end, so 15 to 60 seconds on a typical trip". The TOP of
 *        that published range is taken, not the middle.
 *   60s  inside the buildings: packing up, the corridor, the stairs or the lift,
 *        at both ends. Flat rather than per-building, because deriving it from
 *        floorCount would be inventing a number the data does not support.
 *   60s  one signalled road crossing. The academic core is cut by Call Street,
 *        Woodward Avenue and Jefferson Street, and a walk of any length across it
 *        usually meets at least one.
 *
 * ------------------------------------------------------------------
 * crowdMultiplier = 1.35, applied to the walking portion only
 * ------------------------------------------------------------------
 * Crowding scales with how far you walk, so it multiplies rather than adds. It
 * covers omission 4 and the residual uncertainty in omission 5.
 *
 * 1.35 IS A CHOICE, NOT A MEASUREMENT, and this comment is the whole of its
 * justification: it is set toward the pessimistic end on purpose, because the two
 * ways of being wrong do not cost the same. Telling a student a walk is
 * comfortable when it is not makes them late for a class. Telling them it is
 * tight when it was fine makes them leave a few minutes early. Those are not
 * symmetric, so the estimate is not centred.
 *
 * ------------------------------------------------------------------
 * What the margin does NOT license
 * ------------------------------------------------------------------
 * The corrected number is still an estimate built on unmeasured data. It is not a
 * p90, it does not become one by being larger, and an answer built on it must
 * still state the assumption out loud. The margin makes the estimate honest about
 * its direction of error; it does not make it precise. In particular it is the
 * reason a range is reported rather than a point: the gap between the two ends is
 * the finding.
 *
 * REPLACE THIS when walk-edges.json gains a measurement block with p90Seconds. At
 * that point the p90 is the answer, and this constant is the thing it retires.
 */
import { buildings, walkEdges } from './campus.mjs';

export const SAFETY_MARGIN = Object.freeze({
  fixedSeconds: 180,
  crowdMultiplier: 1.35,
  components: Object.freeze({
    centroidToDoorSeconds: 60,
    insideBuildingSeconds: 60,
    roadCrossingSeconds: 60
  }),
  basis: 'DATA-GAPS.md sections 1 and 6. Chosen, not measured, and deliberately pessimistic: being wrong toward "comfortable" costs a missed class, being wrong toward "tight" costs leaving a few minutes early.',
  retireWhen: 'walk-edges.json carries a measurement block with p90Seconds.'
});

/**
 * Turn one optimistic shipped duration into the RANGE that should be reported.
 *
 * Never report only the high number and never report only the low one. The low
 * end is what the data literally says; the high end is what it says once its
 * known omissions are added back. Reporting either alone throws away the thing a
 * student actually needs, which is how far apart the two are.
 */
export function applySafetyMargin(optimisticSeconds) {
  const optimistic = Math.round(optimisticSeconds);
  const realisticSeconds = Math.round(optimistic * SAFETY_MARGIN.crowdMultiplier) + SAFETY_MARGIN.fixedSeconds;
  return { optimisticSeconds: optimistic, realisticSeconds, marginSeconds: realisticSeconds - optimistic };
}

/* ------------------------------------------------------------------ *
 * The graph
 * ------------------------------------------------------------------ */

const RADIUS_M = 6371008.8;
export const PATH_FACTOR = 1.3;     // as used to build walk-edges.json
export const WALK_SPEED_MPS = 1.4;  // the pace every shipped edge is recorded at

export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

let adjacency = null;
function graph() {
  if (adjacency) return adjacency;
  adjacency = new Map();
  const add = (from, to, edge) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, edge });
  };
  for (const e of walkEdges()) {
    if (e.from.kind !== 'building-entrance' || e.to.kind !== 'building-entrance') continue;
    add(e.from.building, e.to.building, e);
    if (e.bidirectional) add(e.to.building, e.from.building, e);
  }
  return adjacency;
}

/** Rescale one edge to a student's own pace. distanceMeters is the invariant. */
function edgeSeconds(edge, paceMetersPerSecond) {
  if (typeof edge.distanceMeters === 'number' && paceMetersPerSecond > 0) {
    return edge.distanceMeters / paceMetersPerSecond;
  }
  return edge.baseDurationSeconds;
}

/**
 * Shortest walking route between two SHIPPED buildings.
 *
 * Returns { ok: true, path, edges, distanceMeters, optimisticSeconds, ... } or
 * { ok: false, reason } where reason is one of:
 *
 *   'building-not-in-data'  the code is not among the 33 that ship. An ORDINARY
 *                           outcome (DATA-GAPS.md section 4), and the caller must
 *                           refuse rather than substitute anything.
 *   'no-route'              both buildings ship but the graph does not connect
 *                           them. validate-data.mjs asserts connectivity, so this
 *                           should be unreachable; it exists so that a broken
 *                           graph surfaces as a refusal rather than as Infinity.
 */
export function route(fromCode, toCode, { paceMetersPerSecond = WALK_SPEED_MPS } = {}) {
  const known = new Set(buildings().map((b) => b.code));
  const missing = [fromCode, toCode].filter((c) => !known.has(c));
  if (missing.length) return { ok: false, reason: 'building-not-in-data', missing: [...new Set(missing)] };

  if (fromCode === toCode) {
    return {
      ok: true, path: [fromCode], edges: [], distanceMeters: 0,
      optimisticSeconds: 0, paceMetersPerSecond, sameBuilding: true
    };
  }

  const g = graph();
  const dist = new Map([[fromCode, 0]]);
  const prev = new Map();
  const seen = new Set();

  // 32 nodes: a linear scan for the minimum is cheaper than a heap, and easier
  // to read than one.
  while (true) {
    let node = null;
    let best = Infinity;
    for (const [k, v] of dist) {
      if (!seen.has(k) && v < best) { best = v; node = k; }
    }
    if (node === null || node === toCode) break;
    seen.add(node);
    for (const { to, edge } of g.get(node) ?? []) {
      if (seen.has(to)) continue;
      const cand = best + edgeSeconds(edge, paceMetersPerSecond);
      if (cand < (dist.get(to) ?? Infinity)) { dist.set(to, cand); prev.set(to, { node, edge }); }
    }
  }

  if (!dist.has(toCode)) return { ok: false, reason: 'no-route', from: fromCode, to: toCode };

  const path = [toCode];
  const edges = [];
  let cur = toCode;
  while (cur !== fromCode) {
    const step = prev.get(cur);
    edges.unshift(step.edge);
    path.unshift(step.node);
    cur = step.node;
  }

  return {
    ok: true,
    path,
    edges: edges.map((e) => e.id),
    distanceMeters: Math.round(edges.reduce((s, e) => s + e.distanceMeters, 0) * 10) / 10,
    optimisticSeconds: Math.round(dist.get(toCode)),
    paceMetersPerSecond,
    sameBuilding: false
  };
}

/**
 * A straight-line walking estimate between two coordinates, using the SAME
 * documented model that built walk-edges.json.
 *
 * This exists for the parking answer only. No walk edge in the shipped graph has
 * a parking endpoint -- every edge runs building centroid to building centroid --
 * so a garage-to-classroom walk cannot be routed at all, and the alternative to
 * this is having nothing to say about the leg a student most cares about.
 *
 * It is WEAKER than a graph route and a caller must say so: a graph route follows
 * a chain of near-neighbour hops, while this cuts straight across whatever is in
 * the way. The same safety margin applies on top, for the same reasons.
 */
export function straightLineEstimate(a, b) {
  const straight = haversineMeters(a, b);
  const distanceMeters = straight * PATH_FACTOR;
  return {
    straightLineMeters: Math.round(straight * 10) / 10,
    distanceMeters: Math.round(distanceMeters * 10) / 10,
    optimisticSeconds: Math.round(distanceMeters / WALK_SPEED_MPS),
    model: `haversine x PATH_FACTOR ${PATH_FACTOR} / WALK_SPEED_MPS ${WALK_SPEED_MPS}`
  };
}

/** Minutes, rounded, for prose. Never used to make a decision. */
export const formatMinutes = (seconds) => {
  const m = Math.round(seconds / 60);
  return m <= 0 ? '<1 min' : `${m} min`;
};

/**
 * The ONLY duration formatter an answer should reach for. It takes the result of
 * applySafetyMargin and always renders both ends, so a point estimate cannot be
 * produced by picking the wrong helper. When the two ends round to the same
 * minute it says "about", which is still not a promise.
 */
export const formatRange = ({ optimisticSeconds, realisticSeconds }) => {
  const lo = Math.max(1, Math.round(optimisticSeconds / 60));
  const hi = Math.max(1, Math.round(realisticSeconds / 60));
  return lo === hi ? `about ${lo} min` : `${lo}–${hi} min`;
};
