/**
 * Access to the shipped campus data, located relative to this file so that it works
 * whether or not ${CLAUDE_PLUGIN_ROOT} happens to be exported. Node builtins only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(PLUGIN_ROOT, 'data');
export const SCHEMA_DIR = path.join(PLUGIN_ROOT, 'schemas');

const cache = new Map();
function load(file) {
  if (!cache.has(file)) cache.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return cache.get(file);
}

export const buildings = () => load(path.join(DATA_DIR, 'buildings.json'));
export const walkEdges = () => load(path.join(DATA_DIR, 'walk-edges.json'));
export const parkingZones = () => load(path.join(DATA_DIR, 'parking-zones.json'));
export const termCalendars = () => load(path.join(DATA_DIR, 'term-calendar.json'));
export const parkingSchema = () => load(path.join(SCHEMA_DIR, 'parking-zone.schema.json'));

export const termCalendar = (termCode) => termCalendars().find((t) => t.termCode === termCode) || null;

/** The shipped building record for a code, or null. Codes are uppercase. */
export const building = (code) => buildings().find((b) => b.code === String(code).toUpperCase()) || null;

/**
 * The shipped term-calendar record whose span contains a date, or null.
 *
 * Null is NOT "an ordinary day". Only Fall 2026 ships, so any date outside it has
 * no calendar behind it -- which means its parkingBlackouts cannot be checked,
 * which means a parking answer for that date cannot be given at all. The parking
 * script treats null as a refusal for exactly that reason.
 */
export const termCalendarCovering = (date) =>
  termCalendars().find((t) => t.startDate <= date && date <= t.endDate) || null;

/** Normalise an alias or a user string to the same shape, so they can be compared. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Resolve one raw building string against the shipped buildings.
 *
 * Returns one of:
 *   { status: 'resolved',  code, name, matchedOn }
 *   { status: 'ambiguous', candidates: [{code, name}, ...] }
 *   { status: 'unknown',   raw, near: [{code, name}, ...] }
 *
 * 'unknown' is an ORDINARY outcome, not an error: only 33 of FSU's 500-plus
 * buildings ship, so a code this does not recognise usually means a real building
 * that is missing from the data -- see DATA-GAPS.md section 4. The caller's job is
 * to keep the meeting and mark it location-unresolved, never to substitute a
 * different building because its name looked close.
 */
export function resolveBuilding(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { status: 'unknown', raw: String(raw), near: [] };
  const all = buildings();
  const upper = raw.trim().toUpperCase();
  const n = norm(raw);

  const byCode = all.find((b) => b.code === upper);
  if (byCode) return { status: 'resolved', code: byCode.code, name: byCode.name, matchedOn: 'code' };

  const aliasHits = all.filter((b) => (b.aliases || []).some((a) => norm(a) === n) || norm(b.name) === n);
  if (aliasHits.length === 1) {
    return { status: 'resolved', code: aliasHits[0].code, name: aliasHits[0].name, matchedOn: 'alias' };
  }
  if (aliasHits.length > 1) {
    return { status: 'ambiguous', candidates: aliasHits.map((b) => ({ code: b.code, name: b.name })) };
  }

  // Prefix matching, but only when it picks out exactly one building. "roberts"
  // resolving to two different halls must be a question, not a coin flip.
  const prefixHits = n.length >= 3
    ? all.filter((b) => (b.aliases || []).some((a) => norm(a).startsWith(n)) || norm(b.name).startsWith(n))
    : [];
  if (prefixHits.length === 1) {
    return { status: 'resolved', code: prefixHits[0].code, name: prefixHits[0].name, matchedOn: 'prefix' };
  }
  if (prefixHits.length > 1) {
    return { status: 'ambiguous', candidates: prefixHits.map((b) => ({ code: b.code, name: b.name })) };
  }

  const near = n.length >= 3
    ? all.filter((b) => norm(b.name).includes(n) || (b.aliases || []).some((a) => norm(a).includes(n)))
      .map((b) => ({ code: b.code, name: b.name }))
    : [];
  return { status: 'unknown', raw: raw.trim(), near };
}

/**
 * Which term a schedule being imported today most likely belongs to.
 *
 * WHY THIS EXISTS. Asking a student "which term is this?" is a question that
 * cannot earn its place: the answer is derivable from the date, and getting it
 * wrong is both obvious and cheap to correct, because the term is stated on the
 * face of the draft. So the importer states an assumption instead of blocking.
 *
 * The three bases are ranked by how much they should be trusted, and the caller
 * is expected to say which one it used:
 *
 *   'calendar'    today falls inside a shipped term. Solid.
 *   'next-term'   today falls between shipped terms, so the next one starting is
 *                 the guess -- a schedule is usually imported shortly BEFORE the
 *                 term it covers, never after it ends.
 *   'month'       no shipped calendar covers or follows today, so the term is
 *                 derived from the month alone. Says nothing about whether FSU
 *                 actually runs that term; it is a shape, not a fact, and the
 *                 caller must hedge accordingly.
 *
 * Deriving a termCode is not the same as inventing campus data: no dates, rooms
 * or deadlines are conjured here, only the label of the file to write.
 */
