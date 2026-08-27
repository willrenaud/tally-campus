# Data model

Six schemas plus a shared definitions file. Together they describe everything the plugin needs in
order to answer a question like *"can I make it from my 9:05 in HCB to my 9:35 in WMS?"* without
guessing.

All schemas are **JSON Schema draft 2020-12**, every property carries a `description`, and every
object sets `"additionalProperties": false` so that a typo in a data file fails loudly instead of
being silently dropped.

## The two kinds of data

This is the distinction that everything else follows from.

**Static shipped data** — identical for every student, versioned with the plugin, lives in
`plugins/fsu-schedule/data/`:

- buildings and their entrances
- the walk graph: waypoints and walk edges
- parking zones and their rules
- term calendars

**Per-user data** — belongs to one student, never shipped, written at import time:

- their schedule (`student-schedule.schema.json`)

The user's schedule is persisted at:

```
${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json
```

`${CLAUDE_PLUGIN_DATA}` resolves to `~/.claude/plugins/data/fsu-schedule-fsu-campus/`. Per the
plugin docs it is created on first reference and **survives plugin updates**, which is why the
schedule goes there rather than under `${CLAUDE_PLUGIN_ROOT}` — anything inside the plugin
directory is replaced wholesale on update. One caveat worth designing around: the data directory
**is** removed when the plugin is uninstalled from its last scope. So the stored schedule is a
convenience cache, not an archive, and re-import must always remain a one-step operation.

Static data is read from `${CLAUDE_PLUGIN_ROOT}/data/`.

## How the schemas reference each other

```
term-calendar ──(termCode)──┐
                            │
student-schedule ───────────┤
   │  (per-user, in CLAUDE_PLUGIN_DATA)
   │
   └── meetings[] ── course-meeting
                          │
                          └── location.buildingCode ──► building
                                                          │
                                                          └── entrances[].id
                                                                   ▲
                                                                   │ referenced by
                                                          walk-edge.from / .to
                                                                   │
                              parking-zone ── accessPoints[].id ───┘
                                    │
                                    └── servesBuildings[] ──► building
```

The joins, concretely:

| From | Field | To |
| --- | --- | --- |
| `student-schedule` | `termCode` | `term-calendar.termCode` |
| `student-schedule` | `meetings[]` | `course-meeting` (embedded by `$ref`) |
| `course-meeting` | `termCode` | `term-calendar.termCode` |
| `course-meeting` | `partOfTerm` | `term-calendar.sessions[].code` |
| `course-meeting` | `location.buildingCode` | `building.code` |
| `course-meeting` | `location.preferredEntranceId` | `building.entrances[].id` |
| `walk-edge` | `from` / `to` | a building entrance, a waypoint, or a parking access point |
| `parking-zone` | `servesBuildings[]` | `building.code` |
| `student-schedule` | `preferences.parkingPermits[]` | `parking-zone.$defs.permitClass` |

None of these cross-file joins can be enforced by JSON Schema. The data build step is expected to
check referential integrity and fail the build on a dangling reference.

`common.defs.schema.json` is not a document type. It exists only to be `$ref`'d, and it holds the
primitives every other schema shares: `date`, `timestamp`, `timeOfDay`, `dayOfWeek`, `timeWindow`,
`latitude`/`longitude`, `buildingCode`, `termCode`, `slug`, `confidence`, `sourceAttribution`, and
`provenance`.

`provenance` is the per-record audit trail every shipped static record is REQUIRED to carry:
`sourceUrl`, `retrievedOn`, `method` (`fetched` / `computed` / `unverified`) and `confidence`
(`high` / `medium` / `low`), plus a `note` for what was ambiguous. It is required on `building`,
`walk-edge`, `parking-zone` and `term-calendar`, and deliberately absent from `course-meeting` and
`student-schedule`, which are per-user documents whose equivalent is the schedule's `import` block.
Its point is to make an unsourced record impossible to write by accident: a record is either fetched
from a page actually retrieved, or computed from records that were, or it does not ship.
`tools/validate-data.mjs` refuses any record in `data/` whose method is `unverified`.

