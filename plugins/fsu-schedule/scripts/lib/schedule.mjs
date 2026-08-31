/**
 * The shared read layer every query skill sits on. Node builtins only.
 *
 * Four jobs, and each exists because getting it wrong produces a confidently
 * wrong answer rather than a visible error:
 *
 *   1. RESOLVE "NOW" IN AMERICA/NEW_YORK, WITH AN INJECTABLE CLOCK.
 *      Every date in this dataset is FSU wall-clock time. A student asking "what's
 *      next" from a laptop still set to another zone, or a test running in CI on
 *      UTC, must get the same answer as someone standing on Landis Green. And a
 *      clock that cannot be injected cannot be tested: "what happens at 11pm on a
 *      Friday" is exactly the case that breaks, and it is untestable against a
 *      real clock because it is only true for one hour a week.
 *
 *   2. LOAD THE STORED SCHEDULE, WITH NO-SCHEDULE AS A FIRST-CLASS OUTCOME.
 *      Not an exception, not an empty list. A student who has never run the
 *      importer is the single most likely caller of any of these skills, and the
 *      right answer for them is "import first, here is how" -- not a stack trace
 *      and not a cheerful "you have no classes today", which is indistinguishable
 *      from a real free day and is worse than an error.
 *
 *   3. CARRY importWarnings THROUGH TO THE ANSWER.
 *      The warnings recorded at import time are the only record of what is shaky
 *      about a stored schedule. An answer built on a meeting whose room was
 *      OCR'd, whose building did not resolve, or whose delivery mode was assumed,
 *      must be able to say so months later. They are attached per-meeting here so
 *      a consumer cannot lose them by looking at meetings alone.
 *
 *   4. SAY WHETHER THE DATE IS EVEN A CLASS DAY.
 *      See dayStatus(): three-valued, never boolean.
 */
import fs from 'node:fs';
import { readSchedule, dataRoot, listTerms } from './store.mjs';
import { building, termCalendar, termCalendars, termCalendarCovering } from './campus.mjs';

export const TIMEZONE = 'America/New_York';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

/**
 * The current moment as FSU sees it.
 *
 * `override` accepts "YYYY-MM-DD", "YYYY-MM-DDTHH:MM", or "YYYY-MM-DD HH:MM" and
 * is taken as already being America/New_York wall time -- an injected clock is a
 * statement about the campus, not about the machine.
 *
 * Without an override the real clock is converted through Intl, which is a Node
 * builtin and knows about daylight saving. Doing this by hand with a fixed -05:00
 * offset would be wrong for most of a fall term.
 */
export function resolveNow(override) {
  if (override) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(override).trim());
    if (!m) {
      return { ok: false, reason: `--now must be YYYY-MM-DD or YYYY-MM-DDTHH:MM, got ${JSON.stringify(override)}` };
    }
    const date = m[1];
    const time = m[2] ? `${m[2]}:${m[3]}` : '00:00';
    return { ok: true, date, time, weekday: weekdayOf(date), basis: 'injected', timezone: TIMEZONE };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // Intl renders midnight as "24" in some ICU versions; normalise it.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { ok: true, date, time: `${hour}:${parts.minute}`, weekday: weekdayOf(date), basis: 'clock', timezone: TIMEZONE };
}

/** Weekday of a YYYY-MM-DD date, computed in UTC so a local zone cannot shift it. */
export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Calendar-day arithmetic on YYYY-MM-DD, done in UTC for the same reason. */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** "14:05" -> "2:05 pm". Presentation only; never used to decide anything. */
export function clock12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Load the stored schedule for a term.
 *
 * Returns one of:
 *   { status: 'ok', doc, meetings, termCode, calendar, warnings, warningsByMeeting }
 *   { status: 'no-schedule', termCode, otherTerms, say }
 *   { status: 'no-data-dir', say }
 *   { status: 'unreadable', say }
 *
 * None of these is thrown. A caller decides what each one means for its own
 * question, and the three failures all carry a `say` that is addressed to the
 * student rather than to a developer.
 */
