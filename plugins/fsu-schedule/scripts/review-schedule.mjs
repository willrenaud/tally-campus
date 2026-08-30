#!/usr/bin/env node
/**
 * Review a draft schedule BEFORE it is written anywhere.
 *
 *   node review-schedule.mjs draft.json            # human-readable report
 *   node review-schedule.mjs draft.json --json     # same findings as JSON
 *   cat draft.json | node review-schedule.mjs -
 *
 * Exit codes: 0 the draft is valid (it may still carry warnings), 1 the draft is
 * INVALID and must not be saved, 2 the script could not run.
 *
 * This is the confirmation step's evidence. It validates against the schema,
 * resolves every building against the shipped campus data, renders the week as a
 * table for the student to check, and reports time collisions. It writes nothing.
 */
import fs from 'node:fs';
import { validateSchedule, loadPermitClasses } from './lib/validate.mjs';
import { resolveBuilding, termCalendar, parkingSchema } from './lib/campus.mjs';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

function readInput(arg) {
  if (!arg || arg === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(arg, 'utf8');
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));

let doc;
try {
  doc = JSON.parse(readInput(file));
} catch (err) {
  console.error(`Could not read a JSON draft: ${err.message}`);
  process.exit(2);
}

loadPermitClasses(parkingSchema());
const errors = validateSchedule(doc);
const meetings = Array.isArray(doc.meetings) ? doc.meetings : [];

/* ------------------------------------------------------------------ *
 * Building resolution
 * ------------------------------------------------------------------ */
const locations = [];
for (const m of meetings) {
  if (m.locationTba === true) {
    locations.push({ meetingId: m.id, courseCode: m.courseCode, status: 'tba', raw: null });
    continue;
  }
  if (!m.location || !m.location.buildingCode) continue;
  const r = resolveBuilding(m.location.buildingCode);
  locations.push({
    meetingId: m.id,
    courseCode: m.courseCode,
    raw: m.location.buildingCodeRaw || m.location.buildingCode,
    code: m.location.buildingCode,
    room: m.location.room ?? null,
    ...r
  });
}
const unresolved = locations.filter((l) => l.status === 'unknown' || l.status === 'ambiguous' || l.status === 'tba');

/* ------------------------------------------------------------------ *
 * Time collisions -- three outcomes, never two.
 * ------------------------------------------------------------------ */
const cal = doc.termCode ? termCalendar(doc.termCode) : null;
const sessionsStatus = cal?.sessionsStatus ?? 'not-checked';
const sessions = Array.isArray(cal?.sessions) ? cal.sessions : [];

/** The dates a meeting actually runs, or null when they cannot be established. */
function span(m) {
  if (m.dateRange) {
    return { from: m.dateRange.firstMeetingDate, to: m.dateRange.lastMeetingDate, source: 'dateRange' };
  }
  const part = m.partOfTerm ?? 'full-term';
  if (part === 'full-term') {
    if (cal) return { from: cal.classesBeginDate, to: cal.classesEndDate, source: 'term' };
    return null;
  }
  const s = sessions.find((x) => x.code === part);
  if (s) return { from: s.startDate, to: s.endDate, source: 'session' };
  return null; // UNRESOLVABLE -- this is case (c) of partOfTerm's RESOLUTION RULE
}

const overlaps = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