## The time and date policy

Stated in `common.defs.schema.json` and repeated here because it is the rule most likely to be
violated by a future importer:

- **Clock times** are wall-clock `"HH:MM"` 24-hour strings, interpreted in **America/New_York**.
- **Dates** are ISO-8601 `"YYYY-MM-DD"`, also America/New_York.
- **Naive local datetimes never appear anywhere.** A real instant — the moment an import ran — is
  an RFC 3339 timestamp whose pattern *requires* a trailing offset, so `"2026-08-27T10:14:02"`
  fails validation and `"2026-08-27T10:14:02-04:00"` passes.
- **A `timeWindow` may wrap past midnight.** When `endTime` is earlier than `startTime` the window
  runs into the next day, and `daysOfWeek` names the days it *opens* on rather than every day it
  touches. `"24:00"` means end-of-day without wrapping. End equal to start is invalid, and because
  JSON Schema cannot compare two sibling properties that rule lives in `tools/validate-data.mjs`.
  The full evaluation rule is written out in `common.defs.schema.json`.

The split is deliberate. A class that meets at 09:05 meets at 09:05 on both sides of the November
daylight-saving change, so its time must stay a wall-clock string bound to a named zone rather than
a fixed instant. An event that actually happened is a real instant and must carry its offset.
Collapsing the two is how schedules end up an hour wrong for one week of the term.

## The schemas

### `building.schema.json`

One FSU building, keyed by the code printed on a class schedule (`HCB`, `HWC`, `WMS`).

The design point: **a building is not a point.** Its routable geometry is its `entrances` array,
each with its own coordinate, compass facing, accessibility flag, and optional unlocked-hours
windows. `centroid` exists for map display and coarse sorting and must never be used for a walking
estimate — centroid-to-centroid distance systematically understates the real walk by ignoring which
door you leave by. `aliases` carries what students actually say, so "the Wellness Center" resolves.
`floorCount` and `elevatorCount` feed a vertical-travel penalty: reaching a fifth-floor room can
cost more than the walk between two adjacent buildings.

The shipped data does not yet live up to this design — every building in `data/buildings.json` has a
single entrance placed at its centroid, because no door location could be sourced. See
[`DATA-GAPS.md`](../../../DATA-GAPS.md) §1.

### `walk-edge.schema.json`

One walkable connection, and the reason routing does not need an N×N matrix.

Endpoints are `nodeRef`s discriminated by `kind`: a **building entrance**, a free-standing
**waypoint** (a path junction or crosswalk belonging to no building), or a **parking access point**.
Because waypoints are first-class nodes, N buildings need roughly N + J nodes and a sparse set of
edges along real sidewalks. Adding a building means adding its entrances and a handful of edges to
nearby waypoints; nothing else is recomputed. A route is a shortest-path search over these edges,
and its duration is the sum of the edges' durations.

Modifiers, all of which change the answer rather than the presentation:

- `durationSource` (`measured` / `estimated` / `interpolated` / `imported`) plus a `measurement`
  block with `sampleCount`, `medianSeconds`, and `p90Seconds`. The p90 is the honest number when
  telling a student whether they'll make it — the question is about the bad case.
- `paceAssumption`, so every edge can be rescaled to one student's pace instead of shipping one
  pace for everyone.
