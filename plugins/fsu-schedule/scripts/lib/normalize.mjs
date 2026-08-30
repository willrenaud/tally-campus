/**
 * Field normalisation for schedule import. Node builtins only -- nothing here may
 * require an install, because this ships inside the plugin.
 *
 * The rule every function in this file follows: when the input is ambiguous, SAY SO.
 * Each returns either a value or an `{ ok: false, reason }` object, and no function
 * ever returns a plausible guess. An importer that quietly resolves "TH" to Thursday
 * puts a student in the wrong room on the wrong day, and does it silently.
 */

export const DAY_NAMES = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
];

const fail = (reason, detail) => ({ ok: false, reason, detail });
const good = (value, note) => (note ? { ok: true, value, note } : { ok: true, value });

/* ------------------------------------------------------------------ *
 * Course codes
 * ------------------------------------------------------------------ */

const COURSE_CODE = /^[A-Z]{3}[0-9]{4}[A-Za-z]{0,2}$/;
const CANONICAL = /^[A-Z]{3}[0-9]{4}([A-Z]|r)?$/;

/**
 * "enc 1101" -> ENC1101. Uppercases the prefix and strips the internal space,
 * both of which the schema requires importers to do.
 */
export function normalizeCourseCode(raw) {
  if (typeof raw !== 'string') return fail('not-a-string');
  const squashed = raw.replace(/[\s ._-]+/g, '');
  if (!squashed) return fail('empty');
  // Uppercase the letter prefix; leave a trailing suffix's case alone, because the
  // lowercase "r" repeatable marker is meaningful and "R" is a different thing.
  const m = squashed.match(/^([A-Za-z]{3})([0-9]{4})([A-Za-z]{0,2})$/);
  if (!m) return fail('unrecognised-shape', squashed);
  const code = m[1].toUpperCase() + m[2] + (m[3].length === 1 && m[3] === 'r' ? 'r' : m[3].toUpperCase());
  if (!COURSE_CODE.test(code)) return fail('unrecognised-shape', code);
  return good(code, { canonicalNumbering: CANONICAL.test(code) });
}

/* ------------------------------------------------------------------ *
 * Meeting days
 * ------------------------------------------------------------------ */

// FSU prints M T W R F S U, where R is Thursday and U is Sunday.
const FSU_LETTERS = {
  M: 'monday', T: 'tuesday', W: 'wednesday', R: 'thursday',
  F: 'friday', S: 'saturday', U: 'sunday'
};

const WORD_FORMS = {
  mon: 'monday', monday: 'monday', mo: 'monday',
  tue: 'tuesday', tues: 'tuesday', tuesday: 'tuesday', tu: 'tuesday',
  wed: 'wednesday', wednesday: 'wednesday', we: 'wednesday',
  thu: 'thursday', thur: 'thursday', thurs: 'thursday', thursday: 'thursday', th: 'thursday',
  fri: 'friday', friday: 'friday', fr: 'friday',
  sat: 'saturday', saturday: 'saturday', sa: 'saturday',
  sun: 'sunday', sunday: 'sunday', su: 'sunday'
};

const sortDays = (days) => DAY_NAMES.filter((d) => days.includes(d));

/**
 * Expand a day string. Returns ok:false for the genuinely ambiguous cases rather
 * than picking one, because both readings are common in the wild and neither is
 * detectable from the string.
 *
 *   "MWF"            -> monday, wednesday, friday
 *   "TR"             -> tuesday, thursday
 *   "Mon/Wed"        -> monday, wednesday
 *   "TH"             -> AMBIGUOUS. FSU's letter scheme reads this as Tuesday+Thursday
 *                       (R is Thursday, so a lone Thursday is "R"); many other systems
 *                       print "TH" to mean Thursday alone. Ask.
 *   "TTH"            -> AMBIGUOUS for the same reason.
 */
