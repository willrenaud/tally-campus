/**
 * Checks that JSON Schema structurally cannot express, run alongside Ajv.
 *
 * JSON Schema has no way to compare two sibling properties and no way to look
 * across documents, so three whole classes of data error slip past a clean Ajv
 * run: a time window whose end equals its start, a duplicate id, and a dangling
 * cross-file reference. Each of those is a bug that would surface as a wrong
 * answer to a student rather than as a validation failure, which is the worst
 * place for it to surface, so they are checked here instead.
 */

const MINUTES = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Recursively find every object that looks like a common.defs timeWindow. */
function collectTimeWindows(node, pointer, out) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectTimeWindows(v, `${pointer}/${i}`, out));
    return;
  }
  if (node && typeof node === 'object') {
    if (
      Array.isArray(node.daysOfWeek) &&
      typeof node.startTime === 'string' &&
      typeof node.endTime === 'string'
    ) {
      out.push({ pointer, window: node });
    }
    for (const [k, v] of Object.entries(node)) {
      collectTimeWindows(v, `${pointer}/${k}`, out);
    }
  }
}

/**
 * A window with end == start is ambiguous between zero-length and whole-day, and
 * common.defs declares it invalid. It cannot be caught by the schema because the
 * two values are siblings. Wrapping windows (end < start) are legal since the
 * Part A change and are NOT flagged here.
 */
export function checkTimeWindows(doc, label) {
  const found = [];
  collectTimeWindows(doc, '', found);
  const problems = [];
  for (const { pointer, window } of found) {
    if (MINUTES(window.startTime) === MINUTES(window.endTime)) {
      problems.push(
        `${label}${pointer}: startTime and endTime are both "${window.startTime}". ` +
          `A window whose end equals its start is ambiguous between zero-length and whole-day; ` +
          `write a whole day as "00:00" to "24:00".`
      );
    }
  }
  return problems;
}

/** Duplicate ids inside one data file, which silently shadow one another downstream. */
export function checkUniqueIds(records, keyField, label) {
  const seen = new Map();
  const problems = [];
  records.forEach((rec, i) => {
    const key = rec?.[keyField];
    if (key === undefined) return;
    if (seen.has(key)) {
      problems.push(`${label}[${i}]: duplicate ${keyField} "${key}" (first seen at index ${seen.get(key)})`);
    } else {
      seen.set(key, i);
    }
  });
  return problems;
}

/**
 * Cross-file referential integrity. Every one of these joins is documented in
 * schemas/README.md and none of them can be enforced by JSON Schema, because a
 * $ref resolves a SHAPE, never a VALUE in another document.
 */
export function checkReferences({ buildings = [], walkEdges = [], parkingZones = [], waypoints = [] }) {
  const problems = [];

  const buildingCodes = new Set(buildings.map((b) => b.code));
  const entranceKeys = new Set();
  for (const b of buildings) {
    for (const e of b.entrances ?? []) entranceKeys.add(`${b.code}/${e.id}`);
  }
  const waypointIds = new Set(waypoints.map((w) => w.id));
  const accessKeys = new Set();
  for (const z of parkingZones) {
    for (const a of z.accessPoints ?? []) accessKeys.add(`${z.id}/${a.id}`);
  }

  const describeNode = (n) => {
    if (n.kind === 'building-entrance') return `${n.building}/${n.entrance}`;
    if (n.kind === 'waypoint') return n.waypoint;
    if (n.kind === 'parking-access') return `${n.zone}/${n.accessPoint}`;
    return JSON.stringify(n);
  };

  const nodeExists = (n) => {
    if (n.kind === 'building-entrance') return entranceKeys.has(`${n.building}/${n.entrance}`);
    if (n.kind === 'waypoint') return waypointIds.has(n.waypoint);
    if (n.kind === 'parking-access') return accessKeys.has(`${n.zone}/${n.accessPoint}`);
    return false;
  };

  walkEdges.forEach((edge, i) => {
    for (const side of ['from', 'to']) {
      const n = edge[side];
      if (!n) continue;
      if (!nodeExists(n)) {
        problems.push(
          `walk-edges[${i}] (${edge.id}): ${side} references ${n.kind} "${describeNode(n)}", which does not exist.`
        );
      }
    }
    if (edge.from && edge.to && describeNode(edge.from) === describeNode(edge.to)) {
      problems.push(`walk-edges[${i}] (${edge.id}): from and to are the same node.`);
    }
  });

  parkingZones.forEach((z, i) => {
    for (const code of z.servesBuildings ?? []) {
      if (!buildingCodes.has(code)) {
        problems.push(`parking-zones[${i}] (${z.id}): servesBuildings names unknown building code "${code}".`);
      }
    }
  });

  return problems;
}

/**
 * Walk-graph connectivity. A near-neighbour edge set is only useful if it is
 * actually one connected component: an isolated building is a building the
 * router will refuse to answer about, and that is a data gap worth surfacing at
 * build time rather than discovering when a student asks.
 */
export function checkConnectivity(buildings, walkEdges) {
  if (buildings.length === 0) return [];
  const adjacency = new Map();
  const add = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  const codeOf = (n) => (n.kind === 'building-entrance' ? n.building : null);

  for (const b of buildings) adjacency.set(b.code, new Set());
  for (const e of walkEdges) {
    const a = codeOf(e.from);
    const b = codeOf(e.to);
    if (!a || !b) continue;
    add(a, b);
    add(b, a);
  }

  const start = buildings[0].code;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adjacency.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  const orphans = buildings.map((b) => b.code).filter((c) => !seen.has(c));
  return orphans.length
    ? [
        `walk graph is not connected: ${orphans.length} building(s) unreachable from ${start} -- ${orphans.join(', ')}. ` +
          `Every building in buildings.json needs at least one walk edge, or a student asking about it gets no route at all.`
      ]
    : [];
}
