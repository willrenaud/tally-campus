/**
 * Parking-rule evaluation, and the blackout check that runs before it.
 * Node builtins only.
 *
 * ==================================================================
 * THE BLACKOUT CHECK COMES FIRST, AND IT REFUSES
 * ==================================================================
 *
 * parking-zone.schema.json states it as a requirement on consumers: before
 * evaluating any rule for a date, check that date against the parkingBlackouts
 * array of the term-calendar record covering it. This module makes that
 * structural rather than advisory -- evaluateParking() will not evaluate a rule
 * until blackoutCheck() has returned clear, so the check cannot be forgotten by
 * whoever calls it next.
 *
 * The reason it refuses instead of hedging is in DATA-GAPS.md section 7. FSU
 * publishes that "multiple campus parking areas will be closed for reserved
 * Seminole Booster parking on home football game days", that vehicles must be out
 * "by 11:59 PM the night before game day", and that a vehicle left in a reserved
 * Garnet area "will be towed at your expense". It never publishes WHICH areas, or
 * which garages, or when access returns. So on those seven dates the shipped
 * rules are known to be wrong, and a hedged wrong answer gets the car towed just
 * as thoroughly as a confident one.
 *
 * Three distinct refusals live here, not one:
 *
 *   'blackout'      the date is a listed home-game date.
 *   'blackout-eve'  the date is the day BEFORE one, at or after BLACKOUT_EVE_FROM.
 *                   FSU's own "out by 11:59 PM the night before" clause means the
 *                   restriction begins the previous evening, which the date list
 *                   does not model. DATA-GAPS.md section 7 says explicitly that a
 *                   consumer should treat the evening before as suspect too.
 *   'no-calendar'   no shipped term calendar covers the date. This one is easy to
 *                   get wrong: a date with no calendar has no blackout list to
 *                   check, so it is not "a normal day", it is a day whose game
 *                   status is UNKNOWN. Only Fall 2026 ships. Answering for
 *                   Spring 2027 would mean asserting that no game falls on it,
 *                   which nothing in the data supports.
 */
import { parkingZones, termCalendarCovering, termCalendars } from './campus.mjs';

/**
 * From when on the evening before a game the blackout is treated as already in
 * force. FSU says "out by 11:59 PM the night before"; 17:00 is the point after
 * which a car parked on campus is plausibly still there at that deadline. Chosen,
 * not published -- like everything else about game day, FSU gives no time.
 */
export const BLACKOUT_EVE_FROM = '17:00';

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Weekday of a YYYY-MM-DD date, computed in UTC so a local zone cannot shift it. */
export function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The day after a YYYY-MM-DD date, as YYYY-MM-DD. */
export function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Whether this date and time can be answered about at all.
 *
 * Returns { status: 'clear', termCode } or one of the three refusals described in
 * the header, each carrying what an answer needs to say and where to send the
 * student instead.
 */
export function blackoutCheck(date, time = '12:00') {
  const cal = termCalendarCovering(date);
  if (!cal) {
    return {
      status: 'no-calendar',
      date,
      shippedTerms: termCalendars().map((t) => t.termCode),
      why: `No shipped term calendar covers ${date}, so its parkingBlackouts cannot be checked. ` +
        'That is not the same as the date being clear: it means whether a home football game falls ' +
        'on it is unknown, and the shipped rules are known to be wrong on game days.',
      sendTo: 'https://transportation.fsu.edu/GameDay'
    };
  }

  const blackouts = Array.isArray(cal.parkingBlackouts) ? cal.parkingBlackouts : [];
  const hit = blackouts.find((b) => b.date === date);
  if (hit) {
    return {
      status: 'blackout',
      date,
      termCode: cal.termCode,
      blackout: hit,
      why: `${date} is ${hit.name}. FSU closes and reserves campus parking on home football game days ` +
        'and does not publish which areas, so the shipped rules cannot be evaluated for this date.',
      sendTo: hit.sourceUrl || 'https://transportation.fsu.edu/GameDay'
    };
  }

  const tomorrow = nextDate(date);
  const eve = blackouts.find((b) => b.date === tomorrow);
  if (eve && minutes(time) >= minutes(BLACKOUT_EVE_FROM)) {
    return {
      status: 'blackout-eve',
      date,
      time,
      termCode: cal.termCode,
      blackout: eve,
      from: BLACKOUT_EVE_FROM,
      why: `${tomorrow} is ${eve.name}, and FSU requires vehicles to be out of reserved areas ` +
        `"by 11:59 PM the night before game day". A car parked from ${BLACKOUT_EVE_FROM} on ${date} ` +
        'is plausibly still there at that deadline, and FSU does not say which areas are affected.',
      sendTo: eve.sourceUrl || 'https://transportation.fsu.edu/GameDay'
    };
  }

  return { status: 'clear', date, time, termCode: cal.termCode };
}

