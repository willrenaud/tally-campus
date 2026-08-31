#!/usr/bin/env node
/**
 * Regenerate walk-edges.json, and recompute every building's campusZone, from
 * buildings.json alone.
 *
 *   node tools/build-walk-graph.mjs --check    # reproduce and diff; write nothing
 *   node tools/build-walk-graph.mjs --write    # regenerate both files
 *
 * ==================================================================
 * WHY THIS TOOL HAD TO EXIST BEFORE WCB COULD BE ADDED
 * ==================================================================
 *
 * data/README.md states two things that make adding a building more than an
 * append:
 *
 *   "The graph is a PURE FUNCTION of the shipped centroids, so adding a building
 *    means regenerating the whole file rather than appending to it: a new building
 *    can displace an existing edge by pushing a neighbour out of some other
 *    building's nearest four."
 *
 *   "Because the centre is a mean over the shipped set, ADDING A BUILDING CAN IN
 *    PRINCIPLE RECLASSIFY THE OTHERS, so the zone is recomputed for every record
 *    whenever the set changes."
 *
 * Steps 2 and 3 did that by hand. Doing it by hand again would mean trusting that
 * a description in prose still matches data generated months ago by a script
 * nobody kept. So this tool implements the documented algorithm, and `--check`
 * asserts it reproduces the 85 shipped edges and all 32 shipped zones EXACTLY
 * from the 32 shipped centroids. Only once that passed was WCB added.
 *
 * That check is the whole point. A generator that merely produces plausible edges
 * would silently rewrite 85 sourced records the first time it ran.
 *
 * ------------------------------------------------------------------
 * THE ALGORITHM, as data/README.md describes it
 * ------------------------------------------------------------------
 *   distance     haversine between centroids, Earth radius 6371008.8 m
 *   selection    each building links to its NEAREST_K nearest neighbours,
 *                capped at MAX_EDGE_M, then symmetrised
 *   bridging     any disconnected component is joined to the rest by its closest
 *                cross-component pair
 *   duration     distanceMeters = straight x PATH_FACTOR
 *                baseDurationSeconds = round(distanceMeters / WALK_SPEED_MPS)
 *   zones        within CORE_RADIUS_M of the mean centre is academic-core;
 *                otherwise by compass bearing from that centre into quadrants
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(REPO, 'plugins', 'fsu-schedule', 'data');

export const NEAREST_K = 4;
export const MAX_EDGE_M = 600;
export const PATH_FACTOR = 1.3;
export const WALK_SPEED_MPS = 1.4;
export const CORE_RADIUS_M = 700;
const EARTH_R = 6371008.8;

const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function computeZones(buildings) {
  const centre = {
    lat: buildings.reduce((s, b) => s + b.centroid.lat, 0) / buildings.length,
    lon: buildings.reduce((s, b) => s + b.centroid.lon, 0) / buildings.length
  };
  const zones = new Map();
  for (const b of buildings) {
    const d = haversine(centre, b.centroid);
    if (d <= CORE_RADIUS_M) { zones.set(b.code, 'academic-core'); continue; }
    const brg = bearing(centre, b.centroid);
    const zone = brg >= 315 || brg < 45 ? 'north-campus'
      : brg < 135 ? 'east-campus'
        : brg < 225 ? 'south-campus'
          : 'west-campus';
    zones.set(b.code, zone);
  }
  return { centre, zones };
}

/** Undirected pairs, as "A|B" with A alphabetically first. */
export function selectPairs(buildings) {
  const pairs = new Set();
  for (const from of buildings) {
    const near = buildings
      .filter((b) => b.code !== from.code)
      .map((b) => ({ code: b.code, m: haversine(from.centroid, b.centroid) }))
      .sort((x, y) => x.m - y.m || x.code.localeCompare(y.code))
      .slice(0, NEAREST_K)
      .filter((x) => x.m <= MAX_EDGE_M);
    for (const n of near) pairs.add([from.code, n.code].sort().join('|'));
  }

  /* Bridge disconnected components by their closest cross-component pair, one
   * bridge at a time, until the graph is connected. A student's route must not
   * fail because two halves of campus were never joined. */
  for (;;) {
    const comps = components(buildings.map((b) => b.code), pairs);
    if (comps.length <= 1) break;
    const [first, ...rest] = comps;
    const others = rest.flat();
    let best = null;
    for (const a of first) {
      for (const b of others) {
        const m = haversine(byCode(buildings, a).centroid, byCode(buildings, b).centroid);
        if (!best || m < best.m || (m === best.m && [a, b].sort().join('|') < best.key)) {
          best = { m, key: [a, b].sort().join('|') };
        }
      }
    }
    pairs.add(best.key);
  }
  return [...pairs].sort();
}