export function loadSchedule({ dataDir, termCode, scheduleFile } = {}) {
  let doc = null;
  let resolvedTerm = termCode ?? null;

  if (scheduleFile) {
    try {
      doc = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));
      resolvedTerm = doc.termCode ?? resolvedTerm;
    } catch (err) {
      return { status: 'unreadable', say: `Could not read ${scheduleFile}: ${err.message}` };
    }
  } else {
    let root;
    try { root = dataRoot(dataDir); } catch (err) {
      return {
        status: 'no-data-dir',
        say: `${err.message} Without it there is nowhere to read a saved schedule from.`
      };
    }
    const terms = listTerms(root);
    if (!resolvedTerm) resolvedTerm = terms[terms.length - 1] ?? null;
    if (!resolvedTerm) {
      return {
        status: 'no-schedule',
        termCode: null,
        otherTerms: [],
        say: 'No schedule has been imported yet, so there is nothing to answer from. ' +
          'Run the import-schedule skill first -- a paste from Student Central, an .ics export or ' +
          'a screenshot of your week is enough, and it only has to be done once per term.'
      };
    }
    try { doc = readSchedule(root, resolvedTerm); } catch (err) {
      return { status: 'unreadable', say: err.message };
    }
    if (!doc) {
      return {
        status: 'no-schedule',
        termCode: resolvedTerm,
        otherTerms: terms,
        say: terms.length
          ? `Nothing is stored for ${resolvedTerm}. Stored terms: ${terms.join(', ')}. ` +
            'Import this term, or ask about one of those.'
          : 'No schedule has been imported yet, so there is nothing to answer from. ' +
            'Run the import-schedule skill first; it only has to be done once per term.'
      };
    }
  }

  const meetings = Array.isArray(doc.meetings) ? doc.meetings : [];
  const warnings = Array.isArray(doc.import?.warnings) ? doc.import.warnings : [];

  /* Attach warnings to the meeting they are about, so an answer that mentions one
   * meeting cannot lose the caveat recorded against it at import time. */
  const warningsByMeeting = new Map();
  for (const w of warnings) {
    if (!w.meetingId) continue;
    if (!warningsByMeeting.has(w.meetingId)) warningsByMeeting.set(w.meetingId, []);
    warningsByMeeting.get(w.meetingId).push(w);
  }

  return {
    status: 'ok',
    doc,
    meetings,
    termCode: doc.termCode ?? resolvedTerm,
    calendar: doc.termCode ? termCalendar(doc.termCode) : null,
    warnings,
    warningsByMeeting,
    scheduleWarnings: warnings.filter((w) => !w.meetingId)
  };
}

/**
 * What kind of day this is for classes. THREE-VALUED, NEVER BOOLEAN.
 *
 *   'classes'   an ordinary class day inside the term
 *   'partial'   classes meet, but only until cancelledFromTime -- FSU's Homecoming
 *               Friday. This is the value that did not exist before the schema
 *               gained cancelledFromTime, and its absence meant the day reported as
 *               entirely normal while afternoon classes were cancelled.
 *   'none'      a holiday, a break, a weekend, or a date outside the term
 *   'finals'    inside the final examination period, where the weekly meeting
 *               pattern DOES NOT APPLY and must never be expanded
 *
 * `reasons` always carries the calendar records behind the verdict, so an answer
 * can name the holiday rather than just refusing to list anything.
 */
export function dayStatus(date, calendar) {
  /* A caller passes the calendar belonging to the STORED SCHEDULE, which is the
   * right default. But that calendar stops covering the date the moment the term
   * ends, and continuing to reason from it would describe 5 January 2027 in terms
   * of Fall 2026's internals. Outside its own span it is discarded and the
   * covering-term lookup decides, which is what produces the honest "no shipped
   * calendar covers this date" rather than a stale in-term answer. */
  const inSpan = calendar && calendar.startDate <= date && date <= calendar.endDate;
  const covering = inSpan ? calendar : termCalendarCovering(date);
  if (!covering) {
    const all = termCalendars();
    const next = all.filter((c) => c.startDate > date).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const prev = all.filter((c) => c.endDate < date).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    return {
      kind: 'none',
      outsideTerm: true,
      reasons: [],
      nextTerm: next ? { termCode: next.termCode, displayName: next.displayName, startDate: next.startDate } : null,
      previousTerm: prev ? { termCode: prev.termCode, displayName: prev.displayName, endDate: prev.endDate } : null,
      say: next
        ? `${date} falls outside every term this plugin has a calendar for. ${next.displayName ?? next.termCode} begins ${next.startDate}.`
        : `${date} falls outside every term this plugin has a calendar for, and no later term is shipped.`
    };
  }

  if (date < covering.classesBeginDate) {
    return { kind: 'none', beforeClasses: true, reasons: [], termCode: covering.termCode,
      say: `Classes for ${covering.displayName ?? covering.termCode} do not begin until ${covering.classesBeginDate}.` };
  }

  const finals = covering.finals;
  if (finals && date >= finals.startDate && date <= finals.endDate) {
    return {
      kind: 'finals', reasons: [], termCode: covering.termCode, finals,
      say: `${date} is inside final examination week (${finals.startDate} to ${finals.endDate}). ` +
        'Exams do NOT fall at a course\'s normal meeting time, so a weekly schedule says nothing about this week.'
    };
  }

  if (date > covering.classesEndDate) {
    return { kind: 'none', afterClasses: true, reasons: [], termCode: covering.termCode,
      say: `Classes for ${covering.displayName ?? covering.termCode} ended on ${covering.classesEndDate}.` };
  }

  const hits = (covering.nonClassDays ?? []).filter((p) => p.startDate <= date && date <= p.endDate);
  const whole = hits.find((p) => p.classesCancelled !== false);
  if (whole) {
    return { kind: 'none', reasons: hits, termCode: covering.termCode, period: whole,
      say: `${date} is ${whole.name}; classes do not meet.` };
  }
  const partial = hits.find((p) => p.classesCancelled === false && p.cancelledFromTime);
  if (partial) {
    return {
      kind: 'partial', reasons: hits, termCode: covering.termCode, period: partial,
      cancelledFromTime: partial.cancelledFromTime,
      say: `${date} is ${partial.name}. Classes meet in the morning and are cancelled from ` +
        `${clock12(partial.cancelledFromTime)}. The shipped record has classesCancelled false, which on its own ` +
        'would read as an ordinary day -- it is not one.'
    };
  }

  const weekday = weekdayOf(date);
  if (weekday === 'saturday' || weekday === 'sunday') {
    return { kind: 'none', weekend: true, reasons: hits, termCode: covering.termCode,
      say: `${date} is a ${weekday}.` };
  }

  return { kind: 'classes', reasons: hits, termCode: covering.termCode, say: null };
}

