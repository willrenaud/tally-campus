#!/usr/bin/env node
/**
 * Can a student get from one class to the next?
 *
 *   node can-i-make-it.mjs --data-dir <dir> --term 2026-fall          # every leg, every day
 *   node can-i-make-it.mjs --data-dir <dir> --day thursday
 *   node can-i-make-it.mjs --schedule draft.json --json
 *   node can-i-make-it.mjs --from HCB --to BEL --gap 15               # ad hoc, no schedule
 *
 * Exit codes:
 *   0  at least one leg was answered
 *   2  the script could not run (bad arguments, unreadable schedule)
 *   3  NOTHING was answerable -- every leg refused. A distinct code because a
 *      refusal is a result and must not be mistaken for a successful answer by
 *      anything that only checks for zero.
 *
 * THE SAFETY BEHAVIOUR IS IN THIS SCRIPT AND ITS LIBRARIES, NOT IN THE PROSE OF
 * THE SKILL. A range is emitted because reportRange() cannot emit anything else.
 * A leg touching a building that does not ship refuses because evaluateLeg()
 * returns before it reaches any arithmetic. A gap inside the margin reads "tight"
 * because the ladder has no branch that turns it into "yes". None of that depends
 * on the model remembering to be careful.
 */
import fs from 'node:fs';
import { readSchedule, dataRoot } from './lib/store.mjs';
import { termCalendar, currentTerm } from './lib/campus.mjs';
import { SAFETY_MARGIN, formatMinutes } from './lib/routing.mjs';
import { evaluateLeg, endpointOf, legsForDay } from './lib/feasibility.mjs';
import { planDrive, PARKING_SEARCH, DRIVE_MODEL } from './lib/driving.mjs';

/**
 * The drive planner handed to evaluateLeg. It only ever runs on a leg the ladder
 * has already called 'not-walkable', so an ordinary leg never pays for it and a
 * short walk is never answered with a car.
 */
