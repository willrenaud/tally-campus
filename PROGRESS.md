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
a *conditional* answer rather than a bare shrug. An unknown building is still
ordinary — it degrades one leg, never the query.

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
  working tree.**~~ **Closed in step 5** by `npm run pack`; see below.
- **`lib/validate.mjs`'s header comment names `tests/validator-parity.test.mjs`**,
  which does not exist — the parity section lives inside `tests/run-tests.mjs`.
  Documentation drift only; the test itself is real and passing.
- **No real building entrances** ship, so every route is building-centroid to
  building-centroid. `DATA-GAPS.md` §1.
- **Fall half-term session dates are unpublished** by FSU, which is why
  `sessionsStatus` is `not-published` and why "do these two conflict?" has a third
  answer. Not fixable by us.

---

## Step 6 starts here

The remaining query skills: **conflicts** and **deadlines**, plus whatever the
first real use of 0.5.0 exposes.

- **Conflicts** is mostly built already — `review-schedule.mjs` computes the
  three-outcome collision verdict, and `can-i-make-it.mjs` reuses the same
  resolvability rule. A conflicts skill is largely a presentation layer over
  existing output, which is the right amount of work for it.
- **Deadlines** is the untouched one. `term-calendar.json` has twelve dated
  deadlines with the Registrar's own wording quoted rather than paraphrased. Two
  traps: every shipped deadline is a **full-term** one because `sessions` is empty
  (`DATA-GAPS.md` §8), so a half-term course's much earlier drop date cannot be
  given; and **final exams are not at the course's normal meeting time**, so a
  weekly schedule expanded across Dec 7–11 is simply wrong. Send students to
  `finals.url`.
- **Homecoming Friday is a half day** — classes cancelled only after 12:00 on
  Nov 20 — and `nonClassPeriod` cannot express a partial day. It ships with
  `classesCancelled: false`, which understates it. A schema change is the right
  fix, and a deadlines or "what's on today" skill will hit it immediately.

The acceptance criteria from step 3 and step 4 still stand. Two more from step 5,
which are now the pattern rather than a suggestion:

5. **Put the safety behaviour in the script.** If a rule can be skipped by a model
   having a bad day, it is not a rule. Make the wrong answer unrepresentable —
   no `yes` rung, no single-number formatter, an early return before the
   arithmetic — rather than writing "be careful" in a SKILL.md.
6. **A refusal is a result and needs its own exit code.** Exit 3 across both query
   scripts. A caller checking only for zero must not read a refusal as success.

Reuse rather than rebuild: `lib/campus.mjs` exposes `buildings()`, `building()`,
`walkEdges()`, `parkingZones()`, `termCalendar()`, `termCalendars()`,
`termCalendarCovering()`, `resolveBuilding()` and `currentTerm()`. `lib/routing.mjs`
has the graph, the margin and `formatRange()`. `lib/feasibility.mjs` has the ladder.
`lib/parking.mjs` has `blackoutCheck()`, `windowMatches()` (including the wrapping
case common.defs warns about) and `ruleAt()`. Scripts stay Node-builtins-only, and
**changing a schema means running `npm test`**.

Room-number-to-floor derivation is verified against 736 real FSU rooms: a
four-digit room starting with `0` carries the floor in its first two digits,
anything else in its first digit. `deriveFloor` refuses room numbers starting with
a letter (`G700`, `A0101`) rather than guessing.
