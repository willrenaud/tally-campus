#!/usr/bin/env node
/**
 * Validate every shipped campus data file in plugins/nole-schedule/data/ against
 * its schema, then run the cross-file checks JSON Schema cannot express.
 *
 * Exits nonzero on any failure, so it is usable as a pre-commit gate and in CI.
 *
 *   npm run validate:data
 *
 * SHAPE OF A DATA FILE. Every file in data/ is a JSON ARRAY of records, and each
 * element is validated against the schema for that file's record type. A single
 * record type per file, an array even when only one record exists today (the term
 * calendar will gain Spring 2027 without a shape change), and no wrapper object,
 * because a wrapper would have to be its own schema and would sit between every
 * consumer and the records for no gain.
 *
 * Unknown files in data/ are an ERROR rather than a shrug. A data file nothing
 * validates is a data file nothing checked, which is how a hand-edited lot list
 * with a typo'd permit class reaches a student.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  buildAjv,
  compileFor,
  formatErrors,
  readJson
} from './lib/ajv-env.mjs';
import {
  checkTimeWindows,
  checkUniqueIds,
  checkReferences,
  checkConnectivity
} from './lib/semantic.mjs';

/** filename -> { schema file, optional JSON pointer into it, id field } */
const DATA_FILES = {
  'buildings.json': { schema: 'building.schema.json', idField: 'code' },
  'walk-edges.json': { schema: 'walk-edge.schema.json', idField: 'id' },
  'waypoints.json': { schema: 'walk-edge.schema.json', pointer: '#/$defs/waypoint', idField: 'id' },
  'parking-zones.json': { schema: 'parking-zone.schema.json', idField: 'id' },
  'term-calendar.json': { schema: 'term-calendar.schema.json', idField: 'termCode' }
};

/** Files allowed to sit in data/ without being validated. */
const IGNORED = new Set(['.gitkeep', 'README.md']);

const failures = [];
const notes = [];
const loaded = {};

function fail(msg) {
  failures.push(msg);
}

const { ajv } = buildAjv();

if (!fs.existsSync(DATA_DIR)) {
  console.error(`FAIL  data directory does not exist: ${DATA_DIR}`);
  process.exit(1);
}

const present = fs.readdirSync(DATA_DIR).filter((f) => !IGNORED.has(f));

for (const f of present) {
  if (!(f in DATA_FILES)) {
    fail(
      `${f}: unknown data file. Nothing in tools/validate-data.mjs knows how to validate it, ` +
        `so it would ship unchecked. Add it to DATA_FILES or remove it.`
    );
  }
}

for (const [file, spec] of Object.entries(DATA_FILES)) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    notes.push(`SKIP  ${file} -- not present yet`);
    continue;
  }

  let doc;
  try {
    doc = readJson(full);
  } catch (err) {
    fail(`${file}: not parseable as JSON -- ${err.message}`);
    continue;
  }

  if (!Array.isArray(doc)) {
    fail(`${file}: top level must be a JSON array of records, got ${typeof doc}.`);
    continue;
  }

  const validate = compileFor(ajv, spec.schema, spec.pointer ?? '');
  if (!validate) {
    fail(`${file}: could not resolve schema ${spec.schema}${spec.pointer ?? ''}`);
    continue;
  }

  let invalid = 0;
  doc.forEach((record, i) => {
    if (!validate(record)) {
      invalid += 1;
      const label = record?.[spec.idField] ?? `index ${i}`;
      fail(`${file}[${i}] (${label}) failed ${spec.schema}:\n${formatErrors(validate.errors)}`);
    }
  });

  failures.push(...checkUniqueIds(doc, spec.idField, file));
  failures.push(...checkTimeWindows(doc, file));

  loaded[file] = doc;
  if (invalid === 0) {
    notes.push(`OK    ${file} -- ${doc.length} record${doc.length === 1 ? '' : 's'}`);
  }
}

/* ---- cross-file checks, only meaningful once the files parsed ---- */
const buildings = loaded['buildings.json'] ?? [];
const walkEdges = loaded['walk-edges.json'] ?? [];
const parkingZones = loaded['parking-zones.json'] ?? [];
const waypoints = loaded['waypoints.json'] ?? [];

failures.push(...checkReferences({ buildings, walkEdges, parkingZones, waypoints }));
failures.push(...checkConnectivity(buildings, walkEdges));

/* ---- provenance audit: the whole point of the exercise ---- */
for (const [file, doc] of Object.entries(loaded)) {
  doc.forEach((record, i) => {
    const p = record.provenance;
    if (!p) return; // the schema already failed this
    if (p.method === 'unverified') {
      fail(
        `${file}[${i}]: provenance.method is "unverified". Unsourced records belong in ` +
          `DATA-GAPS.md, not in data/.`
      );
    }
  });
}

/* ---- report ---- */
for (const n of notes) console.log(n);

if (failures.length) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'} in shipped data:\n`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}

const total = Object.values(loaded).reduce((n, d) => n + d.length, 0);
console.log(`\nData validation passed: ${total} records across ${Object.keys(loaded).length} file(s).`);