/**
 * Does a timeWindow contain this weekday and time?
 *
 * Implements the evaluation rule written on common.defs timeWindow, INCLUDING the
 * wrapping case, where daysOfWeek names the days the window opens on rather than
 * every day it touches. The comment on that definition warns that an
 * implementation which filters by weekday before comparing times silently drops
 * the after-midnight half; this one compares both halves.
 */
export function windowMatches(win, day, time) {
  const start = minutes(win.startTime);
  const end = minutes(win.endTime);
  const t = minutes(time);
  if (end === start) return false; // invalid; validate-data.mjs rejects these
  if (end > start) return win.daysOfWeek.includes(day) && t >= start && t < end;
  const prev = DAYS[(DAYS.indexOf(day) + 6) % 7];
  return (win.daysOfWeek.includes(day) && t >= start) || (win.daysOfWeek.includes(prev) && t < end);
}

/**
 * The rule that governs one zone at one moment: last match wins, firewall style.
 *
 * rules[0] is a schema-required catch-all, so this never returns null for shipped
 * data -- "no rule matched" is unrepresentable by construction. It is still
 * written to return null rather than throw, because a zone that somehow matched
 * nothing must surface as a refusal upstream, not as a silent default.
 */
export function ruleAt(zone, date, time) {
  const day = dayOfWeek(date);
  let match = null;
  for (const rule of zone.rules) {
    if (rule.effectiveFrom && date < rule.effectiveFrom) continue;
    if (rule.effectiveTo && date > rule.effectiveTo) continue;
    if (windowMatches(rule.window, day, time)) match = rule;
  }
  return match;
}

/** Every shipped zone, with the rule that governs it at this moment. */
export function evaluateZones(date, time, { permits = [] } = {}) {
  return parkingZones().map((zone) => {
    const rule = ruleAt(zone, date, time);
    const allows = rule?.allows ?? [];
    const openToAll = rule?.mode === 'open-to-all';
    return {
      id: zone.id,
      name: zone.name,
      zoneType: zone.zoneType,
      centroid: zone.centroid,
      servesBuildings: zone.servesBuildings ?? [],
      rule: rule
        ? {
            id: rule.id,
            mode: rule.mode,
            window: rule.window,
            allows,
            // ALWAYS carried through to the answer. It is where the source
            // conflict about student white-space hours is recorded, and where
            // "unless denoted by signage" lives.
            enforcementNote: rule.enforcementNote ?? null
          }
        : null,
      // null, not false: with no permits declared the question has not been
      // answered, and reporting "not eligible" would be a claim the data cannot
      // make about a student it knows nothing about.
      eligible: openToAll ? true : (permits.length ? permits.some((p) => allows.includes(p)) : null),
      notes: zone.notes ?? null,
      provenanceConfidence: zone.provenance?.confidence ?? null
    };
  });
}

/**
 * What the shipped parking data does NOT cover. Attached to every answer, because
 * six garages is not "FSU parking" and a student who reads a garage
 * recommendation as the full set of options will drive past a surface lot they
 * could have used, or park in one this data cannot vouch for.
 */
export const COVERAGE_CAVEAT = Object.freeze({
  zonesShipped: 6,
  zoneTypesShipped: ['garage'],
  missing: [
    'every surface lot, including reserved (green-striped) and employee-only lots',
    'student overnight and residence-hall lots, including the DeGraff resident lot',
    'metered, visitor and pay-by-app parking',
    'park-and-ride',
    'which floors of a garage are faculty/staff and which are student',
    'capacity, and the time of day a garage typically fills'
  ],
  say: 'Only FSU\'s six parking garages ship with this plugin. No surface lot, metered space, reserved lot or park-and-ride is in the data at all, so this is not a list of your options -- it is a list of the garages. See DATA-GAPS.md section 7.'
});
