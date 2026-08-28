# Shipped campus data

Static data that is identical for every student, versioned with the plugin. The one per-user
document, a student's own schedule, never lives here — it is written to
`${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json` at import time.

> **Parking data here is a convenience, not an authority. Confirm against the posted signs.**
> Every rule in `parking-zones.json` was read off an FSU web page on 2026-08-27, and FSU's own pages
> contradict each other about student parking hours. A citation or a tow is a real cost to a real
> student; this data is a starting point for a question, never the last word on it. When in doubt,
> the sign at the space wins.
>
> On the seven home football dates listed in `term-calendar.json`'s `parkingBlackouts`, these rules
> are known to be wrong, and the required behaviour is to **refuse to answer**, not to answer with a
> caveat. See [The parking rule model](#the-parking-rule-model) below.

Collected 2026-08-27. Everything missing, and why, is in
[`DATA-GAPS.md`](../../../DATA-GAPS.md) at the repository root — read it before trusting any answer
built on these files.

## The files

Every file is a **JSON array of records**, validated element-by-element against the matching schema
in [`../schemas/`](../schemas/). One record type per file; an array even where only one record exists
today, so that adding Spring 2027 is not a shape change.

| File | Records | Schema | Holds |
| --- | --- | --- | --- |
| `buildings.json` | 32 | `building.schema.json` | The 28 main-campus buildings holding the most FSU-typed classrooms, plus Strozier Library and the New Student Union as destinations, plus B.K. Roberts Hall and the Dirac Science Library added in a later pass. Codes, official names, aliases, coordinates, floor counts, classroom floors. |
| `walk-edges.json` | 85 | `walk-edge.schema.json` | A connected near-neighbour walk graph over those buildings. All durations computed, none measured. |
| `parking-zones.json` | 6 | `parking-zone.schema.json` | FSU's six parking garages with time-windowed permit rules. No surface lots. |
| `term-calendar.json` | 1 | `term-calendar.schema.json` | Fall 2026: term dates, deadlines, holidays, finals week, and the home-game dates on which parking cannot be answered. |

`tools/validate-data.mjs` maps filenames to schemas and **fails on any file it does not recognise**,
so a hand-added data file cannot ship unchecked. Run it with `npm run validate` from the repository
root.

## Provenance conventions

Every record carries a `provenance` object. It is required by the schemas, and it exists to make an
unsourced record impossible to write by accident.

```json
"provenance": {
  "sourceUrl": "https://www.facilities.fsu.edu/portal/building/?bldg=0008",
  "retrievedOn": "2026-08-27",
  "method": "computed",
  "confidence": "medium",
  "note": "…what was joined, what was assumed, what is still ambiguous…"
}
```

- **`method`** — `fetched` means the values were read off `sourceUrl`. `computed` means they were
  derived from sourced values by a documented calculation. `unverified` means neither, and
  `tools/validate-data.mjs` **rejects any record in this directory with `method: "unverified"`**;
  such records belong in `DATA-GAPS.md`, not here.
- **`confidence`** — `high` is read directly off an official FSU page with no interpretation.
  `medium` is derived, or read off a source clear about most of the record but not all of it. `low`
  is good enough to route with, not good enough to act on. **An answer built on anything below `high`
  should say so out loud.**
- **`note`** — where an ambiguity in the source is *recorded* rather than resolved. If two FSU pages
  disagree, the disagreement goes here and in the relevant `enforcementNote`; it does not get
  silently decided.

`provenance` sits alongside the older `source` field. They are not duplicates: `source` is
document-level prose attribution, `provenance` is a per-record audit trail.

### Where the values come from

| What | Source |
| --- | --- |
| Building codes, official names, street addresses, FSU building numbers, space zones | [FSU Building Information Portal](https://www.facilities.fsu.edu/space/buildings/) |
| Floor counts, classroom floors, classroom counts | FSU room-lookup service, e.g. `https://forms.pdc.fsu.edu/portal/room-lookup/?bldg=0008`, counting rooms FSU types `(110) CLASSROOM` |
| All latitude/longitude | OpenStreetMap building polygons via Overpass, joined to the FSU record by street address where possible, by name otherwise |
| Parking rules | [FSU Transportation & Parking Services](https://transportation.fsu.edu/parking) and [its permits page](https://transportation.fsu.edu/parking/permits) |
| Term calendar | [FSU Registrar, Fall 2026 Academic Calendar](https://registrar.fsu.edu/fall-2026-academic-calendar) |
| Final exam period link | [FSU Registrar, Fall 2026 Exam Schedule](https://registrar.fsu.edu/fall-2026-exam-schedule) |
| Home football dates | [2026 football schedule, print view](https://seminoles.com/sports/football/schedule/2026?print=true) |
| Why those dates matter for parking | [FSU Transportation & Parking Services, Game Day](https://transportation.fsu.edu/GameDay) |

**FSU publishes addresses, not coordinates.** That is why no coordinate in this dataset comes from
FSU, and why every building record's `method` is `computed` rather than `fetched`: pairing an FSU
record to an OSM polygon is a join, and a join is a computation that can be wrong. The three joins
that are weakest are named in `DATA-GAPS.md` §3.

### Which buildings shipped, and why those

Not a judgement call about "high traffic" — a count. FSU's own room inventory types every room, and
the first 30 shipped buildings are the 28 with the most `(110) CLASSROOM` rooms that could be given
a coordinate, plus Strozier Library and the New Student Union because a student's next stop between
classes is very often one of those two.

A later pass added two more from the top of the deferred list in `DATA-GAPS.md` §4, both of which
had been held back only because a coordinate could not be found for them at the time:

| Code | Building | Classrooms | Why it can ship now |
| --- | --- | --- | --- |
| `LAW` | B.K. Roberts Hall, College of Law | 9 | Found in OpenStreetMap by name rather than by address. It is 993 m from the mean centre and lands in `east-campus`, not the academic core. |
| `DSL` | Dirac Science Library | 3 | Found by name. Its coordinate is a point-of-interest node *inside* the building rather than a polygon centroid — the only such coordinate in this file. |

The 32 shipped buildings hold 273 of the 421 classrooms FSU lists across its main-campus space
zones. The largest single omission is still `WCB`, the Wertheim Center for Business Excellence, at
24 classrooms; see `DATA-GAPS.md` §4.

Aliases are derived mechanically, not invented: the building code, the code prefixed with "the", the
official name, the name with any parenthetical stripped, that name with a trailing generic noun
(`Building`, `Hall`, `Center`, `House`, `Lab`, `Gym`, `Library`, `Union`) removed and optionally
prefixed with "the", each segment of an FSU name that joins two names with a hyphen, and the
OpenStreetMap name where it differs. So `BEL` yields `bel`, `the bel`, `bellamy`, `the bellamy`;
`LIB` yields `strozier`; and `LAW`, whose FSU name is `B.K. ROBERTS HALL - COLLEGE OF LAW`, yields
`college of law` as well as `b.k. roberts`.

`campusZone` is computed, not looked up: the mean centre of the shipped buildings is taken, and
anything within 700 m of it is `academic-core`, with anything further classified by compass bearing
from that centre into one of four quadrants (315–45° north, 45–135° east, 135–225° south, 225–315°
west). FSU's own A/B/C/D space zones are administrative rather than geographic and do not map onto
the schema's enum, so they are preserved in each record's `notes` instead.

Because the centre is a mean over the shipped set, **adding a building can in principle reclassify
the others**, so the zone is recomputed for every record whenever the set changes. Adding `LAW` and
`DSL` moved the centre 19 m and changed no existing building's zone.

## The walking-time model

Every duration in `walk-edges.json` is computed. **None has been walked with a stopwatch.**

```
straight    = haversine(from.centroid, to.centroid)      // Earth radius 6371008.8 m
distanceM   = straight × PATH_FACTOR                     // PATH_FACTOR   = 1.3
durationSec = round(distanceM ÷ WALK_SPEED_MPS)          // WALK_SPEED_MPS = 1.4
```

**`PATH_FACTOR = 1.3`** — sidewalks are not straight lines. Paths bend around buildings, cross at
crossings rather than diagonally, and start at a door rather than at the middle of a building. 1.3 is
a mid-range circuity figure for a walkable campus grid: enough to stop the estimate being absurd,
not so much that it fabricates precision. It is an assumption, chosen and stated, not a measurement.

**`WALK_SPEED_MPS = 1.4`** — a commonly used design value for adult walking pace, and roughly what an
unhurried student does between classes. Because it is stored on every edge as `paceAssumption`, a
student's own `walkingPaceMetersPerSecond` preference can rescale every edge without the data being
rebuilt.

**What the model leaves out**, all in the optimistic direction:

- time inside either building, including stairs and lifts — the schema's `floorCount` and
  `typicalClassroomFloors` are populated but nothing consumes them yet;
- the distance from the building centre to an actual door, because there are no doors (`DATA-GAPS.md` §1);
- waiting to cross a road;
- class-change crowding, which is exactly when the question gets asked.

So a shipped duration is a **floor, not an estimate of a typical trip**. It is `durationSource:
"estimated"` with `confidence: "medium"` for that reason, and an answer should never tell a student
they will make it on the strength of one of these numbers alone.

**Edge selection.** Each building links to its four nearest neighbours by straight-line distance,
capped at 600 m, symmetrised; any disconnected component is then bridged by its closest cross-component
pair. The result is 85 edges, one connected graph, minimum degree 4 — a sparse near-neighbour graph
rather than the 496 edges an all-pairs matrix would need. `tools/validate-data.mjs` fails the build if
the graph ever stops being connected.

The graph is a **pure function of the shipped centroids**, so adding a building means regenerating
the whole file rather than appending to it: a new building can displace an existing edge by pushing
a neighbour out of some other building's nearest four. Adding `LAW` and `DSL` added 11 edges and
removed 4 (`lov-to-nsu`, `lov-to-stb`, `mch-to-scn`, `pdb-to-scn`, all displaced by `DSL`, which sits
63 m from `MCH`). No bridge edge was needed; `LAW` reaches the rest of the graph through `DIF` at
433 m, comfortably inside the 600 m cap.

## The parking rule model

Rules are an **ordered array evaluated last-match-wins**, firewall style. `rules[0]` is required by
the schema to be a catch-all covering all seven days from `00:00` to `24:00` with no date bounds, so
every instant resolves to some rule and "no rule matched" is unrepresentable. Each later rule is an
exception layered on top.

For all six garages the base rule is deliberately the **restrictive** reading — permit holders only.
FSU publishes when students *may* park, not a general statement that a garage is otherwise open, and
inferring permission from silence is how someone gets a citation. The rules after it widen access for
the windows FSU actually states.

A window whose `endTime` is earlier than its `startTime` wraps past midnight; a window whose end
equals its start is invalid and `tools/validate-data.mjs` rejects it. See the `timeWindow` definition
in `common.defs.schema.json` for the exact evaluation rule, including the fact that `daysOfWeek` names
the days a wrapping window *opens* on, not every day it touches.

### Blackout dates: refuse, do not hedge

Before any of that runs, the date must be checked against `parkingBlackouts` in the `term-calendar`
record covering it. If it matches, **the correct answer is that there is no answer.** Say that FSU
closes and reserves campus parking that day, that this data does not know which areas, and send the
student to [FSU Transportation & Parking Services](https://transportation.fsu.edu/GameDay).

This is deliberately stricter than everything else here, where a low-confidence answer is still an
answer worth giving. The difference is the consequence. FSU's game-day page states that vehicles
must be out "by 11:59 PM the night before game day" and that a vehicle found in a reserved Garnet
area "will be towed at your expense" — and a hedged wrong answer gets the car towed just as
thoroughly as a confident one.

Fall 2026 has seven such dates, and **two of them are not weekends**: Monday 7 September, the Labor
Day game, and Friday 27 November, the day after Thanksgiving. Treating game days as a weekend-only
concern would miss both. What the rules *become* on those dates is not recorded, because FSU does
not publish it; the dates alone are the whole of what can be sourced, and they are enough to refuse
safely.

## Refreshing the term calendar

`term-calendar.json` goes stale every term and is the file most likely to be wrong when nobody has
looked at it. To regenerate:

1. Open the Registrar's calendar for the term:
   `https://registrar.fsu.edu/<season>-<year>-academic-calendar` — for example
   [`fall-2026-academic-calendar`](https://registrar.fsu.edu/fall-2026-academic-calendar). If that
   URL 404s, start from [`registrar.fsu.edu/bulletins/calendar`](https://registrar.fsu.edu/bulletins/calendar);
   the Registrar has moved these pages before.
2. Add a new element to the array — do not edit the existing one. Old terms stay valid for a student
   asking about a past schedule.
3. Set `termCode` as `YYYY-season` using the year classes *begin*, so January–April 2027 is
   `2027-spring`.
4. Fill `startDate`, `endDate`, `classesBeginDate`, `classesEndDate`, then walk the page top to bottom
   and transcribe. **Quote the Registrar's wording in `description` rather than paraphrasing** — the
   difference between "last day to drop a course without receiving a grade" and "last day to withdraw
   from school without receiving a grade" is a real distinction on the same date, and paraphrase
   destroys it.
5. Check whether the page now publishes first-half / second-half session ranges, and check
   [`registrar.fsu.edu/calendar/extended`](https://registrar.fsu.edu/calendar/extended) too — as of
   this writing that page carries them for summer terms only. If you find them, fill `sessions` and
   set `sessionsStatus` to `"published"`. If you do not, leave `sessions` empty and set
   `"not-published"`; half-term conflict checking cannot work until this changes (`DATA-GAPS.md` §8).
   Never leave the array empty without setting the status — that is the exact ambiguity the field
   was added to remove.
6. Point `finals.url` at the term's published exam schedule, which is a *different* page from the
   academic calendar — for Fall 2026 it is
   [`fall-2026-exam-schedule`](https://registrar.fsu.edu/fall-2026-exam-schedule). The grid itself
   does not get transcribed; there is nowhere in the schema to put it.
7. Fill `parkingBlackouts` from the season's home football schedule. The print view of the
   `seminoles.com` schedule is server-rendered and readable —
   `https://seminoles.com/sports/football/schedule/2026?print=true` — while the ordinary page is
   not. Take every game whose location is Tallahassee, **compute** each weekday from the date rather
   than assuming Saturday, and record only the date and the reason. Do not invent a game-day parking
   rule; there isn't a published one.
8. Set `provenance.retrievedOn` to the date you actually fetched the page, and record in
   `provenance.note` anything the page did not supply.
9. Run `npm run validate` from the repository root. It must exit zero.

Nothing else in this directory is term-specific. Buildings, walk edges and parking rules change on a
slower cycle — check them annually, and re-check parking whenever FSU announces a permit change.

## Not affiliated with FSU

Independent project. Campus data is transcribed from public sources and may be wrong or out of date.