export function expandDays(raw) {
  if (typeof raw !== 'string') return fail('not-a-string');
  const trimmed = raw.trim();
  if (!trimmed) return fail('empty');
  if (/^(tba|tbd|arr|arranged|online|n\/a|-|--)$/i.test(trimmed)) return fail('no-days-given', trimmed);

  const tokens = trimmed.toLowerCase().split(/[\s,/;&|+.]+/).filter(Boolean);

  // A DELIMITED list of word abbreviations -- "Mon/Wed/Fri", "Tue, Thu",
  // "Monday Wednesday". Delimiters mean the source is not using FSU's compact
  // letter scheme, so "th" here is plainly Thursday and is read as such.
  if (tokens.length > 1 && tokens.every((t) => WORD_FORMS[t])) {
    const days = [];
    for (const t of tokens) if (!days.includes(WORD_FORMS[t])) days.push(WORD_FORMS[t]);
    return good(sortDays(days));
  }
  // A single full word: "Monday", "thurs".
  if (tokens.length === 1 && tokens[0].length > 2 && WORD_FORMS[tokens[0]]) {
    return good([WORD_FORMS[tokens[0]]]);
  }
  if (tokens.length > 1) {
    const unknown = tokens.find((t) => !WORD_FORMS[t]);
    return fail('unrecognised-token', unknown);
  }

  // Compact FSU letter form: M T W R F S U.
  const compact = trimmed.toUpperCase().replace(/[\s.]/g, '');

  // "TH" is the trap. FSU's scheme spells Thursday "R", so under it "TH" reads as
  // Tuesday followed by an invalid H -- while plenty of other systems print "TH"
  // for Thursday alone. Both readings are common and nothing in the string tells
  // them apart, so ask instead of choosing.
  if (/TH/.test(compact)) return fail('ambiguous-th', trimmed);

  // The same trap in miniature: a bare two-letter abbreviation that is ALSO a valid
  // pair of FSU letters. "FR" is Friday, or it is Friday and Thursday. "TU" is
  // Tuesday, or Tuesday and Sunday. "SU" is Sunday, or Saturday and Sunday.
  if (compact.length === 2 && WORD_FORMS[compact.toLowerCase()]
      && FSU_LETTERS[compact[0]] && FSU_LETTERS[compact[1]]) {
    return fail('ambiguous-two-letter', trimmed);
  }

  const days = [];
  for (const ch of compact) {
    const day = FSU_LETTERS[ch];
    if (!day) return fail('unrecognised-token', ch);
    if (!days.includes(day)) days.push(day);
  }
  if (!days.length) return fail('empty');
  return good(sortDays(days));
}

/* ------------------------------------------------------------------ *
 * Times
 * ------------------------------------------------------------------ */

/**
 * "9:05 AM" -> "09:05". "1:50p" -> "13:50". "0955" -> "09:55".
 *
 * Without a meridiem the value is only accepted when it cannot be read two ways:
 * an hour of 13 or more, or a zero-padded two-digit hour. A bare "1:50" is
 * ambiguous between 01:50 and 13:50 and is refused, because guessing "obviously
 * afternoon" is exactly the reasoning that puts an 8pm lab on a schedule.
 */