- `accessibility`, which keeps two distinct ideas apart: `wheelchairAccessible` (can this edge be
  used at all) and `accessibleRouteOnly` (this edge exists *as* a ramp detour and should be
  deprioritized for people who didn't ask for one).
- `coverage` / `coveredFraction` — Tallahassee afternoon storms make covered routes a real
  preference.
- `crowdFactors`, a list of `timeWindow` + `multiplier`. The motivating case is the class-change
  window: an edge that takes 180 s at 14:00 takes 240 s at 09:50.

Waypoint records are defined by `walk-edge.schema.json#/$defs/waypoint` and ship as their own data
file.

### `parking-zone.schema.json`

A lot, garage, metered block, or park-and-ride.

The design point: **permit rules are time-dependent, never a boolean.** A garage that is
permit-only 07:30–16:30 on weekdays and open to anyone afterward cannot be represented by a
`permitRequired` flag, and getting it wrong is the difference between a free space and a citation.
So eligibility lives entirely in `rules[]`, each a windowed rule with days, start, exclusive end,
`mode`, and the `allows` list of permit classes.

Two details that make the rule list usable:

- **Order is the whole resolution mechanism.** `rules[]` is evaluated firewall-style: the **last**
  rule whose window and effective date range contain the moment is the one that applies, and earlier
  matches are shadowed. Write them broadest first — the base rule, then the recurring enforcement
  window, then dated overrides such as a home-game closure. A change to one exception never requires
  editing the rules underneath it.

  This replaced an integer `priority` field. Priority was a second thing to keep consistent, and two
  rules at equal priority had no defined winner, which made "two matching rules at equal priority is
  a data error" a case every consumer had to detect and report. Array position cannot tie.

- **`rules[0]` must be a catch-all**, enforced by the schema: all seven days, `00:00` to `24:00`, and
  no `effectiveFrom` or `effectiveTo`. Because some rule always matches, "no rule matched" is
  unrepresentable and a consumer never has to choose between reporting *unknown* and guessing. What
  the base rule should say is the honest default for that zone — which for a zone whose sources only
  ever state when parking is *allowed* means the restrictive reading, since inferring permission from
  silence is how someone gets a citation.

Windows **may** wrap past midnight: when `endTime` is earlier than `startTime` the window runs into
the following day, so an overnight span is one rule rather than two. `daysOfWeek` then names the days
the window *opens* on, not every day it touches — Friday 17:00–02:00 covers Friday evening and early
Saturday, not Friday's own small hours. A window whose end *equals* its start is invalid; JSON Schema
cannot compare two sibling properties, so that one is enforced by `tools/validate-data.mjs`.

`capacity.typicalFullBy` is more useful to a student than `totalSpaces`: "there are 900 spaces" is
not an answer, "don't bother after 09:30" is.

### `course-meeting.schema.json`

**One meeting block**, not one course. A section is one *or more* records, and that is what makes
the messy cases representable:

- A section that lectures Mon/Wed in one building and holds recitation Fri in another → two
  records sharing `courseCode` and `section`.
- A lecture plus its lab → two records with different `meetingType`.
- A biweekly lab → one record whose `recurrence.frequency` is `biweekly` with an `anchorDate`. The
  anchor is required, and required for good reason: without it there is no way to tell which of two
  alternating weeks is the on week, and a coin-flip about which Thursday to attend is worse than
  saying nothing.
- An asynchronous online section → one record with `deliveryMode: "online-asynchronous"`, no days,
  no times, and `location: null`.

`deliveryMode` governs which fields are required, enforced by `if`/`then` rules at the bottom of
the schema. Physical modes require a location object; fully online modes require `location` to be
null; asynchronous additionally forbids days and times outright. Carrying a placeholder building
code like `"WEB"` for an online class is the classic import bug — it produces phantom conflicts and
makes a router try to walk someone to a room that doesn't exist — so the schema rejects it.

`courseCode` is deliberately permissive: `^[A-Z]{3}[0-9]{4}[A-Za-z]{0,2}# Data model

Six schemas plus a shared definitions file. Together they describe everything the plugin needs in
order to answer a question like *"can I make it from my 9:05 in HCB to my 9:35 in WMS?"* without
guessing.

All schemas are **JSON Schema draft 2020-12**, every property carries a `description`, and every
object sets `"additionalProperties": false` so that a typo in a data file fails loudly instead of
being silently dropped.

## The two kinds of data

This is the distinction that everything else follows from.

**Static shipped data** — identical for every student, versioned with the plugin, lives in
`plugins/fsu-schedule/data/`:

- buildings and their entrances
- the walk graph: waypoints and walk edges
- parking zones and their rules
- term calendars

**Per-user data** — belongs to one student, never shipped, written at import time:

- their schedule (`student-schedule.schema.json`)

The user's schedule is persisted at:

```
${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json
```

`${CLAUDE_PLUGIN_DATA}` resolves to `~/.claude/plugins/data/fsu-schedule-fsu-campus/`. Per the
plugin docs it is created on first reference and **survives plugin updates**, which is why the
schedule goes there rather than under `${CLAUDE_PLUGIN_ROOT}` — anything inside the plugin
directory is replaced wholesale on update. One caveat worth designing around: the data directory
**is** removed when the plugin is uninstalled from its last scope. So the stored schedule is a
convenience cache, not an archive, and re-import must always remain a one-step operation.

Static data is read from `${CLAUDE_PLUGIN_ROOT}/data/`.

## How the schemas reference each other

```
term-calendar ──(termCode)──┐
                            │
student-schedule ───────────┤
   │  (per-user, in CLAUDE_PLUGIN_DATA)
   │
   └── meetings[] ── course-meeting
                          │
                          └── location.buildingCode ──► building
                                                          │
                                                          └── entrances[].id
                                                                   ▲
                                                                   │ referenced by
                                                          walk-edge.from / .to
                                                                   │
                              parking-zone ── accessPoints[].id ───┘
                                    │
                                    └── servesBuildings[] ──► building
```

The joins, concretely:

| From | Field | To |
| --- | --- | --- |
| `student-schedule` | `termCode` | `term-calendar.termCode` |
| `student-schedule` | `meetings[]` | `course-meeting` (embedded by `$ref`) |
| `course-meeting` | `termCode` | `term-calendar.termCode` |
| `course-meeting` | `partOfTerm` | `term-calendar.sessions[].code` |
| `course-meeting` | `location.buildingCode` | `building.code` |
| `course-meeting` | `location.preferredEntranceId` | `building.entrances[].id` |
| `walk-edge` | `from` / `to` | a building entrance, a waypoint, or a parking access point |
| `parking-zone` | `servesBuildings[]` | `building.code` |
| `student-schedule` | `preferences.parkingPermits[]` | `parking-zone.$defs.permitClass` |

None of these cross-file joins can be enforced by JSON Schema. The data build step is expected to
check referential integrity and fail the build on a dangling reference.

`common.defs.schema.json` is not a document type. It exists only to be `$ref`'d, and it holds the
primitives every other schema shares: `date`, `timestamp`, `timeOfDay`, `dayOfWeek`, `timeWindow`,
`latitude`/`longitude`, `buildingCode`, `termCode`, `slug`, `confidence`, `sourceAttribution`, and
`provenance`.

`provenance` is the per-record audit trail every shipped static record is REQUIRED to carry:
`sourceUrl`, `retrievedOn`, `method` (`fetched` / `computed` / `unverified`) and `confidence`
(`high` / `medium` / `low`), plus a `note` for what was ambiguous. It is required on `building`,
`walk-edge`, `parking-zone` and `term-calendar`, and deliberately absent from `course-meeting` and
`student-schedule`, which are per-user documents whose equivalent is the schedule's `import` block.
Its point is to make an unsourced record impossible to write by accident: a record is either fetched
from a page actually retrieved, or computed from records that were, or it does not ship.
`tools/validate-data.mjs` refuses any record in `data/` whose method is `unverified`.

## The time and date policy

Stated in `common.defs.schema.json` and repeated here because it is the rule most likely to be
violated by a future importer:

- **Clock times** are wall-clock `"HH:MM"` 24-hour strings, interpreted in **America/New_York**.
- **Dates** are ISO-8601 `"YYYY-MM-DD"`, also America/New_York.
- **Naive local datetimes never appear anywhere.** A real instant — the moment an import ran — is
  an RFC 3339 timestamp whose pattern *requires* a trailing offset, so `"2026-08-27T10:14:02"`
  fails validation and `"2026-08-27T10:14:02-04:00"` passes.
- **A `timeWindow` may wrap past midnight.** When `endTime` is earlier than `startTime` the window
  runs into the next day, and `daysOfWeek` names the days it *opens* on rather than every day it
  touches. `"24:00"` means end-of-day without wrapping. End equal to start is invalid, and because
  JSON Schema cannot compare two sibling properties that rule lives in `tools/validate-data.mjs`.
  The full evaluation rule is written out in `common.defs.schema.json`.

The split is deliberate. A class that meets at 09:05 meets at 09:05 on both sides of the November
daylight-saving change, so its time must stay a wall-clock string bound to a named zone rather than
a fixed instant. An event that actually happened is a real instant and must carry its offset.
Collapsing the two is how schedules end up an hour wrong for one week of the term.

## The schemas

### `building.schema.json`

One FSU building, keyed by the code printed on a class schedule (`HCB`, `HWC`, `WMS`).

The design point: **a building is not a point.** Its routable geometry is its `entrances` array,
each with its own coordinate, compass facing, accessibility flag, and optional unlocked-hours
windows. `centroid` exists for map display and coarse sorting and must never be used for a walking
estimate — centroid-to-centroid distance systematically understates the real walk by ignoring which
door you leave by. `aliases` carries what students actually say, so "the Wellness Center" resolves.
`floorCount` and `elevatorCount` feed a vertical-travel penalty: reaching a fifth-floor room can
cost more than the walk between two adjacent buildings.

The shipped data does not yet live up to this design — every building in `data/buildings.json` has a
single entrance placed at its centroid, because no door location could be sourced. See
[`DATA-GAPS.md`](../../../DATA-GAPS.md) §1.

### `walk-edge.schema.json`

One walkable connection, and the reason routing does not need an N×N matrix.

Endpoints are `nodeRef`s discriminated by `kind`: a **building entrance**, a free-standing
**waypoint** (a path junction or crosswalk belonging to no building), or a **parking access point**.
Because waypoints are first-class nodes, N buildings need roughly N + J nodes and a sparse set of
edges along real sidewalks. Adding a building means adding its entrances and a handful of edges to
nearby waypoints; nothing else is recomputed. A route is a shortest-path search over these edges,
and its duration is the sum of the edges' durations.

Modifiers, all of which change the answer rather than the presentation:

- `durationSource` (`measured` / `estimated` / `interpolated` / `imported`) plus a `measurement`
  block with `sampleCount`, `medianSeconds`, and `p90Seconds`. The p90 is the honest number when
  telling a student whether they'll make it — the question is about the bad case.
- `paceAssumption`, so every edge can be rescaled to one student's pace instead of shipping one
  pace for everyone.
- `accessibility`, which keeps two distinct ideas apart: `wheelchairAccessible` (can this edge be
  used at all) and `accessibleRouteOnly` (this edge exists *as* a ramp detour and should be
  deprioritized for people who didn't ask for one).
- `coverage` / `coveredFraction` — Tallahassee afternoon storms make covered routes a real
  preference.
- `crowdFactors`, a list of `timeWindow` + `multiplier`. The motivating case is the class-change
  window: an edge that takes 180 s at 14:00 takes 240 s at 09:50.

Waypoint records are defined by `walk-edge.schema.json#/$defs/waypoint` and ship as their own data
file.

### `parking-zone.schema.json`

A lot, garage, metered block, or park-and-ride.

The design point: **permit rules are time-dependent, never a boolean.** A garage that is
permit-only 07:30–16:30 on weekdays and open to anyone afterward cannot be represented by a
`permitRequired` flag, and getting it wrong is the difference between a free space and a citation.
So eligibility lives entirely in `rules[]`, each a windowed rule with days, start, exclusive end,
`mode`, and the `allows` list of permit classes.

Two details that make the rule list usable:

- **Order is the whole resolution mechanism.** `rules[]` is evaluated firewall-style: the **last**
  rule whose window and effective date range contain the moment is the one that applies, and earlier
  matches are shadowed. Write them broadest first — the base rule, then the recurring enforcement
  window, then dated overrides such as a home-game closure. A change to one exception never requires
  editing the rules underneath it.

  This replaced an integer `priority` field. Priority was a second thing to keep consistent, and two
  rules at equal priority had no defined winner, which made "two matching rules at equal priority is
  a data error" a case every consumer had to detect and report. Array position cannot tie.

- **`rules[0]` must be a catch-all**, enforced by the schema: all seven days, `00:00` to `24:00`, and
  no `effectiveFrom` or `effectiveTo`. Because some rule always matches, "no rule matched" is
  unrepresentable and a consumer never has to choose between reporting *unknown* and guessing. What
  the base rule should say is the honest default for that zone — which for a zone whose sources only
  ever state when parking is *allowed* means the restrictive reading, since inferring permission from
  silence is how someone gets a citation.

Windows **may** wrap past midnight: when `endTime` is earlier than `startTime` the window runs into
the following day, so an overnight span is one rule rather than two. `daysOfWeek` then names the days
the window *opens* on, not every day it touches — Friday 17:00–02:00 covers Friday evening and early
Saturday, not Friday's own small hours. A window whose end *equals* its start is invalid; JSON Schema
cannot compare two sibling properties, so that one is enforced by `tools/validate-data.mjs`.

`capacity.typicalFullBy` is more useful to a student than `totalSpaces`: "there are 900 spaces" is
not an answer, "don't bother after 09:30" is.

### `course-meeting.schema.json`

**One meeting block**, not one course. A section is one *or more* records, and that is what makes
the messy cases representable:

- A section that lectures Mon/Wed in one building and holds recitation Fri in another → two
  records sharing `courseCode` and `section`.
- A lecture plus its lab → two records with different `meetingType`.
- A biweekly lab → one record whose `recurrence.frequency` is `biweekly` with an `anchorDate`. The
  anchor is required, and required for good reason: without it there is no way to tell which of two
  alternating weeks is the on week, and a coin-flip about which Thursday to attend is worse than
  saying nothing.
- An asynchronous online section → one record with `deliveryMode: "online-asynchronous"`, no days,
  no times, and `location: null`.

`deliveryMode` governs which fields are required, enforced by `if`/`then` rules at the bottom of
the schema. Physical modes require a location object; fully online modes require `location` to be
null; asynchronous additionally forbids days and times outright. Carrying a placeholder building
code like `"WEB"` for an online class is the classic import bug — it produces phantom conflicts and
makes a router try to walk someone to a room that doesn't exist — so the schema rejects it.

, which is looser than
Florida's statewide course numbering (SCNS). Rejecting a real schedule at import is worse than
accepting an odd course code — cross-listed, experimental, special-topics and graduate offerings
routinely carry numbers that do not fit the canonical form, and a student whose import fails gets
nothing at all. The stricter judgement is carried as an optional `canonicalNumbering` boolean
instead, so a non-conforming code can be flagged and hedged about rather than thrown away. Nothing
downstream may refuse to route a meeting because that flag is false.

`partOfTerm` matters more than it looks: FSU runs seven-week halves, so two courses in the same
time slot can never actually collide if one ends before the other begins. A conflict check that
ignores this field reports false conflicts.

### `term-calendar.schema.json`

One record per term. This is what turns a weekly recurring pattern into actual dates.

`deadlines[]` each carry a `type` from a closed enum (`drop-add`, `course-withdrawal`,
`term-withdrawal`, `tuition-payment`, …) so deadlines can be filtered without string-matching their
descriptions, and an optional `time` for the ones that expire at 23:59 or 17:00 rather than
end-of-day. `appliesToSession` exists because half-term and summer-session courses have their own,
much earlier, withdrawal dates.

`nonClassDays[]` covers holidays, breaks, reading days, and closures, with `classesCancelled` and
`campusClosed` kept separate — on a reading day classes don't meet but the library is full.
`finals` is its own object because exam blocks don't follow the term's normal meeting pattern, so a
schedule expanded from weekly meetings is simply wrong for that week. `sessions[]` supplies the
date ranges that a course meeting's `partOfTerm` refers to.

### `student-schedule.schema.json`

The only per-user document. Holds `meetings[]` (embedding `course-meeting` by `$ref`), a
`termCode`, a `schemaVersion` for migration, `preferences`, and an `import` provenance block.

`preferences` changes answers rather than presentation: `walkingPaceMetersPerSecond` rescales every
edge, `requiresAccessibleRoutes` restricts routing to accessible edges and entrances and must
report failure rather than quietly falling back, `parkingPermits` narrows a parking answer from
"here are all the rules" to "here is where *you* may park right now", and
`minimumTransitBufferMinutes` moves the line between "you can make it" and "you can't".

`import` records `sourceFormat`, `importedAt`, `importerVersion`, a `sourceChecksum`, and a list of
structured `warnings`. The format is the strongest single signal of how much to trust the result —
an ICS feed carries exact times, `screenshot-ocr` routinely mangles room numbers — and the warnings
are what let an answer say which parts of the schedule it is unsure about instead of asserting all
of it equally.

## Examples

`examples/` holds one hand-written instance per schema. They are the executable definition of what
these shapes look like.

> **Every example is an illustrative placeholder.** Building names, coordinates, entrance layouts,
> parking rules, capacities, course numbers, instructors, and calendar dates are all invented and
> internally consistent only. No verified FSU data has been collected yet; that is a later step.
> Each example says so in its own `notes` or `source` field.

`student-schedule.example.json` deliberately exercises the hard cases in one document: a section
meeting in two different buildings on different days, a biweekly lab with an anchor date and an
exception, an asynchronous course with a null location, and a second-half-of-term seminar that
cannot conflict with anything ending in October.

## Validating

```bash
npm run validate          # both suites
npm run validate:schemas  # examples + malformed rejections
npm run validate:data     # the shipped data in ../data/
```

`tools/validate-schemas.mjs` is the suite: all seven schemas compile, all six examples validate, and
**21 deliberately-malformed documents are rejected** — an async class with a room, an async class
with meeting days, an in-person class with a null location, a biweekly lab with no anchor date, an
unparseable course code, an unknown property, a building with no entrances, a swapped
latitude/longitude pair, a point outside Florida, a record with no provenance, provenance claiming
`fetched` with no `sourceUrl`, a permit-required rule with no permit list, three ways for
`rules[0]` to fail the catch-all constraint, an empty rules array, the retired `priority` field, an
unknown walk-graph node kind, a naive local datetime, an unknown deadline type, and a malformed term
code. Three further cases assert that the Part A changes *accept* what they were meant to: a loose
course code, the repeatable `r` suffix, and a window that wraps past midnight.

The rejection half is the half that matters. A schema that accepts everything passes a positive-only
suite perfectly, so if one of those cases ever starts passing, a constraint has been lost.

Ajv runs in **strict mode** with `ajv-formats`. One strict check is disabled, `strictTuples`: the
parking `rules` array is head-plus-tail (`prefixItems` pins `rules[0]`, `items` constrains the
rest), which is what those keywords mean in draft 2020-12, but Ajv's heuristic assumes any
`prefixItems` means a fixed-length tuple and would cap a zone at exactly one rule.

Checks JSON Schema structurally cannot make live in `tools/lib/semantic.mjs`: a time window whose end
equals its start, duplicate ids within a file, dangling cross-file references, and whether the walk
graph is still one connected component.

Because the schemas `$ref` each other by relative URI, a validator must load **all seven** files
before validating any one of them, resolving them by `$id`.

## The `$id` base URI

Schemas are identified under `https://fsu-campus.example/schemas/v0/`. The `.example` TLD is
reserved by IANA and will never resolve, which is correct for an identifier that is a namespace
rather than a fetchable document. Relative `$ref`s resolve against it, so all seven files must sit
in one directory. If these schemas are ever published at a real URL, change the base in all seven
`$id` values together.
