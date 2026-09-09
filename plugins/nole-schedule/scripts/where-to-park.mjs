#!/usr/bin/env node
/**
 * Where to park for a class in a given building, at a given date and time.
 *
 *   node where-to-park.mjs --building HCB --date 2026-09-03 --time 09:00
 *   node where-to-park.mjs --building HCB --date 2026-08-29            # a blackout: refuses
 *   node where-to-park.mjs --building HCB --permits student-commuter --json
 *   node where-to-park.mjs --data-dir <dir> --course ISM3541 --date 2026-09-03
 *
 * Exit codes:
 *   0  an answer was produced
 *   2  the script could not run (bad arguments, unreadable schedule)
 *   3  REFUSED by design -- a blackout date, the evening before one, a date with no
 *      shipped calendar behind it, or a building that is not in the shipped data.
 *      A distinct code, because a refusal is a correct answer and must never be
 *      mistaken for a successful one by anything that only checks for zero.
 *
 * THE SAFETY BEHAVIOUR IS IN THIS SCRIPT, NOT IN PROSE. The blackout check runs
 * before any rule is read and exits the process; there is no code path from a
 * blackout date to a parking recommendation. Every zone printed carries its
 * matched rule's enforcementNote, because the note is a field of the rule and the
 * formatter prints it unconditionally. The coverage caveat is appended to every
 * answer, including the JSON one.
 */
import { readSchedule, dataRoot } from './lib/store.mjs';
import { building, buildings, currentTerm } from './lib/campus.mjs';
import { blackoutCheck, rankZonesFor, dayOfWeek, COVERAGE_CAVEAT, BLACKOUT_EVE_FROM } from './lib/parking.mjs';
import { SAFETY_MARGIN } from './lib/routing.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const asJson = has('--json');

const die = (msg) => { console.error(msg); process.exit(2); };

const date = val('--date') || new Date().toISOString().slice(0, 10);
const time = val('--time') || '09:00';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
if (!/^\d{2}:\d{2}$/.test(time)) die(`--time must be HH:MM, got ${JSON.stringify(time)}`);

const permits = (val('--permits') || '').split(',').map((s) => s.trim()).filter(Boolean);

/* ------------------------------------------------------------------ *
 * REFUSAL 1 and 2 and 3: the date itself.
 *
 * This runs before the building is even looked up, and it exits. Nothing below
 * can be reached on a blackout date, which is the point -- the schema requires
 * this check of every consumer, and a check that is merely documented is a check
 * that gets skipped.
 * ------------------------------------------------------------------ */
const gate = blackoutCheck(date, time);
if (gate.status !== 'clear') {
  refuse({
    kind: gate.status,
    date,
    time,
    why: gate.why,
    sendTo: gate.sendTo,
    /* Carried through rather than dropped: "no calendar" and "this copy of the
     * plugin has expired" are the same refusal but not the same remedy, and the
     * second one has a maintainer fix behind it. */
    staleCalendar: gate.staleCalendar ?? false,
    alsoSee: gate.alsoSee ?? null,
    detail: gate.blackout?.note ?? null
  });
}

/* ------------------------------------------------------------------ *
 * Which building.
 * ------------------------------------------------------------------ */
let code = (val('--building') || '').toUpperCase();
let forClass = null;

if (!code && has('--course')) {
  let root;
  try { root = dataRoot(val('--data-dir')); } catch (err) { die(err.message); }
  const term = val('--term') || currentTerm().termCode;
  let doc;
  try { doc = readSchedule(root, term); } catch (err) { die(err.message); }
  if (!doc) die(`No schedule stored for ${term}. Import one first with the import-schedule skill.`);
  const wanted = val('--course').toUpperCase();
  const m = (doc.meetings || []).find((x) => x.courseCode === wanted);
  if (!m) die(`${wanted} is not in the stored ${term} schedule.`);
  if (m.locationTba === true) {
    refuse({
      kind: 'location-tba',
      why: `${wanted} meets in person but FSU has not announced where, so there is no building to park near.`,
      sendTo: null
    });
  }
  if (!m.location?.buildingCode) {
    refuse({
      kind: 'no-location',
      why: `${wanted} has no physical location recorded, so there is nothing to park near.`,
      sendTo: null
    });
  }
  code = m.location.buildingCode;
  forClass = { courseCode: wanted, room: m.location.room ?? null, startTime: m.startTime ?? null };
}

if (!code) die('Usage: where-to-park.mjs --building <CODE> [--date YYYY-MM-DD] [--time HH:MM]  (or --course <CODE> --data-dir <dir>)');

/* ------------------------------------------------------------------ *
 * REFUSAL 4: a building that is not in the shipped data.
 *
 * Never answer about a building this plugin does not ship. There is no
 * coordinate for it, so no garage can be ranked against it, and the curated
 * servesBuildings lists do not mention it either. A recommendation here would be
 * about a building the data has never heard of.
 * ------------------------------------------------------------------ */
