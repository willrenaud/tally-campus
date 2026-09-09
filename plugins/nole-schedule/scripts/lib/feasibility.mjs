/**
 * "Can I make it from this class to the next one?" -- the verdict ladder.
 * Node builtins only.
 *
 * ==================================================================
 * WHY THE VERDICTS ARE THESE FIVE AND NOT "YES" / "NO"
 * ==================================================================
 *
 * The walking data underneath this is a floor, not an estimate (see the header of
 * routing.mjs). Every omission in it runs in the optimistic direction. A question
 * whose wrong answer is a missed class cannot be answered off a number that is
 * known to be too small, so the ladder below is built around that asymmetry
 * rather than around a threshold:
 *
 *   'refuse'            something about the leg cannot be estimated at all. The
 *                       answer is that there is no answer. Never downgraded to a
 *                       guess with a caveat.
 *   'cannot-determine'  the walk can be estimated, but whether the two classes
 *                       ever run on the same day cannot be. A conditional answer
 *                       is attached; the condition is not silently assumed away.
 *   'no'                the gap is shorter than the OPTIMISTIC estimate. This is
 *                       the one verdict the data can state confidently, and it is
 *                       confident precisely because of the bias: if a walk does
 *                       not fit even under assumptions that are all too generous,
 *                       it does not fit. The bias points the right way here.
 *   'tight'             the gap fits the optimistic estimate but not the
 *                       realistic one, or not with the student's buffer on top.
 *                       ANYTHING INSIDE THE MARGIN OF ERROR LANDS HERE. It is
 *                       never reported as "yes" -- the margin is not slack to be
 *                       spent, it is the part of the trip the data forgot to
 *                       count.
 *   'comfortable'       the gap clears the realistic estimate AND the buffer. Even
 *                       this states the assumption; it does not promise.
 *
 * There is deliberately no verdict that reports a single number. reportRange()
 * below is the only formatter, and it always emits both ends.
 *
 * ORDER MATTERS. The checks run: accessibility, then location, then session
 * resolvability, then the numeric ladder. A leg that fails an earlier check never
 * reaches a later one, so a refusal can never be overwritten by an estimate.
 */
import { applySafetyMargin, route, formatRange, WALK_SPEED_MPS } from './routing.mjs';
import { building, buildings } from './campus.mjs';

export const VERDICTS = Object.freeze([
  'refuse', 'cannot-determine', 'no', 'not-walkable', 'tight', 'comfortable',
  // Not on the ladder: there is no walk to judge, so there is nothing to be
  // optimistic or pessimistic about. Kept separate from 'refuse' because nothing
  // was withheld.
  'not-applicable'
]);

/**
 * The modes this plugin knows a student might use instead of walking, and how
 * much it can say about each.
 *
 * WHY THIS EXISTS. Returning a bare "no" to "can I get from WCB to PDB in 30
 * minutes?" answers a question about a mode the student may not be using. The
 * walk genuinely does not fit -- that part was right -- but "no" reads as "you
 * cannot make this class", when the real answer is "not on foot". A student who
 * drives that leg was told a true thing about walking and nothing about the
 * option they actually take.
 *
 * So a leg that is too long to walk STOPS at 'not-walkable' and names what else
 * exists. Even with zero data about those alternatives this is strictly better
 * than a flat refusal, because naming an option a student can evaluate for
 * themselves beats silently implying there is none.
 */
export const ALTERNATIVES = Object.freeze([
  Object.freeze({
    mode: 'drive',
    known: 'partial',
    say: 'Driving and parking again at the other end. The plugin can estimate the walk to your car, ' +
      'the drive itself, and the walk in from the garage -- but NOT how long it takes to find a ' +
      'space, which is usually the part that decides whether you make it.'
  }),
  Object.freeze({
    mode: 'seminole-express',
    known: 'none',
    say: 'Seminole Express, FSU\'s campus bus. Seven routes run 7am-8pm Monday to Friday in fall and ' +
      'spring, and none of their stops, times or paths are in this plugin. It cannot tell you whether ' +
      'a bus helps on this leg. The Transit app has live times.',
    url: 'https://transportation.fsu.edu/bus'
  }),
  Object.freeze({
    mode: 'reschedule',
    known: 'full',
    say: 'Neither class moving is also an option worth naming: a leg that does not fit on foot and ' +
      'depends on a parking space you cannot count on is a standing risk, not a one-off.'
  })
]);

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Where a meeting physically is, for routing purposes. Four outcomes, and three
 * of them are not a building.
 */
