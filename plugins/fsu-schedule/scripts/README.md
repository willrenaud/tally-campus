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

`lib/` holds what they share: `normalize.mjs` (field parsing), `validate.mjs` (a
hand-written schema check), `campus.mjs` (shipped data access and building
resolution), `store.mjs` (the per-user file and the re-import policy).

## Three rules these scripts follow

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

**An unknown building is a result.** Only 32 of FSU's buildings ship. A code that
does not resolve is reported as `unknown` and the import continues; nothing here
substitutes a building because a name looked close.

**The write path validates for itself.** `save-schedule.mjs` re-runs the full
validation rather than trusting that `review-schedule.mjs` already did. It is the
only door to the filesystem, and a door that trusts its caller is not a door.

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
