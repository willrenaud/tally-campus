/**
 * Driving between classes, and parking again at the other end. Node builtins only.
 *
 * ==================================================================
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * ==================================================================
 *
 * **There is no total.** Not a field, not a getter, not a number anywhere in the
 * returned object that adds up to "how long the trip takes". `planDrive()`
 * returns components and a `knownMinimumSeconds` that is explicitly labelled a
 * FLOOR, and the thing standing between that floor and a real answer --
 * **how long it takes to find a space** -- is returned as
 * `{ estimable: false }` with no seconds on it at all.
 *
 * That is not caution for its own sake. A drive leg is:
 *
 *     walk to the car  +  drive  +  FIND A SPACE  +  walk in from the garage
 *
 * and the third term is the one that decides whether a student makes the class.
 * The shipped data has six garages with **no capacity, no `typicalFullBy`, no
 * occupancy and no historical fill data** (`DATA-GAPS.md` §7). There is nothing
 * to estimate it from. Producing "about 12 minutes" would be the same class of
 * harm the parking skill already refuses on game days: a student told 12 minutes
 * arrives late because PG5 was full, while a student told "unknown, budget
 * generously" leaves early and makes it.
 *
 * So the honest core of this feature is a hole in the middle of it, and the
 * design job was to make that hole impossible to paper over. It is enforced
 * structurally rather than in prose: there is no field to put a total in.
 *
 * ==================================================================
 * THE SAFETY MARGIN IS APPLIED ONCE, NOT TWICE
 * ==================================================================
 *
 * A drive leg has TWO walking components, and `SAFETY_MARGIN` (see routing.mjs)
 * is ×1.35 on the walk PLUS a flat 180 seconds. Applying it to each walk leg
 * separately would add the flat 180s twice, and the flat part is explicitly a
 * per-JOURNEY allowance, not a per-leg one -- its three components are
 * centroid-to-door at both ends, time inside the buildings at both ends, and one
 * road crossing. A drive journey still has exactly one origin building and one
 * destination building, so it earns that allowance exactly once.
 *
 * Therefore: the two walk legs' optimistic seconds are SUMMED FIRST and
 * `applySafetyMargin` is called ONCE on the sum. The multiplier is still applied
 * to all the walking, which is correct -- crowding scales with distance walked --
 * but the fixed allowance is not double-charged. Every component in the returned
 * object carries a `carriesMargin` field saying which side of this it falls on,
 * so an answer can state it rather than leaving the reader to guess.
 *
 * What this deliberately does NOT do is invent a garage-specific allowance for
 * the walk from the deck down to street level. Garage access points are
 * `centroid-stand-in`, `verticalTransit` is unpopulated on every one of them, and
 * inventing a stair-and-lift time would be exactly the fabrication this file is
 * built to avoid. It is named as an unquantified addition instead.
 */
import { straightLineEstimate, applySafetyMargin, haversineMeters, formatRange, formatMinutes, SAFETY_MARGIN } from './routing.mjs';
import { blackoutCheck, rankZonesFor } from './parking.mjs';
import { building } from './campus.mjs';

/**
 * The driving model, in the same shape and spirit as the walking one: two
 * constants, both chosen and documented rather than measured, applied to a
 * haversine distance.
 *
 *   roadMeters   = haversine × ROAD_FACTOR
 *   seconds      = roadMeters ÷ DRIVE_SPEED_MPS
 *
 * `roadFactor = 1.45` — higher than walking's 1.3, and for a specific reason: a
 * pedestrian can cut across Landis Green and through building breezeways, and a
 * car cannot. Cars are confined to through-streets, meet one-way segments around
 * the core, and on this campus frequently have to go out to a perimeter road and
 * back in. 1.45 is a mid-range circuity figure for driving in a constrained urban
 * grid.
 *
 * `driveSpeedMetersPerSecond = 6.7` — about 15 mph, an average INCLUDING stops.
 * FSU's internal roads are posted at 20 mph or below and the surrounding streets
 * at 30–35, but the average over a two-kilometre trip with signals, stop signs
 * and constant pedestrian crossings is far below any of those.
 *
 * NEITHER NUMBER HAS BEEN MEASURED. They are stated so an answer can say what it
 * assumed, and they are the smallest source of error in a drive answer by a wide
 * margin — the parking search dominates everything.
 */
