# Data gaps

Everything that is missing from `plugins/nole-schedule/data/`, why, and what was tried.

This file is a to-do list, not an apology. The build rule is that a record is either read off a page
actually fetched, or computed from records that were, or it does not ship — so every judgement call
that could not be sourced ended up here instead of in the data. A gap listed here is safer than a
plausible-looking guess in `data/`, which is the whole point.

Data was collected **2026-08-27**, with a second pass on **2026-08-28** that added two buildings,
seven parking blackout dates, and a link to the exam grid. Sources used: the
[FSU Building Information Portal](https://www.facilities.fsu.edu/space/buildings/), the FSU room-lookup
service behind it, [FSU Transportation & Parking Services](https://transportation.fsu.edu/parking),
the [FSU Registrar's Fall 2026 Academic Calendar](https://registrar.fsu.edu/fall-2026-academic-calendar),
and OpenStreetMap via the Overpass API.

---

## 1. No real entrances exist. Every building routes from its centre.

**The single biggest gap, and it affects all 33 buildings.** Each building in `buildings.json`
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
exactly), **14 `medium`** (name match only, OSM polygon carries no address, or the two sources
disagree about the street), **4 `low`** (see below).

`WCB` is the fourth and is a different kind of weak from the other three: it has no OpenStreetMap
element at all, so its coordinate does not come from a polygon join. It is the mean of three
independent **address geocodes**. See §3.

## 3. The four low-confidence building coordinates

Plus two `medium` records whose weakness is worth naming here even though they cleared the bar:
`LAW`'s OSM element sits on West Pensacola Street while FSU gives 425 W Jefferson St, so the two
sources disagree about the street and only geometry ties them together; and `DSL`'s coordinate is a
**point-of-interest node inside the building**, not a polygon centroid — the only coordinate in the
file derived that way, and offset from the building's true centre by an unknown amount.

| Code | Building | Problem |
| --- | --- | --- |
| `WJB` | Johnston Building | OSM has **two** polygons both named "Johnston", 57 m apart, neither with an address. The shipped coordinate is their midpoint, which may fall between the wings rather than inside either. FSU's address, 143 Honors Way, is consistent with both. |
| `PDB` | Psychology Department Building | OSM has "Psychology Building A" and "Psychology Building B", both tagged `1107 West Call Street` — the same address FSU gives for `PDB`. FSU has a separate code `PDA` for the Psychology Department Auditorium, so `PDB` is one of A/B or both. The shipped coordinate is the midpoint of A and B. |
| `HWC` | Coburn Wellness Center | Paired to an OSM polygon named "Wellness Building". Similar, not identical, and the OSM polygon has no address to confirm against. Plausible and unconfirmed. |
| `WCB` | Herbert Wertheim Center for Business Excellence | **No OpenStreetMap element of any kind.** The coordinate is the mean of three independent geocodes of FSU's published address; they disagree by up to 104.6 m, which is comparable to the building's own footprint. Added 2026-08-31; see below. |

### `WCB` in detail, because it is the newest and the weakest

FSU publishes no coordinates and OpenStreetMap has no polygon for this building — an Overpass query
for `building` ways within 250 m of the address returns 45 elements and **none of them is on this
block**, because the construction is too recent to have been mapped. So unlike every other record in
the file, there is no polygon to join to and the shipped point is an **address point**.

Three independent geocodes of FSU's published `402 W Gaines St`:

| Source | Coordinate | Kind |
| --- | --- | --- |
| US Census Bureau geocoder (`Public_AR_Current`) | 30.435556684975, −84.285716372278 | TIGER address-range interpolation, line 82851215, side R |
| Esri World Geocoding Service | 30.436000647226, −84.286678500607 | `PointAddress`, score 100 |
| OpenStreetMap node 8381890349 | 30.4357406, −84.2862174 | `place=house` address node |

Shipped value is their mean: **30.4357660, −84.2862041**, which sits 3.1 m from the OSM node and
about 52 m from each of the other two.

**Two cross-checks confirm the block**, and both are FSU statements rather than more geocoding:

1. FSU's own FAQ places the **southeast corner entrance at Gaines St and MLK Blvd**. OSM puts that
   junction (node 98446167) at 30.4354658/−84.2856235 — **64.9 m southeast** of the shipped point,
   which is the right direction and the right magnitude for a corner of a building this size.
2. FSU News places it **"just south of the Donald L. Tucker Civic Center"**. OSM way 168363245 puts
   the Civic Center at 30.4377202/−84.2866811 — **222.1 m north** of the shipped point.

These also **resolve the ambiguity this file recorded in §4**: a Nominatim search for the street
address returns two candidates about 1.5 km apart, and the western one (30.4355039/−84.3019140) is
ruled out by all four lines of evidence above.

**What the coordinate is not:** a surveyed position, a polygon centroid, or a door. A walking
estimate through it inherits an error of the order of 50 m at that end, on top of everything already
wrong with the walk model. It ships `low` for that reason, and `low` means good enough to route with
and not good enough to act on.

**To close it properly:** a GPS reading at the building, or wait for OpenStreetMap to map it.

## 4. Classroom buildings on main campus that did not ship

33 buildings ship, holding **297 of the 421** rooms FSU types as `(110) CLASSROOM` across its
main-campus space zones. 30 buildings with at least one classroom did not ship. The ones worth adding
next, in order:

| Code | Classrooms | Building | Why it is missing |
| --- | --- | --- | --- |
| `UCD` / `UCC` / `UCB` | 8 / 6 / 3 | University Center buildings D, C, B | Matched by name in OSM, but they ring Doak Campbell Stadium roughly a kilometre southwest of the academic core, and admitting them would stretch the walk graph across a gap with no sourced path. Deferred rather than rejected. |
| `CAR`, `DOD`, `FLH`, `UPL`, `LSB`, `EOA`, `DSC`, `LON`, `FAA` | 1–2 each | various | All resolved cleanly to OSM coordinates; they simply fell below the original cut. Adding them is nearly free. |

**Closed in the 2026-08-31 pass: `WCB`, which had been the largest single omission by a wide
margin** — 24 classrooms, the biggest classroom count of any building now in the file, and the home
of the business school, so any finance or management student hit the unknown-building path on
almost every course they took.

Earlier passes failed on it because they searched OpenStreetMap, which still has nothing there. What
worked was abandoning OSM as the coordinate source and geocoding FSU's published address through
**three independent services**, then cross-checking the result against two FSU prose statements about
what the building is next to. §3 has the full derivation, the numbers, and the reasons it still ships
at `low` confidence. `UCB` now carries the unknown-building test fixture that `WCB` used to.

The FSU Building Information Portal moved during this pass: `facilities.fsu.edu/space/buildings/`
now 301-redirects to `forms.pdc.fsu.edu/portal`, and the per-building URL is
`https://forms.pdc.fsu.edu/portal/building/?bldg=<number>` — WCB is building **4540**. The room
inventory behind it, `https://forms.pdc.fsu.edu/portal/room-lookup/?bldg=<number>`, is **public and
needs no login**, which is what supplied the 24 classroom numbers and their floors.

**Closed in the 2026-08-28 pass.** `LAW` (9 classrooms) and `DSL` (3) were both listed here as
having no OSM match. Both in fact match by *name* — the earlier pass had searched by address only,
and neither building's OSM element carries FSU's address. Both now ship at `medium` confidence; see
§3 for what remains weak about them.

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
[`plugins/nole-schedule/data/README.md`](plugins/nole-schedule/data/README.md) for the constants and
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

**`WCB` is a leaf node, and its routes are the one place the error runs pessimistic.** Nothing else
ships within the graph's 600 m edge cap of it — the next nearest after `LAW` at 380 m is `DIF` at
676 m — so `WCB` has exactly one edge and every route in or out detours through `LAW`:

| Route | Graph path | Straight-line model | Detour |
| --- | --- | --- | --- |
| `WCB`→`DIF` | 1057 m | 879 m | ×1.20 |
| `WCB`→`HCB` | 2000 m | 1730 m | ×1.16 |
| `WCB`→`PDB` | 3195 m | 2620 m | ×1.22 |

So a walking answer involving `WCB` is inflated by roughly 15–20% by graph topology, which is the
**opposite** direction from every other error in this file. It is left as it is: the detour is a
consequence of the documented edge-selection rule, and quietly widening the cap for one building
would rewrite the other 84 edges' basis. A consumer does not need to correct for it — being long is
the safe direction — but should not claim precision about a WCB route either.

### One real-world corroboration, at the long end

*Recorded 2026-08-31.* The `WCB`→`PDB` leg — the longest routine leg any test schedule produces, and
the one where the leaf detour and the safety margin stack most — is reported as **38–54 minutes**.
A student who makes that trip regularly reports that figure is **accurate, not inflated**.

This is the only point on the model that has been checked against reality at all, and it is worth
writing down precisely because the preceding paragraphs predicted the opposite. The leaf detour and
the margin are *not* producing a false negative here; at the long end they land about right.

**Nothing was tuned on the strength of it, and nothing should be.** One leg, one observer, one mode,
no stopwatch, and it is a single point at the extreme end of the range — the place where a
proportional error is largest in absolute terms and therefore easiest to feel as "about right". It
is corroboration, not calibration. `PATH_FACTOR`, `WALK_SPEED_MPS` and `SAFETY_MARGIN` are unchanged.
What would justify changing them is the fieldwork in §1 and §6 above: a set of measured edges across
a range of distances, which is what a `p90Seconds` needs anyway.

What this *did* expose is a different gap entirely, and a real one: on that leg the plugin told a
student a true thing about **a mode they do not use**. See §10.

Adding `WCB` also **displaced an existing edge**, exactly as this model predicts it can:
`krb-to-law` disappeared because `WCB` pushed `KRB` out of `LAW`'s nearest four. That is why
`tools/build-walk-graph.mjs` exists and why it has a `--check` mode that reproduces the shipped file
byte-for-byte before it is allowed to write one.

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
2. **Home football dates are now encoded; what happens on them is not.** *Partially closed
   2026-08-28.* The seven Fall 2026 home dates are in `term-calendar.json`'s `parkingBlackouts`, read
   from the print view of the `seminoles.com` schedule (the ordinary page is client-rendered and
   yields nothing, which is why the first pass failed). Two of the seven are not Saturdays: the Labor
   Day Monday, 7 September, and the Friday after Thanksgiving, 27 November.

   **What is still missing is everything about what the rules become.** FSU says only that *"multiple
   campus parking areas will be closed for reserved Seminole Booster parking on home football game
   days"*, that vehicles must be out *"by 11:59 PM the night before game day"*, and that a vehicle in
   a reserved Garnet area *"will be towed at your expense"*. It never says which areas, or which
   garages, or when access returns. So the shipped rules remain wrong on those dates and the dates
   are recorded to force a **refusal**, not to enable an answer. Encoding a game-day rule would mean
   inventing one. The night-before clause also means the blackout effectively starts on the evening
   of the preceding day, which the date list does not currently model — a consumer should treat the
   evening before a listed date as suspect too.
3. **No per-floor permit split.** Third-party summaries state the first floor of every FSU garage is
   faculty/staff (R/RP) and upper floors are student (W). That sentence does not appear on any FSU
   page fetched for this build, so it is not asserted. The rules describe the garage as a whole.
4. **`WCB` has sourced parking guidance that this schema cannot hold.** *Noted 2026-08-31.* The
   building's own FAQ says students have "designated lots within a 10-minute walk" and shared
   parking "within 7 minutes", that the "metered spaces along the perimeter of the Wertheim Center"
   are maintained by **the City of Tallahassee** rather than FSU, and that visitors may use the
   Donald L. Tucker Civic Center. **None of that is representable here**: no surface lot ships, no
   metered space ships, no non-FSU operator is modelled, and FSU names no specific lot. So the
   nearest garage this data can offer for a `WCB` class is `PG5` at about 7–13 minutes, and it is
   **not** in any garage's curated `servesBuildings` — the parking script reports it as "nearest by
   geometry only". For the building with the most classrooms on campus, the shipped parking answer
   is therefore the weakest one in the file, and it must say so.

## 8. Term calendar: three things the page or the schema could not carry

- **No `sessions` array, and it is not an oversight.** *Investigated 2026-08-28; not closeable from
  any FSU page.* The Registrar publishes session date breakdowns for **summer terms only**:
  [`registrar.fsu.edu/calendar/extended`](https://registrar.fsu.edu/calendar/extended) lists them for
  summer and gives Fall 2026 as a single Aug 24 – Dec 11 span, and the Fall 2026 calendar page has no
  session table at all. A course meeting's `partOfTerm` therefore cannot be resolved against anything
  in a fall term, so **half-term conflict checking does not work** — the exact false-conflict problem
  the field exists to prevent.

  What changed is that the gap is now *explicit rather than silent*. `term-calendar.schema.json`
  gained a required `sessionsStatus`, set to `"not-published"` on the shipped record, and
  `partOfTerm` gained a written `RESOLUTION RULE` with three outcomes instead of two. A consumer can
  now distinguish "these do not overlap" from "I cannot tell whether these overlap", and is required
  to say the latter rather than guessing. That does not make half-term conflict checking work; it
  makes its absence impossible to mistake for a clean answer.

  Note that this also compromises `appliesToSession` on deadlines: half-term courses have their own,
  much earlier drop and withdrawal dates, and with no sessions to attach them to, every deadline in
  the shipped record is a full-term one.

  **To close it:** find a source that states fall session ranges — a departmental calendar, a course
  catalogue, or the Student Central schedule search — or read them off a student's own registration
  record at import time and store them per-meeting as a `custom` `dateRange`.
- **No final exam grid.** `finals` carries only the Dec 7–11 range. *Improved 2026-08-28:* the grid
  does exist, at [`registrar.fsu.edu/fall-2026-exam-schedule`](https://registrar.fsu.edu/fall-2026-exam-schedule),
  with block exams for MUT/STA/AST/PHY/BUL/CHM and the foreign languages plus full MWF and TR grids,
  and `finals.url` now points there instead of at the academic calendar. The grid itself is still not
  in the data, because `finalsPeriod` has only `startDate`/`endDate`/`note`/`url` and nowhere to put
  a mapping from meeting pattern to exam block. **A schema change is the right fix.** Until then a
  weekly schedule expanded across that week is simply wrong, and the record says so in its `note`.
- ~~**Homecoming Friday is a half day** and `nonClassPeriod` has no way to express a partial day.~~
  **Closed 2026-08-31, by the schema change this entry called for.** `nonClassPeriod` gained an
  optional `cancelledFromTime`, and the Homecoming record now carries `"12:00"` alongside
  `classesCancelled: false`. The two fields together are three-valued — classes meet / classes meet
  until this time / no classes — where the boolean alone read as "an ordinary day" and would have
  sent a student to a 2 p.m. class that is not happening. `lib/schedule.mjs`'s `dayStatus()` returns
  `partial` for it and `whats-next` lists the afternoon meetings under CANCELLED rather than
  omitting them.
- No reading day appears on the Registrar's page, so none is recorded.

## 9. Everything about accessibility

There is no accessibility data anywhere in this dataset: not on entrances, not on walk edges, not on
garage access points. `student-schedule.schema.json` defines `requiresAccessibleRoutes`, and the
correct behaviour when it is set is to **report that the data cannot answer**, never to quietly return
the default route.

## 10. Modes other than walking

*Opened 2026-08-31, and partly closed the same day.*

Until 0.7.0 this plugin modelled **walking and nothing else**. That was invisible while every
answerable leg was a short one, and became obvious the moment `WCB` shipped and the `WCB`→`PDB` leg
started returning a correct 38–54 minutes to a student who **drives** that leg. The number was right
and the answer was useless: it was a true statement about a mode the student does not use, and the
verdict attached to it — a flat "no" — read as "you cannot make this class" when the truth was "not
on foot".

**What now ships.** A leg too long to walk returns `not-walkable` rather than `no`, and names what
else exists. Where both ends are shipped buildings it also produces a four-part drive plan.

**What is still missing, per component:**

| Component | Status | Why |
| --- | --- | --- |
| walk to the car | estimated, **weak** | Straight-line to a garage centroid. No walk edge in the graph has a parking endpoint (§6), so this is weaker than an ordinary walking estimate. |
| drive time | estimated | `haversine × 1.45 ÷ 6.7 m/s`. Both constants **chosen, not measured**, same as the walking model. No road network is shipped, so this cuts across blocks a car cannot. |
| **finding a space** | **not estimable at all** | The core of the gap. See below. |
| walk from garage | estimated, **weak** | Same weakness as the leg to the car. |
| deck to street level | **unmodelled** | Garage access points are `centroid-stand-in` and `verticalTransit` is unpopulated on every one, so stairs and lifts inside a garage are not counted anywhere. |

**Time to find a space cannot be estimated, and this is the honest core of the feature.** §7 lists
what is missing per garage: no capacity, no `adaSpaces`, no `typicalFullBy`, no occupancy feed, no
historical fill data. There is nothing to derive a search time from, and on a weekday morning it is
routinely the largest term in the whole trip. So `lib/driving.mjs` returns it as
`{ estimable: false }` with **no seconds key on the object at all**, and the plan it returns has **no
total field** — only a `knownMinimumSeconds` explicitly labelled as the floor before the search
begins. A drive answer that produced "about 12 minutes" would be the same class of harm as a hedged
game-day parking answer: the student arrives late because PG5 was full.

**To close it:** a capacity and `typicalFullBy` per garage would let the search be *bounded*. A live
occupancy feed would let it be *answered*. Neither is published on any FSU page fetched for this
build.

**One thing to watch in the arithmetic.** A drive leg has two walking components, and `SAFETY_MARGIN`
is a multiplier *plus a flat 180 seconds*. The flat part is a per-JOURNEY allowance — doors at both
ends, time inside both buildings, one road crossing — so it is charged **once**, on the sum of the
two walk legs, not once per leg. Applying it twice would add three minutes of pure double-counting.
Every component in a drive plan carries a `carriesMargin` field recording which side of this it falls
on, and a test asserts the once-versus-twice difference is exactly the flat allowance.

## 11. Seminole Express: fetchable, and deliberately not built yet

*Investigated 2026-08-31. Route and timetable data **is** available; it is scoped here and left for a
later step.*

FSU's campus bus is operated by the City of Tallahassee's StarMetro. What exists:

| Source | What it gives | URL |
| --- | --- | --- |
| FSU Transportation, Bus Services | Operating hours only, no stop times | `https://transportation.fsu.edu/bus` |
| StarMetro FSU routes page | The seven route names, per-route map **PDFs**, no stop times | `https://www.talgov.com/starmetro/starmetro-routes-se` |
| **StarMetro static GTFS** | **The whole timetable**: stops with coordinates, stop times, trips, calendars | `https://www.talgov.com/Uploads/Public/documents/starmetro/GTFS.zip` |
| Transitland feed record | Confirms the feed is live and tracked | `https://www.transit.land/feeds/f-djkj-starmetro` |

The seven routes are **Garnet, Gold, Heritage, Innovation, Osceola, Renegade and Tomahawk**, plus
**Nite Nole** in the evenings. Published hours are *"Fall & Spring Semester: 7 AM - 8 PM, Monday -
Friday"*, *"Summer Semester: 7 AM - 5 PM, Monday - Friday"*, and *"Buses do not run during University
closures and when classes are not in session."* Transitland records the GTFS feed as active with a
successful fetch on **2026-08-31**.

**Why it is not built here.** A GTFS import is a whole step: a new schema for routes, stops and stop
times, a `.zip` and CSV parser that has to stay Node-builtins-only, a stop-to-building association
that is its own sourcing problem, and the question of how a bus leg composes with a walking leg at
both ends. Bolting a half-version of that onto this step would produce exactly the kind of
confident-sounding answer the rest of this file exists to prevent.

**So the `not-walkable` message names the shuttle and admits it knows nothing about it** — no times,
no stops, no claim that a bus helps on any particular leg — and points at the Transit app, which has
live times. A test asserts the shuttle alternative carries `known: 'none'` and quotes no duration.

**To close it:** parse the GTFS feed, and solve stop-to-building association honestly rather than by
nearest-neighbour guessing.
