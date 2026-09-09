/**
 * Time collisions between meetings, with THREE outcomes. Node builtins only.
 *
 * ==================================================================
 * THE THIRD OUTCOME IS THE WHOLE POINT OF THIS FILE
 * ==================================================================
 *
 * Two meetings that share a weekday and overlap in clock time have three possible
 * relationships, not two:
 *
 *   'conflict'          they genuinely run at the same time, on the same days,
 *                       during an overlapping stretch of the term.
 *   'no-conflict'       they overlap on the clock but their date ranges do not
 *                       touch -- a first-half course and a second-half course in
 *                       the same slot. This is a POSITIVE finding and needs dates
 *                       to support it.
 *   'cannot-determine'  at least one meeting's partOfTerm cannot be resolved to
 *                       dates at all, so whether they ever coincide is unknown.
 *
 * Collapsing the third into the second is the failure this exists to prevent, and
 * it is not hypothetical: FSU publishes session date ranges for SUMMER terms only.
 * The shipped Fall 2026 calendar therefore carries sessionsStatus
 * "not-published" and an empty sessions array, so for the term this plugin
 * actually ships, ANY non-full-term meeting lands in 'cannot-determine'. That is
 * the common case right now, not an edge case, and an answer has to make it read
 * as a fact about FSU's publishing rather than as the tool being broken.
 *
 * The distinction has teeth: told "no conflict", a student registers for both and
 * finds out in week one. Told "I cannot tell", they check with the department,
 * which takes a minute and is always right.
 */

const overlaps = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

/**
 * The dates a meeting actually runs, or null when they cannot be established.
 *
 * null is case (c) of the partOfTerm RESOLUTION RULE and MUST NOT be treated as
 * "the whole term" -- that assumption is exactly what manufactures a false
 * conflict, or a false absence of one.
 */
export function resolveSpan(m, calendar) {
  if (m.dateRange) {
    return { from: m.dateRange.firstMeetingDate, to: m.dateRange.lastMeetingDate, source: 'dateRange' };
  }
  const part = m.partOfTerm ?? 'full-term';
  if (part === 'full-term') {
    if (calendar) return { from: calendar.classesBeginDate, to: calendar.classesEndDate, source: 'term' };
    return null;
  }
  const sessions = Array.isArray(calendar?.sessions) ? calendar.sessions : [];
  const s = sessions.find((x) => x.code === part);
  if (s) return { from: s.startDate, to: s.endDate, source: 'session' };
  return null; // UNRESOLVABLE
}

/**
 * Every pair of meetings that share a day and overlap on the clock, each with its
 * verdict. Pairs that never touch are not returned at all.
 *
 * An asynchronous course has no meeting time and so can never collide; it is
 * skipped rather than reported as conflict-free, because "no conflict" about a
 * course with no time is a claim with no content.
 */
export function findCollisions(meetings, calendar, termCode) {
  const sessionsStatus = calendar?.sessionsStatus ?? 'not-checked';
  const out = [];
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      const a = meetings[i];
      const b = meetings[j];
      if (a.deliveryMode === 'online-asynchronous' || b.deliveryMode === 'online-asynchronous') continue;
      if (!Array.isArray(a.daysOfWeek) || !Array.isArray(b.daysOfWeek)) continue;
      if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) continue;
      const days = a.daysOfWeek.filter((d) => b.daysOfWeek.includes(d));
      if (!days.length || !overlaps(a, b)) continue;

      const sa = resolveSpan(a, calendar);
      const sb = resolveSpan(b, calendar);
      let verdict, why;
      if (!sa || !sb) {
        const which = !sa ? a : b;
        verdict = 'cannot-determine';
        why = `${which.courseCode} runs '${which.partOfTerm}', and the ${termCode} calendar has no date range for that ` +
          `(sessionsStatus is "${sessionsStatus}"). These two might not overlap at all, or they might collide every week. ` +
          'This is not the same as "no conflict" and must not be reported as one.';
      } else if (sa.from > sb.to || sb.from > sa.to) {
        verdict = 'no-conflict';
        why = `${a.courseCode} runs ${sa.from} to ${sa.to} and ${b.courseCode} runs ${sb.from} to ${sb.to}; they never run at the same time of year.`;
      } else {
        verdict = 'conflict';
        why = `Both run between ${sa.from > sb.from ? sa.from : sb.from} and ${sa.to < sb.to ? sa.to : sb.to}.`;
      }
      out.push({
        verdict,
        days,
        a: { id: a.id, courseCode: a.courseCode, section: a.section, startTime: a.startTime, endTime: a.endTime, partOfTerm: a.partOfTerm ?? 'full-term' },
        b: { id: b.id, courseCode: b.courseCode, section: b.section, startTime: b.startTime, endTime: b.endTime, partOfTerm: b.partOfTerm ?? 'full-term' },
        why
      });
    }
  }
  return out;
}

/**
 * Meetings whose part of term cannot be resolved at all, whether or not they
 * collide with anything.
 *
 * Reported separately because these are the courses whose answers are degraded
 * generally -- their deadlines are unknown too -- and a student is better served
 * knowing which courses those are than being told once per colliding pair.
 */
export function unresolvableMeetings(meetings, calendar) {
  return meetings.filter((m) => resolveSpan(m, calendar) === null);
}
