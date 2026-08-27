# Data gaps

Everything that is missing from `plugins/fsu-schedule/data/`, why, and what was tried.

This file is a to-do list, not an apology. The build rule is that a record is either read off a page
actually fetched, or computed from records that were, or it does not ship — so every judgement call
that could not be sourced ended up here instead of in the data. A gap listed here is safer than a
plausible-looking guess in `data/`, which is the whole point.

Data was collected **2026-08-27**. Sources used: the
[FSU Building Information Portal](https://www.facilities.fsu.edu/space/buildings/), the FSU room-lookup
service behind it, [FSU Transportation & Parking Services](https://transportation.fsu.edu/parking),
the [FSU Registrar's Fall 2026 Academic Calendar](https://registrar.fsu.edu/fall-2026-academic-calendar),
and OpenStreetMap via the Overpass API.

---

## 1. No real entrances exist. Every building routes from its centre.

**The single biggest gap, and it affects all 30 buildings.** Each building in `buildings.json`
carries exactly one entrance whose id is `centroid-stand-in`, placed at the building's centroid and
labelled as not being a door.

Walking estimates through those nodes are short by the distance from the middle of a building to
whichever door you actually use — call it 10 to 40 m at each end, so 15 to 60 seconds on a typical
trip, always in the optimistic direction. Nothing in the data can currently answer "which door should
I leave by", and no consumer should phrase an answer as though it could.

What was tried:

| Attempt | Result |
| --- | --- |
| OpenStreetMap `entrance=*` nodes across the campus bounding box | 24 nodes for the whole campus. 13 tagged only `entrance=yes`, 5 carry a `wheelchair` tag, none carry a name, and they are not associated with a named building in the extract. Too thin and too easy to attach to the wrong building. |
| FSU Building Portal building profile pages | Carry name, number, address, departments and floor plans. **No coordinates of any kind**, for the building or its doors. |
| FSU interactive campus map (`campus.map.fsu.edu`) | A Concept3D vendor application. Its location API requires a key that is not published on the page, and reverse-engineering the vendor's key was rejected as both brittle and inappropriate. |

**To close it:** walk the campus with a GPS and record doors, or find an FSU accessibility/wayfinding
dataset that publishes door locations. This is fieldwork, not a fetch.

## 2. No coordinate in this dataset comes from FSU

FSU publishes building **addresses**, not latitude and longitude. Every coordinate in `buildings.json`
and `parking-zones.json` therefore comes from an OpenStreetMap building polygon, paired to the FSU
record by street address where possible and by name otherwise. The join method and its confidence are
recorded per record in `provenance.note`.

Confidence ladder as shipped: **15 buildings `high`** (FSU street address and OSM `addr:*` tags match
exactly), **12 `medium`** (name match only, OSM polygon carries no address), **3 `low`** (see below).

## 3. The three low-confidence building coordinates

| Code | Building | Problem |
| --- | --- | --- |
| `WJB` | Johnston Building | OSM has **two** polygons both named "Johnston", 57 m apart, neither with an address. The shipped coordinate is their midpoint, which may fall between the wings rather than inside either. FSU's address, 143 Honors Way, is consistent with both. |
| `PDB` | Psychology Department Building | OSM has "Psychology Building A" and "Psychology Building B", both tagged `1107 West Call Street` — the same address FSU gives for `PDB`. FSU has a separate code `PDA` for the Psychology Department Auditorium, so `PDB` is one of A/B or both. The shipped coordinate is the midpoint of A and B. |
| `HWC` | Coburn Wellness Center | Paired to an OSM polygon named "Wellness Building". Similar, not identical, and the OSM polygon has no address to confirm against. Plausible and unconfirmed. |

## 4. Classroom buildings on main campus that did not ship

30 buildings ship, holding **261 of the 421** rooms FSU types as `(110) CLASSROOM` across its
main-campus space zones. 33 buildings with at least one classroom did not ship. The ones worth adding
next, in order:

| Code | Classrooms | Building | Why it is missing |
| --- | --- | --- | --- |
| `WCB` | 24 | Herbert Wertheim Center for Business Excellence | No OpenStreetMap polygon under FSU's address (402 W Gaines St) or under any matching name. Recent construction; OSM has not caught up. **This is the largest single omission** — a 24-classroom building students are timetabled into. |
| `LAW` | 9 | B.K. Roberts Hall, College of Law | No OSM match by address (425 W Jefferson St) or name. |
| `DSL` | 3 | Dirac Science Library | No OSM match by address (110 N Woodward Ave) or name, despite being a major building. |
| `UCD` / `UCC` / `UCB` | 8 / 6 / 3 | University Center buildings D, C, B | Matched by name in OSM, but they ring Doak Campbell Stadium roughly a kilometre southwest of the academic core, and admitting them would stretch the walk graph across a gap with no sourced path. Deferred rather than rejected. |
| `CAR`, `DOD`, `FLH`, `UPL`, `LSB`, `EOA`, `DSC`, `LON`, `FAA` | 1–2 each | various | All resolved cleanly to OSM coordinates; they simply fell below the 28-building cut. Adding them is nearly free. |

## 5. Off-main-campus teaching sites, deliberately excluded

These hold classrooms but are not walkable from the academic core, and putting them in a walk graph
whose edges are straight-line estimates would produce nonsense routes.

- `CE1` / `CE2` — FAMU-FSU College of Engineering, 2525 Pottsdamer St, Innovation Park (7 classrooms each)
- `CLI` / `CLO` — Nursing clinical placements at 1401 Centerville Rd (32 and 21 rooms typed as classroom)
- `MAG` — National High Magnetic Field Laboratory, Innovation Park
- `CLC` — Challenger Learning Center, 200 S Duval St, downtown
- `CAB`, `CRT`, `FHP`, `JMB` — Carnaghi Arts, Critchfield, FHP Academy, Jim Moran Building

A future release should model these with a `campusZone` other than `academic-core` and refuse to
route between zones rather than pretending the walk is possible.

## 6. Walking times are computed and have never been measured

Every edge in `walk-edges.json` is `durationSource: "estimated"` with `provenance.method: "computed"`
and `confidence: "medium"`. The model is haversine distance × 1.3 ÷ 1.4 m/s; see
[`plugins/fsu-schedule/data/README.md`](plugins/fsu-schedule/data/README.md) for the constants and
their justification.

Missing as a direct consequence:

- **No `measurement` block on any edge**, so no `medianSeconds` and no `p90Seconds`. The p90 is the
  honest number for "will I make it", and the data does not have one.
- **No `accessibility` block on any edge.** Nothing in the dataset can answer a question about
  step-free routing, and a consumer must say so rather than fall back to the default route.
- **No `surface`, `coverage`, or `crowdFactors`.** In particular the class-change surge — the
  motivating case for `crowdFactors` in the schema — is entirely unmodelled.
- **No `waypoints.json`.** Edges connect building centroids directly, so the graph has no path
  junctions and no crosswalks. `tools/validate-data.mjs` already knows how to validate that file when
  it appears.
- The 1.3 path factor and 1.4 m/s pace are **assumptions, not measurements**, chosen and documented
  rather than sourced. They are the two numbers most worth replacing first.

## 7. Parking: six garages, and nothing else

`parking-zones.json` holds the six FSU parking garages and no other parking of any kind.

**Missing entirely:** every surface lot, every reserved (green-striped) lot, employee-only lots,
student overnight lots, the DeGraff resident lot, metered and visitor parking, and any park-and-ride.
FSU's parking map is served by the same key-gated Concept3D application as the campus map, and the
prose pages name permit *types* rather than enumerating *places*.

**Missing per garage:** capacity, ADA space counts, `typicalFullBy`, payment methods, EV charging
spaces, vehicle entrances, and real pedestrian exits. Each garage has a single `centroid-stand-in`
access point for the same reason buildings do.

Three specific unresolved problems:

1. **FSU contradicts itself about student white-space hours.** The garages section of
   `transportation.fsu.edu/parking` says students may park in Student (W) White Spaces
   *"from 5:45 AM to Midnight, unless denoted by signage"*. The general parking section of the same
   site says *"Monday - Friday, 7:30 AM - 4:30 PM"*. FSU does not say which governs a white space
   inside a garage. The shipped rule uses the wider garage-specific wording and **records the
   conflict in its `enforcementNote` rather than resolving it**.
2. **No home football game dates are encoded.** FSU states *"Open weekend parking varies during home
   football games"* and publishes no dates on the parking pages. The 2026 schedule on `seminoles.com`
   is rendered client-side and could not be read. **On a home game Saturday the shipped weekend rule
   is wrong** and will report a garage as open when it may be closed, reserved, or a tow-away zone.
3. **No per-floor permit split.** Third-party summaries state the first floor of every FSU garage is
   faculty/staff (R/RP) and upper floors are student (W). That sentence does not appear on any FSU
   page fetched for this build, so it is not asserted. The rules describe the garage as a whole.

## 8. Term calendar: three things the page or the schema could not carry

- **No `sessions` array.** The Registrar's Fall 2026 page publishes no first-half / second-half date
  ranges. A course meeting's `partOfTerm` therefore cannot be resolved against anything, which means
  **half-term conflict checking does not work** — the exact false-conflict problem the field exists to
  prevent.
- **No final exam grid.** `finals` carries only the Dec 7–11 range. A weekly schedule expanded across
  that week is simply wrong, and the record says so in its `note`.
- **Homecoming Friday is a half day** — classes cancelled only after 12:00 p.m. on Nov 20 — and
  `nonClassPeriod` has no way to express a partial day. It ships with `classesCancelled: false` and the
  detail in the name, which understates it. **A schema change is the right fix**, not a data change.
- No reading day appears on the Registrar's page, so none is recorded.

## 9. Everything about accessibility

There is no accessibility data anywhere in this dataset: not on entrances, not on walk edges, not on
garage access points. `student-schedule.schema.json` defines `requiresAccessibleRoutes`, and the
correct behaviour when it is set is to **report that the data cannot answer**, never to quietly return
the default route.