export function endpointOf(meeting) {
  if (meeting.deliveryMode === 'online-asynchronous' || meeting.deliveryMode === 'online-synchronous') {
    return { kind: 'online', label: 'online' };
  }
  if (meeting.locationTba === true) return { kind: 'tba', label: 'location not yet announced' };
  if (!meeting.location || !meeting.location.buildingCode) return { kind: 'online', label: 'no location recorded' };
  const code = meeting.location.buildingCode;
  const known = building(code);
  return known
    ? { kind: 'building', code, name: known.name, room: meeting.location.room ?? null, label: `${code}${meeting.location.room ? ` ${meeting.location.room}` : ''}` }
    : { kind: 'unknown-building', code, room: meeting.location.room ?? null, label: `${code}${meeting.location.room ? ` ${meeting.location.room}` : ''}` };
}

/** Always both ends. There is no single-number formatter in this file on purpose. */
export function reportRange(margin) {
  return formatRange(margin);
}

/**
 * Evaluate one leg.
 *
 * `sessionsResolvable` is false when either meeting's partOfTerm cannot be mapped
 * to dates -- the third outcome of the partOfTerm RESOLUTION RULE. It is passed
 * in rather than computed here so that this module needs no calendar.
 */
export function evaluateLeg({
  from,
  to,
  gapMinutes,
  paceMetersPerSecond = WALK_SPEED_MPS,
  bufferMinutes = 0,
  requiresAccessibleRoutes = false,
  sessionsResolvable = true,
  sessionsNote = null,
  drivePlanner = null
}) {
  const gapSeconds = gapMinutes * 60;
  const bufferSeconds = bufferMinutes * 60;
  const base = { from, to, gapMinutes, bufferMinutes, paceMetersPerSecond };

  /* --- 1. Accessibility. DATA-GAPS.md section 9: there is no accessibility data
   * anywhere in this dataset. student-schedule.schema.json says the correct
   * behaviour is to report that the data cannot answer, never to quietly return
   * the default route -- so this refusal comes before everything, including
   * before checking whether the buildings even ship. --- */
  if (requiresAccessibleRoutes) {
    return {
      ...base,
      verdict: 'refuse',
      reason: 'accessible-routes-unsupported',
      say: 'This schedule asks for step-free routing, and the shipped data has no accessibility ' +
        'information at all: not on building entrances, not on walk edges, not on garage access ' +
        'points. There is no accessible route to check against and no way to tell you whether the ' +
        'default one would work. FSU Student Accessibility Services is the right place for this.'
    };
  }

  /* --- 2. Location. Any leg touching an endpoint that is not a shipped building
   * refuses. Not "estimates with a warning" -- refuses. The nearest shipped
   * building is not a stand-in for a missing one, and the distance from WCB to
   * anything the data does know is exactly the number that is missing. --- */
  for (const [side, end] of [['from', from], ['to', to]]) {
    if (end.kind === 'unknown-building') {
      return {
        ...base,
        verdict: 'refuse',
        reason: 'building-not-in-data',
        side,
        say: `${end.code} is not one of the ${buildings().length} buildings that ship with this plugin, so there is no ` +
          'coordinate for it and no walking estimate to give. Substituting a nearby building would ' +
          'produce a number, not an answer. See DATA-GAPS.md section 4.'
      };
    }
    if (end.kind === 'tba') {
      return {
        ...base,
        verdict: 'refuse',
        reason: 'location-tba',
        side,
        say: 'That class meets in person but FSU has not announced where, so there is nothing to ' +
          'route to. Ask again once the room is posted.'
      };
    }
  }
  if (from.kind === 'online') {
    return {
      ...base,
      verdict: 'refuse',
      reason: 'unknown-origin',
      say: 'The earlier class is online, so where you will be walking FROM is not something this ' +
        'data knows. If you will be somewhere on campus, say where and this becomes answerable.'
    };
  }
  if (to.kind === 'online') {
    return {
      ...base,
      verdict: 'not-applicable',
      reason: 'destination-online',
      say: 'The next class is online, so there is no walk between them. What matters instead is ' +
        'whether you will have somewhere to join it from, which this data cannot tell you.'
    };
  }

  /* --- 3. The walk itself. --- */
  const r = route(from.code, to.code, { paceMetersPerSecond });
  if (!r.ok) {
    return {
      ...base,
      verdict: 'refuse',
      reason: r.reason,
      say: r.reason === 'no-route'
        ? `The shipped walk graph has no path between ${from.code} and ${to.code}. That is a defect ` +
          'in the data rather than a fact about campus, and guessing a duration would hide it.'
        : `${(r.missing || []).join(', ')} is not in the shipped campus data.`
    };
  }

  const margin = applySafetyMargin(r.optimisticSeconds);
  const walk = {
    path: r.path,
    edges: r.edges,
    distanceMeters: r.distanceMeters,
    sameBuilding: r.sameBuilding,
    ...margin,
    range: reportRange(margin)
  };

  /* --- 4. Do these two classes ever share a day? Third outcome, not silence. --- */
  if (!sessionsResolvable) {
    const conditional = numericVerdict(gapSeconds, bufferSeconds, margin);
    return {
      ...base,
      verdict: 'cannot-determine',
      reason: 'part-of-term-unresolvable',
      walk,
      conditionalVerdict: conditional.verdict,
      say: (sessionsNote || 'One of these courses runs a part of term whose dates FSU has not published, ' +
        'so whether the two ever meet on the same day cannot be established from the shipped calendar.') +
        ` IF they do both meet that day, the walk is ${walk.range} and that would be ` +
        `"${conditional.verdict}". This is not the same as saying they do.`
    };
  }

  /* --- 5. The numeric ladder. --- */
  const v = numericVerdict(gapSeconds, bufferSeconds, margin);
  const result = { ...base, verdict: v.verdict, reason: v.reason, walk, say: v.say(walk) };

  /* --- 6. A leg that does not work on foot names what else there is.
   *
   * Attached HERE rather than left to the caller's prose, so that a
   * 'not-walkable' verdict can never be rendered as a bare no. `drivePlanner` is
   * optional: with no planner the alternatives are still named, just without
   * numbers, which is the Part A floor and is meant to stand on its own. --- */
  if (v.verdict === 'not-walkable') {
    result.alternatives = ALTERNATIVES;
    if (typeof drivePlanner === 'function') {
      result.drivePlan = drivePlanner({ from, to, gapMinutes, bufferMinutes });
    }
  }
  return result;
}

