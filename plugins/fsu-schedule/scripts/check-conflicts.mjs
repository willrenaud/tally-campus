#!/usr/bin/env node
/**
 * Do any of these classes collide?
 *
 *   node check-conflicts.mjs --data-dir <dir>
 *   node check-conflicts.mjs --schedule draft.json --json
 *
 * Exit codes:
 *   0  answered (which INCLUDES answering "cannot determine")
 *   2  could not run
 *   4  no schedule imported
 *
 * There is deliberately no exit 3 here. A 'cannot-determine' verdict is not a
 * refusal: it is a specific, useful finding about FSU's publishing, and it is
 * reported alongside everything that could be decided rather than instead of it.
 *
 * THE SAFETY BEHAVIOUR IS IN THE SCRIPT, NOT THE PROSE.
 *
 * The verdict comes from lib/conflicts.mjs, whose findCollisions() has exactly
 * three branches and no default. There is no code path that turns an unresolvable
 * partOfTerm into 'no-conflict': the span resolver returns null and the null is
 * checked first, before either date comparison. And the summary line below counts
 * the three verdicts separately, so "no conflicts found" cannot be printed over a
 * schedule that has undecidable pairs in it.
 */
import { loadSchedule, resolveNow, SHORT, clock12 } from './lib/schedule.mjs';
import { findCollisions, unresolvableMeetings, resolveSpan } from './lib/conflicts.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const asJson = has('--json');
const die = (msg) => { console.error(msg); process.exit(2); };

const now = resolveNow(val('--now'));
if (!now.ok) die(now.reason);

const loaded = loadSchedule({ dataDir: val('--data-dir'), termCode: val('--term'), scheduleFile: val('--schedule') });
if (loaded.status !== 'ok') {
  const payload = { status: loaded.status, say: loaded.say };
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(loaded.status === 'no-schedule' ? 'NO SCHEDULE IMPORTED' : `CANNOT READ A SCHEDULE (${loaded.status})`);
    console.log('');
    console.log(`  ${loaded.say}`);
  }
  process.exit(loaded.status === 'no-schedule' ? 4 : 2);
}

const cal = loaded.calendar;
const sessionsStatus = cal?.sessionsStatus ?? 'not-checked';
const collisions = findCollisions(loaded.meetings, cal, loaded.termCode);
const undecidable = unresolvableMeetings(loaded.meetings, cal);

const tally = { conflict: 0, 'no-conflict': 0, 'cannot-determine': 0 };
for (const c of collisions) tally[c.verdict]++;

const payload = {
  status: 'ok',
  termCode: loaded.termCode,
  sessionsStatus,
  meetingCount: loaded.meetings.length,
  collisions,
  tally,
  unresolvablePartOfTerm: undecidable.map((m) => ({ id: m.id, courseCode: m.courseCode, partOfTerm: m.partOfTerm ?? 'full-term' })),
  scheduleWarnings: loaded.scheduleWarnings
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const pair = (c) => `${c.a.courseCode}${c.a.section ? ` ${c.a.section}` : ''} ${clock12(c.a.startTime)}–${clock12(c.a.endTime)} vs ` +
  `${c.b.courseCode}${c.b.section ? ` ${c.b.section}` : ''} ${clock12(c.b.startTime)}–${clock12(c.b.endTime)} on ${c.days.map((d) => SHORT[d]).join(', ')}`;

const out = [];
out.push(`CONFLICT CHECK — ${loaded.termCode}, ${loaded.meetings.length} meeting block(s)`);
out.push(`  Session dates for this term: ${sessionsStatus}.`);
out.push('');

out.push('THREE OUTCOMES, NOT TWO');
out.push(`  ${tally.conflict} genuine conflict(s), ${tally['no-conflict']} pair(s) ruled out by dates, ` +
  `${tally['cannot-determine']} that CANNOT BE DECIDED.`);
if (!collisions.length) {
  out.push('  No two meetings share a day and a time range at all, so there is nothing to decide.');
}
out.push('');

if (tally.conflict) {
  out.push(`CONFLICTS (${tally.conflict}) — these genuinely overlap`);
  for (const c of collisions.filter((x) => x.verdict === 'conflict')) {
    out.push(`  ${pair(c)}`);
    out.push(`    ${c.why}`);
  }
  out.push('');
}

if (tally['cannot-determine']) {
  out.push(`CANNOT TELL (${tally['cannot-determine']}) — this is a finding, not a failure`);
  for (const c of collisions.filter((x) => x.verdict === 'cannot-determine')) {
    out.push(`  ${pair(c)}`);
    out.push(`    ${c.why}`);
  }
  out.push('');
  out.push('  WHY THIS KEEPS HAPPENING, and what to say about it:');
  out.push('  FSU\'s Registrar publishes first-half/second-half session dates for SUMMER terms only.');
  out.push(`  The ${loaded.termCode} calendar therefore carries sessionsStatus "${sessionsStatus}" and an empty`);
  out.push('  sessions array, so a course marked first-half or second-half cannot be placed on the');
  out.push('  calendar at all. That is a fact about what FSU publishes, not a defect in the schedule.');
  out.push('  The student can settle it in one step: give the real start and end dates for the course');
  out.push('  and it becomes partOfTerm "custom" with a dateRange, which resolves exactly.');
  out.push('');
}

if (tally['no-conflict']) {
  out.push(`RULED OUT BY DATES (${tally['no-conflict']}) — same slot, different weeks`);
  for (const c of collisions.filter((x) => x.verdict === 'no-conflict')) {
    out.push(`  ${pair(c)}`);
    out.push(`    ${c.why}`);
  }
  out.push('');
}

if (undecidable.length) {
  out.push(`COURSES WHOSE TERM DATES ARE UNKNOWN (${undecidable.length})`);
  for (const m of undecidable) {
    out.push(`  ${m.courseCode}${m.section ? ` ${m.section}` : ''} — partOfTerm "${m.partOfTerm ?? 'full-term'}", which this calendar cannot place`);
  }
  out.push('  Their DEADLINES are unknown for the same reason: a half-term course has its own, much');
  out.push('  earlier drop and withdrawal dates, and none of them are in the shipped calendar.');
  out.push('');
}

out.push('NEVER SAY');
out.push('  "No conflicts" over a schedule with a CANNOT TELL in it. The honest summary names all');
out.push('  three counts, and an undecidable pair is the one the student has to go and check.');

console.log(out.join('\n'));
process.exit(0);
