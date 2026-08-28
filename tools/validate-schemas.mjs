#!/usr/bin/env node
/**
 * The schema suite: every example must validate, and every deliberately-malformed
 * document must be REJECTED.
 *
 *   npm run validate:schemas
 *
 * The rejection half is the half that matters. A schema that accepts everything
 * passes a positive-only suite perfectly, so each case below names one specific
 * bad document these schemas exist to stop -- an asynchronous class carrying a
 * room number, a permit-required window with no permit list, a swapped
 * latitude/longitude pair. If a rejection case ever starts passing, a constraint
 * has been lost.
 *
 * Cases marked SEMANTIC are not expressible in JSON Schema at all (they compare
 * two sibling values) and are checked by tools/lib/semantic.mjs instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_DIR, buildAjv, compileFor, formatErrors, readJson } from './lib/ajv-env.mjs';
import { checkTimeWindows } from './lib/semantic.mjs';

const EXAMPLE_DIR = path.join(SCHEMA_DIR, 'examples');
const clone = (o) => structuredClone(o);

const EXAMPLES = {
  'building.example.json': 'building.schema.json',
  'walk-edge.example.json': 'walk-edge.schema.json',
  'parking-zone.example.json': 'parking-zone.schema.json',
  'course-meeting.example.json': 'course-meeting.schema.json',
  'term-calendar.example.json': 'term-calendar.schema.json',
  'student-schedule.example.json': 'student-schedule.schema.json'
};

const { ajv, schemaFiles } = buildAjv();
const ex = (f) => readJson(path.join(EXAMPLE_DIR, f));

let passed = 0;
const failures = [];

function ok(msg) {
  passed += 1;
  console.log(`  ok   ${msg}`);
}
function bad(msg, detail) {
  failures.push(detail ? `${msg}\n${detail}` : msg);
  console.log(`  FAIL ${msg}`);
}

/* ------------------------------------------------------------------ *
 * 1. Every schema compiles, and the examples validate.
 * ------------------------------------------------------------------ */
console.log(`\nCompiling ${schemaFiles.length} schemas`);
for (const f of schemaFiles) {
  try {
    const v = compileFor(ajv, f);
    if (!v) throw new Error('schema not registered under its $id');
    ok(`compiles: ${f}`);
  } catch (err) {
    bad(`compiles: ${f}`, '    ' + err.message);
  }
}

console.log('\nExamples must VALIDATE');
for (const [exampleFile, schemaFile] of Object.entries(EXAMPLES)) {
  const validate = compileFor(ajv, schemaFile);
  const doc = ex(exampleFile);
  if (validate(doc)) {
    const semantic = checkTimeWindows(doc, exampleFile);
    if (semantic.length) bad(`${exampleFile}`, semantic.map((s) => '    ' + s).join('\n'));
    else ok(`${exampleFile} against ${schemaFile}`);
  } else {
    bad(`${exampleFile} against ${schemaFile}`, formatErrors(validate.errors));
  }
}

/* ------------------------------------------------------------------ *
 * 2. Part A regression cases: things that must now be ACCEPTED.
 * ------------------------------------------------------------------ */
console.log('\nPart A: newly-permitted shapes must VALIDATE');

const acceptCases = [
  {
    name: 'courseCode with a two-letter suffix is accepted (fix 1)',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.courseCode = 'ISC4241C';
      d.canonicalNumbering = false;
      return d;
    }
  },
  {
    name: 'lowercase repeatable "r" suffix still accepted (fix 1)',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.courseCode = 'MUS1010r';
      d.canonicalNumbering = true;
      return d;
    }
  },
  {
    name: 'a window wrapping past midnight is accepted (fix 3)',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules.push({
        id: 'overnight-wrap',
        window: {
          daysOfWeek: ['friday'],
          startTime: '17:00',
          endTime: '02:00'
        },
        mode: 'open-to-all',
        enforcementNote: 'Friday evening into Saturday morning as ONE rule. Before the wrapping change this needed two.'
      });
      return d;
    }
  },
  {
    name: 'STEP 3: in-person class whose room is TBA (building known, room not)',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      delete d.location.room;
      delete d.location.floor;
      d.location.buildingCodeRaw = 'HCB TBA';
      return d; // an FSU schedule prints TBA in this column often enough to matter
    }
  },
  {
    name: 'STEP 3: in-person class whose location is wholly unknown, declared as such',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      delete d.location;
      d.locationTba = true;
      return d;
    }
  },
  {
    name: 'STEP 3: term whose sessions are unpublished says so',
    schema: 'term-calendar.schema.json',
    build: () => {
      const d = ex('term-calendar.example.json');
      d.sessions = [];
      d.sessionsStatus = 'not-published';
      return d;
    }
  }
];