/**
 * The threshold logic, kept separate so the conditional branch above uses exactly
 * the same rules rather than a second copy of them.
 */
function numericVerdict(gapSeconds, bufferSeconds, margin) {
  if (gapSeconds <= 0) {
    return {
      verdict: 'no',
      reason: 'meetings-overlap',
      say: () => 'These two overlap in time; there is no gap to walk in. That is a schedule conflict, not a walking problem.'
    };
  }
  if (gapSeconds < margin.optimisticSeconds) {
    /* NOT "no". The walk does not fit -- that much the data can state plainly,
     * and it can because the bias runs the safe way: a walk that fails even the
     * optimistic number fails for real. But "no" answers a question about
     * WALKING, and the student may not be walking. Stop at the mode. */
    return {
      verdict: 'not-walkable',
      reason: 'shorter-than-optimistic',
      say: (w) => `Not on foot. The gap is shorter than even the optimistic walking estimate (${w.range}), ` +
        'and every omission in this data makes walks look FASTER than they are -- so a walk that does ' +
        'not fit the optimistic number does not fit at all. That is a statement about walking, not ' +
        'about whether you can make the class.'
    };
  }
  if (gapSeconds < margin.realisticSeconds + bufferSeconds) {
    return {
      verdict: 'tight',
      reason: 'inside-the-margin',
      say: (w) => `Tight -- leave as soon as you are packed. The walk is ${w.range}: the low end is what ` +
        'the shipped data says, the high end adds back what it is known to leave out (door-to-door ' +
        'distance, stairs, crossings, class-change crowds). Your gap fits the low end but not the ' +
        'high one, which is exactly the band where the data cannot tell you which side you are on.'
    };
  }
  return {
    verdict: 'comfortable',
    reason: 'clears-the-margin',
    say: (w) => `Comfortable. The walk is ${w.range} and your gap clears the high end. That high end ` +
      'already includes the safety margin, so this holds up even if the crowds are bad -- assuming ' +
      'the class actually lets out on time, which no data here can promise.'
  };
}

/**
 * Consecutive in-person pairs on one weekday, in time order.
 *
 * A meeting with no days or no start time (an asynchronous course) is not part of
 * anyone's walking day and is skipped rather than placed somewhere.
 */
export function legsForDay(meetings, day) {
  const onDay = meetings
    .filter((m) => Array.isArray(m.daysOfWeek) && m.daysOfWeek.includes(day) && m.startTime && m.endTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const pairs = [];
  for (let i = 0; i + 1 < onDay.length; i++) {
    pairs.push({
      day,
      earlier: onDay[i],
      later: onDay[i + 1],
      gapMinutes: toMinutes(onDay[i + 1].startTime) - toMinutes(onDay[i].endTime)
    });
  }
  return pairs;
}
