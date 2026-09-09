#!/usr/bin/env node
/**
 * Turn an .ics export into DRAFT meeting blocks. Node builtins only.
 *
 *   node parse-ics.mjs schedule.ics
 *   cat schedule.ics | node parse-ics.mjs -
 *
 * Always exits 0 unless the file cannot be read. Output is JSON:
 *   { events: [...], drafts: [...], warnings: [...], unparsed: [...] }
 *
 * WHY A SCRIPT RATHER THAN READING THE FILE DIRECTLY. ICS has three mechanical traps
 * that are easy to get wrong by eye and wrong in a way nobody notices: lines are
 * folded at 75 octets and continued with a leading space, values escape commas and
 * semicolons with backslashes, and the weekday set lives in an RRULE's BYDAY rather
 * than anywhere obvious. Getting BYDAY wrong moves a class to a different day.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not guess a course code out of a
 * calendar SUMMARY, does not guess a building out of a LOCATION, and does not
 * produce a schema-valid meeting. It produces a draft with the fields it can read
 * honestly and a warning for each field it cannot, and the remaining judgement is
 * left to the import skill and the student.
 */
import fs from 'node:fs';
import { normalizeCourseCode, splitLocation, normalizeRoom, deriveFloor, slugify } from './lib/normalize.mjs';

const BYDAY = {
  MO: 'monday', TU: 'tuesday', WE: 'wednesday', TH: 'thursday',
  FR: 'friday', SA: 'saturday', SU: 'sunday'
};
const ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** RFC 5545 line unfolding: a line beginning with space or tab continues the previous one. */
function unfold(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines.filter((l) => l.length);
}

const unescape = (v) => v
  .replace(/\\n/gi, '\n')
  .replace(/\\,/g, ',')
  .replace(/\\;/g, ';')
  .replace(/\\\\/g, '\\');

/** "DTSTART;TZID=America/New_York:20260824T090500" -> {name, params, value} */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Read a DATE-TIME. Returns { date, time, floating, utc }.
 *
 * A trailing Z means UTC. Everything else is treated as local wall-clock, which is
 * correct for the America/New_York exports FSU systems produce and is why no
 * timezone conversion happens here: converting a floating time using the machine's
 * own zone is how a 9:05 class becomes an 8:05 class on a laptop set to Chicago.
 */
function parseDateTime(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : null,
    utc: Boolean(m[7]),
    dateOnly: !m[4]
  };
}

