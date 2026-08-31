#!/usr/bin/env node
/**
 * Deadlines, holidays, breaks and finals for the stored term.
 *
 *   node deadlines.mjs --data-dir <dir>
 *   node deadlines.mjs --term 2026-fall --now 2026-10-01 --json
 *   node deadlines.mjs --data-dir <dir> --within 30
 *
 * Exit codes:
 *   0  answered
 *   2  could not run
 *   3  refused by design -- no shipped calendar covers the term asked about
 *   4  no schedule imported (only when one was needed)
 *
 * This one works WITHOUT a stored schedule: deadlines are a property of the term,
 * not of the student. A schedule is used only to add the half-term caveat, so a
 * student who has not imported anything still gets their drop deadline.
 *
 * THE SAFETY BEHAVIOUR IS IN THE SCRIPT.
 *
 * Two traps, both structural rather than advisory:
 *
 *   1. FINALS ARE A DATE RANGE WITH NO GRID. finalsPeriod has startDate, endDate,
 *      note and url, and nowhere to put a mapping from meeting pattern to exam
 *      block. So this script NEVER emits a per-course exam time -- it has none to
 *      emit -- and it always prints the Registrar URL instead. Expanding a weekly
 *      schedule across that week is the specific wrong answer, and the shape of
 *      the data is what prevents it: there is no field to expand from.
 *
 *   2. EVERY SHIPPED DEADLINE IS A FULL-TERM DEADLINE. sessions is empty, so a
 *      half-term course's much earlier drop and withdrawal dates are not in the
 *      data at all. When the stored schedule contains a course whose partOfTerm
 *      does not resolve, that is surfaced as a warning ON the deadline list,
 *      because a student reading "last day to drop: 9 October" about a first-half
 *      course is reading a date that does not apply to them.
 */
import { loadSchedule, resolveNow, addDays, weekdayOf, clock12, SHORT } from './lib/schedule.mjs';
import { termCalendar, termCalendars, termCalendarCovering } from './lib/campus.mjs';
import { unresolvableMeetings } from './lib/conflicts.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const asJson = has('--json');
const die = (msg) => { console.error(msg); process.exit(2); };

const now = resolveNow(val('--now'));
if (!now.ok) die(now.reason);

/* A schedule is optional here. If one loads it sharpens the answer; if none is
 * stored the deadlines are still entirely answerable, so this is not exit 4. */
const loaded = loadSchedule({ dataDir: val('--data-dir'), termCode: val('--term'), scheduleFile: val('--schedule') });
const haveSchedule = loaded.status === 'ok';

const termCode = val('--term') ?? (haveSchedule ? loaded.termCode : null);
const cal = termCode ? termCalendar(termCode) : termCalendarCovering(now.date);

if (!cal) {
  const body = {
    status: 'refused',
    kind: 'no-calendar',
    termCode: termCode ?? null,
    date: now.date,
    shippedTerms: termCalendars().map((t) => t.termCode),
    say: termCode
      ? `No calendar for ${termCode} ships with this plugin. Shipped: ${termCalendars().map((t) => t.termCode).join(', ')}.`
      : `No shipped calendar covers ${now.date}, so there are no deadlines to report for it. ` +
        `Shipped: ${termCalendars().map((t) => t.termCode).join(', ')}.`,
    sendTo: 'https://registrar.fsu.edu/bulletins/calendar'
  };
  if (asJson) console.log(JSON.stringify(body, null, 2));
  else {
    console.log(`REFUSING TO ANSWER -- ${body.kind}`);
    console.log('');
    console.log(`  ${body.say}`);
    console.log('');
    console.log('  Inventing a drop deadline is how a student misses one. Send them to:');
    console.log(`  ${body.sendTo}`);
  }
  process.exit(3);
}

const within = val('--within') ? Number(val('--within')) : null;
if (within !== null && !Number.isFinite(within)) die('--within takes a number of days');
const horizon = within === null ? null : addDays(now.date, within);