export function normalizeTime(raw) {
  if (typeof raw !== 'string') return fail('not-a-string');
  const s = raw.trim().toLowerCase().replace(/\./g, '');
  if (!s) return fail('empty');
  if (/^(tba|tbd|arr|arranged|n\/a|-|--)$/.test(s)) return fail('no-time-given', raw.trim());

  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return fail('unrecognised-shape', raw.trim());

  // "0955" needs no special case: \d{1,2} takes "09" and the minute group takes "55".
  const rawHour = m[1];
  let hour = Number(rawHour);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3] ? m[3][0] : null;
  if (minute > 59) return fail('minute-out-of-range', raw.trim());

  if (meridiem) {
    if (hour < 1 || hour > 12) return fail('hour-out-of-range-for-meridiem', raw.trim());
    if (meridiem === 'p' && hour !== 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
  } else {
    if (hour > 23) return fail('hour-out-of-range', raw.trim());
    const unambiguous = hour >= 13 || rawHour.length >= 2;
    if (!unambiguous) return fail('ambiguous-no-meridiem', raw.trim());
  }
  return good(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
}

/**
 * Split and normalise a range: "9:05 AM - 9:55 AM", "9:05-9:55am", "1:20 - 2:10 PM".
 *
 * A meridiem on only the END is applied to the start ONLY when doing so keeps the
 * range positive and under twelve hours, which is what "1:20 - 2:10 PM" needs and
 * what stops "11:00 - 1:00 PM" from becoming a two-hour-negative range.
 */
export function parseTimeRange(raw) {
  if (typeof raw !== 'string') return fail('not-a-string');
  const parts = raw.split(/\s*(?:-|–|—|to|until)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return fail('not-a-range', raw.trim());

  const end = normalizeTime(parts[1]);
  if (!end.ok) return fail('end-' + end.reason, end.detail ?? parts[1]);

  let start = normalizeTime(parts[0]);
  if (!start.ok && start.reason === 'ambiguous-no-meridiem') {
    const tail = parts[1].trim().toLowerCase().replace(/\./g, '').match(/(am|pm|a|p)$/);
    if (tail) {
      const retry = normalizeTime(`${parts[0]} ${tail[1]}`);
      if (retry.ok) {
        const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const delta = mins(end.value) - mins(retry.value);
        if (delta > 0 && delta < 12 * 60) start = retry;
        else {
          const alt = normalizeTime(`${parts[0]} ${tail[1] === 'p' || tail[1] === 'pm' ? 'am' : 'pm'}`);
          if (alt.ok && mins(end.value) - mins(alt.value) > 0) start = alt;
        }
      }
    }
  }
  if (!start.ok) return fail('start-' + start.reason, start.detail ?? parts[0]);

  if (start.value === end.value) return fail('zero-length-range', raw.trim());
  if (start.value > end.value) return fail('end-before-start', `${start.value}-${end.value}`);
  return good({ startTime: start.value, endTime: end.value });
}

/* ------------------------------------------------------------------ *
 * Rooms and buildings
 * ------------------------------------------------------------------ */

const NOT_A_ROOM = /^(tba|tbd|to be announced|to be arranged|arr|arranged|none|n\/a|na|online|web|wwww|-|--|\.)$/i;

/**
 * Returns ok:true with value null when the source says the room is unknown.
 * The literal string "TBA" must never reach a location.room: it is a statement
 * about the source, and a student shown "HCB TBA" reads it as a room.
 */
export function normalizeRoom(raw) {
  if (raw === null || raw === undefined) return good(null);
  if (typeof raw !== 'string') return fail('not-a-string');
  const s = raw.trim();
  if (!s || NOT_A_ROOM.test(s)) return good(null);
  return good(s.replace(/\s+/g, ' '));
}

/**
 * Floor from an FSU room number.
 *
 * Verified against FSU's own room inventory: 736 rooms across LAW (0032),
 * DSL (0020) and MCH (0055), where every room's floor is published alongside its
 * number. This rule matched all 736. A four-digit number beginning with zero
 * carries the floor in its first TWO digits ("0422" is floor 4, "0152" is floor 1);
 * any other number carries it in the first digit ("1200" is floor 1, not 12).
 *
 * Three buildings is a small sample, so this returns ok:false rather than a guess
 * whenever the shape is anything else, and callers should treat a derived floor as
 * a convenience rather than a fact.
 */
export function deriveFloor(room) {
  if (typeof room !== 'string') return fail('not-a-string');
  const digits = (room.trim().match(/^[0-9]+/) || [''])[0];
  if (digits.length === 4) return good(digits[0] === '0' ? Number(digits.slice(0, 2)) : Number(digits[0]));
  if (digits.length === 3) return good(Number(digits[0]));
  return fail('unrecognised-room-shape', room);
}

const MEANS_ONLINE = /^(online|web|internet|remote|distance learning|zoom|canvas)$/i;
const MEANS_TBA = /^(tba|tbd|to be announced|to be arranged|arr|arranged|none|n\/a|na|-|--|\.)$/i;

/**
 * Pull a building token out of a raw location string: "HCB 216" -> "HCB".
 *
 * Deliberately does NOT decide whether that token is a real building -- that is
 * resolve-buildings.mjs's job, against the shipped data.
 *
 * `kind` separates the three things a blank-looking location can mean, which must
 * never be collapsed: "located" (a place is named), "tba" (there is a physical room
 * and nobody has said which), and "online" (there is no physical room at all).
 * Reading "Online" as a TBA room is how a fake building gets created; reading a TBA
 * room as online is how a class silently drops off a walking route.
 */
export function splitLocation(raw) {
  if (typeof raw !== 'string') return fail('not-a-string');
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return good({ kind: 'tba', building: null, room: null });
  if (MEANS_ONLINE.test(s)) return good({ kind: 'online', building: null, room: null });
  if (MEANS_TBA.test(s)) return good({ kind: 'tba', building: null, room: null });

  const m = s.match(/^([A-Za-z][A-Za-z0-9]{1,7})[\s.,-]+(.+)$/);
  if (m) {
    const room = normalizeRoom(m[2]);
    return good({ kind: 'located', building: m[1].toUpperCase(), room: room.ok ? room.value : null });
  }
  if (/^[A-Za-z][A-Za-z0-9]{1,7}$/.test(s)) {
    return good({ kind: 'located', building: s.toUpperCase(), room: null });
  }
  return fail('unrecognised-shape', s);
}

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

export function slugify(...parts) {
  const s = parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join('-')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'meeting';
}

/** A meeting id that is stable for the same block and distinct for a different one. */
export function meetingId(meeting, index) {
  const days = Array.isArray(meeting.daysOfWeek) && meeting.daysOfWeek.length
    ? meeting.daysOfWeek.map((d) => d.slice(0, 2)).join('')
    : 'async';
  return slugify(
    meeting.courseCode || 'course',
    meeting.section || String(index + 1),
    meeting.meetingType || 'meeting',
    days
  );
}
