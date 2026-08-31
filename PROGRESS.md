# Progress

The running record of what each step of this build delivered, what is still
outstanding, and where the next step picks up. **Append a section at the end of
every step.** Newest step last.

This file exists because the state of the project is not recoverable from the code
alone: several decisions here are about what was deliberately *not* built, and a
commit log does not record those.

---

## Step 1 — Scaffold (`d249172`)

Marketplace and plugin manifests, and the shape of the data contracts.

- `.claude-plugin/marketplace.json` and `plugins/fsu-schedule/.claude-plugin/plugin.json`.
- Repository layout settled: `tools/` and `package.json` at the root, never inside
  the plugin, so that nothing a student installs carries a dependency.
- `NOTES-SPEC.md` — what the live plugin docs actually say about manifest schemas,
  skill layout, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` and relative
  source resolution, recorded so it never has to be re-fetched.

## Step 2 — Campus data and validators (`26faf2c`)

Real, sourced FSU data plus the tooling that guards it.

- 32 buildings, 85 walk edges, 6 parking garages, the Fall 2026 calendar.
- `tools/validate-schemas.mjs` and `tools/validate-data.mjs` (Ajv, dev-only).
- Three schema fixes fell out of validating real data against them.
- **The standing rule, set here:** never write a data record from memory. A record
  is read off a page actually retrieved, or computed from records that were, or it
  is logged in `DATA-GAPS.md`. Every shipped record carries a `provenance` block.

## Step 3 — The import skill (`2e1f1dc`, `221c41d`)

Plugin 0.3.0. Made unresolvable facts explicit, then shipped the importer.

- `import-schedule` SKILL.md, four dependency-free scripts, `lib/` shared code.
- The adversarial fixture suite (01–06) and `npm test`, including the **PARITY**
  section: `lib/validate.mjs` re-implements two schemas by hand because the plugin
  cannot ship Ajv, and parity against Ajv is the only thing stopping it drifting.
- Four contracts written into the schemas rather than left as convention:
  1. `partOfTerm` has **three** outcomes. Fall sessions are unpublished, so a
     non-full-term meeting is UNRESOLVABLE and a conflict answer must be able to
     say "cannot determine" — never "no conflict".
  2. `parkingBlackouts` carries seven Fall 2026 home football dates (two not
     Saturdays). The contract is **refusal**, not a hedge.
  3. `locationTba: true` (physical, unknown) and `location: null` (online) are
     different, and the schema forbids mixing them.
  4. An unknown building code is an **ordinary** outcome. 32 of ~500 ship.

## Step 4 — Draft first, ask second (`60c394c`)

Plugin 0.4.0. A design fix, found by running the 0.3.0 skill against a real
screenshot: **it interrogated before it showed anything.** That import opened with
four blocking questions — which term, what are the section numbers, does this
Thursday course really meet once, and a digit-by-digit recital of five room
numbers — before the student saw a single row of their own schedule.

**The rule now written into the skill:** a question must earn its place. Ask only
when the answer cannot be inferred **and** getting it wrong would produce a
schedule that is quietly incorrect — wrong in a way the student would not catch
while reading the draft. Everything else is a stated assumption under the table,
correctable in one word.

What changed:

- **Term is derived, not asked.** New `current-term.mjs` + `currentTerm()` in
  `lib/campus.mjs`, from today's date and the shipped calendar. It reports a
  `basis` — `calendar` / `next-term` / `month` — because the three do not deserve
  equal confidence, and only `month` is weak enough to be worth a question.
- **`section` and `title` were `required` in `course-meeting.schema.json`.** That
  was the schema defect forcing the interrogation: a grid screenshot carries
  neither. Both are optional now, with the reasoning recorded at the field, and
  `lib/validate.mjs` mirrors it. Meeting ids no longer need a section:
  `ism3541-lecture-th`.
- **A once-weekly course is ordinary.** Noted as an observation under the table,
  never asked about.
- **OCR rooms keep the check, lose the interrogation.** Bold in the draft table,
  one closing question.
- **`review-schedule.mjs` computes the split itself**, printing `ASSUMPTIONS` and
  `MUST ASK` *after* the week. The ordering is a property of the tool now, not a
  hope about the model. Blocking is exactly: an unparsed row, an ambiguous time,
  or a genuine full-term collision.

Deliberately unchanged: unknown buildings still import with a warning and never
fail a schedule; `partOfTerm` is still never guessed; nothing is invented to make
a record validate; the write path still validates for itself.

Tests: **154 checks.** Fixture **07** is the regression — the exact screenshot that
produced four questions, asserting **zero**. Every fixture carries an exact
`blockingQuestions` count, and a `FLOW` section asserts `THE WEEK` precedes
`MUST ASK` in the text a student actually sees, including on fixture 05 which does
have something to ask.

## Step 5 — The two consequential query skills

Plugin 0.5.0. `can-i-make-it` and `parking`: the first two skills where a wrong
answer costs a student something. The data under both is known-weak, so the job
was never to compute a confident number — it was to answer honestly given data we
already know is thin, and to enforce that **in the scripts rather than in prose the
model might skip**. That is the step 4 pattern applied to a harder case.

### The safety margin

`scripts/lib/routing.mjs` holds one constant and the whole justification for it:

    SAFETY_MARGIN = { fixedSeconds: 180, crowdMultiplier: 1.35 }
    realistic = round(optimistic × 1.35) + 180

Every duration in `walk-edges.json` is computed, never measured, and omits five
things **all in the optimistic direction**: real doors, time inside the buildings,
waiting at crossings, class-change crowding, and the fact that `PATH_FACTOR = 1.3`
and `WALK_SPEED_MPS = 1.4` are themselves assumptions. There is no `measurement`
block on any edge, so there is no p90 — and the p90 is the honest number for "will
I make it". **This constant is what stands in for the missing p90.**

`fixedSeconds` is three stated 60-second components: centroid-to-door at both ends
(`DATA-GAPS.md` §1 gives 15–60 s per trip; the top of the published range is
taken), time inside the buildings, and one signalled road crossing. It is
distance-independent because none of it scales with distance.
`crowdMultiplier` multiplies instead, because crowding scales with how far you
walk. **1.35 is a choice, not a measurement**, set toward the pessimistic end
because the two ways of being wrong do not cost the same: wrong toward
"comfortable" is a missed class, wrong toward "tight" is leaving five minutes
early. The estimate is deliberately not centred.

It is one constant in one file so a reader can find the number without reading the
algorithm, a test can assert on it, and there is exactly one place to delete when
measured edges ship. A test greps the shipped scripts for a second literal `1.35`
and fails if one appears.

### What is enforced in code, not in prose

- **A range, never a point.** `formatRange()` is the only duration formatter in the
  codebase and it physically cannot emit one number.
- **Inside the margin is `tight`, never "yes".** The ladder has no `yes` rung; a
  test asserts `VERDICTS` does not contain one.
- **A leg touching an unresolvable location refuses**, because `evaluateLeg()`
  returns before it reaches any arithmetic. A test asserts no duration leaks into
  a refusal's text.
- **A blackout date never reaches a parking rule**, because `where-to-park.mjs`
  calls `blackoutCheck()` first and exits on it.
- **Exit code 3 means refused.** Distinct from 0 on purpose: a caller that only
  checks for zero would read total refusal as success.

### The verdict ladder

`refuse` → `cannot-determine` → `no` → `tight` → `comfortable`, checked in that
order so a refusal can never be overwritten by an estimate. The interesting rung is
**`no`**: it is the one verdict the data can state plainly, and it can *because* of
the optimism bias rather than despite it — a walk that does not fit under
assumptions which are all too generous does not fit.

### Every refusal, and why each one is not a hedge

`can-i-make-it`: `building-not-in-data` (all four `WCB` courses), `location-tba`,
`unknown-origin` (the earlier class is online), `accessible-routes-unsupported`
(`DATA-GAPS.md` §9 — there is no accessibility data anywhere in this dataset, and
the schema says the correct behaviour is to report that, never to return the
default route), `no-route` (a graph defect, surfaced rather than papered over).

`parking`: `blackout` (the seven home-game dates), `blackout-eve` (from 17:00 the
day before — FSU requires vehicles out "by 11:59 PM the night before" and
`DATA-GAPS.md` §7 says to treat the evening before as suspect), `no-calendar`
(**the one that is easy to get wrong**: a date with no shipped calendar is not a
normal day, it is a day whose game status is unknown), `building-not-in-data`,
`location-tba`.

Parking also answers what it *can* say honestly: garage-to-classroom walks are a
**straight-line** estimate, not a graph route, because no walk edge in the shipped
data has a parking endpoint. Labelled as such, and carrying the same margin.

### The isolation problem, closed

`tools/pack-plugin.mjs` (`npm run pack`) freezes the plugin into
`dist/marketplace/` and you install that. A directory source points at the
directory you name, so pointing it at a frozen copy is what stops the install
tracking the working tree. Of the two options — document a procedure, or change
how installation works — this is the second, because a documented procedure that
depends on being remembered is the same class of thing as a safety rule written in
prose. `dist/PACK-INFO.json` stamps version, commit, dirty flag and a tree hash.
`dist/` is gitignored, and the suite checks the frozen copy is byte-identical to
the source and still runs.

### Tests: **211 checks**, up from 154

New sections: `SAFETY MARGIN` (the constant is what the docs claim, its three
components sum to it, it never shortens an estimate, it is defined in one file),
`FEASIBILITY`, `PARKING`, `PACK`. Fixture **08** is new and is the first fixture
that is not about importing: four back-to-back pairs, one per rung. The blackout
tests are generated **from the calendar data**, so adding a date cannot be
forgotten. The tight case asserts the *inequality* — gap above the optimistic
number and below the realistic one — not just the label, so a data change that
stops it being the tight case fails loudly instead of passing for the wrong reason.

Deliberately unchanged: no campus data was touched, so no new record needed
sourcing. `partOfTerm` still has three outcomes and `cannot-determine` now carries

## A note on the step numbering

**The numbering in this file drifted, and this section is the correction.**

Step 5 shipped `can-i-make-it` and `parking` and then wrote a "Step 6 starts here"
section listing `check-conflicts` and `deadlines` as what remained. But step 5's own
heading called itself *"the two consequential query skills"*, and the step 3 and 4
sections had already promised **four** query skills — walking times, parking,
conflicts, deadlines — plus a "what's next" view. So "step 6" was really the second
half of a job step 5 had started and described as finished.

What follows is that second half, plus `whats-next`, which had been specified in the
step 4 wrap-up and then never built at all — it fell out of the list between steps
and nothing caught it, because each step's plan was written by reading the previous
step's closing section rather than the original spec.

**The lesson, recorded because it will happen again:** a step's closing "what's
next" section is a summary, not the specification. When it disagrees with what
earlier steps promised, the earlier promise wins. This step is numbered 6 and does
the work of the missing half of 5 and the whole of 6.

---

## Step 6 — WCB, and the three query skills that were skipped

Plugin 0.6.0. The feature set is now complete: six skills.

### Part A — `WCB` ships, and it was the highest-value item in the project

Four of the five courses in the real schedule this project has been tested against
are in the Herbert Wertheim Center for Business Excellence. Until now every one of
them was location-unresolved, so `can-i-make-it` refused **every leg** of that
schedule and exited 3, and `parking` refused outright. Any finance or management
student hit this on almost every course they took. It is a 24-classroom building —
the largest classroom count of any building now in the file.

**Steps 2 and 3 failed on it because they searched OpenStreetMap**, and OSM still
has nothing there: an Overpass query for `building` ways within 250 m of the address
returns 45 elements and none is on that block. The construction is too recent.

What worked was giving up on a polygon join and **geocoding FSU's published address
through three independent services**, then cross-checking the answer against two FSU
statements about what the building is next to:

| Source | Coordinate |
| --- | --- |
| US Census Bureau geocoder (TIGER) | 30.435556684975, −84.285716372278 |
| Esri World Geocoding Service (`PointAddress`, score 100) | 30.436000647226, −84.286678500607 |
| OpenStreetMap node 8381890349 (`place=house`) | 30.4357406, −84.2862174 |

Shipped value is their mean, **30.4357660, −84.2862041**. The two cross-checks:
FSU's FAQ puts the southeast corner entrance at Gaines & MLK, and OSM puts that
junction **64.9 m southeast** of the shipped point; FSU News puts the building "just
south of the Donald L. Tucker Civic Center", and OSM puts the Civic Center **222.1 m
north** of it. Both are the right direction and the right magnitude.

Those also **resolved the ambiguity `DATA-GAPS.md` §4 had recorded**: Nominatim
returns two `402 W Gaines St` candidates 1.5 km apart, and the western one is now
ruled out by four independent lines of evidence.

**It ships `low` confidence** and says why. The three geocodes disagree by up to
104.6 m, which is comparable to the building's own footprint, and the result is an
*address point* — not a surveyed position, not a polygon centroid, not a door.
`low` means good enough to route with and not good enough to act on, which is
exactly right.

Also sourced in the same pass, all from pages actually fetched: FSU building number
**4540**, official name, `ZONE D`, the **24 classroom numbers and their floors** from
the public room-lookup service, and five floors from the building's own FAQ. Two FSU
sources disagree about the floor count — the FAQ says "five stories from the Ground
Floor to the 4th Floor", the room inventory carries floor codes `00`–`05` — and the
disagreement is **recorded rather than resolved**, per the standing rule.

The FSU Building Portal moved during this pass: `facilities.fsu.edu/space/buildings/`
now 301-redirects to `forms.pdc.fsu.edu/portal`, and the room-lookup service behind
it turns out to be **public, no login**.

### `tools/build-walk-graph.mjs`, which had to exist first

`data/README.md` says the walk graph is a pure function of the shipped centroids and
that `campusZone` is recomputed whenever the building set changes. Steps 2 and 3 did
that by hand, so there was no way to add a building without either trusting prose
written months earlier or rewriting 85 sourced records on a guess.

So the algorithm is now a tool with a **`--check` mode that regenerates the graph and
diffs it against the shipped file**, and `--check` passing on the 32 existing
buildings was the precondition for letting it write anything. Getting it to reproduce
the file *exactly* pinned down two details the prose had never recorded: the path
factor is applied to the **unrounded** haversine and rounded once, and the duration
divides that same unrounded product rather than the rounded distance. Rounding in the
other order moves 20 edges by 0.1 m and 3 durations by a whole second.

Adding `WCB` then did exactly what that document warns a new building can do: it
**displaced an existing edge**. `law-to-wcb` appeared and `krb-to-law` vanished,
because `WCB` at 380 m pushed `KRB` out of `LAW`'s nearest four. Still 85 edges,
still connected, no `campusZone` changed.

**`WCB` is the only building with degree 1** — nothing else ships within the 600 m
cap — so every route in or out detours through `LAW` and is inflated by roughly
15–20%. That is the **one place in this dataset where the error runs pessimistic**.
Left as it is: widening the cap for one building would rewrite the other 84 edges'
basis, and being long is the safe direction.

### Part B — `whats-next`, `check-conflicts`, `deadlines`

Built on a new shared read layer, `lib/schedule.mjs`, which exists because four
scripts were about to invent four answers to the same questions:

- **An injectable America/New_York clock.** `resolveNow()` goes through `Intl`, so
  daylight saving is handled rather than assumed, and `--now` injects a fixed moment.
  A clock that cannot be injected cannot be tested: "what happens at 11pm on a
  Friday" is only true for one hour a week. A test asserts the answer is identical
  under `TZ=UTC` and `TZ=Pacific/Auckland`.
- **`no-schedule` as a first-class status**, never an exception and never an empty
  list, with its own exit code **4**. Conflating it with 0 produces the worst failure
  available here: telling a student who has not imported anything that they have no
  classes today. That is indistinguishable from a real free day.
- **`dayStatus()`, which is three-valued** — `classes` / `partial` / `none`, plus
  `finals`.
- **`import.warnings` attached to the meeting they are about**, so a room OCR'd from
  a screenshot months ago is still flagged on the line that mentions it.

**A schema change closed a gap this file had flagged twice.** `nonClassPeriod` gained
an optional `cancelledFromTime`, and FSU's Homecoming Friday now carries `"12:00"`
alongside `classesCancelled: false`. The boolean alone read as "an ordinary day" and
would have sent a student to a 2 p.m. class that is not happening.

`lib/conflicts.mjs` holds the three-outcome collision rule, and **`review-schedule.mjs`
was refactored onto it** rather than keeping a second copy — two copies of a
three-outcome rule is two chances to quietly lose the third outcome.

What each skill refuses or declines to invent:

- **`whats-next`** never invents a next class. The search walks forward one real
  calendar day at a time and **stops at the end of the term** rather than wrapping.
  Finals week returns **no meetings at all**. Location-unresolved courses are listed
  **inline with their times**, never dropped — the time is right even when the place
  is not, and a silently missing class is the failure a student cannot catch.
- **`check-conflicts`** has no refusal exit code, on purpose: `cannot-determine` is a
  *finding*, reported alongside what could be decided. With `sessionsStatus:
  "not-published"` it is currently the common outcome for any half-term course, so
  the skill's job is making it read as a fact about FSU's publishing rather than as a
  broken tool — including the one-step fix, which is that the student's own syllabus
  has the dates.
- **`deadlines`** works **without a stored schedule**, because deadlines belong to
  the term rather than the student. It never emits a per-course exam time — there is
  no grid in the data and no field one could live in — and it refuses (exit 3) for a
  term with no shipped calendar rather than inventing a drop date.

### Tests: **241 checks**, up from 211

New `GRAPH` and `QUERY SKILLS` sections. The graph section runs
`build-walk-graph.mjs --check` as a test, so the shipped data and the documented
algorithm cannot drift apart, and pins `WCB`'s coordinate to the mean of the three
sourced geocodes so a hand edit cannot leave the provenance note describing a
different number.

The three WCB feasibility assertions were **reversed rather than deleted** — they
used to assert every leg of the real schedule refuses, and now assert every leg
answers. Fixture **04** was repointed from `WCB` to `UCB` so the unknown-building
path keeps a live example; if `UCB` ever ships, repoint it again.

Also covered: no schedule imported (exit 4, and the message must not read as an
empty day), 11pm Friday, finals week, winter break, a weekend, the Homecoming
partial day, timezone independence, all three conflict outcomes — including a
constructed case proving `no-conflict` is still **reachable**, which the shipped
calendar alone cannot demonstrate — and that the Registrar's wording for the two
different 9 October deadlines is quoted rather than paraphrased.

## Step 7 — Driving, and the first correction from real use

Plugin 0.7.0. The first step driven by someone actually using the thing, and the
first time a finding from a previous step turned out to be **wrong in an
interesting direction**.

### The correction: the model is better than step 6 claimed

Step 6 reported `WCB`→`PDB` at **38–54 minutes** and hedged it, on the grounds that
`WCB` is a graph leaf whose routes detour through `LAW` and run 15–20% long, with
the safety margin stacked on top. `DATA-GAPS.md` §6 predicted an inflated answer.

**It is accurate.** The student who makes that trip regularly reports the figure is
right, not inflated. At the long end the leaf detour and the margin land about
where reality is.

**Nothing was tuned.** One leg, one observer, one mode, no stopwatch, at the extreme
end of the range — the place where a proportional error is largest in absolute
terms and therefore easiest to *feel* correct. `PATH_FACTOR`, `WALK_SPEED_MPS` and
`SAFETY_MARGIN` are untouched. It is recorded in §6 as corroboration and explicitly
not as calibration. What would justify moving a constant is the fieldwork in §1 and
§6: measured edges across a range of distances, which is what a `p90Seconds` needs
anyway.

### The real gap it exposed: the plugin only modelled walking

On that leg the plugin told a student **a true thing about a mode they do not use**.
The walk verdict was right and the answer was useless, because the verdict attached
to it — a flat `no` — reads as *"you cannot make this class"* when the truth is
*"not on foot"*. The student drives that leg. The useful answer was unsayable.

This is a different failure from every one the earlier steps chased. Those were all
about **confidence** — saying more than the data supports. This one is about
**scope**: answering a narrower question than the one asked, and letting the
narrowness pass unmentioned.

### Part A — the honest floor, shipped first and standing on its own

`no` now means only that two meetings **overlap in time** — a scheduling conflict,
with no gap to travel in. A gap too short to walk returns **`not-walkable`**, which
names alternatives instead of stopping.

Deliberately built and tested to work with **zero drive data**: `evaluateLeg()`
attaches `ALTERNATIVES` whenever the verdict is `not-walkable`, and the drive
planner is an *optional* injected function. With no planner the alternatives are
still named, just without numbers. A test calls `evaluateLeg` with no planner and
asserts exactly that, so Part A cannot rot into something that only works because
Part B happens to be there.

### Part B — the drive model, and the hole in the middle of it

`lib/driving.mjs`. Four components, kept separately visible because their
confidences are not remotely comparable:

| Step | Confidence |
| --- | --- |
| walk to the car | estimate, **weak** — straight-line to a garage centroid, no walk edge has a parking endpoint |
| drive | estimate — `haversine × 1.45 ÷ 6.7 m/s`, both constants chosen and stated, neither measured |
| **find a space** | **not estimable at all** |
| walk in from the garage | same weak straight-line estimate |

**The hard rule is structural, not advisory: there is no total.** Not a field, not
a getter. `PARKING_SEARCH` carries `estimable: false` and **no seconds key**, so a
consumer cannot read a number off it by accident, and a test walks every key
asserting none is numeric. The plan exposes `knownMinimumSeconds`, labelled
*"before you start looking for a space"*, and nothing that adds the four steps up.

That hole is the feature, not a limitation of it. Six garages ship with no
capacity, no `typicalFullBy`, no occupancy and no fill history (`DATA-GAPS.md` §7),
and on a weekday morning the search is routinely the largest term in the trip. "About
12 minutes" would be the same class of harm as a hedged game-day parking answer: the
student arrives late because PG5 was full. The output also refuses to present
`gap − knownMinimum` as time available to park.

**The margin is charged once.** A drive leg has two walking components and
`SAFETY_MARGIN` is a multiplier **plus a flat 180 s**. The flat part is a
per-JOURNEY allowance — doors at both ends, time inside both buildings, one
crossing — and a drive journey still has one origin and one destination building.
So the two walk legs are summed and the margin applied once. The drive leg carries
**no** walking margin at all, because doors, stairs and class-change crowds are not
things a car is subject to. Every component reports `carriesMargin`, and a test
asserts the once-versus-twice difference is *exactly* the flat allowance, so it
cannot pass trivially.

**The multi-hop assumption is stated, not hidden.** The car is assumed to be at the
garage this plugin would have recommended for the *earlier* class, because a student
who drives between classes moves the car during the day. A model assuming one
morning parking spot answers a question nobody asked. The assumption is returned on
the plan so an answer can state it.

**Blackout dates refuse the drive too** — a drive answer is a parking answer with a
journey in front of it, so telling a student to drive on a home football date is
telling them to park on one. `planDrive()` calls `blackoutCheck()` before it ranks a
single garage.

`rankZonesFor()` moved into `lib/parking.mjs` so `where-to-park` and the drive model
rank garages identically; two copies would be two chances to disagree.

### Seminole Express: scoped, not built

**Route and timetable data is fetchable.** StarMetro publishes a static GTFS feed at
`talgov.com/Uploads/Public/documents/starmetro/GTFS.zip`, tracked live by Transitland
(`f-djkj-starmetro`, successful fetch 2026-08-31). Seven routes — Garnet, Gold,
Heritage, Innovation, Osceola, Renegade, Tomahawk — plus Nite Nole. FSU publishes
operating hours; per-stop times exist only inside the GTFS.

Not built here, because a GTFS import is a whole step: a schema for routes and stop
times, a zip and CSV parser that stays Node-builtins-only, stop-to-building
association as its own sourcing problem, and the question of how a bus leg composes
with walking legs at both ends. A half-version would produce exactly the
confident-sounding answer the rest of this project exists to prevent. `DATA-GAPS.md`
§11 has the URLs and the scope.

So the shuttle is **named with no times**, carrying `known: 'none'`, and a test
asserts it quotes no duration.

### Tests: **250 checks**, up from 241

New `MODES` section: `WCB`→`PDB` in 30 minutes returns `not-walkable` with a drive
alternative and never a bare `no`; no drive answer exposes a numeric total or puts a
number on the search; the margin is applied once and differs from twice by exactly
the flat allowance; the drive leg carries no walking margin; a blackout date refuses
the drive; short and same-building legs are untouched and are not offered a car they
do not need; Part A works with no planner; the shuttle quotes no times.

---

## Outstanding

Carried forward until fixed.

- **`owner.name` and `author.name` are `"TODO"`** in both manifests. Harmless for a
  local install; must be real before this is published anywhere.
- **A session caches skill text.** Editing `SKILL.md` and running
  `claude plugin update` is not enough — the running session keeps serving the
  already-loaded version, and `/reload-plugins` or a restart is required. Verified
  the hard way in the step 4 session: a re-invocation after updating to 0.4.0
  still served 0.3.0 instructions. Worth remembering before concluding a skill
  edit "didn't work". *Step 5 did not fix this — it cannot be fixed from here —
  but `dist/PACK-INFO.json` now stamps every pack so that "am I looking at a
  cached copy?" is answerable instead of a guess.*
- ~~**A directory-source marketplace resolves the skill's base directory to the
  working tree.**~~ **Closed in step 5** by `npm run pack`.
- **`lib/validate.mjs`'s header comment names `tests/validator-parity.test.mjs`**,
  which does not exist — the parity section lives inside `tests/run-tests.mjs`.
  Documentation drift only; the test itself is real and passing.
- **No real building entrances** ship, so every route is building-centroid to
  building-centroid. `DATA-GAPS.md` §1.
- **`WCB`'s coordinate is the weakest in the file.** It is the mean of three
  address geocodes that disagree by 104 m, not a polygon centroid and not a door,
  and it ships `low`. One GPS reading at the building closes it, and it is the
  building with the most classrooms. `DATA-GAPS.md` §3.
- **`WCB` is a graph leaf**, so routes to it detour through `LAW` and run 15–20%
  long — the only place in this dataset where the error is pessimistic rather than
  optimistic. Accepted deliberately. `DATA-GAPS.md` §6.
- **Fall half-term session dates are unpublished** by FSU, which is why
  `sessionsStatus` is `not-published` and why "do these two conflict?" has a third
  answer. Not fixable by us.
- **Only Fall 2026 ships**, so `deadlines` refuses for any other term and `parking`
  refuses for any date it cannot check blackouts against. Both refusals are
  correct; both stop being necessary when a second calendar ships.
- **Time to find a parking space cannot be estimated at all**, which is why a drive
  answer has no total. The single highest-value data item in the project now: a
  capacity and `typicalFullBy` per garage would *bound* it, an occupancy feed would
  *answer* it. `DATA-GAPS.md` §7 and §10.
- **Seminole Express is named but unknown.** The GTFS feed is live and scoped in
  `DATA-GAPS.md` §11; importing it is a whole step and was deliberately not started.
- **Nothing inside a garage is modelled** — deck-to-street stairs and lifts are
  uncounted, because `verticalTransit` is unpopulated on every access point.
- ~~**Homecoming Friday is a half day that `nonClassPeriod` cannot express.**~~
  **Closed in step 6** by adding `cancelledFromTime` to the schema.

---

## Step 8 starts here

Step 7 changed what the next step should be. Two of the three items step 6 listed
are still right, but a new one now outranks them both.

**1. Garage capacity and `typicalFullBy`.** This is now the single highest-value
data item in the project. It is the term that dominates every drive answer, it is
the reason a drive cannot be totalled, and bounding it would turn "unknown" into
"usually 5–15 minutes before 10am" — which is an actionable answer rather than an
admission. FSU does not publish it on any page fetched so far. Worth trying:
Transportation & Parking's annual reports, an FSU Facilities space or parking
inventory, a public-records request, or counting decks from the garage records
themselves. An occupancy *feed* would close it outright; a static count and a fill
time would bound it, which is most of the value.

**2. Seminole Express, via the GTFS feed.** Scoped in `DATA-GAPS.md` §11 and ready
to build: the feed is live and tracked. This is the second mode the student actually
has, and right now the plugin names it and admits it knows nothing. A whole step:
schema for routes/stops/stop-times, a Node-builtins-only zip and CSV reader,
stop-to-building association, and how a bus leg composes with walking at both ends.
Do not shortcut the association step — nearest-neighbour guessing a stop to a
building is exactly the kind of plausible fabrication this project refuses.

**3. Walk the campus with a GPS.** Unchanged from step 6, and step 7 sharpened the
case for it: one real-world data point now corroborates the walking model at the
long end, which is encouraging and is *not* evidence about the short end, where most
legs live. Measured edges across a range of distances would give `walk-edges.json` a
`measurement` block with `p90Seconds`, and `SAFETY_MARGIN` is designed to be deleted
the day that lands. Also worth a GPS reading at `WCB` while out there — it is still
the weakest coordinate in the file.

Smaller, all carried forward:

- **Spring 2027's calendar** when the Registrar publishes it. `deadlines` and
  `parking` both refuse outside Fall 2026, correctly.
- **The finals exam grid** — a schema change, the same shape as `cancelledFromTime`.
- **Surface lots**, still the largest coverage gap in parking, and now doubly
  relevant: a drive answer that could name a lot near `WCB` would be materially
  better than one that can only offer PG5.
- **`UCD`/`UCC`/`UCB`** and the nine small buildings. Note fixture 04 uses `UCB` as
  its unknown building and must be repointed if it ships.
- **`owner.name` and `author.name` are still `"TODO"`.**

### The acceptance criteria, cumulative

From step 3: `partOfTerm` has three outcomes; `parkingBlackouts` means refusal;
`locationTba` and `location: null` are different; an unknown building is ordinary.
From step 4: a question must earn its place. From step 5: put the safety behaviour
in the script, and give a refusal its own exit code. From step 6: a closing
"what's next" is a summary and not a specification, and derived data is regenerated
rather than hand-edited. And now:

9. **Answer the question that was asked, not the one the data models.** A correct
   answer about walking, given to someone who drives, is a wrong answer. When a
   result is scoped to an assumption the student never made, say the scope out loud
   and name what falls outside it. This is a different failure from over-confidence
   and it will not be caught by any amount of hedging.
10. **An unknown gets no field.** If a quantity cannot be estimated, do not give it
    a nullable number, a zero, or a default — remove the key, and remove any field
    that would let a caller total around it. `PARKING_SEARCH` has no `seconds` and
    the drive plan has no total. Making the wrong answer unrepresentable beats
    warning against it, and it survives a model having a bad day.
11. **One real data point is corroboration, never calibration.** Record it, say what
    it does and does not support, and leave the constants alone. Tuning a documented
    assumption to a single observation replaces a stated guess with a fitted one and
    loses the honesty without gaining accuracy.

Reuse rather than rebuild: `lib/campus.mjs`, `lib/schedule.mjs` (injectable clock,
`loadSchedule`, three-valued `dayStatus`), `lib/conflicts.mjs` (the three-outcome
rule), `lib/routing.mjs` (graph, margin, `formatRange`), `lib/feasibility.mjs` (the
ladder and `ALTERNATIVES`), `lib/driving.mjs` (`planDrive`, `PARKING_SEARCH`,
`DRIVE_MODEL`), `lib/parking.mjs` (`blackoutCheck`, `rankZonesFor`, `windowMatches`,
`ruleAt`).

Scripts stay Node-builtins-only. **Changing a schema means running `npm test`** —
the parity section is what catches `lib/validate.mjs` drifting. **Changing a
building coordinate means running `tools/build-walk-graph.mjs --check`** before
`--write`.

Room-number-to-floor derivation is verified against 736 real FSU rooms: a
four-digit room starting with `0` carries the floor in its first two digits,
anything else in its first digit. `deriveFloor` refuses room numbers starting with
a letter (`G700`, `A0101`) rather than guessing.
