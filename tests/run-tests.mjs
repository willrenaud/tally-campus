#!/usr/bin/env node
/**
 * The import-skill test suite.
 *
 *   npm test
 *
 * Four things are checked, in ascending order of how much they would hurt if they
 * broke:
 *
 *   1. UNIT   -- the normalisation helpers, especially the cases they must REFUSE.
 *   2. PARITY -- the plugin's dependency-free validator and Ajv agree, document for
 *                document, about what is valid. This is the load-bearing one: the
 *                shipped plugin cannot carry Ajv, so the hand-written validator is
 *                what actually guards a student's file, and the only thing stopping
 *                it drifting away from the schemas is this test.
 *   3. FIXTURE -- each fixture's expected.json validates and produces the review
 *                outcome the fixture exists to pin down.
 *   4. STORE  -- re-import replaces rather than merges, archives what it replaced,
 *                and is a no-op when the source has not changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { buildAjv, compileFor } from '../tools/lib/ajv-env.mjs';
import * as N from '../plugins/fsu-schedule/scripts/lib/normalize.mjs';
import { validateSchedule, loadPermitClasses } from '../plugins/fsu-schedule/scripts/lib/validate.mjs';
import { parkingSchema } from '../plugins/fsu-schedule/scripts/lib/campus.mjs';
import * as N_CAMPUS from '../plugins/fsu-schedule/scripts/lib/campus.mjs';
import { saveSchedule, readSchedule, listTerms, archiveDir, ARCHIVE_KEEP } from '../plugins/fsu-schedule/scripts/lib/store.mjs';
import { SAFETY_MARGIN, applySafetyMargin, route, formatRange } from '../plugins/fsu-schedule/scripts/lib/routing.mjs';
import { evaluateLeg, endpointOf, legsForDay, VERDICTS } from '../plugins/fsu-schedule/scripts/lib/feasibility.mjs';
import { blackoutCheck, ruleAt, windowMatches, dayOfWeek, nextDate, BLACKOUT_EVE_FROM } from '../plugins/fsu-schedule/scripts/lib/parking.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const FIXTURES = path.join(HERE, 'fixtures');
const SCRIPTS = path.join(REPO, 'plugins', 'fsu-schedule', 'scripts');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const detail = fn();
    if (detail === true || detail === undefined) { passed++; console.log(`  ok   ${name}`); }
    else { failures.push(`${name}\n    ${detail}`); console.log(`  FAIL ${name}`); }
  } catch (err) {
    failures.push(`${name}\n    threw: ${err.message}`);
    console.log(`  FAIL ${name}`);
  }
}
const eq = (actual, expected, what) =>
  (JSON.stringify(actual) === JSON.stringify(expected) ? true : `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

loadPermitClasses(parkingSchema());
const { ajv } = buildAjv();
const ajvSchedule = compileFor(ajv, 'student-schedule.schema.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ================================================================== *
 * 1. UNIT -- the refusals matter more than the successes
 * ================================================================== */
console.log('\nUNIT: field normalisation');