export const DRIVE_MODEL = Object.freeze({
  roadFactor: 1.45,
  driveSpeedMetersPerSecond: 6.7,
  approxMph: 15,
  basis: 'Chosen and documented, not measured. Same approach as the walking model in data/README.md. ' +
    'Excludes finding a space, queueing at a garage gate, and any traffic beyond an average that ' +
    'assumes signals and stops.',
  excludes: ['finding a space', 'queueing at a gate arm', 'unusual traffic', 'weather']
});

/**
 * The hole in the middle, as data rather than as a warning.
 *
 * `seconds` is not merely null — the key does not exist. A consumer cannot read a
 * number off this object by accident, and a test can assert that no key on it is
 * numeric.
 */
export const PARKING_SEARCH = Object.freeze({
  estimable: false,
  confidence: 'none',
  why: 'The shipped parking data has six garages and, for each of them, NO capacity, no adaSpaces, ' +
    'no typicalFullBy, no occupancy feed and no historical fill data. There is nothing to estimate ' +
    'a search time from. See DATA-GAPS.md section 7.',
  couldSwampEverything: true,
  impact: 'On a weekday morning this is routinely the largest term in the whole trip, and it is the ' +
    'one that decides whether you make the class. A drive answer that omits it is not an ' +
    'underestimate, it is a different question.',
  whatWouldFixIt: 'A capacity and typicalFullBy figure per garage would let this be bounded rather ' +
    'than guessed. An occupancy feed would let it be answered.',
  say: 'TIME TO FIND A SPACE IS UNKNOWN and can be larger than every other component put together. ' +
    'Budget generously; do not plan to the estimated components.'
});

/** Straight-line driving estimate between two coordinates. */
export function driveEstimate(a, b) {
  const straight = haversineMeters(a, b);
  const roadMeters = straight * DRIVE_MODEL.roadFactor;
  return {
    straightLineMeters: Math.round(straight * 10) / 10,
    roadMeters: Math.round(roadMeters * 10) / 10,
    optimisticSeconds: Math.round(roadMeters / DRIVE_MODEL.driveSpeedMetersPerSecond),
    model: `haversine x ROAD_FACTOR ${DRIVE_MODEL.roadFactor} / DRIVE_SPEED ${DRIVE_MODEL.driveSpeedMetersPerSecond} m/s (~${DRIVE_MODEL.approxMph} mph)`
  };
}

/**
 * Plan a drive-and-park-again leg between two shipped buildings.
 *
 * THE MULTI-HOP ASSUMPTION, stated because it is doing a lot of work: the car is
 * assumed to be at the garage this plugin would have recommended for the EARLIER
 * class, not at some single spot taken in the morning. A student who drives
 * between classes moves the car during the day, so a model that assumes one
 * morning parking spot answers a question nobody asked. The assumption is
 * returned on the result so an answer can state it and a student can correct it.
 *
 * Returns { ok: false, reason } for a blackout date, an unshipped building, or a
 * pair whose best garage is the same at both ends.
 */