const deadlines = (cal.deadlines ?? [])
  .slice()
  .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
  .map((d) => ({
    ...d,
    weekday: weekdayOf(d.date),
    daysAway: Math.round((Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 86400000),
    past: d.date < now.date
  }))
  .filter((d) => (horizon === null ? true : d.date <= horizon));

const nonClassDays = (cal.nonClassDays ?? []).map((p) => ({
  ...p,
  partial: p.classesCancelled === false && Boolean(p.cancelledFromTime),
  past: p.endDate < now.date
}));

/* Half-term courses: the caveat that the deadline list cannot carry on its own. */
const halfTerm = haveSchedule ? unresolvableMeetings(loaded.meetings, cal) : [];

const payload = {
  status: 'ok',
  now,
  termCode: cal.termCode,
  displayName: cal.displayName ?? null,
  sessionsStatus: cal.sessionsStatus ?? 'not-checked',
  scheduleLoaded: haveSchedule,
  deadlines,
  nonClassDays,
  finals: {
    ...cal.finals,
    // Stated as data, not left to prose: there is no grid in this record and no
    // field one could live in, so no per-course exam time can be produced.
    examGridAvailable: false,
    weeklyPatternApplies: false
  },
  halfTermCourses: halfTerm.map((m) => ({ id: m.id, courseCode: m.courseCode, partOfTerm: m.partOfTerm ?? 'full-term' })),
  allDeadlinesAreFullTerm: true
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const when = (d) => {
  if (d.daysAway === 0) return 'TODAY';
  if (d.past) return `${-d.daysAway}d ago`;
  return `in ${d.daysAway}d`;
};

const out = [];
out.push(`DEADLINES — ${cal.displayName ?? cal.termCode}, as of ${now.date} (${now.weekday}, ${now.timezone})`);
out.push('');

const upcoming = deadlines.filter((d) => !d.past);
const past = deadlines.filter((d) => d.past);

out.push(`UPCOMING (${upcoming.length})`);
if (!upcoming.length) out.push('  None left in this term.');
for (const d of upcoming) {
  out.push(`  ${d.date} ${SHORT[d.weekday]}  ${when(d).padStart(8)}  ${d.type}${d.time ? ` (by ${clock12(d.time)})` : ''}`);
  out.push(`      ${d.description}`);
}
out.push('');

if (past.length) {
  out.push(`ALREADY PASSED (${past.length})`);
  for (const d of past) out.push(`  ${d.date} ${SHORT[d.weekday]}  ${when(d).padStart(8)}  ${d.type}`);
  out.push('');
}

out.push('HOLIDAYS AND BREAKS');
for (const p of nonClassDays) {
  const span = p.startDate === p.endDate ? p.startDate : `${p.startDate} to ${p.endDate}`;
  if (p.partial) {
    out.push(`  ${span}  ${p.name}`);
    out.push(`      PARTIAL DAY — classes meet in the morning and are cancelled from ${clock12(p.cancelledFromTime)}.`);
    out.push('      The record carries classesCancelled false, which alone would read as a normal day. It is not one.');
  } else if (p.classesCancelled === false) {
    out.push(`  ${span}  ${p.name} — classes still meet`);
  } else {
    out.push(`  ${span}  ${p.name} — no classes`);
  }
}
out.push('');

out.push('FINAL EXAMS');
out.push(`  ${cal.finals.startDate} to ${cal.finals.endDate}.`);
out.push('  THERE IS NO EXAM GRID IN THIS DATA, and no field in the schema to hold one.');
out.push('  Exams do NOT fall at a course\'s normal meeting time, so a weekly schedule expanded');
out.push('  across that week is simply wrong. Do not produce per-course exam times from it.');
out.push(`  The student's actual exam times are here: ${cal.finals.url}`);
out.push('');

out.push('THE CAVEAT ON EVERY DATE ABOVE');
out.push(`  Session dates for this term are "${payload.sessionsStatus}", so EVERY deadline listed here is`);
out.push('  a FULL-TERM deadline. A half-term course has its own, much earlier drop and withdrawal');
out.push('  dates, and they are not in this data at all.');
if (halfTerm.length) {
  out.push('');
  out.push(`  THIS APPLIES TO ${halfTerm.length} OF YOUR COURSES:`);
  for (const m of halfTerm) out.push(`    ${m.courseCode}${m.section ? ` ${m.section}` : ''} — partOfTerm "${m.partOfTerm ?? 'full-term'}"`);
  out.push('    Do not give these courses the dates above. Send the student to their department or');
  out.push('    to Student Central for the real ones.');
} else if (haveSchedule) {
  out.push('  Every course in the stored schedule is full-term, so the dates above do apply to all of them.');
} else {
  out.push('  No schedule is stored, so whether any of your courses is a half-term one is unknown.');
}

console.log(out.join('\n'));
process.exit(0);