const dayCases = [
  ['MWF', ['monday', 'wednesday', 'friday']],
  ['TR', ['tuesday', 'thursday']],
  ['M', ['monday']],
  ['Mon/Wed/Fri', ['monday', 'wednesday', 'friday']],
  ['Tue, Thu', ['tuesday', 'thursday']],
  ['Monday', ['monday']],
  ['MTWRF', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']]
];
for (const [input, want] of dayCases) {
  check(`expandDays accepts ${input}`, () => {
    const r = N.expandDays(input);
    return r.ok ? eq(r.value, want, input) : `refused with ${r.reason}`;
  });
}
for (const [input, reason] of [
  ['TH', 'ambiguous-th'],
  ['TTH', 'ambiguous-th'],
  ['FR', 'ambiguous-two-letter'],
  ['TU', 'ambiguous-two-letter'],
  ['SU', 'ambiguous-two-letter'],
  ['MWX', 'unrecognised-token'],
  ['TBA', 'no-days-given']
]) {
  check(`expandDays REFUSES ${input} (${reason})`, () => {
    const r = N.expandDays(input);
    if (r.ok) return `accepted it as ${JSON.stringify(r.value)} -- this is the bug that moves a class to the wrong day`;
    return eq(r.reason, reason, 'reason');
  });
}

for (const [input, want] of [['9:05 AM', '09:05'], ['1:50p', '13:50'], ['13:50', '13:50'], ['0955', '09:55'], ['12:00 am', '00:00'], ['12:00 pm', '12:00']]) {
  check(`normalizeTime ${input}`, () => {
    const r = N.normalizeTime(input);
    return r.ok ? eq(r.value, want, input) : `refused with ${r.reason}`;
  });
}
check('normalizeTime REFUSES a bare 1:50', () => {
  const r = N.normalizeTime('1:50');
  return r.ok ? `accepted it as ${r.value}` : eq(r.reason, 'ambiguous-no-meridiem', 'reason');
});
check('parseTimeRange carries a trailing meridiem back to the start', () => {
  const r = N.parseTimeRange('1:20 - 2:10 PM');
  return r.ok ? eq(r.value, { startTime: '13:20', endTime: '14:10' }, 'range') : `refused with ${r.reason}`;
});
check('parseTimeRange keeps 11:00 - 1:00 PM spanning noon', () => {
  const r = N.parseTimeRange('11:00 - 1:00 PM');
  return r.ok ? eq(r.value, { startTime: '11:00', endTime: '13:00' }, 'range') : `refused with ${r.reason}`;
});
check('parseTimeRange REFUSES an end before its start', () => {
  const r = N.parseTimeRange('2:00 PM - 1:00 PM');
  return r.ok ? `accepted ${JSON.stringify(r.value)}` : true;
});

for (const tba of ['TBA', 'TBD', 'To Be Announced', 'ARR', '', '   ']) {
  check(`normalizeRoom turns ${JSON.stringify(tba)} into null, never the string`, () => {
    const r = N.normalizeRoom(tba);
    return r.ok ? eq(r.value, null, 'room') : `refused with ${r.reason}`;
  });
}
/* The term is derived, never asked. These pin the three bases apart, because they
 * do not deserve equal confidence and the skill hedges differently for each. */
for (const [today, wantCode, wantBasis] of [
  ['2026-08-31', '2026-fall', 'calendar'],   // inside the shipped term
  ['2026-08-24', '2026-fall', 'calendar'],   // first day of classes
  ['2026-08-01', '2026-fall', 'next-term'],  // before it starts; a schedule is imported early
  ['2027-06-01', '2027-summer', 'month']     // nothing shipped covers or follows it
]) {
  check(`currentTerm ${today} -> ${wantCode} (${wantBasis})`, () => {
    const r = N_CAMPUS.currentTerm(today);
    return eq([r.termCode, r.basis], [wantCode, wantBasis], today);
  });
}
check('currentTerm never asks: it always returns a termCode', () => {
  for (const d of ['2020-01-01', '2026-05-15', '2030-12-31']) {
    const r = N_CAMPUS.currentTerm(d);
    if (!/^20[0-9]{2}-(spring|summer|fall)$/.test(r.termCode)) return `${d} produced ${r.termCode}`;
  }
  return true;
});

check('splitLocation separates online from TBA', () => {
  const online = N.splitLocation('ONLINE');
  const tba = N.splitLocation('TBA');
  if (!online.ok || !tba.ok) return 'one of them failed to parse';
  if (online.value.kind !== 'online') return `ONLINE read as ${online.value.kind}`;
  if (tba.value.kind !== 'tba') return `TBA read as ${tba.value.kind}`;
  return true;
});
for (const [room, floor] of [['0216', 2], ['0422', 4], ['0152', 1], ['1200', 1], ['216', 2]]) {
  check(`deriveFloor ${room} -> ${floor}`, () => {
    const r = N.deriveFloor(room);
    return r.ok ? eq(r.value, floor, room) : `refused with ${r.reason}`;
  });
}

/* ================================================================== *
 * 2. PARITY -- the shipped validator must agree with Ajv
 * ================================================================== */
console.log('\nPARITY: the plugin validator and Ajv must agree');

const base = readJson(path.join(FIXTURES, '01-clean-paste', 'expected.json'));
const clone = () => structuredClone(base);

/** Every one of these must be REJECTED, by both validators, for the same document. */
const mutations = [
  ['async meeting carrying a room', (d) => { d.meetings[0].deliveryMode = 'online-asynchronous'; }],
  ['in-person meeting with a null location', (d) => { d.meetings[0].location = null; }],
  ['in-person meeting with no location at all', (d) => { delete d.meetings[0].location; }],
  ['locationTba on an online meeting', (d) => { d.meetings[0].deliveryMode = 'online-synchronous'; d.meetings[0].location = null; d.meetings[0].locationTba = true; }],
  ['locationTba alongside a real location', (d) => { d.meetings[0].locationTba = true; }],
  ['location with no buildingCode', (d) => { delete d.meetings[0].location.buildingCode; }],
  ['empty room string', (d) => { d.meetings[0].location.room = ''; }],
  ['lowercase building code', (d) => { d.meetings[0].location.buildingCode = 'hcb'; }],
  ['course code with a space', (d) => { d.meetings[0].courseCode = 'ENC 1101'; }],
  ['section that is too long', (d) => { d.meetings[0].section = '000000001'; }],
  ['credits that are not a half step', (d) => { d.meetings[0].credits = 3.3; }],
  ['unknown delivery mode', (d) => { d.meetings[0].deliveryMode = 'carrier-pigeon'; }],
  ['unknown meeting type', (d) => { d.meetings[0].meetingType = 'happening'; }],
  ['duplicate weekday', (d) => { d.meetings[0].daysOfWeek = ['monday', 'monday']; }],
  ['empty weekday list', (d) => { d.meetings[0].daysOfWeek = []; }],
  ['capitalised weekday', (d) => { d.meetings[0].daysOfWeek = ['Monday']; }],
  ['time with no leading zero', (d) => { d.meetings[0].startTime = '9:05'; }],
  ['id that is not a slug', (d) => { d.meetings[0].id = 'ENC1101 Lecture'; }],
  ['unknown property on a meeting', (d) => { d.meetings[0].professorEmail = 'x@fsu.edu'; }],
  ['unknown property on the schedule', (d) => { d.notes = 'hello'; }],
  ['biweekly recurrence with no anchorDate', (d) => { d.meetings[0].recurrence = { frequency: 'biweekly' }; }],
  ['irregular recurrence with no dates', (d) => { d.meetings[0].recurrence = { frequency: 'irregular' }; }],
  ['custom partOfTerm with no dateRange', (d) => { d.meetings[0].partOfTerm = 'custom'; }],
  ['missing schemaVersion', (d) => { delete d.schemaVersion; }],
  ['malformed termCode', (d) => { d.termCode = 'Fall 2026'; }],
  ['import with no sourceFormat', (d) => { delete d.import.sourceFormat; }],
  ['unknown sourceFormat', (d) => { d.import.sourceFormat = 'telepathy'; }],
  ['importedAt with no offset', (d) => { d.import.importedAt = '2026-08-30T14:00:00'; }],
  ['checksum that is not a SHA-256', (d) => { d.import.sourceChecksum = 'nope'; }],
  ['unknown warning code', (d) => { d.import.warnings[0].code = 'oops'; }],
  ['warning with an empty message', (d) => { d.import.warnings[0].message = ''; }],
  ['walking pace of zero', (d) => { d.preferences = { walkingPaceMetersPerSecond: 0 }; }],
  ['negative transit buffer', (d) => { d.preferences = { minimumTransitBufferMinutes: -5 }; }],
  ['unknown permit class', (d) => { d.preferences = { parkingPermits: ['GOLDEN-TICKET'] }; }]
];

check('the baseline fixture is valid under BOTH validators', () => {
  const mine = validateSchedule(base);
  const theirs = ajvSchedule(base);
  if (mine.length) return `plugin validator rejected it: ${mine.join('; ')}`;
  if (!theirs) return `Ajv rejected it: ${ajv.errorsText(ajvSchedule.errors)}`;
  return true;
});

for (const [name, mutate] of mutations) {
  check(`both reject: ${name}`, () => {
    const doc = clone();
    mutate(doc);
    const mineOk = validateSchedule(doc).length === 0;
    const ajvOk = ajvSchedule(doc);
    if (mineOk && ajvOk) return 'BOTH accepted a document that should be invalid';
    if (mineOk !== ajvOk) {
      return mineOk
        ? 'the PLUGIN validator accepted it but Ajv rejected it -- the shipped validator has drifted and will let bad data through'
        : 'Ajv accepted it but the plugin validator rejected it -- the shipped validator is stricter than the schema and will refuse valid schedules';
    }
    return true;
  });
}

// Things that must be ACCEPTED by both, so parity is not achieved by rejecting everything.
const permitted = [
  ['a TBA room, building known', (d) => { delete d.meetings[0].location.room; delete d.meetings[0].location.floor; }],
  ['a wholly unknown location, declared', (d) => { delete d.meetings[0].location; d.meetings[0].locationTba = true; }],
  ['an empty instructor list', (d) => { d.meetings[0].instructors = []; }],
  ['no meetings at all', (d) => { d.meetings = []; d.import.warnings = []; }],
  ['a non-canonical course code', (d) => { d.meetings[0].courseCode = 'ISC4241C'; d.meetings[0].canonicalNumbering = false; }],
  // section and title became optional in 0.4.0. A screenshot grid carries neither,
  // and requiring them forced the importer to interrogate or to fabricate.
  ['a meeting with no section', (d) => { delete d.meetings[0].section; }],
  ['a meeting with no title', (d) => { delete d.meetings[0].title; }],
  ['a meeting with neither section nor title', (d) => { for (const m of d.meetings) { delete m.section; delete m.title; } }],
  ['a custom term slice with dates', (d) => { d.meetings[0].partOfTerm = 'custom'; d.meetings[0].dateRange = { firstMeetingDate: '2026-08-24', lastMeetingDate: '2026-10-09' }; }]
];
for (const [name, mutate] of permitted) {
  check(`both accept: ${name}`, () => {
    const doc = clone();
    mutate(doc);
    const mine = validateSchedule(doc);
    const ajvOk = ajvSchedule(doc);
    if (!mine.length && ajvOk) return true;
    if (mine.length && !ajvOk) return `both rejected it: ${mine.join('; ')}`;
    return mine.length
      ? `the PLUGIN validator rejected what Ajv accepted: ${mine.join('; ')}`
      : `Ajv rejected what the plugin validator accepted: ${ajv.errorsText(ajvSchedule.errors)}`;
  });
}

/* ================================================================== *
 * 3. FIXTURES
 * ================================================================== */
console.log('\nFIXTURES: each input has one right answer');

const review = (file) => JSON.parse(execFileSync(process.execPath,
  [path.join(SCRIPTS, 'review-schedule.mjs'), file, '--json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

const EXPECTATIONS = {
  '01-clean-paste': {
    input: 'input.txt',
    meetings: 6,
    unresolvedLocations: 0,
    blockingQuestions: 0,  // the assertion this rework exists for
    collisions: {},
    warningCodes: ['missing-instructor', 'missing-instructor']
  },
  '02-wrapped-and-repeated-header': {
    input: 'input.txt',
    meetings: 4,
    unresolvedLocations: 0,
    blockingQuestions: 0,  // the assertion this rework exists for
    collisions: {},
    warningCodes: ['missing-instructor'],
    // The whole point: the wrapped title is rejoined and the repeated header is not
    // mistaken for a course.
    extra: (doc) => {
      const spc = doc.meetings.find((m) => m.courseCode === 'SPC2608');
      if (!spc) return 'SPC2608 is missing';
      if (spc.title !== 'Public Speaking: Theory and Practice for the Contemporary Speaker') {
        return `wrapped title was not rejoined: ${JSON.stringify(spc.title)}`;
      }
      if (doc.meetings.some((m) => /course|class nbr/i.test(m.title))) return 'a repeated header row was imported as a course';
      return true;
    }
  },
  '03-online-async-and-tba-room': {
    input: 'input.txt',
    meetings: 3,
    // Zero, and that is the interesting part. A TBA ROOM is not an unresolved
    // LOCATION: the building resolved, so routing to it works and only the door
    // number is missing. The async course has no location to resolve at all.
    unresolvedLocations: 0,
    blockingQuestions: 0,  // the assertion this rework exists for
    collisions: {},
    warningCodes: ['missing-instructor', 'assumed-delivery-mode', 'missing-room'],
    extra: (doc, rev) => {
      const async_ = doc.meetings.find((m) => m.courseCode === 'POS2041');
      if (async_.deliveryMode !== 'online-asynchronous') return 'POS2041 should be online-asynchronous';
      if (async_.location !== null) return 'an online course must carry location null';
      if ('daysOfWeek' in async_ || 'startTime' in async_) return 'an asynchronous course must carry no days or times';
      if ('locationTba' in async_) return 'online is NOT the same as location-TBA; locationTba must not appear here';
      const tba = doc.meetings.find((m) => m.courseCode === 'STA2023');
      if (tba.location.buildingCode !== 'BEL') return 'the known building must be kept even when the room is not';
      if ('room' in tba.location) return `room must be omitted, not stored as ${JSON.stringify(tba.location.room)}`;
      if ('locationTba' in tba) return 'a known building with an unknown room is not a TBA location';
      const bel = rev.locations.find((l) => l.meetingId === tba.id);
      if (!bel || bel.status !== 'resolved') return 'BEL should still resolve; only the room is missing';
      return true;
    }
  },
  '04-unknown-building': {
    input: 'input.txt',
    meetings: 3,
    unresolvedLocations: 1,
    blockingQuestions: 0,  // the assertion this rework exists for
    collisions: {},
    warningCodes: ['unknown-building-code', 'missing-instructor'],
    extra: (doc, rev) => {
      // THE POINT OF THIS FIXTURE: one unknown building must not fail the import.
      if (!rev.valid) return 'the import was rejected -- one unknown building must never fail a whole schedule';
      const bul = doc.meetings.find((m) => m.courseCode === 'BUL3310');
      if (bul.location.buildingCode !== 'WCB') return 'the unknown code must be kept exactly as printed';
      if (bul.location.room !== '1010') return 'the room must survive even though the building is unknown';
      const other = rev.locations.filter((l) => l.status === 'resolved');
      if (other.length !== 2) return `the other ${2 - other.length} building(s) should still resolve normally`;
      const unknown = rev.locations.find((l) => l.status === 'unknown');
      if (!unknown || unknown.code !== 'WCB') return 'WCB should be reported as unknown';
      return true;
    }
  },
  '05-time-conflict': {
    input: 'input.txt',
    meetings: 4,
    unresolvedLocations: 0,
    blockingQuestions: 1,  // the assertion this rework exists for
    collisions: { conflict: 1, 'cannot-determine': 1 },
    warningCodes: ['unmapped-session', 'unmapped-session'],
    extra: (doc, rev) => {
      const real = rev.collisions.find((c) => c.verdict === 'conflict');
      if (!real) return 'the genuine MW collision was not reported';
      const codes = [real.a.courseCode, real.b.courseCode].sort();
      if (JSON.stringify(codes) !== JSON.stringify(['HIS2100', 'MUH2051'])) return `wrong pair flagged: ${codes}`;
      const undecidable = rev.collisions.find((c) => c.verdict === 'cannot-determine');
      if (!undecidable) return 'the half-term pair was not reported as undecidable';
      if (rev.collisions.some((c) => c.verdict === 'no-conflict')) {
        return 'something was reported as "no conflict"; with sessionsStatus not-published that claim cannot be made';
      }
      if (rev.sessionsStatus !== 'not-published') return `sessionsStatus should be not-published, got ${rev.sessionsStatus}`;
      return true;
    }
  },
  // Built for the step 5 query skills rather than for the importer: four back-to-back
  // pairs chosen so that one lands on each rung of the feasibility ladder, plus an
  // online origin. See the FEASIBILITY section below; the checks here only confirm
  // that the fixture is a legitimate schedule to ask those questions of.
  '08-back-to-back-walks': {
    input: null,
    meetings: 8,
    unresolvedLocations: 0,
    blockingQuestions: 0,
    collisions: {},
    warningCodes: ['missing-instructor']
  },
  '07-screenshot-no-sections': {
    // No input file at all: the source was an image. Nothing to checksum.
    input: null,
    meetings: 5,
    unresolvedLocations: 4,
    blockingQuestions: 0,  // THE POINT OF THIS FIXTURE
    collisions: {},
    warningCodes: ['unknown-building-code', 'unknown-building-code', 'unknown-building-code', 'unknown-building-code'],
    extra: (doc, rev) => {
      // This exact input produced FOUR blocking questions under the 0.3.0 skill,
      // before the student saw anything at all. Every one of them is now derived
      // or stated. If this count ever rises above zero the rework has regressed.
      if (rev.blockingQuestions.length !== 0) {
        return `asks ${rev.blockingQuestions.length} question(s) before showing anything: ` +
          rev.blockingQuestions.map((q) => q.kind).join(', ');
      }
      if (doc.meetings.some((m) => 'section' in m)) return 'a section was invented; the screenshot has none';
      if (doc.meetings.some((m) => 'title' in m)) return 'a title was invented; the screenshot has none';
      if (doc.import.sourceChecksum !== undefined) return 'an image has no raw text to checksum';
      // Four of five buildings unresolvable and the import still succeeds.
      if (!rev.valid) return 'the import was rejected -- a mostly-unknown-buildings schedule must still import';
      const pdb = rev.locations.find((l) => l.code === 'PDB');
      if (!pdb || pdb.status !== 'resolved') return 'PDB must still resolve alongside the unknown ones';
      // A once-weekly course is an observation, never a question.
      const once = doc.meetings.find((m) => m.courseCode === 'ISM3541');
      if (once.daysOfWeek.length !== 1) return 'ISM3541 meets once a week in the source';
      if (!rev.assumptions.some((a) => a.includes('once a week'))) {
        return 'a once-weekly course must be noted as an observation under the table';
      }
      if (!rev.assumptions.some((a) => a.toLowerCase().includes('room numbers'))) {
        return 'a screenshot import must flag room numbers as the OCR risk';
      }
      return true;
    }
  }
};

for (const [dir, exp] of Object.entries(EXPECTATIONS)) {
  const expectedFile = path.join(FIXTURES, dir, 'expected.json');
  const doc = readJson(expectedFile);

  check(`${dir}: expected.json is valid under BOTH validators`, () => {
    const mine = validateSchedule(doc);
    const ajvOk = ajvSchedule(doc);
    if (mine.length) return `plugin validator: ${mine.join('; ')}`;
    if (!ajvOk) return `Ajv: ${ajv.errorsText(ajvSchedule.errors)}`;
    return true;
  });

  check(`${dir}: checksum matches the input file`, () => {
    if (!exp.input) {
      // An image source has no raw text, so the schema lets the checksum be absent
      // rather than inviting a fabricated one.
      return doc.import.sourceChecksum === undefined
        ? true
        : `there is no input file, so sourceChecksum should be absent, not ${JSON.stringify(doc.import.sourceChecksum)}`;
    }
    const raw = fs.readFileSync(path.join(FIXTURES, dir, exp.input), 'utf8');
    const sum = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    return eq(doc.import.sourceChecksum, sum, 'sourceChecksum');
  });

  check(`${dir}: ${exp.meetings} meeting block(s)`, () => eq(doc.meetings.length, exp.meetings, 'meeting count'));

  check(`${dir}: warnings recorded`, () => eq(
    doc.import.warnings.map((w) => w.code).sort(),
    [...exp.warningCodes].sort(),
    'warning codes'
  ));

  const rev = review(expectedFile);
  check(`${dir}: review reports the expected collisions`, () => {
    const tally = {};
    for (const c of rev.collisions) tally[c.verdict] = (tally[c.verdict] || 0) + 1;
    return eq(tally, exp.collisions, 'collision verdicts');
  });
  check(`${dir}: ${exp.unresolvedLocations} unresolved location(s)`, () =>
    eq(rev.unresolved.length, exp.unresolvedLocations, 'unresolved count'));

  check(`${dir}: ${exp.blockingQuestions} blocking question(s)`, () => {
    if (rev.blockingQuestions.length === exp.blockingQuestions) return true;
    return `expected ${exp.blockingQuestions}, got ${rev.blockingQuestions.length}: ` +
      rev.blockingQuestions.map((q) => q.kind).join(', ') +
      '\n    A question must earn its place: it may only be asked when the answer cannot be' +
      '\n    inferred AND a wrong guess would be invisible to a student reading the draft.';
  });

  if (exp.extra) check(`${dir}: ${dir.replace(/^\d+-/, '').replace(/-/g, ' ')}`, () => exp.extra(doc, rev));
}

/* ------------------------------------------------------------------ *
 * The draft comes FIRST. This is an ordering assertion, not a content one:
 * whatever else the report says, the student must meet their own week before
 * they meet a question about it. Asserted on the text the student actually
 * sees, because that is where the ordering is real.
 * ------------------------------------------------------------------ */
console.log('\nFLOW: the draft is shown before anything is asked');

const reviewText = (file) => execFileSync(process.execPath,
  [path.join(SCRIPTS, 'review-schedule.mjs'), file],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const dir of Object.keys(EXPECTATIONS)) {
  check(`${dir}: THE WEEK precedes MUST ASK`, () => {
    const text = reviewText(path.join(FIXTURES, dir, 'expected.json'));
    const week = text.indexOf('THE WEEK');
    const ask = text.indexOf('MUST ASK');
    const assume = text.indexOf('ASSUMPTIONS');
    if (week === -1) return 'the week was never rendered';
    if (ask === -1) return 'the MUST ASK section is missing entirely';
    if (assume === -1) return 'the ASSUMPTIONS section is missing entirely';
    if (week > assume) return 'assumptions were listed before the week they qualify';
    if (assume > ask) return 'questions came before the assumptions';
    return true;
  });
}

check('a schedule that needs a question STILL shows the week first', () => {
  // 05 is the fixture with a genuine collision, so it is the one that proves the
  // ordering holds when there really is something to ask about.
  const text = reviewText(path.join(FIXTURES, '05-time-conflict', 'expected.json'));
  if (!/MUST ASK \(1\)/.test(text)) return 'fixture 05 should raise exactly one question';
  return text.indexOf('THE WEEK') < text.indexOf('MUST ASK')
    ? true
    : 'the question was raised before the draft was shown';
});

/* --- the .ics fixture exercises the parser rather than a document --- */
console.log('\nFIXTURES: .ics parsing');
const ics = JSON.parse(execFileSync(process.execPath,
  [path.join(SCRIPTS, 'parse-ics.mjs'), path.join(FIXTURES, '06-ics-export', 'input.ics')],
  { encoding: 'utf8' }));

check('06: all five VEVENTs are read', () => eq(ics.eventCount, 5, 'event count'));
check('06: a folded DESCRIPTION is rejoined', () => {
  const mac = ics.drafts.find((d) => d.courseCode === 'MAC2311');
  if (!mac.description.includes('make-up procedure that applies when a documented absence')) {
    return 'the continuation lines were not unfolded';
  }
  return true;
});
check('06: an escaped comma survives', () => {
  const mac = ics.drafts.find((d) => d.courseCode === 'MAC2311');
  return mac.summary.includes('Geometry I, Lecture') ? true : `summary is ${JSON.stringify(mac.summary)}`;
});
check('06: BYDAY drives the weekdays', () => {
  const enc = ics.drafts.find((d) => d.courseCode === 'ENC1101');
  return eq(enc.daysOfWeek, ['monday', 'wednesday', 'friday'], 'ENC1101 days');
});
check('06: INTERVAL=2 becomes biweekly', () => {
  const lab = ics.drafts.find((d) => d.courseCode === 'BSC2010L');
  return eq(lab.frequency, 'biweekly', 'frequency');
});
check('06: both EXDATEs are collected', () => {
  const enc = ics.drafts.find((d) => d.courseCode === 'ENC1101');
  return eq(enc.exceptDates, ['2026-09-07', '2026-11-11'], 'exceptDates');
});
check('06: a missing LOCATION is a question, not an assumption of online', () => {
  const pos = ics.drafts.find((d) => d.courseCode === 'POS2041');
  if (pos.locationHint.kind !== 'absent') return `location was read as ${pos.locationHint.kind}`;
  if (!ics.warnings.some((w) => w.code === 'missing-room')) return 'no warning was raised about the missing LOCATION';
  return true;
});
check('06: an event with no course code is flagged, not guessed at', () => {
  const stray = ics.drafts.find((d) => !d.courseCode);
  if (!stray) return 'the advising appointment was given a course code it does not have';
  return ics.warnings.some((w) => w.message.includes('Advising appointment')) ? true : 'no warning names it';
});

/* ================================================================== *
 * 4. STORE -- the re-import policy
 * ================================================================== */
console.log('\nSTORE: re-import replaces, archives, and never merges');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsu-schedule-test-'));
const withChecksum = (doc, sum) => {
  const d = structuredClone(doc);
  d.import = { ...d.import, sourceChecksum: sum };
  return d;
};
const sum = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

check('a first import creates the file', () => {
  const r = saveSchedule(tmp, withChecksum(base, sum('one')));
  if (r.action !== 'created') return `action was ${r.action}`;
  return eq(listTerms(tmp), ['2026-fall'], 'stored terms');
});

check('re-importing identical source writes nothing', () => {
  const r = saveSchedule(tmp, withChecksum(base, sum('one')));
  return eq(r.action, 'unchanged', 'action');
});

check('a dropped course REPLACES rather than merges', () => {
  const dropped = structuredClone(base);
  dropped.meetings = dropped.meetings.filter((m) => m.courseCode !== 'PSY2012');
  dropped.import.warnings = [];
  const r = saveSchedule(tmp, withChecksum(dropped, sum('two')));
  if (r.action !== 'replaced') return `action was ${r.action}`;
  const stored = readSchedule(tmp, '2026-fall');
  if (stored.meetings.length !== 5) return `stored ${stored.meetings.length} blocks; a merge would have kept 6`;
  if (stored.meetings.some((m) => m.courseCode === 'PSY2012')) {
    return 'the dropped course survived the re-import -- this is the merge bug';
  }
  return true;
});

check('the replaced version is archived', () => {
  const files = fs.readdirSync(archiveDir(tmp));
  if (files.length !== 1) return `expected 1 archive, found ${files.length}`;
  const old = JSON.parse(fs.readFileSync(path.join(archiveDir(tmp), files[0]), 'utf8'));
  return old.meetings.length === 6 ? true : 'the archive does not hold the pre-replacement version';
});

check(`only the ${ARCHIVE_KEEP} most recent archives are kept`, () => {
  for (let i = 0; i < ARCHIVE_KEEP + 3; i++) {
    const d = structuredClone(base);
    d.import = { ...d.import, importedAt: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00-04:00`, sourceChecksum: sum(`run-${i}`) };
    saveSchedule(tmp, d);
  }
  const files = fs.readdirSync(archiveDir(tmp)).filter((f) => f.startsWith('2026-fall--'));
  return files.length <= ARCHIVE_KEEP ? true : `${files.length} archives remain`;
});

check('save-schedule.mjs REFUSES an invalid document', () => {
  const bad = structuredClone(base);
  bad.meetings[0].location = null;
  const file = path.join(tmp, 'bad.json');
  fs.writeFileSync(file, JSON.stringify(bad));
  try {
    execFileSync(process.execPath, [path.join(SCRIPTS, 'save-schedule.mjs'), file, '--data-dir', tmp],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 'it wrote an invalid document';
  } catch (err) {
    if (err.status !== 1) return `exited ${err.status}, expected 1`;
    return /REFUSING TO WRITE/.test(err.stderr || '') ? true : `stderr was ${JSON.stringify(err.stderr)}`;
  }
});

check('a corrupt stored file is an error, not "no schedule yet"', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fsu-schedule-test-'));
  fs.mkdirSync(path.join(dir2, 'schedules'), { recursive: true });
  fs.writeFileSync(path.join(dir2, 'schedules', '2026-fall.json'), '{ this is not json');
  try {
    readSchedule(dir2, '2026-fall');
    return 'a corrupt file was treated as absent, which would silently destroy it';
  } catch {
    return true;
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

fs.rmSync(tmp, { recursive: true, force: true });

/* ================================================================== *
 * 5. SAFETY MARGIN -- one constant, in one place, that never shrinks
 *
 * The margin is the whole of this project's answer to walking data that has
 * never been measured. If it drifts, becomes a second copy, or is quietly
 * bypassed by a formatter that emits a point estimate, every feasibility answer
 * silently goes back to being optimistic. These checks are the thing stopping
 * that, in the same spirit as the PARITY section above.
 * ================================================================== */
console.log('\nSAFETY MARGIN: one constant, documented, never shrinking');

check('the margin is exactly what the documentation claims', () =>
  eq([SAFETY_MARGIN.fixedSeconds, SAFETY_MARGIN.crowdMultiplier], [180, 1.35], 'margin'));

check('the three stated components add up to fixedSeconds', () => {
  const total = Object.values(SAFETY_MARGIN.components).reduce((a, b) => a + b, 0);
  return total === SAFETY_MARGIN.fixedSeconds
    ? true
    : `the breakdown sums to ${total} but fixedSeconds is ${SAFETY_MARGIN.fixedSeconds}; ` +
      'the justification in routing.mjs no longer describes the number being used';
});

check('the constant is frozen', () =>
  Object.isFrozen(SAFETY_MARGIN) && Object.isFrozen(SAFETY_MARGIN.components) ? true : 'a caller could mutate the margin at runtime');

check('the margin never makes an estimate SHORTER, on any shipped edge', () => {
  for (const e of readJson(path.join(REPO, 'plugins', 'fsu-schedule', 'data', 'walk-edges.json'))) {
    const m = applySafetyMargin(e.baseDurationSeconds);
    if (m.realisticSeconds <= m.optimisticSeconds) return `${e.id}: ${m.realisticSeconds} <= ${m.optimisticSeconds}`;
  }
  return true;
});

check('a zero-length walk still costs the fixed margin', () => {
  // Two classes in the same building. You still leave a room, walk a corridor and
  // find another one, and none of that is in the shipped data.
  const m = applySafetyMargin(0);
  return eq([m.optimisticSeconds, m.realisticSeconds], [0, 180], 'same-building margin');
});

check('the margin is defined in ONE file', () => {
  // A second literal 1.35 anywhere in the shipped scripts means the documented
  // constant and the applied one can part company without anything noticing.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.mjs')) continue;
      if (p.endsWith(`${path.sep}routing.mjs`)) continue; // the one place it may appear
      const text = fs.readFileSync(p, 'utf8');
      // Ignore prose in comments: only executable-looking occurrences matter.
      const code = text.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
      if (/\b1\.35\b/.test(code)) offenders.push(path.relative(REPO, p));
    }
  };
  walk(SCRIPTS);
  return offenders.length ? `the multiplier is hard-coded outside routing.mjs in: ${offenders.join(', ')}` : true;
});

check('formatRange ALWAYS emits both ends', () => {
  for (const seconds of [0, 30, 106, 466, 854, 1919]) {
    const text = formatRange(applySafetyMargin(seconds));
    if (!/^(\d+–\d+ min|about \d+ min)$/.test(text)) return `${seconds}s formatted as ${JSON.stringify(text)}`;
  }
  return true;
});

check('there is no "yes" verdict to fall back on', () =>
  VERDICTS.includes('yes') ? 'a "yes" verdict exists; anything inside the margin could be reported as one' : true);

/* ================================================================== *
 * 6. FEASIBILITY -- the ladder, and every rung of it
 * ================================================================== */
console.log('\nFEASIBILITY: can-i-make-it refuses where it must and hedges where it must');

const CANIMAKEIT = path.join(SCRIPTS, 'can-i-make-it.mjs');

/** execFileSync throws on a non-zero exit, and exit 3 is a RESULT here. */
function run(script, args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}
const feasibility = (args) => {
  const r = run(CANIMAKEIT, [...args, '--json']);
  return { ...r, json: JSON.parse(r.stdout) };
};

const FX07 = path.join(FIXTURES, '07-screenshot-no-sections', 'expected.json');
const FX08 = path.join(FIXTURES, '08-back-to-back-walks', 'expected.json');
const FX05 = path.join(FIXTURES, '05-time-conflict', 'expected.json');

check('WCB: EVERY leg of the step-4 screenshot schedule refuses', () => {
  const { json } = feasibility(['--schedule', FX07]);
  if (!json.legs.length) return 'no legs were found at all; the fixture no longer exercises this';
  const wrong = json.legs.filter((l) => l.verdict !== 'refuse' || l.reason !== 'building-not-in-data');
  return wrong.length
    ? `${wrong.length} leg(s) did not refuse: ${wrong.map((l) => `${l.earlier}->${l.later} ${l.verdict}`).join('; ')}`
    : true;
});

check('WCB: no walking number leaks out of a refusal', () => {
  const { json } = feasibility(['--schedule', FX07]);
  const leaked = json.legs.filter((l) => l.walk || /\d+\s*min/.test(l.say));
  return leaked.length ? `a refusal carried a duration: ${JSON.stringify(leaked[0].say).slice(0, 120)}` : true;
});

check('WCB: a run where nothing was answerable exits 3, not 0', () => {
  const r = run(CANIMAKEIT, ['--schedule', FX07, '--json']);
  return r.status === 3 ? true : `exited ${r.status}; a caller checking only for zero would read total refusal as success`;
});

check('PDB to PDB works normally -- comfortable, with a range', () => {
  const { json } = feasibility(['--schedule', FX08, '--day', 'monday']);
  const leg = json.legs[0];
  if (!leg) return 'the Monday pair vanished from the fixture';
  if (leg.verdict !== 'comfortable') return `verdict was ${leg.verdict}: ${leg.say}`;
  if (!leg.walk.sameBuilding) return 'PDB to PDB should route as the same building';
  return /–|about/.test(leg.walk.range) ? true : `range was ${JSON.stringify(leg.walk.range)}`;
});

check('a tight-but-technically-feasible gap reports as TIGHT, never comfortable', () => {
  const { json } = feasibility(['--schedule', FX08, '--day', 'tuesday']);
  const leg = json.legs[0];
  if (leg.verdict !== 'tight') return `verdict was ${leg.verdict}: ${leg.say}`;
  // The whole point of the rung: the gap DOES fit the optimistic estimate. A
  // consumer working from the shipped number alone would have called this yes.
  const gapSeconds = leg.gapMinutes * 60;
  if (!(gapSeconds > leg.walk.optimisticSeconds)) return 'this gap does not fit even the optimistic estimate, so it is not the tight case';
  if (!(gapSeconds < leg.walk.realisticSeconds)) return 'this gap clears the realistic estimate, so it is not the tight case';
  return /tight/i.test(leg.say) ? true : 'the wording does not tell the student to leave early';
});

check('a gap shorter than the OPTIMISTIC estimate is a plain no', () => {
  const { json } = feasibility(['--schedule', FX08, '--day', 'wednesday']);
  const leg = json.legs[0];
  if (leg.verdict !== 'no') return `verdict was ${leg.verdict}`;
  return leg.reason === 'shorter-than-optimistic' ? true : `reason was ${leg.reason}`;
});

check('an online first class refuses rather than guessing an origin', () => {
  const { json } = feasibility(['--schedule', FX08, '--day', 'friday']);
  const leg = json.legs[0];
  return leg.verdict === 'refuse' && leg.reason === 'unknown-origin' ? true : `${leg.verdict}/${leg.reason}`;
});

check('every answered leg reports a RANGE, never a point', () => {
  const { json } = feasibility(['--schedule', FX08]);
  for (const leg of json.legs) {
    if (!leg.walk) continue;
    if (!(leg.walk.realisticSeconds > leg.walk.optimisticSeconds)) return `${leg.earlier}: the two ends collapsed to one number`;
    if (leg.walk.marginSeconds <= 0) return `${leg.earlier}: no margin was applied`;
  }
  return true;
});

check('an unresolvable partOfTerm is CANNOT TELL with a conditional, not a verdict', () => {
  const { json } = feasibility(['--schedule', FX05]);
  const undecidable = json.legs.filter((l) => l.verdict === 'cannot-determine');
  if (!undecidable.length) return 'the half-term pair was decided rather than reported as undecidable';
  const one = undecidable[0];
  if (!one.conditionalVerdict) return 'no conditional answer was offered; the student gets nothing usable';
  return /not the same as saying/i.test(one.say) ? true : 'the answer does not distinguish "cannot tell" from a verdict';
});

check('requiresAccessibleRoutes refuses EVERY leg, including a same-building one', () => {
  // DATA-GAPS.md section 9: there is no accessibility data anywhere in this
  // dataset, so the default route must never be returned as though it answered.
  const doc = readJson(FX08);
  doc.preferences = { requiresAccessibleRoutes: true };
  const file = path.join(os.tmpdir(), `fsu-a11y-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(doc));
  try {
    const { json } = feasibility(['--schedule', file]);
    const wrong = json.legs.filter((l) => l.reason !== 'accessible-routes-unsupported');
    return wrong.length ? `${wrong.length} leg(s) answered anyway: ${wrong.map((l) => l.verdict).join(', ')}` : true;
  } finally { fs.rmSync(file, { force: true }); }
});

check('a TBA location refuses rather than routing to the building', () => {
  const doc = readJson(FX08);
  const target = doc.meetings.find((m) => m.id === 'psy3213-lecture-mo');
  delete target.location;
  target.locationTba = true;
  const file = path.join(os.tmpdir(), `fsu-tba-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(doc));
  try {
    const { json } = feasibility(['--schedule', file, '--day', 'monday']);
    return json.legs[0].reason === 'location-tba' ? true : `${json.legs[0].verdict}/${json.legs[0].reason}`;
  } finally { fs.rmSync(file, { force: true }); }
});

check('a faster pace changes the estimate but never removes the margin', () => {
  const slow = evaluateLeg({ from: endpointOf({ deliveryMode: 'in-person', location: { buildingCode: 'BEL' } }), to: endpointOf({ deliveryMode: 'in-person', location: { buildingCode: 'KRB' } }), gapMinutes: 10, paceMetersPerSecond: 1.4 });
  const fast = evaluateLeg({ from: endpointOf({ deliveryMode: 'in-person', location: { buildingCode: 'BEL' } }), to: endpointOf({ deliveryMode: 'in-person', location: { buildingCode: 'KRB' } }), gapMinutes: 10, paceMetersPerSecond: 1.9 });
  if (!(fast.walk.optimisticSeconds < slow.walk.optimisticSeconds)) return 'a faster pace did not shorten the walk';
  if (fast.walk.realisticSeconds - fast.walk.optimisticSeconds < SAFETY_MARGIN.fixedSeconds) return 'the fixed margin was scaled away by the pace';
  return true;
});

check('legsForDay skips an asynchronous course rather than placing it', () => {
  const meetings = [
    { courseCode: 'A', daysOfWeek: ['monday'], startTime: '09:00', endTime: '09:50' },
    { courseCode: 'B', deliveryMode: 'online-asynchronous' },
    { courseCode: 'C', daysOfWeek: ['monday'], startTime: '10:00', endTime: '10:50' }
  ];
  const legs = legsForDay(meetings, 'monday');
  return legs.length === 1 && legs[0].gapMinutes === 10 ? true : `got ${legs.length} leg(s)`;
});

check('the ad-hoc route between two shipped buildings is symmetric', () => {
  const a = route('HCB', 'PDB');
  const b = route('PDB', 'HCB');
  return eq(a.optimisticSeconds, b.optimisticSeconds, 'HCB<->PDB');
});

/* ================================================================== *
 * 7. PARKING -- the blackout gate, and the coverage it must confess to
 * ================================================================== */
console.log('\nPARKING: refusals come first, and every answer confesses its coverage');

const PARK = path.join(SCRIPTS, 'where-to-park.mjs');
const park = (args) => {
  const r = run(PARK, [...args, '--json']);
  return { ...r, json: JSON.parse(r.stdout) };
};
const CAL = readJson(path.join(REPO, 'plugins', 'fsu-schedule', 'data', 'term-calendar.json'))
  .find((t) => t.termCode === '2026-fall');

// Driven off the DATA, not off a list written here: adding a blackout date to the
// calendar cannot be forgotten by this test.
for (const b of CAL.parkingBlackouts) {
  check(`${b.date} (${dayOfWeek(b.date)}) REFUSES -- ${b.name.replace(/ \(home.*$/, '')}`, () => {
    const r = park(['--building', 'HCB', '--date', b.date, '--time', '09:00']);
    if (r.status !== 3) return `exited ${r.status}; a blackout date must exit 3, not answer`;
    if (r.json.status !== 'refused') return `status was ${r.json.status}`;
    if (r.json.kind !== 'blackout') return `kind was ${r.json.kind}`;
    if (!/GameDay/.test(r.json.sendTo || '')) return 'the refusal does not send the student anywhere';
    return true;
  });
}

check('the two blackout dates that are NOT Saturdays still refuse', () => {
  // Treating game days as a weekend concern would miss the Labor Day Monday and
  // the Friday after Thanksgiving.
  const odd = CAL.parkingBlackouts.filter((b) => dayOfWeek(b.date) !== 'saturday').map((b) => b.date);
  if (odd.length !== 2) return `expected 2 non-Saturday blackouts, found ${odd.length}: ${odd.join(', ')}`;
  for (const date of odd) {
    if (park(['--building', 'HCB', '--date', date]).status !== 3) return `${date} (${dayOfWeek(date)}) answered instead of refusing`;
  }
  return true;
});

/* The day before a game, found by asking nextDate which day it precedes rather
 * than by doing date arithmetic a second way. The chosen game is the SMU Monday,
 * so the eve is a Sunday inside the term -- a date the shipped rules would
 * otherwise happily call open. */
const SMU_GAME = '2026-09-07';
const GAME_EVE = CAL.parkingBlackouts.length
  ? ['2026-09-06'].find((d) => nextDate(d) === SMU_GAME)
  : null;

check(`the evening before a game refuses from ${BLACKOUT_EVE_FROM}`, () => {
  if (!GAME_EVE) return 'the fixture date no longer precedes a blackout';
  const late = park(['--building', 'HCB', '--date', GAME_EVE, '--time', '18:00']);
  if (late.status !== 3) return `18:00 the night before exited ${late.status} instead of refusing`;
  return late.json.kind === 'blackout-eve' ? true : `kind was ${late.json.kind}`;
});

check('the MORNING before a game is still answerable', () => {
  // The eve refusal is about a car left overnight. Refusing the whole preceding
  // day would be over-reach, and a refusal that fires too often stops being read.
  const early = park(['--building', 'HCB', '--date', GAME_EVE, '--time', '09:00']);
  return early.status === 0 ? true : `09:00 the day before refused (${early.json.kind})`;
});

check('a date with no shipped calendar REFUSES rather than assuming it is clear', () => {
  const r = park(['--building', 'HCB', '--date', '2027-03-01']);
  if (r.status !== 3) return `exited ${r.status}; an unknown date must not be treated as a normal day`;
  return r.json.kind === 'no-calendar' ? true : `kind was ${r.json.kind}`;
});

check('a building outside the shipped data REFUSES', () => {
  const r = park(['--building', 'WCB', '--date', '2026-09-03']);
  return r.status === 3 && r.json.kind === 'building-not-in-data' ? true : `${r.status}/${r.json.kind}`;
});

check('an ordinary weekday answers, and exits 0', () => {
  const r = park(['--building', 'HCB', '--date', '2026-09-03', '--time', '09:00']);
  if (r.status !== 0) return `exited ${r.status}`;
  return r.json.zones.length === 6 ? true : `${r.json.zones.length} zones, expected all 6 garages`;
});

check('EVERY zone in an answer carries its matched rule and enforcementNote', () => {
  const { json } = park(['--building', 'HCB', '--date', '2026-09-03', '--time', '09:00']);
  for (const z of json.zones) {
    if (!z.rule) return `${z.id} matched no rule; the catch-all base rule is supposed to make that impossible`;
    if (!z.rule.enforcementNote) return `${z.id} carries no enforcementNote, so the answer loses the part that matters`;
  }
  return true;
});

check('the answer says out loud that surface lots are not covered', () => {
  const text = run(PARK, ['--building', 'HCB', '--date', '2026-09-03']).stdout;
  if (!/surface lot/i.test(text)) return 'no mention of surface lots anywhere in the answer';
  const { json } = park(['--building', 'HCB', '--date', '2026-09-03']);
  return json.coverage?.zonesShipped === 6 ? true : 'the JSON answer carries no coverage caveat';
});

check('the source conflict about student hours is passed through unresolved', () => {
  const { json } = park(['--building', 'HCB', '--date', '2026-09-03', '--time', '09:00']);
  const note = json.zones[0].rule.enforcementNote;
  if (!/unless denoted by signage/i.test(note)) return 'the signage clause was lost';
  return /SOURCE CONFLICT/.test(note) ? true : 'the disagreement between FSU pages was not carried through';
});

check('permits narrow eligibility; no permits leaves it unanswered', () => {
  const none = park(['--building', 'HCB', '--date', '2026-09-03', '--time', '09:00']).json;
  const some = park(['--building', 'HCB', '--date', '2026-09-03', '--time', '09:00', '--permits', 'student-commuter']).json;
  if (none.zones[0].eligible !== null) return 'eligibility was decided without knowing the permits';
  return some.zones[0].eligible === true ? true : 'a student-commuter permit was not matched against the weekday garage rule';
});

check('blackoutCheck is a function of the DATA, not of a hard-coded date list', () => {
  for (const b of CAL.parkingBlackouts) {
    if (blackoutCheck(b.date, '09:00').status !== 'blackout') return `${b.date} did not trip the check`;
  }
  return blackoutCheck('2026-09-03', '09:00').status === 'clear' ? true : 'an ordinary weekday tripped the blackout check';
});

/* The wrapping case of the timeWindow evaluation rule. common.defs warns that an
 * implementation filtering by weekday before comparing times drops the
 * after-midnight half; this is the assertion that ours does not. */
check('windowMatches handles a window that wraps past midnight', () => {
  const win = { daysOfWeek: ['friday'], startTime: '17:00', endTime: '02:00' };
  const cases = [
    ['friday', '18:00', true],
    ['friday', '01:00', false],   // Friday's small hours belong to Thursday's window
    ['saturday', '01:00', true],  // the after-midnight half
    ['saturday', '03:00', false]
  ];
  for (const [day, time, want] of cases) {
    if (windowMatches(win, day, time) !== want) return `${day} ${time} should be ${want}`;
  }
  return true;
});

check('ruleAt is last-match-wins across the shipped garage rules', () => {
  const zone = readJson(path.join(REPO, 'plugins', 'fsu-schedule', 'data', 'parking-zones.json'))[0];
  const cases = [
    ['2026-09-03', '09:00', 'student-garage-hours'],   // a Thursday inside student hours
    ['2026-09-03', '03:00', 'base-permit-required'],   // before them: the restrictive catch-all
    ['2026-09-04', '23:00', 'friday-evening-open'],    // Friday after 22:00
    ['2026-09-05', '12:00', 'weekend-open']            // Saturday (not a blackout date)
  ];
  for (const [date, time, want] of cases) {
    const got = ruleAt(zone, date, time)?.id;
    if (got !== want) return `${date} ${time} matched ${got}, expected ${want}`;
  }
  return true;
});

/* ================================================================== *
 * 8. PACK -- testing the shipped copy rather than the working tree
 *
 * A directory-source marketplace points at whatever directory you name, so
 * installing this repository points the "installed" plugin at the working tree
 * and a test tells you nothing about the shipped copy. tools/pack-plugin.mjs
 * freezes it into dist/marketplace/ instead. These checks are what stop the
 * frozen copy silently diverging from the source.
 * ================================================================== */
console.log('\nPACK: the frozen copy is complete, identical, and runnable');

const packOut = run(path.join(REPO, 'tools', 'pack-plugin.mjs'), ['--json']);
check('pack-plugin.mjs runs', () => (packOut.status === 0 ? true : `exited ${packOut.status}: ${packOut.stderr}`));

const packInfo = packOut.status === 0 ? JSON.parse(packOut.stdout) : null;
const PACKED = path.join(REPO, 'dist', 'marketplace');

check('the pack is a self-contained marketplace', () => {
  for (const rel of ['.claude-plugin/marketplace.json', 'plugins/fsu-schedule/.claude-plugin/plugin.json']) {
    if (!fs.existsSync(path.join(PACKED, rel))) return `missing ${rel}`;
  }
  return true;
});

check('every packed file is byte-identical to its source', () => {
  for (const f of packInfo.files) {
    const src = fs.readFileSync(path.join(REPO, f.path));
    const dst = fs.readFileSync(path.join(PACKED, f.path.replace(/^plugins\//, 'plugins/')));
    if (!src.equals(dst)) return `${f.path} differs between the working tree and the pack`;
    if (crypto.createHash('sha256').update(src).digest('hex') !== f.sha256) return `${f.path} has the wrong recorded hash`;
  }
  return true;
});

check('the pack carries no file the working tree does not have', () => {
  const listed = new Set(packInfo.files.map((f) => f.path));
  const found = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, r); else found.push(r);
    }
  };
  walk(path.join(PACKED, 'plugins', 'fsu-schedule'), 'plugins/fsu-schedule');
  const extra = found.filter((f) => !listed.has(f));
  return extra.length ? `the pack contains files not from the source: ${extra.join(', ')}` : true;
});

check('the stamp is written OUTSIDE the marketplace, so it never ships', () => {
  if (!fs.existsSync(path.join(REPO, 'dist', 'PACK-INFO.json'))) return 'no stamp was written';
  return fs.existsSync(path.join(PACKED, 'PACK-INFO.json')) ? 'the stamp leaked into the packed marketplace' : true;
});

check('a script runs from the frozen copy, resolving its own data', () => {
  const r = run(path.join(PACKED, 'plugins', 'fsu-schedule', 'scripts', 'can-i-make-it.mjs'), ['--from', 'HCB', '--to', 'BEL', '--gap', '15', '--json']);
  if (r.status !== 0) return `exited ${r.status}: ${r.stderr}`;
  return JSON.parse(r.stdout).legs[0].verdict === 'comfortable' ? true : 'the packed copy gave a different answer from the working tree';
});

check('the pack stamp records the plugin version and whether the tree was dirty', () =>
  (typeof packInfo.pluginVersion === 'string' && typeof packInfo.gitDirty === 'boolean' && packInfo.treeHash.length === 64)
    ? true
    : 'the stamp cannot be used to tell which copy is installed');

/* ================================================================== */
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\nFailures:\n');
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
