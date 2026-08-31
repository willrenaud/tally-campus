# Import fixtures

Each directory is one schedule an importer has to survive. They are written
**adversarially**: the point is not to show the importer working, it is to pin down
what it must do when the input fights back.

## Everything here is invented

No fixture contains a real student's schedule, and no course number, section,
instructor name or room number in these files was read off an FSU page. They are
plausible-shaped fabrications, and they are allowed to be — the
[no-unsourced-data rule](../../plugins/fsu-schedule/data/README.md) governs
`plugins/fsu-schedule/data/`, which is what ships and what students act on. Test
inputs are not campus facts.

The **building codes** are the exception and are deliberately real: they have to be,
because the whole point of fixture 04 is what happens when a code is not in
`buildings.json`. `HCB`, `BEL`, `LOV`, `DIF`, `MCH`, `LIB`, `WMS` and `KRB` ship;
`WCB` does not, and [`DATA-GAPS.md`](../../DATA-GAPS.md) §4 says why.

## Layout

| File | What it is |
| --- | --- |
| `input.txt` / `input.ics` | The raw artifact, exactly as a student would hand it over. Absent for 07, whose source was an image. |
| `expected.json` | The `student-schedule` document a correct import produces from it. |
| `NOTES.md` | What is adversarial about this fixture and what the importer must not do. |

`expected.json` is the contract. `tests/run-tests.mjs` asserts that each one:

- validates under the plugin's own dependency-free validator, **and** under Ajv
  against the real schemas, and that the two agree;
- produces the specific review outcome the fixture is about — an unknown building
  that still imports, a collision that is a collision, a collision that is
  *undecidable*.
- asks the student **only** what genuinely could not be resolved: every fixture
  carries an exact `blockingQuestions` count, and the report renders the week
  before it renders a question.

## The fixtures

| # | Input | The trap |
| --- | --- | --- |
| 01 | Clean Student Central paste | None. The baseline: if this one is wrong, nothing else means anything. |
| 02 | Wrapped lines, header repeated mid-paste | Field values continue on the next line, and the column header reappears where the source paginated. Both look like data. |
| 03 | Online asynchronous course, plus an in-person course with a TBA room | Two different kinds of "no room" that must not be conflated. |
| 04 | A course in `WCB`, which does not ship | **Must import successfully.** Failing the whole schedule over one building is the bug. |
| 05 | Two full-term courses genuinely colliding, and two half-term courses that only appear to | One is a `CONFLICT`, the other is `CANNOT TELL`, and reporting the second as "no conflict" is the failure. |
| 06 | `.ics` export | Folded lines, escaped commas, `BYDAY`, an `EXDATE`, and an event with no `LOCATION`. |
| 07 | A screenshot: no sections, no titles, four of five rooms in `WCB` | **Must ask nothing.** Under 0.3.0 this input produced four blocking questions before the student saw a thing. Doubles as the feasibility fixture where **every leg refuses**. |
| 08 | Four back-to-back pairs, one per rung of the feasibility ladder | Not an importer fixture. Its gaps are chosen so that one lands on `comfortable`, one on `tight`, one on `no`, and one refuses for an online origin. |

## Fixture 08 is a query fixture, not an import one

Everything above 08 exists to pin down what the *importer* does. 08 exists to pin
down what `can-i-make-it` does, and its gaps are not arbitrary:

| Day | Pair | Gap | Why that number |
| --- | --- | --- | --- |
| Mon | `PDB` → `PDB` | 15 min | Same building. Still costs the fixed margin, because you still leave one room and find another. `comfortable`. |
| Tue | `BEL` → `KRB` | 10 min | The load-bearing case. The shipped estimate is **8 min** and the margin-corrected one is **14**, so the gap fits the optimistic number and not the realistic one. Anything that reports this as "yes" has thrown the margin away. `tight`. |
| Wed | `HCB` → `PDB` | 10 min | Shorter than even the optimistic estimate. The one verdict the data can state plainly, because the bias points the safe way. `no`. |
| Fri | online → `BEL` | 10 min | There is no origin to walk from. `refuse`, not a guess. |

If a change to `walk-edges.json` moves those durations, the Tuesday row stops
testing what it exists to test — the assertion checks the inequality, not just the
verdict, so it will fail loudly rather than quietly passing for the wrong reason.