const driveDate = () => { const i = process.argv.indexOf('--date'); return i === -1 ? undefined : process.argv[i + 1]; };
const drivePlanner = ({ from, to }) => {
  if (from.kind !== 'building' || to.kind !== 'building') return null;
  return planDrive({
    fromCode: from.code,
    toCode: to.code,
    date: driveDate(),
    time: (() => { const i = process.argv.indexOf('--time'); return i === -1 ? '12:00' : process.argv[i + 1]; })(),
    permits: (() => { const i = process.argv.indexOf('--permits'); return i === -1 ? [] : String(process.argv[i + 1]).split(',').map((s) => s.trim()).filter(Boolean); })()
  });
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const asJson = has('--json');

const die = (msg) => { console.error(msg); process.exit(2); };

/* ------------------------------------------------------------------ *
 * Ad-hoc mode: two building codes and a gap, no stored schedule.
 * ------------------------------------------------------------------ */
if (has('--from') || has('--to')) {
  const from = (val('--from') || '').toUpperCase();
  const to = (val('--to') || '').toUpperCase();
  const gap = Number(val('--gap'));
  if (!from || !to || !Number.isFinite(gap)) die('Ad-hoc mode needs --from <CODE> --to <CODE> --gap <minutes>');

  const fake = (code) => ({ deliveryMode: 'in-person', location: { buildingCode: code } });
  const result = evaluateLeg({
    from: endpointOf(fake(from)),
    to: endpointOf(fake(to)),
    gapMinutes: gap,
    paceMetersPerSecond: Number(val('--pace')) || undefined,
    bufferMinutes: Number(val('--buffer')) || 0,
    drivePlanner
  });
  emit({ mode: 'ad-hoc', legs: [{ ...result, day: null, earlier: from, later: to }] });
}

/* ------------------------------------------------------------------ *
 * Schedule mode.
 * ------------------------------------------------------------------ */
let doc;
if (has('--schedule')) {
  try { doc = JSON.parse(fs.readFileSync(val('--schedule'), 'utf8')); }
  catch (err) { die(`Could not read --schedule: ${err.message}`); }
} else {
  let root;
  try { root = dataRoot(val('--data-dir')); } catch (err) { die(err.message); }
  const term = val('--term') || currentTerm().termCode;
  try { doc = readSchedule(root, term); } catch (err) { die(err.message); }
  if (!doc) die(`No schedule stored for ${term}. Import one first with the import-schedule skill.`);
}

const meetings = Array.isArray(doc.meetings) ? doc.meetings : [];
const prefs = doc.preferences ?? {};
const cal = doc.termCode ? termCalendar(doc.termCode) : null;
const sessionsStatus = cal?.sessionsStatus ?? 'not-checked';
const sessions = Array.isArray(cal?.sessions) ? cal.sessions : [];

/**
 * Whether a meeting's part of term maps to real dates. The third outcome of the
 * partOfTerm RESOLUTION RULE: false here means "cannot tell", never "no".
 */
function resolvable(m) {
  if (m.dateRange) return true;
  const part = m.partOfTerm ?? 'full-term';
  if (part === 'full-term') return Boolean(cal);
  return sessions.some((s) => s.code === part);
}

const onlyDay = val('--day');
if (onlyDay && !DAYS.includes(onlyDay)) die(`--day must be one of ${DAYS.join(', ')}`);

const legs = [];
for (const day of onlyDay ? [onlyDay] : DAYS) {
  for (const pair of legsForDay(meetings, day)) {
    const unresolved = [pair.earlier, pair.later].filter((m) => !resolvable(m));
    const result = evaluateLeg({
      from: endpointOf(pair.earlier),
      to: endpointOf(pair.later),
      gapMinutes: pair.gapMinutes,
      paceMetersPerSecond: prefs.walkingPaceMetersPerSecond,
      bufferMinutes: prefs.minimumTransitBufferMinutes ?? 0,
      requiresAccessibleRoutes: prefs.requiresAccessibleRoutes === true,
      sessionsResolvable: unresolved.length === 0,
      sessionsNote: unresolved.length
        ? `${unresolved.map((m) => `${m.courseCode} runs "${m.partOfTerm}"`).join(', ')}, and the ` +
          `${doc.termCode} calendar has no dates for that part of term (sessionsStatus is "${sessionsStatus}").`
        : null,
      drivePlanner
    });
    legs.push({
      ...result,
      day,
      earlier: labelOf(pair.earlier),
      later: labelOf(pair.later)
    });
  }
}

emit({ mode: 'schedule', termCode: doc.termCode ?? null, sessionsStatus, legs });

function labelOf(m) {
  return `${m.courseCode}${m.section ? ` ${m.section}` : ''} ${m.startTime}-${m.endTime}`;
}

/**
 * What to do instead of walking. Printed as COMPONENTS with the unknown in the
 * middle of them, never as a total -- the drive plan has no total field to print
 * even if this wanted to.
 */
function renderAlternatives(out, leg) {
  const p = (s) => out.push(`                 ${s}`);
  p('');
  p('OPTIONS INSTEAD OF WALKING');

  const d = leg.drivePlan;
  if (d && d.ok) {
    p(`  DRIVE — ${d.assumption}`);
    p(`    1. walk to the car    ~${formatMinutes(d.components.walkToCar.optimisticSeconds)}  (${d.origin.code} to ${d.parkedAt.name})`);
    p(`    2. drive              ~${formatMinutes(d.components.drive.optimisticSeconds)}  (${d.parkedAt.name} to ${d.parkAt.name}, ~${DRIVE_MODEL.approxMph} mph assumed)`);
    p('    3. FIND A SPACE       UNKNOWN — not estimable from this data, and usually the biggest term');
    p(`    4. walk in            ~${formatMinutes(d.components.walkFromGarage.optimisticSeconds)}  (${d.parkAt.name} to ${d.destination.code})`);
    p('');
    p(`    Walking legs 1 and 4 together, with the safety margin applied ONCE: ${d.combinedWalk.range}`);
    p(`    Known minimum, steps 1+2+4 only: ${d.knownMinimumLabel}`);
    p(`    Your gap is ${leg.gapMinutes} min. DO NOT read the difference between those two as`);
    p('    "time available to find a space". Step 3 has no bound in this data, and steps 1, 2');
    p('    and 4 are themselves estimates. The trip cannot be totalled.');
    p('');
    p(`    ${PARKING_SEARCH.say}`);
    for (const u of d.unknowns.slice(1)) p(`    Also unmodelled: ${u}`);
  } else if (d && !d.ok) {
    p(`  DRIVE — not answerable: ${d.say}`);
  } else {
    p('  DRIVE — the plugin can estimate the walk to your car, the drive, and the walk in from');
    p('    the garage, but NOT how long it takes to find a space. Ask about a specific pair of');
    p('    buildings for the components.');
  }

  for (const alt of leg.alternatives.filter((a) => a.mode !== 'drive')) {
    p(`  ${alt.mode.toUpperCase().replace(/-/g, ' ')} — ${alt.say}${alt.url ? ` (${alt.url})` : ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */
function emit(payload) {
  const answered = payload.legs.filter((l) => l.verdict !== 'refuse');
  const refusals = payload.legs.filter((l) => l.verdict === 'refuse');

  if (asJson) {
    console.log(JSON.stringify({ ...payload, safetyMargin: SAFETY_MARGIN, answeredCount: answered.length, refusedCount: refusals.length }, null, 2));
    process.exit(payload.legs.length && !answered.length ? 3 : 0);
  }

  const out = [];
  out.push('HOW THESE NUMBERS ARE BUILT');
  out.push('  Every walking time in the shipped data is computed from building CENTRES, never');
  out.push('  measured, and leaves out doors, stairs, road crossings and class-change crowds --');
  out.push(`  all of it in the optimistic direction. So each answer is a RANGE: the low end is what`);
  out.push(`  the data says, the high end adds back a safety margin of x${SAFETY_MARGIN.crowdMultiplier}`);
  out.push(`  on the walk plus ${SAFETY_MARGIN.fixedSeconds}s fixed. There is no p90 in this data; the margin stands in for one.`);
  out.push('');

  if (!payload.legs.length) {
    out.push('No back-to-back pairs found. Nothing to check.');
    console.log(out.join('\n'));
    process.exit(0);
  }

  out.push('LEGS');
  let lastDay = null;
  for (const leg of payload.legs) {
    if (leg.day && leg.day !== lastDay) { out.push(`  ${SHORT[leg.day]}`); lastDay = leg.day; }
    const tag = {
      comfortable: 'COMFORTABLE  ',
      tight: 'TIGHT        ',
      no: "NO           ",
      "not-walkable": "NOT WALKABLE ",
      'cannot-determine': 'CANNOT TELL  ',
      'not-applicable': 'no walk      ',
      refuse: 'REFUSING     '
    }[leg.verdict];
    out.push(`    ${tag} ${leg.earlier}  ->  ${leg.later}   gap ${leg.gapMinutes} min`);
    if (leg.walk) {
      out.push(`                 walk ${leg.walk.range} via ${leg.walk.path.join(' -> ')} (${leg.walk.distanceMeters} m assumed)`);
    }
    out.push(`                 ${leg.say}`);
    if (leg.verdict === 'not-walkable') renderAlternatives(out, leg);
  }
  out.push('');

  if (refusals.length) {
    out.push(`REFUSED (${refusals.length}) -- these are answers, not failures`);
    for (const r of refusals) out.push(`  - ${r.day ? `${SHORT[r.day]} ` : ''}${r.earlier} -> ${r.later}: ${r.reason}`);
    out.push('');
  }

  out.push('ALWAYS SAY THIS');
  out.push('  These are estimates from unmeasured data, biased optimistic. A gap reported as');
  out.push('  "tight" is one the data cannot call either way -- treat it as leave-immediately.');

  console.log(out.join('\n'));
  process.exit(payload.legs.length && !answered.length ? 3 : 0);
}
