#!/usr/bin/env node
/**
 * What is next, what is on today, what is on this week.
 *
 *   node whats-next.mjs --data-dir <dir>
 *   node whats-next.mjs --data-dir <dir> --today
 *   node whats-next.mjs --data-dir <dir> --week
 *   node whats-next.mjs --schedule draft.json --now 2026-11-20T13:00 --json
 *
 * Exit codes:
 *   0  answered
 *   2  could not run (bad arguments, unreadable file)
 *   3  refused by design -- nothing to say, and saying nothing is correct
 *   4  NO SCHEDULE IMPORTED. Its own code because the remedy is different: this
 *      is not "the data cannot support an answer", it is "there is no data yet,
 *      go and import it", and a caller should be able to tell those apart.
 *
 * THE SAFETY BEHAVIOUR IS IN THIS SCRIPT.
 *
 * A next class is never invented. The search walks forward one real calendar day
 * at a time, asking dayStatus() about each, and STOPS at the end of the term
 * rather than wrapping around -- so "what's next" in December returns the end of
 * term, not January's first Monday. Finals week returns no meetings at all,
 * because the weekly pattern does not apply there and expanding it would put a
 * student outside a locked room. A location-unresolved course is listed INLINE
 * with the reason, never dropped, because a silently missing class is the failure
 * a student cannot catch.
 */
import { loadSchedule, resolveNow, dayStatus, meetingsOn, addDays, toMinutes, clock12, weekdayOf, SHORT, WEEK, label } from './lib/schedule.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const asJson = has('--json');
const die = (msg) => { console.error(msg); process.exit(2); };

/** How far forward "what is next" is willing to look. See SEARCH_HORIZON below. */
export const SEARCH_HORIZON_DAYS = 14;

const now = resolveNow(val('--now'));
if (!now.ok) die(now.reason);

const loaded = loadSchedule({ dataDir: val('--data-dir'), termCode: val('--term'), scheduleFile: val('--schedule') });
if (loaded.status !== 'ok') {
  const payload = { status: loaded.status, now, say: loaded.say };
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(loaded.status === 'no-schedule' ? 'NO SCHEDULE IMPORTED' : `CANNOT READ A SCHEDULE (${loaded.status})`);
    console.log('');
    console.log(`  ${loaded.say}`);
  }
  process.exit(loaded.status === 'no-schedule' ? 4 : 2);
}

const today = meetingsOn(now.date, loaded);

/**
 * The next meeting at or after `now`, searched forward day by day.
 *
 * Returns { found: false, reason } rather than null, because the four ways this
 * can come up empty need different things said about them and collapsing them
 * into "no next class" is how a student gets told their term is over on a
 * Saturday in September.
 */
function findNext() {
  for (let i = 0; i <= SEARCH_HORIZON_DAYS; i++) {
    const date = addDays(now.date, i);
    const status = dayStatus(date, loaded.calendar);

    // Walking off the end of the term is a RESULT, not an empty search.
    if (status.outsideTerm || status.afterClasses) {
      return { found: false, reason: 'term-over', date, status };
    }
    if (status.kind === 'finals') {
      return { found: false, reason: 'finals', date, status };
    }
    if (status.kind === 'none') continue;

    const { meetings } = meetingsOn(date, loaded, status);
    const candidates = i === 0
      ? meetings.filter((m) => m.startTime && toMinutes(m.startTime) > toMinutes(now.time))
      : meetings.filter((m) => m.startTime);
    if (candidates.length) return { found: true, date, status, meeting: candidates[0], daysAhead: i };
  }
  return { found: false, reason: 'horizon', date: addDays(now.date, SEARCH_HORIZON_DAYS) };
}

const next = findNext();

const week = [];
{
  // The Monday of the week containing today, so "this week" means a calendar week
  // rather than the next seven days.
  const offset = (WEEK.indexOf(weekdayOf(now.date)) + 7) % 7;
  const monday = addDays(now.date, -offset);
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const day = meetingsOn(date, loaded);
    week.push({ date, weekday: weekdayOf(date), status: day.status, meetings: day.meetings, suppressed: day.suppressed ?? [] });
  }
}

const unresolved = loaded.meetings.length
  ? week.flatMap((d) => d.meetings).filter((m) => m.locationStatus === 'unknown-building' || m.locationStatus === 'tba' || m.locationStatus === 'unknown')
  : [];