const target = building(code);
if (!target) {
  refuse({
    kind: 'building-not-in-data',
    building: code,
    why: `${code} is not one of the ${buildings().length} buildings that ship with this plugin, so there is no coordinate ` +
      'for it and no garage can be ranked against it. Naming a garage anyway would be a guess about ' +
      'a building this data has never seen. See DATA-GAPS.md section 4.',
    sendTo: 'https://transportation.fsu.edu/parking'
  });
}

/* ------------------------------------------------------------------ *
 * The answer.
 * ------------------------------------------------------------------ */
const zones = rankZonesFor(target, date, time, { permits });
const anyCurated = zones.some((z) => z.curated);

const payload = {
  status: 'answered',
  date,
  time,
  dayOfWeek: dayOfWeek(date),
  termCode: gate.termCode,
  building: { code: target.code, name: target.name },
  forClass,
  permitsConsidered: permits,
  curatedForThisBuilding: anyCurated,
  zones,
  safetyMargin: SAFETY_MARGIN,
  coverage: COVERAGE_CAVEAT,
  blackoutCheck: { status: 'clear', checkedAgainst: gate.termCode, eveThreshold: BLACKOUT_EVE_FROM }
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const out = [];
out.push(`PARKING FOR ${target.code} (${target.name}) -- ${date} ${time}, a ${payload.dayOfWeek}`);
out.push(`  Blackout check: clear against the ${gate.termCode} calendar.`);
out.push('');

out.push('WHAT THIS DATA COVERS, AND WHAT IT DOES NOT');
out.push(`  ${COVERAGE_CAVEAT.say}`);
for (const m of COVERAGE_CAVEAT.missing) out.push(`    not in the data: ${m}`);
out.push('');

/* Every garage's enforcementNote is surfaced -- but all six garages carry the
 * same rule text, so printing it six times buries it instead of surfacing it.
 * Distinct notes are numbered here and printed in full below, and every garage
 * carries its number. Nothing is dropped; the same note is just said once. */
const noteIds = new Map();
const noteFor = (text) => {
  if (!text) return null;
  if (!noteIds.has(text)) noteIds.set(text, noteIds.size + 1);
  return noteIds.get(text);
};

out.push('GARAGES');
for (const z of zones) {
  const mark = z.curated ? 'listed for this building' : 'nearest by geometry only, NOT listed for this building';
  out.push(`  ${z.name}  [${mark}]`);
  out.push(`    walk to ${target.code}: ${z.walk.range}   (${z.walk.basis})`);
  if (!z.rule) {
    out.push('    NO RULE MATCHED. The schema makes this unrepresentable, so treat it as a data defect and do not park on it.');
    out.push('');
    continue;
  }
  const eligibility = z.eligible === null
    ? 'you have not said which permits you hold, so eligibility is unanswered'
    : z.eligible ? 'your permits are on the allowed list for this window' : 'your permits are NOT on the allowed list for this window';
  out.push(`    at ${time} on a ${payload.dayOfWeek}: ${z.rule.mode}` +
    (z.rule.allows.length ? ` (${z.rule.allows.join(', ')})` : '') + ` [rule: ${z.rule.id}]`);
  out.push(`    ${eligibility}`);
  const n = noteFor(z.rule.enforcementNote);
  out.push(n ? `    ENFORCEMENT: see note ${n} below -- it is part of the rule, not a disclaimer` : '    ENFORCEMENT: no enforcement note on this rule');
  out.push('');
}

out.push(`ENFORCEMENT NOTES (${noteIds.size}) -- repeat these to the student, they are the answer`);
for (const [text, n] of noteIds) out.push(`  ${n}. ${text}`, '');

out.push('ALWAYS SAY THIS');
out.push('  Six garages and nothing else are in this data -- no surface lots at all, so this is not');
out.push('  a list of where you could park, only of the garages. FSU\'s own pages disagree about');
out.push('  student white-space hours, and a posted sign at the space overrides everything here.');

console.log(out.join('\n'));
process.exit(0);

/* ------------------------------------------------------------------ *
 * Refusals share one exit, so every one of them is shaped the same and none can
 * accidentally fall through into an answer.
 * ------------------------------------------------------------------ */
function refuse(info) {
  const body = {
    status: 'refused',
    ...info,
    coverage: COVERAGE_CAVEAT,
    note: 'A refusal is the correct answer here, not a failure. Do not soften it into a hedged recommendation.'
  };
  if (asJson) {
    console.log(JSON.stringify(body, null, 2));
    process.exit(3);
  }
  const lines = [`REFUSING TO ANSWER -- ${info.kind}`, ''];
  lines.push(`  ${info.why}`);
  if (info.detail) lines.push('', `  FSU's own wording: ${info.detail}`);
  if (info.sendTo) lines.push('', `  Send the student to: ${info.sendTo}`);
  lines.push('', '  This is the correct answer, not a failure. Do not soften it into a hedged');
  lines.push('  recommendation -- a hedged wrong answer gets the car towed just as thoroughly');
  lines.push('  as a confident one.');
  console.log(lines.join('\n'));
  process.exit(3);
}
