#!/usr/bin/env node
/**
 * Which term an import happening today belongs to.
 *
 *   node current-term.mjs                # today, human-readable
 *   node current-term.mjs --json
 *   node current-term.mjs --date 2027-01-15
 *
 * Exists so the importer never has to ask "which term is this?". That question
 * cannot earn its place: the answer follows from the date and the shipped term
 * calendar, and a wrong guess is visible on the face of the draft and correctable
 * in one word. Stating an assumption beats blocking a student on arithmetic.
 *
 * Prints the basis alongside the code, because the three bases do not deserve
 * equal confidence -- see currentTerm() in lib/campus.mjs.
 */
import { currentTerm, calendarStatus, REGISTRAR_CALENDAR_URL } from './lib/campus.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dateFlag = args.indexOf('--date');
const date = dateFlag !== -1 ? args[dateFlag + 1] : undefined;

if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`--date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  process.exit(2);
}

const r = currentTerm(date);

/* Importing is NOT refused when the shipped calendar has expired. A student can
 * still hand over next term's schedule and have it parsed, resolved and stored --
 * none of that needs a calendar. What they must not be given is a silent
 * assumption, so the staleness travels with the term guess and the skill states it
 * on the draft. Note basis 'month' and calendarStale are the same condition seen
 * from two sides; see calendarStatus() in lib/campus.mjs. */
const cs = calendarStatus(date ?? new Date().toISOString().slice(0, 10));
const out = {
  ...r,
  calendarStale: cs.stale,
  shippedTerms: cs.shippedTerms,
  ...(cs.stale ? { staleSay: cs.say, sendTo: REGISTRAR_CALENDAR_URL } : {})
};

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const because = {
  calendar: 'today falls inside this term in the shipped calendar',
  'next-term': 'today falls between terms; this is the next one that starts',
  month: 'no shipped calendar covers or follows today, so this is derived from the month alone and is a shape rather than a fact'
}[r.basis];

console.log(`${r.termCode}${r.displayName ? `  (${r.displayName})` : ''}`);
console.log(`  basis: ${r.basis} -- ${because}`);
console.log('  State this as an assumption on the draft. Do not ask.');
if (cs.stale) {
  console.log('');
  console.log(`  CALENDAR OUT OF DATE: ${cs.say}`);
  console.log('  Importing still works -- parsing and storing a schedule needs no calendar. But say');
  console.log('  on the draft that no deadlines, holidays or conflict dates can be checked for this');
  console.log(`  term, and point at ${REGISTRAR_CALENDAR_URL}.`);
}
