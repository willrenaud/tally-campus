# 08 — back-to-back walks

**The first fixture that is not about importing.** There is no `input.txt`: this is a
`student-schedule` document written directly, so that `can-i-make-it.mjs` has one input
covering every rung of its verdict ladder at once.

It still has to be a legitimate schedule — it validates under both validators, produces zero
blocking questions and zero collisions, and is checked by the same fixture loop as the rest —
because a feasibility answer computed over a document the importer would never have produced
proves nothing.

## What each day is for

| Day | Pair | Gap | Verdict | The trap |
| --- | --- | --- | --- | --- |
| Mon | `PDB` → `PDB` | 15 min | `comfortable` | Two classes in one building. The optimistic walk is **zero seconds**, and an implementation that reported zero would be lying: you still leave a room, walk a corridor and find another. The fixed 180-second margin is what makes this honest, and this row is what stops someone "optimising" it away. |
| Tue | `BEL` → `KRB` | 10 min | `tight` | **The load-bearing row.** The shipped estimate is 8 minutes and the corrected one is 14, so a 10-minute gap fits the data's own number and fails the honest one. Anything that reads the shipped duration alone calls this "yes" — which is the exact failure the safety margin exists to prevent. The assertion checks the inequality, not just the label, so it fails loudly if a data change stops this being the tight case rather than silently passing for the wrong reason. |
| Wed | `HCB` → `PDB` | 10 min | `no` | Shorter than even the optimistic estimate. This is the one verdict the data can state plainly, and it can *because* of the bias rather than despite it: a walk that does not fit under assumptions which are all too generous does not fit. |
| Fri | online → `BEL` | 10 min | `refuse` | The earlier class is online, so where the student is walking *from* is unknown. There is a plausible-looking answer available — assume they are at home, assume they are in the library — and taking it would be inventing an origin. |

## What this fixture must never do

- **Never report a single number** for any of these legs. The Tuesday row is the one where a point
  estimate is most tempting and most wrong.
- **Never call Tuesday "comfortable", "fine" or "doable".** Inside the margin is `tight`.
- **Never route from the Friday online class.** An unknown origin is a refusal.
- **Never let Monday collapse to zero.** Same building is not the same room.

## Deliberately not here

`WCB` — the missing-building refusal is fixture **07**'s job, where four of five courses are in it
and *every* leg refuses. Duplicating it here would make this fixture about two things.

An unresolvable `partOfTerm` — that is fixture **05**, which already carries a `first-half` and a
`second-half` course and is asserted to produce `cannot-determine` with a conditional rather than a
verdict.
