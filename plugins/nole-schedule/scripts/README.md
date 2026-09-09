# Plugin scripts

Everything here ships to users and **must run with no install**: Node builtins only,
no `package.json`, no `node_modules`, no transitive anything. Ajv and the rest of the
tooling stay at the repository root as dev dependencies and never cross this line.

Run them with `node`, from anywhere; they locate the shipped data relative to
themselves rather than relying on `${CLAUDE_PLUGIN_ROOT}` being exported.

| Script | Reads | Writes | Exit codes |
| --- | --- | --- | --- |
| `current-term.mjs` | `data/term-calendar.json` | the term to assume, on stdout | 0, or 2 on a malformed `--date` |
| `parse-ics.mjs <file>` | an `.ics` file | JSON drafts on stdout | 0, or 2 if the file is unreadable |
| `resolve-buildings.mjs <loc>…` | `data/buildings.json` | a report on stdout | always 0 — an unknown building is a result, not a failure |
| `review-schedule.mjs <draft>` | the draft, `data/` | a report on stdout | 0 valid, 1 invalid, 2 could not run |
| `save-schedule.mjs <draft>` | the draft | `$CLAUDE_PLUGIN_DATA/schedules/` | 0 done, 1 invalid so nothing written, 2 could not run |
| `can-i-make-it.mjs` | the stored schedule, `data/` | a feasibility report on stdout | 0 something answered, 2 could not run, **3 nothing was answerable** |
| `where-to-park.mjs --building <CODE>` | `data/`, optionally the stored schedule | a parking report on stdout | 0 answered, 2 could not run, **3 refused by design** |
| `whats-next.mjs` | the stored schedule, `data/` | next class, today, this week | 0 answered, 2 could not run, **4 no schedule imported** |
| `check-conflicts.mjs` | the stored schedule, `data/` | the three-outcome collision report | 0 answered, 2 could not run, **4 no schedule imported** |
| `deadlines.mjs` | `data/`, optionally the stored schedule | deadlines, breaks, finals | 0 answered, 2 could not run, **3 no calendar for that term** |

`lib/` holds what they share: `normalize.mjs` (field parsing), `validate.mjs` (a
hand-written schema check), `campus.mjs` (shipped data access and building
resolution), `store.mjs` (the per-user file and the re-import policy),
`routing.mjs` (the walk graph **and the safety margin**), `feasibility.mjs` (the
verdict ladder), `driving.mjs` (the drive model **and the missing middle**),
`parking.mjs` (the blackout gate, rule evaluation and garage ranking),
`conflicts.mjs` (the three-outcome collision rule), and `schedule.mjs` (the shared
read layer: the injectable America/New_York clock, loading the stored schedule,
and `dayStatus`).

## Exit codes 3 and 4 both mean "no answer", and they are different

**3 is refused by design.** The honest answer is that there is no answer: a home
football date, a building outside the 33 that ship, a step-free routing request
against data with no accessibility information in it, a term with no shipped
calendar.

**4 is nothing imported yet.** The remedy is completely different — go and run
`import-schedule` — and conflating the two produces the single worst failure in
this plugin: reporting "you have no classes today" to a student who simply has not
imported a schedule. That is indistinguishable from a real free day, and it sends
them to a class they do have.

Both are distinct from 0 on purpose. A caller that only checks for zero would read
either as success.

## The shared read layer

`lib/schedule.mjs` exists so the four schedule-reading scripts cannot each invent
their own answer to the same four questions:

- **What time is it, in America/New_York?** `resolveNow()` goes through `Intl`, so
  daylight saving is handled rather than assumed, and `--now` injects a fixed
  moment. A clock that cannot be injected cannot be tested: "what happens at 11pm
  on a Friday" is only true for one hour a week.
- **Is there a schedule at all?** `loadSchedule()` returns `no-schedule` as a
  status, never as an exception and never as an empty list.
- **Is this date even a class day?** `dayStatus()` is **three-valued** —
  `classes` / `partial` / `none`, plus `finals` — because FSU's Homecoming Friday
  cancels classes only after noon, and a boolean cannot say that.
- **What is shaky about this schedule?** `import.warnings` are attached to the
  meeting they are about, so a room read off a screenshot months ago can still be
  flagged on the line that mentions it.

## Four rules these scripts follow

**Ambiguity is returned, never resolved.** Every function in `normalize.mjs` yields
either a value or `{ ok: false, reason }`. `TH` in a day column, a bare `1:50` with
no meridiem, and a two-letter `FR` all come back refused, because each has two
readings that are both common in real schedules and nothing in the string separates
them. Guessing is silent, and silent is the problem — a student finds out in the
wrong room three weeks later.

**A question must earn its place.** `review-schedule.mjs` splits what it finds into
ASSUMPTIONS and MUST ASK, and the split is not cosmetic: it is the rule that an
importer may only stop a student when the answer cannot be inferred AND a wrong
guess would be invisible in the rendered week. `current-term.mjs` exists to move one
former question -- which term is this? -- permanently onto the assumptions side.

**An unknown building is a result.** Only 33 of FSU's buildings ship. A code that
does not resolve is reported as `unknown` and the import continues; nothing here
substitutes a building because a name looked close.

**The write path validates for itself.** `save-schedule.mjs` re-runs the full
validation rather than trusting that `review-schedule.mjs` already did. It is the
only door to the filesystem, and a door that trusts its caller is not a door.

**Safety lives in the code, not in the prose that calls it.** The two query
scripts exist because a rule the model might skip is not a rule. A range is
emitted because `formatRange()` is the only duration formatter and it physically
cannot emit one number. A leg touching a missing building refuses because
`evaluateLeg()` returns before it reaches any arithmetic. A blackout date never
reaches a parking rule because `where-to-park.mjs` calls `blackoutCheck()` first
and exits on it. None of that depends on anyone remembering to be careful.

**An unknown gets no field.** `lib/driving.mjs` returns a drive plan with **no
total**, because a drive is `walk + drive + FIND A SPACE + walk` and the third
term cannot be estimated from six garages with no capacity and no occupancy data.
`PARKING_SEARCH` carries `estimable: false` and **no seconds key at all**, so a
consumer cannot read a number off it by accident, and the plan exposes only a
`knownMinimumSeconds` labelled as the floor before the search begins. Making the
wrong answer unrepresentable beats warning against it.

**The safety margin is charged once per journey, not once per leg.** A drive has
two walking components; their optimistic seconds are summed and
`applySafetyMargin` is called once, because the flat 180 s covers doors,
in-building time and a crossing — a per-journey allowance. Each component reports
a `carriesMargin` field so an answer can say which parts are margined.

## The one thing to watch

`lib/validate.mjs` is a hand-written re-implementation of
`../schemas/student-schedule.schema.json` and `../schemas/course-meeting.schema.json`.
It exists because the plugin cannot ship a JSON Schema library, and it **will drift
from those schemas** unless someone stops it.

`tests/run-tests.mjs` at the repository root is what stops it: its PARITY section
runs both this validator and Ajv over the same forty-odd documents and fails if they
ever disagree about whether one is valid, in either direction. **If you change a
schema, run `npm test`.** A failure there naming "the shipped validator has drifted"
means this file needs the same change.