for (const c of acceptCases) {
  const validate = compileFor(ajv, c.schema);
  const doc = c.build();
  if (validate(doc)) ok(c.name);
  else bad(c.name, formatErrors(validate.errors));
}

/* ------------------------------------------------------------------ *
 * 3. Malformed documents that must be REJECTED.
 * ------------------------------------------------------------------ */
console.log('\nMalformed documents must be REJECTED');

const rejectCases = [
  {
    name: 'asynchronous class carrying a room',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.deliveryMode = 'online-asynchronous';
      delete d.daysOfWeek;
      delete d.startTime;
      delete d.endTime;
      return d; // location left non-null: the classic "WEB" import bug
    }
  },
  {
    name: 'asynchronous class carrying meeting days',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.deliveryMode = 'online-asynchronous';
      d.location = null;
      return d; // daysOfWeek/startTime/endTime still present
    }
  },
  {
    name: 'in-person class with a null location',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.location = null;
      return d;
    }
  },
  {
    name: 'biweekly meeting with no anchorDate',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.recurrence = { frequency: 'biweekly' };
      return d;
    }
  },
  {
    name: 'unknown property on a course meeting',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.professorEmail = 'someone@fsu.edu';
      return d;
    }
  },
  {
    name: 'course code that is not remotely a course code',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.courseCode = 'ENC 1101';
      return d;
    }
  },
  {
    name: 'building with an empty entrances array',
    schema: 'building.schema.json',
    build: () => {
      const d = ex('building.example.json');
      d.entrances = [];
      return d;
    }
  },
  {
    name: 'building with a swapped latitude/longitude pair',
    schema: 'building.schema.json',
    build: () => {
      const d = ex('building.example.json');
      d.centroid = { lat: -84.2986, lon: 30.4423 };
      return d;
    }
  },
  {
    name: 'building record with no provenance',
    schema: 'building.schema.json',
    build: () => {
      const d = ex('building.example.json');
      delete d.provenance;
      return d;
    }
  },
  {
    name: 'provenance claiming "fetched" with no sourceUrl',
    schema: 'building.schema.json',
    build: () => {
      const d = ex('building.example.json');
      d.provenance = { retrievedOn: '2026-08-27', method: 'fetched', confidence: 'high' };
      return d;
    }
  },
  {
    name: 'permit-required window with no permit list',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      const r = d.rules.find((x) => x.mode === 'permit-required') ?? d.rules[1];
      r.mode = 'permit-required';
      delete r.allows;
      return d;
    }
  },
  {
    name: 'NEW: rules[0] is not a catch-all (weekdays only)',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules[0].window.daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      return d;
    }
  },
  {
    name: 'NEW: rules[0] is not a catch-all (does not start at 00:00)',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules[0].window.startTime = '07:30';
      return d;
    }
  },
  {
    name: 'NEW: rules[0] is date-bounded, so some instants are undefined',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules[0].effectiveFrom = '2026-08-24';
      return d;
    }
  },
  {
    name: 'NEW: empty rules array',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules = [];
      return d;
    }
  },
  {
    name: 'retired priority field is no longer accepted',
    schema: 'parking-zone.schema.json',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules[0].priority = 0;
      return d;
    }
  },
  {
    name: 'walk edge referencing an unknown node kind',
    schema: 'walk-edge.schema.json',
    build: () => {
      const d = ex('walk-edge.example.json');
      d.from = { kind: 'bus-stop', stop: 'union' };
      return d;
    }
  },
  {
    name: 'naive local datetime in a timestamp field',
    schema: 'walk-edge.schema.json',
    build: () => {
      const d = ex('walk-edge.example.json');
      d.source.retrievedAt = '2026-08-27T10:00:00';
      return d;
    }
  },
  {
    name: 'term calendar deadline with an unknown type',
    schema: 'term-calendar.schema.json',
    build: () => {
      const d = ex('term-calendar.example.json');
      d.deadlines[0].type = 'last-day-to-vibe';
      return d;
    }
  },
  {
    name: 'malformed term code',
    schema: 'student-schedule.schema.json',
    build: () => {
      const d = ex('student-schedule.example.json');
      d.termCode = 'FA26';
      return d;
    }
  },
  {
    name: 'entrance point outside the Florida bounding box',
    schema: 'building.schema.json',
    build: () => {
      const d = ex('building.example.json');
      d.entrances[0].point = { lat: 40.7128, lon: -74.006 };
      return d;
    }
  },
  {
    name: 'STEP 3: in-person class with no location and no admission that it is missing',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      delete d.location;
      return d; // silently roomless is the case locationTba exists to force open
    }
  },
  {
    name: 'STEP 3: online class smuggling a room back in via locationTba',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.deliveryMode = 'online-synchronous';
      d.location = null;
      d.locationTba = true;
      return d; // online is not "room pending"; that blur is how TBA becomes a building
    }
  },
  {
    name: 'STEP 3: locationTba true alongside a real location',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.locationTba = true;
      return d; // location object left in place: contradictory
    }
  },
  {
    name: 'STEP 3: location with neither a building nor a room',
    schema: 'course-meeting.schema.json',
    build: () => {
      const d = ex('course-meeting.example.json');
      d.location = { buildingCodeRaw: 'TBA' };
      return d; // room may be dropped; buildingCode may not
    }
  },
  // NOTE: "room recorded as the literal string TBA" is deliberately NOT a case here.
  // "TBA" is a syntactically valid room string and no pattern separates it from a real
  // room without banning real ones, so the constraint lives in the import skill and is
  // asserted by its own tests instead.
  {
    name: 'STEP 3: term claiming published sessions while listing none',
    schema: 'term-calendar.schema.json',
    build: () => {
      const d = ex('term-calendar.example.json');
      d.sessions = [];
      d.sessionsStatus = 'published';
      return d;
    }
  },
  {
    name: 'STEP 3: term listing sessions while claiming they are unpublished',
    schema: 'term-calendar.schema.json',
    build: () => {
      const d = ex('term-calendar.example.json');
      d.sessionsStatus = 'not-published';
      return d; // sessions array left populated
    }
  },
  {
    name: 'STEP 3: term calendar with no sessionsStatus at all',
    schema: 'term-calendar.schema.json',
    build: () => {
      const d = ex('term-calendar.example.json');
      delete d.sessionsStatus;
      return d; // silence on resolvability is the failure mode this field removes
    }
  },
  {
    name: 'STEP 3: parking blackout with a date but no reason',
    schema: 'term-calendar.schema.json',
    build: () => {
      const d = ex('term-calendar.example.json');
      d.parkingBlackouts = [{ date: '2026-10-31' }];
      return d;
    }
  }
];