export function planDrive({ fromCode, toCode, date, time = '12:00', permits = [], paceMetersPerSecond } = {}) {
  const origin = building(fromCode);
  const destination = building(toCode);
  if (!origin || !destination) {
    return {
      ok: false,
      reason: 'building-not-in-data',
      missing: [fromCode, toCode].filter((c) => !building(c)),
      say: 'A drive answer needs a coordinate at both ends, and at least one of these buildings is not ' +
        'in the shipped campus data.'
    };
  }

  /* The blackout gate applies to DRIVING TOO, and this is easy to miss: a drive
   * answer is a parking answer with a car journey in front of it. Telling a
   * student to drive to campus on a home football date is telling them to park on
   * one, which parking-zones.json's own schema requires a consumer to refuse. */
  if (date) {
    const gate = blackoutCheck(date, time);
    if (gate.status !== 'clear') {
      return {
        ok: false,
        reason: gate.status,
        gate,
        say: `Driving is not answerable for ${date} either: ${gate.why} A drive answer is a parking ` +
          'answer with a journey in front of it, so the same refusal applies.',
        sendTo: gate.sendTo
      };
    }
  }

  const originZones = rankZonesFor(origin, date ?? '2026-09-03', time, { permits });
  const destZones = rankZonesFor(destination, date ?? '2026-09-03', time, { permits });
  const parkedAt = originZones[0];
  const parkAt = destZones[0];

  if (parkedAt.id === parkAt.id) {
    return {
      ok: false,
      reason: 'same-garage',
      zone: parkAt,
      say: `The best garage this data can offer is the same one for both buildings (${parkAt.name}), ` +
        'so driving between them means moving the car and parking in the place it already is. ' +
        'Walking is the answer, even if the walk is long.'
    };
  }

  /* --- the four components --- */
  const walkToCar = {
    ...straightLineEstimate(origin.centroid, parkedAt.centroid),
    from: origin.code,
    to: parkedAt.id,
    carriesMargin: 'in-combined-walk',
    basis: 'straight-line to a garage centroid, NOT a graph route -- no walk edge in the shipped data ' +
      'has a parking endpoint, so this is weaker than an ordinary walking estimate'
  };
  const walkFromGarage = {
    ...straightLineEstimate(parkAt.centroid, destination.centroid),
    from: parkAt.id,
    to: destination.code,
    carriesMargin: 'in-combined-walk',
    basis: 'straight-line from a garage centroid, NOT a graph route -- same weakness as the leg to the car'
  };
  const drive = {
    ...driveEstimate(parkedAt.centroid, parkAt.centroid),
    from: parkedAt.id,
    to: parkAt.id,
    carriesMargin: false,
    basis: 'estimate from documented constants; the walking safety margin is NOT applied to it, ' +
      'because that margin models doors, stairs, crossings and class-change crowds, none of which a ' +
      'car is subject to'
  };

  /* THE MARGIN, ONCE. Summed first, then applied. See the header. */
  const combinedWalkOptimistic = walkToCar.optimisticSeconds + walkFromGarage.optimisticSeconds;
  const margin = applySafetyMargin(combinedWalkOptimistic);
  const combinedWalk = {
    ...margin,
    range: formatRange(margin),
    appliedOnce: true,
    note: `The x${SAFETY_MARGIN.crowdMultiplier} multiplier applies to the sum of both walking legs, and the ` +
      `${SAFETY_MARGIN.fixedSeconds}s fixed allowance is added ONCE, not once per leg: it covers doors, ` +
      'time inside the buildings and a road crossing, and this journey still has one origin building ' +
      'and one destination building.'
  };

  const knownMinimumSeconds = combinedWalk.realisticSeconds + drive.optimisticSeconds;

  return {
    ok: true,
    assumption: `Assumes your car is at ${parkedAt.name}, which is where this plugin would have told ` +
      `you to park for the earlier class. If you left it somewhere else, the walk-to-car leg is wrong.`,
    origin: { code: origin.code, name: origin.name },
    destination: { code: destination.code, name: destination.name },
    parkedAt: { id: parkedAt.id, name: parkedAt.name, curated: parkedAt.curated, rule: parkedAt.rule, eligible: parkedAt.eligible },
    parkAt: { id: parkAt.id, name: parkAt.name, curated: parkAt.curated, rule: parkAt.rule, eligible: parkAt.eligible },
    components: { walkToCar, drive, parkingSearch: PARKING_SEARCH, walkFromGarage },
    combinedWalk,
    /* A FLOOR, and named one. Everything except the term that dominates. */
    knownMinimumSeconds,
    knownMinimumLabel: `${formatMinutes(knownMinimumSeconds)} BEFORE you start looking for a space`,
    /* Deliberately absent: any field that totals the trip. There is no honest
     * value for one, so there is no key for one. */
    unknowns: [PARKING_SEARCH.say,
      'Getting from the parking deck down to street level is not counted either: garage access points ' +
      'are structure centres and no verticalTransit is recorded, so stairs and lifts are unmodelled.'],
    driveModel: DRIVE_MODEL
  };
}