const payload = {
  status: 'ok',
  now,
  termCode: loaded.termCode,
  today: { date: now.date, weekday: now.weekday, status: today.status, meetings: today.meetings, suppressed: today.suppressed ?? [] },
  next,
  week,
  scheduleWarnings: loaded.scheduleWarnings,
  locationUnresolvedCount: new Set(unresolved.map((m) => m.id)).size
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const out = [];
const line = (m) => {
  const flag = m.locationStatus === 'resolved' ? '' :
    m.locationStatus === 'unknown-building' ? '   [LOCATION UNRESOLVED — building not in the shipped data]' :
      m.locationStatus === 'tba' ? '   [LOCATION UNRESOLVED — room not yet announced]' :
        m.locationStatus === 'unknown' ? '   [LOCATION UNRESOLVED — nothing recorded]' : '';
  const when = `${clock12(m.startTime)}–${clock12(m.endTime)}`.padEnd(19);
  return `    ${when} ${label(m).padEnd(14)} ${m.where}${flag}`;
};

out.push(`NOW: ${now.date} ${clock12(now.time)} (${now.weekday}, ${now.timezone}, ${now.basis} clock) — ${loaded.termCode}`);
out.push('');

out.push('NEXT CLASS');
if (next.found) {
  const when = next.daysAhead === 0 ? 'today' : next.daysAhead === 1 ? 'tomorrow' : `${SHORT[weekdayOf(next.date)]} ${next.date}`;
  out.push(`  ${when} at ${clock12(next.meeting.startTime)} — ${label(next.meeting)}`);
  out.push(`    ${next.meeting.where}`);
  if (next.meeting.locationStatus !== 'resolved') {
    out.push('    THIS COURSE IS LOCATION-UNRESOLVED. Say so; do not route to it and do not omit it.');
  }
  for (const w of next.meeting.warnings) out.push(`    caveat (${w.code}): ${w.message}`);
} else if (next.reason === 'term-over') {
  out.push(`  None. ${next.status.say}`);
  out.push('  There is no next class to give. Do not roll forward into a term with no shipped calendar.');
} else if (next.reason === 'finals') {
  out.push(`  None from the weekly schedule. ${next.status.say}`);
  out.push(`  Send the student to the exam grid: ${next.status.finals?.url ?? 'https://registrar.fsu.edu'}`);
} else {
  out.push(`  Nothing in the next ${SEARCH_HORIZON_DAYS} days.`);
}
out.push('');

out.push(`TODAY — ${now.date} (${now.weekday})`);
if (today.status.kind === 'none' || today.status.kind === 'finals') {
  out.push(`  No classes. ${today.status.say}`);
} else if (!today.meetings.length) {
  out.push('  Nothing scheduled today.');
} else {
  for (const m of today.meetings) out.push(line(m));
}
if (today.status.kind === 'partial') {
  out.push(`  PARTIAL DAY: ${today.status.say}`);
  for (const m of today.suppressed ?? []) out.push(`    CANCELLED  ${clock12(m.startTime)} ${label(m)} — after the cutoff, this does not meet`);
}
out.push('');

out.push('THIS WEEK');
for (const d of week) {
  const tag = `  ${SHORT[d.weekday]} ${d.date}`;
  if (d.status.kind === 'none' || d.status.kind === 'finals') { out.push(`${tag}  — ${d.status.say}`); continue; }
  if (!d.meetings.length) { out.push(`${tag}  — nothing scheduled`); continue; }
  out.push(tag + (d.status.kind === 'partial' ? `  — PARTIAL DAY, cancelled from ${clock12(d.status.cancelledFromTime)}` : ''));
  for (const m of d.meetings) out.push(line(m));
  for (const m of d.suppressed ?? []) out.push(`    CANCELLED  ${clock12(m.startTime)} ${label(m)}`);
}
out.push('');

if (payload.locationUnresolvedCount) {
  out.push(`LOCATION-UNRESOLVED COURSES (${payload.locationUnresolvedCount})`);
  out.push('  These are listed above with their times, because the time is right even when the place is not.');
  out.push('  Never leave one out of a day\'s list to keep the answer tidy.');
  out.push('');
}
if (loaded.scheduleWarnings.length) {
  out.push(`IMPORT CAVEATS CARRIED FORWARD (${loaded.scheduleWarnings.length})`);
  for (const w of loaded.scheduleWarnings) out.push(`  ${w.code}: ${w.message}`);
}

console.log(out.join('\n'));
process.exit(0);