for (const c of rejectCases) {
  const validate = compileFor(ajv, c.schema);
  let doc;
  try {
    doc = c.build();
  } catch (err) {
    bad(`rejects: ${c.name}`, '    could not construct case: ' + err.message);
    continue;
  }
  if (validate(doc)) {
    bad(`rejects: ${c.name}`, '    document VALIDATED but should have been rejected.');
  } else {
    ok(`rejects: ${c.name}`);
  }
}

/* ------------------------------------------------------------------ *
 * 4. Semantic rejections: not expressible in JSON Schema.
 * ------------------------------------------------------------------ */
console.log('\nSEMANTIC rejections (sibling comparisons JSON Schema cannot make)');

const semanticCases = [
  {
    name: 'time window whose end equals its start',
    build: () => {
      const d = ex('parking-zone.example.json');
      d.rules[1].window.startTime = '09:00';
      d.rules[1].window.endTime = '09:00';
      return d;
    }
  }
];

for (const c of semanticCases) {
  const doc = c.build();
  const problems = checkTimeWindows(doc, 'case');
  if (problems.length) ok(`rejects: ${c.name}`);
  else bad(`rejects: ${c.name}`, '    semantic checker raised nothing.');
}

/* ------------------------------------------------------------------ */
console.log(
  `\n${passed} check${passed === 1 ? '' : 's'} passed, ${failures.length} failed.`
);
if (failures.length) {
  console.error('\nFailures:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  process.exit(1);
}