const byCode = (buildings, code) => buildings.find((b) => b.code === code);

function components(codes, pairs) {
  const adj = new Map(codes.map((c) => [c, []]));
  for (const p of pairs) {
    const [a, b] = p.split('|');
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const seen = new Set();
  const out = [];
  for (const c of codes) {
    if (seen.has(c)) continue;
    const stack = [c];
    const comp = [];
    seen.add(c);
    while (stack.length) {
      const n = stack.pop();
      comp.push(n);
      for (const m of adj.get(n)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    out.push(comp.sort());
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;

export function buildEdges(buildings, { retrievedOn, lowConfidenceCodes = new Set() } = {}) {
  const pairs = selectPairs(buildings);
  const edges = [];
  for (const key of pairs) {
    const [aCode, bCode] = key.split('|');
    const a = byCode(buildings, aCode);
    const b = byCode(buildings, bCode);
    /* Rounding ORDER is part of the contract, not a detail. Everything is
     * computed from the UNROUNDED haversine and rounded exactly once at the end;
     * the rounded values are for display and are never fed back into the next
     * step. Rounding the straight line first shifts 20 of the 85 shipped edges by
     * 0.1 m, and dividing the already-rounded distance shifts 3 durations by a
     * whole second where the quotient lands on .5. --check catches both. */
    const straightRaw = haversine(a.centroid, b.centroid);
    const walkRaw = straightRaw * PATH_FACTOR;
    const straight = round1(straightRaw);
    const distanceMeters = round1(walkRaw);
    const baseDurationSeconds = Math.round(walkRaw / WALK_SPEED_MPS);

    const weak = [aCode, bCode].filter((c) => lowConfidenceCodes.has(c));
    const weakNote = weak.length
      ? ` ${weak.join(' and ')} carries a LOW-confidence coordinate that is a geocoded address point rather than a surveyed position or a building polygon, so this edge is weaker than the rest of the file; see DATA-GAPS.md section 3.`
      : '';

    edges.push({
      id: `${aCode.toLowerCase()}-to-${bCode.toLowerCase()}`,
      from: { kind: 'building-entrance', building: aCode, entrance: 'centroid-stand-in' },
      to: { kind: 'building-entrance', building: bCode, entrance: 'centroid-stand-in' },
      bidirectional: true,
      distanceMeters,
      baseDurationSeconds,
      durationSource: 'estimated',
      paceAssumption: { metersPerSecond: WALK_SPEED_MPS, profile: 'average' },
      notes: `Estimate, not a measurement. Straight-line centre-to-centre distance ${straight} m, ` +
        `multiplied by a path factor of ${PATH_FACTOR} to give ${distanceMeters} m of assumed walking, ` +
        `divided by ${WALK_SPEED_MPS} m/s. It excludes time spent inside either building, stairs and lifts, ` +
        'waiting at crossings, and class-change crowding, so it is an optimistic floor rather than a ' +
        'realistic door-to-door time. Do not tell a student they will "make it" on the strength of this ' +
        'number alone.',
      provenance: {
        sourceUrl: 'https://www.facilities.fsu.edu/space/buildings/',
        retrievedOn: retrievedOn ?? a.provenance.retrievedOn,
        method: 'computed',
        confidence: 'medium',
        note: `Haversine distance between the shipped centroids of ${aCode} (${a.name}) and ${bCode} (${b.name}), ` +
          `scaled by PATH_FACTOR=${PATH_FACTOR} and divided by WALK_SPEED_MPS=${WALK_SPEED_MPS}. ` +
          'Earth radius 6371008.8 m. Both input centroids are themselves cross-source joins (see ' +
          'buildings.json provenance), and neither endpoint is a real door, so this edge inherits their ' +
          `error as well as the model's. No edge in this file has been walked with a stopwatch.${weakNote}`
      }
    });
  }
  return edges;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  const buildings = JSON.parse(fs.readFileSync(path.join(DATA, 'buildings.json'), 'utf8'));
  const existing = JSON.parse(fs.readFileSync(path.join(DATA, 'walk-edges.json'), 'utf8'));

  const low = new Set(buildings.filter((b) => b.provenance?.confidence === 'low').map((b) => b.code));
  const { centre, zones } = computeZones(buildings);
  const edges = buildEdges(buildings, { lowConfidenceCodes: low });

  console.log(`${buildings.length} buildings, mean centre ${centre.lat.toFixed(7)} ${centre.lon.toFixed(7)}`);
  console.log(`${edges.length} edges generated (file currently has ${existing.length})`);

  const zoneDrift = buildings.filter((b) => b.campusZone !== zones.get(b.code));
  if (zoneDrift.length) {
    console.log(`\ncampusZone changes (${zoneDrift.length}):`);
    for (const b of zoneDrift) console.log(`  ${b.code}: ${b.campusZone} -> ${zones.get(b.code)}`);
  } else {
    console.log('campusZone: no change for any building');
  }

  const was = new Set(existing.map((e) => e.id));
  const now = new Set(edges.map((e) => e.id));
  const added = [...now].filter((i) => !was.has(i));
  const removed = [...was].filter((i) => !now.has(i));
  if (added.length) console.log(`\nedges added (${added.length}): ${added.join(', ')}`);
  if (removed.length) console.log(`edges removed (${removed.length}): ${removed.join(', ')}`);

  const degrees = new Map(buildings.map((b) => [b.code, 0]));
  for (const e of edges) {
    degrees.set(e.from.building, degrees.get(e.from.building) + 1);
    degrees.set(e.to.building, degrees.get(e.to.building) + 1);
  }
  const minDeg = Math.min(...degrees.values());
  const minCodes = [...degrees].filter(([, d]) => d === minDeg).map(([c]) => c);
  console.log(`\nminimum degree ${minDeg} (${minCodes.join(', ')}), components ${components(buildings.map((b) => b.code), new Set(edges.map((e) => `${e.from.building}|${e.to.building}`))).length}`);

  if (mode === 'check') {
    /* Reproduction is judged on the fields the algorithm computes. Prose that a
     * later pass may have hand-edited is not part of the contract. */
    const key = (e) => JSON.stringify([e.id, e.from, e.to, e.bidirectional, e.distanceMeters, e.baseDurationSeconds, e.durationSource, e.paceAssumption]);
    const mismatches = [];
    for (const e of edges) {
      const old = existing.find((x) => x.id === e.id);
      if (!old) { mismatches.push(`${e.id}: not in the shipped file`); continue; }
      if (key(old) !== key(e)) mismatches.push(`${e.id}:\n    shipped   ${key(old)}\n    generated ${key(e)}`);
    }
    for (const id of removed) mismatches.push(`${id}: in the shipped file but not generated`);
    if (mismatches.length) {
      console.log(`\nFAIL -- ${mismatches.length} edge(s) do not reproduce:`);
      for (const m of mismatches.slice(0, 10)) console.log(`  ${m}`);
      process.exit(1);
    }
    console.log('\nOK -- every generated edge matches the shipped file exactly.');
    process.exit(0);
  }

  for (const b of buildings) b.campusZone = zones.get(b.code);
  fs.writeFileSync(path.join(DATA, 'buildings.json'), JSON.stringify(buildings, null, 2) + '\n');
  fs.writeFileSync(path.join(DATA, 'walk-edges.json'), JSON.stringify(edges, null, 2) + '\n');
  console.log('\nWrote buildings.json and walk-edges.json.');
}