/**
 * The meetings that actually occur on a date, in time order, with each one's
 * import warnings attached and its location described honestly.
 *
 * Respects dayStatus: on a 'none' or 'finals' day this returns an EMPTY list, and
 * the caller must report the reason rather than the emptiness. Expanding a weekly
 * pattern across finals week is the specific error this prevents.
 */
export function meetingsOn(date, loaded, statusOverride) {
  const status = statusOverride ?? dayStatus(date, loaded.calendar);
  if (status.kind === 'none' || status.kind === 'finals') return { status, meetings: [] };
  const weekday = weekdayOf(date);
  const cutoff = status.kind === 'partial' ? toMinutes(status.cancelledFromTime) : null;

  const list = loaded.meetings
    .filter((m) => Array.isArray(m.daysOfWeek) && m.daysOfWeek.includes(weekday) && m.startTime)
    .filter((m) => (cutoff === null ? true : toMinutes(m.startTime) < cutoff))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((m) => describeMeeting(m, loaded));

  const suppressed = cutoff === null ? [] : loaded.meetings
    .filter((m) => Array.isArray(m.daysOfWeek) && m.daysOfWeek.includes(weekday) && m.startTime)
    .filter((m) => toMinutes(m.startTime) >= cutoff)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((m) => describeMeeting(m, loaded));

  return { status, meetings: list, suppressed };
}

/**
 * One meeting, with its location resolved and its caveats attached.
 *
 * `locationStatus` is the field that matters: a course whose building did not
 * resolve is STILL RETURNED, flagged, so that a caller lists it inline rather
 * than silently dropping it. A missing class is worse than an unhelpful one --
 * the student stops trusting the whole answer, and rightly.
 */
export function describeMeeting(m, loaded) {
  const warnings = loaded.warningsByMeeting?.get(m.id) ?? [];
  let locationStatus = 'resolved';
  let where;

  if (m.deliveryMode === 'online-asynchronous') { locationStatus = 'async'; where = 'asynchronous, no meeting time'; }
  else if (m.deliveryMode === 'online-synchronous' || m.location === null) { locationStatus = 'online'; where = 'online'; }
  else if (m.locationTba === true) { locationStatus = 'tba'; where = 'room not yet announced'; }
  else if (!m.location?.buildingCode) { locationStatus = 'unknown'; where = 'no location recorded'; }
  else {
    const known = buildingKnown(m.location.buildingCode);
    if (!known) { locationStatus = 'unknown-building'; where = `${m.location.buildingCode}${m.location.room ? ` ${m.location.room}` : ''} (not in the shipped campus data)`; }
    else where = `${m.location.buildingCode}${m.location.room ? ` ${m.location.room}` : ' (room not recorded)'} — ${known.name}`;
  }

  return {
    id: m.id,
    courseCode: m.courseCode,
    section: m.section ?? null,
    title: m.title ?? null,
    meetingType: m.meetingType ?? null,
    deliveryMode: m.deliveryMode,
    startTime: m.startTime ?? null,
    endTime: m.endTime ?? null,
    daysOfWeek: m.daysOfWeek ?? [],
    partOfTerm: m.partOfTerm ?? 'full-term',
    buildingCode: m.location?.buildingCode ?? null,
    room: m.location?.room ?? null,
    locationStatus,
    where,
    warnings: warnings.map((w) => ({ code: w.code, message: w.message }))
  };
}

const buildingKnown = (code) => building(code);

export const label = (m) => `${m.courseCode}${m.section ? ` ${m.section}` : ''}`;
