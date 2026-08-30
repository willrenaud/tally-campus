#!/usr/bin/env node
/**
 * Validate a schedule and write it to the plugin's per-user data directory.
 *
 *   node save-schedule.mjs draft.json              # replace, archiving what was there
 *   node save-schedule.mjs draft.json --dry-run    # say what would happen, write nothing
 *   node save-schedule.mjs draft.json --force      # write even if the checksum matches
 *   node save-schedule.mjs --plan --term 2026-fall # what is stored for this term right now
 *   node save-schedule.mjs draft.json --data-dir <path>   # for tests
 *
 * Exit codes: 0 done, 1 the draft is invalid and nothing was written, 2 could not run.
 *
 * Validation runs HERE too, not only in review-schedule.mjs, because this is the
 * only door to the filesystem and a door that trusts its caller is not a door.
 */
import fs from 'node:fs';
import { validateSchedule, loadPermitClasses } from './lib/validate.mjs';
import { parkingSchema } from './lib/campus.mjs';
import { dataRoot, readSchedule, saveSchedule, summarise, ARCHIVE_KEEP } from './lib/store.mjs';

const argv = process.argv.slice(2);
const TAKES_VALUE = new Set(['--data-dir', '--term']);
const flags = new Set();
const values = new Map();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (TAKES_VALUE.has(a)) values.set(a, argv[++i]);
  else if (a.startsWith('--')) flags.add(a);
  else positional.push(a);
}
const flag = (name) => flags.has(name);
const value = (name) => values.get(name) ?? null;
const file = positional[0] ?? null;

let root;
try {
  root = dataRoot(value('--data-dir'));
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

/* --plan: report what is stored, so the skill can tell the student what it is about
 * to replace BEFORE they confirm. */
if (flag('--plan')) {
  const term = value('--term');
  if (!term) { console.error('--plan requires --term <termCode>'); process.exit(2); }
  let existing;
  try {
    existing = readSchedule(root, term);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (!existing) {
    console.log(`No schedule is stored for ${term}. An import will create one.`);
  } else {
    const s = summarise(existing);
    console.log([
      `A schedule for ${term} is ALREADY STORED and an import will REPLACE it:`,
      `  ${s.courses} course(s), ${s.meetings} meeting block(s): ${s.courseCodes.join(', ')}`,
      `  imported ${s.importedAt} from ${s.sourceFormat}, ${s.warnings} warning(s)`,
      '',
      'Replacement, not merge: if a course was dropped, merging would keep it and keep',
      'sending the student to a class they are not in. The file being replaced is copied',
      `into schedules/archive/ first, and the ${ARCHIVE_KEEP} most recent are kept.`
    ].join('\n'));
  }
  process.exit(0);
}

if (!file) {
  console.error('Usage: save-schedule.mjs <draft.json> [--dry-run] [--force] [--data-dir <path>]');
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Could not read a JSON draft: ${err.message}`);
  process.exit(2);
}

loadPermitClasses(parkingSchema());
const errors = validateSchedule(doc);
if (errors.length) {
  console.error(`REFUSING TO WRITE. The draft has ${errors.length} schema error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (flag('--dry-run')) {
  const existing = readSchedule(root, doc.termCode);
  console.log(existing
    ? `Would REPLACE ${doc.termCode} (currently ${summarise(existing).meetings} block(s)) with ${doc.meetings.length} block(s).`
    : `Would CREATE ${doc.termCode} with ${doc.meetings.length} block(s).`);
  process.exit(0);
}

let result;
try {
  result = saveSchedule(root, doc, { force: flag('--force') });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

if (result.action === 'unchanged') {
  console.log(
    `No change. The stored ${doc.termCode} schedule came from an identical source ` +
    `(same SHA-256), so nothing was rewritten and no archive copy was made.`
  );
  process.exit(0);
}

const lines = [
  result.action === 'created'
    ? `Created ${result.file}`
    : `Replaced ${result.file}`,
  `  ${doc.meetings.length} meeting block(s) for ${doc.termCode}`
];
if (result.previous) {
  lines.push(`  previous version had ${result.previous.meetings} block(s): ${result.previous.courseCodes.join(', ')}`);
}
if (result.archived) lines.push(`  previous version archived to ${result.archived}`);
if (result.pruned.length) lines.push(`  pruned ${result.pruned.length} old archive(s) beyond the most recent ${ARCHIVE_KEEP}`);
console.log(lines.join('\n'));
