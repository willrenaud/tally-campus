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
import { findCollisions } from './lib/conflicts.mjs';

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
 *
 * The logic lives in lib/conflicts.mjs so that this script and check-conflicts.mjs
 * cannot drift apart about what counts as a conflict. Two copies of a
 * three-outcome rule is two chances to quietly lose the third outcome.
 * ------------------------------------------------------------------ */
const cal = doc.termCode ? termCalendar(doc.termCode) : null;
const sessionsStatus = cal?.sessionsStatus ?? 'not-checked';
const collisions = findCollisions(meetings, cal, doc.termCode);

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
const where = (m) => {
  if (m.deliveryMode === 'online-asynchronous') return 'async, no meetings';
  if (m.locationTba === true) return 'LOCATION TBA';
  if (!m.location) return 'online';
  return m.location.room ? `${m.location.buildingCode} ${m.location.room}` : `${m.location.buildingCode} (room TBA)`;
};

/** Section is optional, so it is a suffix rather than a column. */
const label = (m) => (m.section ? `${m.courseCode} ${m.section}` : m.courseCode);

/* ------------------------------------------------------------------ *
 * Questions versus assumptions
 *
 * THE RULE, and the reason this section exists at all: a question must earn its
 * place. It earns it only when the answer cannot be inferred AND getting it wrong
 * would produce a schedule that is quietly incorrect -- wrong in a way the student
 * would not notice while reading the draft table.
 *
 * Everything else is an ASSUMPTION: stated plainly under the draft, correctable in
 * one word, and never a thing that stops a student seeing their schedule. An import
 * that interrogates before it shows anything is an import that gets abandoned, and
 * an abandoned import helps nobody.
 *
 * So an unknown building is not a question -- the student cannot fix FSU's missing
 * data and does not need to. A missing section is not a question -- nothing is
 * computed from it. A course meeting once a week is not a question -- that is
 * ordinary. An unreadable row IS a question, because a silently dropped class is
 * exactly the failure the student will not catch by scanning a table.
 * ------------------------------------------------------------------ */
const BLOCKING_WARNINGS = new Set(['unparsed-row', 'ambiguous-time']);
const allWarnings = doc.import?.warnings ?? [];

const blockingQuestions = [];
for (const w of allWarnings) {
  if (!BLOCKING_WARNINGS.has(w.code)) continue;
  blockingQuestions.push({
    kind: w.code,
    ask: w.code === 'unparsed-row'
      ? `A row could not be read, so a class may be missing entirely: ${w.rawValue ?? w.message}`
      : `A time could not be read unambiguously: ${w.rawValue ?? w.message}`,
    meetingId: w.meetingId ?? null
  });
}
for (const c of collisions) {
  if (c.verdict !== 'conflict') continue;
  blockingQuestions.push({
    kind: 'time-conflict',
    ask: `${c.a.courseCode} and ${c.b.courseCode} genuinely overlap on ${c.days.map((d) => SHORT[d]).join(', ')}. ` +
      'That is usually a misread time and occasionally a real registration problem. Which is it?',
    meetingId: c.a.id
  });
}

/* Stated, not asked. */
const assumptions = [];
const noSection = meetings.filter((m) => m.section === undefined);
if (noSection.length) {
  assumptions.push(`No section numbers in the source, so none were stored (${noSection.length} block(s)). ` +
    'Location, conflict and walking-time answers do not use them. Say so if you want them added.');
}
const noTitle = meetings.filter((m) => m.title === undefined);
if (noTitle.length) {
  assumptions.push(`No course titles in the source, so none were stored (${noTitle.length} block(s)). Course codes carry the meaning.`);
}
if (meetings.some((m) => (m.partOfTerm ?? 'full-term') === 'full-term')) {
  assumptions.push('Every course is treated as full-term, which is the default -- the source did not say otherwise. ' +
    'A half-term course would change conflict answers, so correct this if any of yours is one.');
}
for (const w of allWarnings) {
  if (BLOCKING_WARNINGS.has(w.code)) continue;
  assumptions.push(`${w.code}: ${w.message}`);
}
const onceWeekly = meetings.filter((m) => Array.isArray(m.daysOfWeek) && m.daysOfWeek.length === 1);
if (onceWeekly.length) {
  assumptions.push(`Meets once a week: ${onceWeekly.map((m) => `${m.courseCode} (${SHORT[m.daysOfWeek[0]]})`).join(', ')}. ` +
    'Read off the source as-is; ordinary, but correct it if a day was cut off.');
}
if (doc.import?.sourceFormat === 'screenshot-ocr') {
  assumptions.push('Read from an image, so ROOM NUMBERS are the values most likely to be wrong. ' +
    'They are shown in full in the week above -- check them there.');
}

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
    warnings: allWarnings,
    assumptions,
    blockingQuestions
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
    out.push(`    ${m.startTime}-${m.endTime}  ${label(m).padEnd(14)} ${(m.meetingType || 'meeting').padEnd(10)} ${where(m)}`);
  }
}
for (const m of unscheduled) {
  out.push(`  (no fixed time)  ${label(m).padEnd(14)} ${m.deliveryMode}  ${where(m)}`);
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

out.push(`IMPORT WARNINGS (${allWarnings.length})`);
for (const w of allWarnings) out.push(`  ${w.code}: ${w.message}`);
if (!allWarnings.length) out.push('  None recorded.');
out.push('');

/* These two sections come LAST, and that ordering is the point: the student sees
 * their week before they are asked to do anything about it. */
out.push(`ASSUMPTIONS (${assumptions.length}) -- stated, not asked; correct any that are wrong`);
if (!assumptions.length) out.push('  None: nothing had to be assumed.');
for (const a of assumptions) out.push(`  - ${a}`);
out.push('');

out.push(`MUST ASK (${blockingQuestions.length})`);
if (!blockingQuestions.length) {
  out.push('  Nothing. Show the week above and ask for a yes.');
} else {
  for (const q of blockingQuestions) out.push(`  - ${q.ask}`);
}

console.log(out.join('\n'));
process.exit(0);