export function currentTerm(today = new Date().toISOString().slice(0, 10)) {
  const cals = termCalendars();

  const covering = cals.find((c) => c.startDate <= today && today <= c.endDate);
  if (covering) {
    return { termCode: covering.termCode, displayName: covering.displayName ?? null, basis: 'calendar' };
  }

  const upcoming = cals
    .filter((c) => c.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (upcoming) {
    return { termCode: upcoming.termCode, displayName: upcoming.displayName ?? null, basis: 'next-term' };
  }

  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  const season = month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'fall';
  return { termCode: `${year}-${season}`, displayName: null, basis: 'month' };
}

/**
 * The Registrar's calendar index. The single URL every staleness message sends a
 * student to, because a shipped calendar that has expired is not a reason to guess
 * -- it is a reason to read the real one.
 */
export const REGISTRAR_CALENDAR_URL = 'https://registrar.fsu.edu/bulletins/calendar';

/**
 * Is the shipped calendar data still usable for TODAY?
 *
 * ==================================================================
 * WHY THIS EXISTS
 * ==================================================================
 *
 * Only Fall 2026 ships. Its span ends 2026-12-11, and after that date every
 * deadline in the file is a DEAD deadline -- a real date, correctly transcribed,
 * about a term that is over. A student who asks "when is the last day to drop?"
 * in March 2027 and is told "9 October" has been given something worse than
 * silence: it is specific, it is quotable, and it is wrong.
 *
 * The trap is that nothing else catches it. termCalendar('2026-fall') still
 * returns a perfectly valid record forever, so a script that looks the term up by
 * code -- from an explicit --term, or from a schedule imported last year and never
 * deleted -- answers happily and confidently from expired data. Only a comparison
 * against TODAY can tell the difference.
 *
 * ------------------------------------------------------------------
 * THE THREE STATES, AND WHY "BEFORE" IS NOT "STALE"
 * ------------------------------------------------------------------
 *
 *   'covered'   today falls inside a shipped term. Everything answers.
 *   'upcoming'  today falls before a shipped term that has not started yet --
 *               August, or the gap between two shipped terms. The data is not out
 *               of date; the term simply has not begun, and a schedule is normally
 *               imported shortly BEFORE the term it covers. Answering is correct.
 *   'stale'     today is past the end of the LAST shipped term and no later term
 *               ships. There is no future in this file. This is the state that
 *               must stop an answer.
 *
 * Collapsing 'upcoming' into 'stale' would refuse every August import, which is
 * the single most common moment anyone uses this plugin. The distinction is
 * exactly `date > max(endDate)`, and nothing subtler.
 *
 * Note the equivalence, which is not a coincidence: state 'stale' holds precisely
 * when currentTerm() falls back to basis 'month'. Both are asking the same
 * question -- is there any shipped calendar at or after today? -- and if one is
 * ever changed the other must move with it.
 */
export function calendarStatus(today = new Date().toISOString().slice(0, 10)) {
  const cals = termCalendars();
  const shippedTerms = cals.map((t) => t.termCode);

  const covering = cals.find((c) => c.startDate <= today && today <= c.endDate);
  if (covering) {
    return {
      state: 'covered', stale: false, date: today, shippedTerms,
      termCode: covering.termCode, displayName: covering.displayName ?? null
    };
  }

  const next = cals.filter((c) => c.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (next) {
    return {
      state: 'upcoming', stale: false, date: today, shippedTerms,
      termCode: next.termCode, displayName: next.displayName ?? null, startDate: next.startDate
    };
  }

  const last = cals.slice().sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  return {
    state: 'stale',
    stale: true,
    date: today,
    shippedTerms,
    lastTerm: last ? { termCode: last.termCode, displayName: last.displayName ?? null, endDate: last.endDate } : null,
    sendTo: REGISTRAR_CALENDAR_URL,
    say: last
      ? `THE CALENDAR DATA SHIPPED WITH THIS PLUGIN IS OUT OF DATE. The last term it covers is ` +
        `${last.displayName ?? last.termCode}, which ended ${last.endDate}, and today is ${today}. ` +
        `Every deadline, holiday and exam date in this plugin belongs to a term that is over, so none of ` +
        `them applies to you. Nothing in this data can answer a question about ${today}.`
      : `THE CALENDAR DATA SHIPPED WITH THIS PLUGIN IS OUT OF DATE. No term calendar ships at all, ` +
        `so nothing here can answer a question about ${today}.`
  };
}
