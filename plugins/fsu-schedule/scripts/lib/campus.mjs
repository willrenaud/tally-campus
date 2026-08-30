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
export const termCalendars = () => load(path.join(DATA_DIR, 'term-calendar.json'));
export const parkingSchema = () => load(path.join(SCHEMA_DIR, 'parking-zone.schema.json'));

export const termCalendar = (termCode) => termCalendars().find((t) => t.termCode === termCode) || null;

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
 * 'unknown' is an ORDINARY outcome, not an error: only 32 of FSU's 500-plus
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