function parseRRule(value) {
  const out = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--')) || '-';
let text;
try {
  text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(2);
}

const lines = unfold(text);
const events = [];
let current = null;
for (const line of lines) {
  const p = parseLine(line);
  if (!p) continue;
  if (p.name === 'BEGIN' && p.value === 'VEVENT') { current = { props: {}, params: {} }; continue; }
  if (p.name === 'END' && p.value === 'VEVENT') { if (current) events.push(current); current = null; continue; }
  if (!current) continue;
  // Keep the FIRST occurrence of a property; repeated EXDATEs accumulate instead.
  if (p.name === 'EXDATE') (current.props.EXDATE ||= []).push(p.value);
  else if (current.props[p.name] === undefined) { current.props[p.name] = p.value; current.params[p.name] = p.params; }
}

const warnings = [];
const unparsed = [];
const drafts = [];
const warn = (code, message, rawValue) => warnings.push({ code, message, ...(rawValue ? { rawValue } : {}) });

events.forEach((ev, index) => {
  const summary = ev.props.SUMMARY ? unescape(ev.props.SUMMARY).trim() : '';
  const location = ev.props.LOCATION ? unescape(ev.props.LOCATION).trim() : '';
  const description = ev.props.DESCRIPTION ? unescape(ev.props.DESCRIPTION).trim() : '';

  const start = ev.props.DTSTART ? parseDateTime(ev.props.DTSTART) : null;
  const end = ev.props.DTEND ? parseDateTime(ev.props.DTEND) : null;
  if (!start || !end) {
    unparsed.push({ index, summary, reason: 'missing or unreadable DTSTART/DTEND', raw: ev.props.DTSTART ?? null });
    warn('unparsed-row', `Calendar event ${index + 1} ("${summary || 'untitled'}") has no readable start/end and was not imported.`, summary);
    return;
  }
  if (start.utc || end.utc) {
    warn('ambiguous-time', `Calendar event "${summary || 'untitled'}" stores its time in UTC rather than local wall-clock. ` +
      'The times below are UTC and have NOT been converted; confirm them against the schedule before saving.', ev.props.DTSTART);
  }

  const draft = {
    sourceIndex: index,
    summary,
    rawLocation: location || null,
    description: description || null,
    startTime: start.time,
    endTime: end.time,
    firstDate: start.date,
    daysOfWeek: null,
    until: null,
    frequency: 'weekly',
    interval: 1,
    exceptDates: []
  };

  const rrule = ev.props.RRULE ? parseRRule(ev.props.RRULE) : null;
  if (rrule) {
    if (rrule.FREQ && rrule.FREQ !== 'WEEKLY') {
      warn('other', `Calendar event "${summary}" repeats ${rrule.FREQ}, which this importer does not model. Treated as a single occurrence.`, ev.props.RRULE);
      draft.frequency = 'one-time';
    }
    if (rrule.INTERVAL) {
      draft.interval = Number(rrule.INTERVAL) || 1;
      if (draft.interval === 2) draft.frequency = 'biweekly';
      else if (draft.interval > 2) {
        warn('other', `Calendar event "${summary}" repeats every ${draft.interval} weeks.`, ev.props.RRULE);
      }
    }
    if (rrule.BYDAY) {
      const days = [];
      for (const token of rrule.BYDAY.split(',')) {
        const key = token.replace(/^[+-]?\d+/, '').toUpperCase();
        if (BYDAY[key]) { if (!days.includes(BYDAY[key])) days.push(BYDAY[key]); }
        else warn('other', `Calendar event "${summary}" has an unreadable BYDAY token "${token}".`, ev.props.RRULE);
      }
      if (days.length) draft.daysOfWeek = ORDER.filter((d) => days.includes(d));
    }
    if (rrule.UNTIL) {
      const u = parseDateTime(rrule.UNTIL);
      if (u) draft.until = u.date;
    }
  } else {
    draft.frequency = 'one-time';
  }

  if (!draft.daysOfWeek) {
    // No BYDAY: a weekly rule repeats on the start date's weekday. Derive it from
    // the DATE ONLY -- constructing a Date from a wall-clock time would apply the
    // machine's timezone and can land on the previous day.
    const [y, mo, d] = draft.firstDate.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
    draft.daysOfWeek = [ORDER[(weekday + 6) % 7]];
    if (rrule) {
      warn('other', `Calendar event "${summary}" has no BYDAY; its weekday was taken from the first occurrence, ${draft.firstDate}.`, ev.props.RRULE);
    }
  }

  for (const ex of ev.props.EXDATE || []) {
    for (const one of ex.split(',')) {
      const parsed = parseDateTime(one);
      if (parsed) draft.exceptDates.push(parsed.date);
    }
  }

  // Course code: only when the summary actually contains one. No guessing.
  const codeMatch = summary.match(/\b([A-Za-z]{3})[\s._-]?(\d{4})([A-Za-z]{0,2})\b/);
  if (codeMatch) {
    const norm = normalizeCourseCode(codeMatch[0]);
    if (norm.ok) {
      draft.courseCode = norm.value;
      draft.canonicalNumbering = norm.note.canonicalNumbering;
    }
  }
  if (!draft.courseCode) {
    warn('other', `Calendar event "${summary || 'untitled'}" has no course code in its title. Ask the student which course it is; do not infer one.`, summary);
  }

  // Location: separate "no room named" from "no physical room".
  if (!location) {
    draft.locationHint = { kind: 'absent' };
    warn('missing-room', `Calendar event "${summary}" has no LOCATION. Ask whether it is online or its room is unannounced; these are different.`, summary);
  } else {
    const split = splitLocation(location);
    if (!split.ok) {
      draft.locationHint = { kind: 'unparsed', raw: location };
      warn('other', `Could not read a building out of the LOCATION "${location}".`, location);
    } else if (split.value.kind === 'online') {
      draft.locationHint = { kind: 'online', raw: location };
    } else if (split.value.kind === 'tba') {
      draft.locationHint = { kind: 'tba', raw: location };
    } else {
      const room = normalizeRoom(split.value.room);
      const floor = room.ok && room.value ? deriveFloor(room.value) : { ok: false };
      draft.locationHint = {
        kind: 'located',
        raw: location,
        buildingCode: split.value.building,
        room: room.ok ? room.value : null,
        floor: floor.ok ? floor.value : null
      };
      if (room.ok && room.value === null) {
        warn('missing-room', `Calendar event "${summary}" names building ${split.value.building} but no room.`, location);
      }
    }
  }

  draft.suggestedId = slugify(draft.courseCode || 'event', String(index + 1),
    (draft.daysOfWeek || []).map((d) => d.slice(0, 2)).join('') || 'once');
  drafts.push(draft);
});

if (!events.length) warn('unparsed-row', 'No VEVENT blocks were found. Is this actually an .ics export?');

console.log(JSON.stringify({
  eventCount: events.length,
  drafts,
  warnings,
  unparsed,
  note:
    'These are DRAFTS, not schema-valid meetings. Delivery mode, meeting type, section, ' +
    'title and partOfTerm are not present in a calendar export and must come from the ' +
    'student or from another source. Resolve every locationHint through ' +
    'resolve-buildings.mjs before building a meeting record.'
}, null, 2));
