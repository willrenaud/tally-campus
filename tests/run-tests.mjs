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
import { saveSchedule, readSchedule, listTerms, archiveDir, ARCHIVE_KEEP } from '../plugins/fsu-schedule/scripts/lib/store.mjs';

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
    collisions: {},
    warningCodes: ['missing-instructor', 'missing-instructor']
  },
  '02-wrapped-and-repeated-header': {
    input: 'input.txt',
    meetings: 4,
    unresolvedLocations: 0,
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

  if (exp.extra) check(`${dir}: ${dir.replace(/^\d+-/, '').replace(/-/g, ' ')}`, () => exp.extra(doc, rev));
}

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

/* ================================================================== */
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\nFailures:\n');
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