const collisions = [];
for (let i = 0; i < meetings.length; i++) {
  for (let j = i + 1; j < meetings.length; j++) {
    const a = meetings[i], b = meetings[j];
    if (a.deliveryMode === 'online-asynchronous' || b.deliveryMode === 'online-asynchronous') continue;
    if (!Array.isArray(a.daysOfWeek) || !Array.isArray(b.daysOfWeek)) continue;
    if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) continue;
    const days = a.daysOfWeek.filter((d) => b.daysOfWeek.includes(d));
    if (!days.length || !overlaps(a, b)) continue;

    const sa = span(a), sb = span(b);
    let verdict, why;
    if (!sa || !sb) {
      const which = !sa ? a : b;
      verdict = 'cannot-determine';
      why = `${which.courseCode} runs '${which.partOfTerm}', and the ${doc.termCode} calendar has no date range for that ` +
        `(sessionsStatus is "${sessionsStatus}"). These two might not overlap at all, or they might collide every week. ` +
        'This is not the same as "no conflict" and must not be reported as one.';
    } else if (sa.from > sb.to || sb.from > sa.to) {
      verdict = 'no-conflict';
      why = `${a.courseCode} runs ${sa.from} to ${sa.to} and ${b.courseCode} runs ${sb.from} to ${sb.to}; they never run at the same time of year.`;
    } else {
      verdict = 'conflict';
      why = `Both run between ${sa.from > sb.from ? sa.from : sb.from} and ${sa.to < sb.to ? sa.to : sb.to}.`;
    }
    collisions.push({
      verdict,
      days,
      a: { id: a.id, courseCode: a.courseCode, section: a.section, startTime: a.startTime, endTime: a.endTime },
      b: { id: b.id, courseCode: b.courseCode, section: b.section, startTime: b.startTime, endTime: b.endTime },
      why
    });
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
const where = (m) => {
  if (m.deliveryMode === 'online-asynchronous') return 'async, no meetings';
  if (m.locationTba === true) return 'LOCATION TBA';
  if (!m.location) return 'online';
  return m.location.room ? `${m.location.buildingCode} ${m.location.room}` : `${m.location.buildingCode} (room TBA)`;
};

if (asJson) {
  console.log(JSON.stringify({
    valid: errors.length === 0,
    errors,
    termCode: doc.termCode ?? null,
    sessionsStatus,
    meetingCount: meetings.length,
    locations,
    unresolved,
    collisions,
    warnings: doc.import?.warnings ?? []
  }, null, 2));
  process.exit(errors.length ? 1 : 0);
}

const out = [];
out.push(`Draft schedule for ${doc.termCode ?? '(no termCode)'} -- ${meetings.length} meeting block(s)`);
out.push('');

if (errors.length) {
  out.push(`INVALID -- ${errors.length} schema error(s). Nothing may be saved until these are fixed:`);
  for (const e of errors) out.push(`  - ${e}`);
  out.push('');
  console.log(out.join('\n'));
  process.exit(1);
}

out.push('Valid against student-schedule.schema.json.');
out.push('');
out.push('THE WEEK');
const byDay = new Map(DAYS.map((d) => [d, []]));
const unscheduled = [];
for (const m of meetings) {
  if (!Array.isArray(m.daysOfWeek) || !m.daysOfWeek.length) { unscheduled.push(m); continue; }
  for (const d of m.daysOfWeek) byDay.get(d)?.push(m);
}
for (const d of DAYS) {
  const list = byDay.get(d).slice().sort((x, y) => x.startTime.localeCompare(y.startTime));
  if (!list.length) continue;
  out.push(`  ${SHORT[d]}`);
  for (const m of list) {
    out.push(`    ${m.startTime}-${m.endTime}  ${m.courseCode} ${m.section}  ${(m.meetingType || 'meeting').padEnd(10)} ${where(m)}`);
  }
}
for (const m of unscheduled) {
  out.push(`  (no fixed time)  ${m.courseCode} ${m.section}  ${m.deliveryMode}  ${where(m)}`);
}
out.push('');

out.push('LOCATIONS');
if (!locations.length) out.push('  No meeting has a physical location.');
for (const l of locations) {
  if (l.status === 'resolved') out.push(`  ok        ${l.code} -> ${l.name} (matched on ${l.matchedOn})`);
  else if (l.status === 'tba') out.push(`  TBA       ${l.courseCode}: meets in person, location not yet announced`);
  else if (l.status === 'ambiguous') out.push(`  AMBIGUOUS ${l.raw} -> ${l.candidates.map((c) => c.code).join(', ')}`);
  else out.push(`  UNKNOWN   ${l.raw}${l.near?.length ? ` (near: ${l.near.map((c) => c.code).join(', ')})` : ''}`);
}
if (unresolved.length) {
  out.push('');
  out.push(`  ${unresolved.length} meeting(s) have no usable building. THE IMPORT IS STILL FINE.`);
  out.push('  What will not work for those courses: walking times to or from them, between-class');
  out.push('  "can I make it" checks, and any parking answer anchored on them. Everything else works.');
  out.push('  Only 32 of FSU\'s buildings ship with this plugin; see DATA-GAPS.md section 4.');
}
out.push('');

out.push('TIME COLLISIONS');
if (!collisions.length) {
  out.push('  None: no two meetings share a day and a time range.');
} else {
  for (const c of collisions) {
    const label = { conflict: 'CONFLICT     ', 'no-conflict': 'no conflict  ', 'cannot-determine': 'CANNOT TELL  ' }[c.verdict];
    out.push(`  ${label} ${c.a.courseCode} ${c.a.startTime}-${c.a.endTime} vs ${c.b.courseCode} ${c.b.startTime}-${c.b.endTime} on ${c.days.map((d) => SHORT[d]).join(', ')}`);
    out.push(`                ${c.why}`);
  }
}
out.push('');

const warnings = doc.import?.warnings ?? [];
out.push(`IMPORT WARNINGS (${warnings.length})`);
for (const w of warnings) out.push(`  ${w.code}: ${w.message}`);
if (!warnings.length) out.push('  None recorded.');

console.log(out.join('\n'));
process.exit(0);
