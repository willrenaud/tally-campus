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
| `input.txt` / `input.ics` | The raw artifact, exactly as a student would hand it over. |
| `expected.json` | The `student-schedule` document a correct import produces from it. |
| `NOTES.md` | What is adversarial about this fixture and what the importer must not do. |

`expected.json` is the contract. `tests/run-tests.mjs` asserts that each one:

- validates under the plugin's own dependency-free validator, **and** under Ajv
  against the real schemas, and that the two agree;
- produces the specific review outcome the fixture is about — an unknown building
  that still imports, a collision that is a collision, a collision that is
  *undecidable*.

## The fixtures

| # | Input | The trap |
| --- | --- | --- |
| 01 | Clean Student Central paste | None. The baseline: if this one is wrong, nothing else means anything. |
| 02 | Wrapped lines, header repeated mid-paste | Field values continue on the next line, and the column header reappears where the source paginated. Both look like data. |
| 03 | Online asynchronous course, plus an in-person course with a TBA room | Two different kinds of "no room" that must not be conflated. |
| 04 | A course in `WCB`, which does not ship | **Must import successfully.** Failing the whole schedule over one building is the bug. |
| 05 | Two full-term courses genuinely colliding, and two half-term courses that only appear to | One is a `CONFLICT`, the other is `CANNOT TELL`, and reporting the second as "no conflict" is the failure. |
| 06 | `.ics` export | Folded lines, escaped commas, `BYDAY`, an `EXDATE`, and an event with no `LOCATION`. |
