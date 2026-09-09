#!/usr/bin/env node
/**
 * Resolve raw building strings against the shipped campus data.
 *
 *   node resolve-buildings.mjs "HCB 216" "WCB 1010" "Dirac"
 *   echo '["HCB","WCB"]' | node resolve-buildings.mjs -
 *   node resolve-buildings.mjs --json "HCB" "WCB"
 *
 * Always exits 0. An unrecognised building is an ORDINARY RESULT, not a failure:
 * 33 of FSU's 500-plus buildings ship, so a code this does not know usually means a
 * real building missing from the data rather than a typo. Never substitute a
 * different building because its name looked close -- report 'unknown' and let the
 * import carry on with that meeting marked location-unresolved.
 */
import fs from 'node:fs';
import { resolveBuilding } from './lib/campus.mjs';
import { splitLocation } from './lib/normalize.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
let inputs = argv.filter((a) => !a.startsWith('--'));

if (inputs.length === 1 && inputs[0] === '-') {
  const raw = fs.readFileSync(0, 'utf8').trim();
  try {
    const parsed = JSON.parse(raw);
    inputs = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    inputs = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  }
}

if (!inputs.length) {
  console.error('Usage: resolve-buildings.mjs [--json] "<location>" ...   (or - to read stdin)');
  process.exit(0);
}

const results = inputs.map((raw) => {
  const split = splitLocation(raw);
  if (!split.ok) return { raw, status: 'unparsed', reason: split.reason };
  if (split.value.kind === 'online') return { raw, status: 'online', room: null };
  if (split.value.kind === 'tba') return { raw, status: 'tba', room: null };
  return { raw, room: split.value.room, ...resolveBuilding(split.value.building) };
});

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const room = r.room ? ` room ${r.room}` : (r.status === 'resolved' ? ' (room not given)' : '');
    if (r.status === 'resolved') console.log(`ok         ${r.raw} -> ${r.code} ${r.name}${room} [matched on ${r.matchedOn}]`);
    else if (r.status === 'online') console.log(`online     ${r.raw} -> no physical location; set location null, NOT locationTba`);
    else if (r.status === 'tba') console.log(`tba        ${r.raw} -> physical but unannounced; set locationTba true`);
    else if (r.status === 'ambiguous') console.log(`ambiguous  ${r.raw} -> ${r.candidates.map((c) => `${c.code} (${c.name})`).join(' | ')}  ASK THE STUDENT`);
    else if (r.status === 'unparsed') console.log(`unparsed   ${r.raw} -> ${r.reason}  ASK THE STUDENT`);
    else console.log(`unknown    ${r.raw} -> not in the shipped data${r.near?.length ? `; nearest names: ${r.near.map((c) => c.code).join(', ')}` : ''}`);
  }
}
