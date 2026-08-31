---
name: can-i-make-it
description: Work out whether a student can get from one FSU class to the next in the gap between them — walking time between buildings, back-to-back feasibility, "do I have time to stop at Strozier", "how long from Bellamy to HCB". Reports a range with its assumptions rather than a single number, and refuses on legs the shipped campus data cannot route. Use whenever a student asks about getting between classes, walking times, or whether a schedule gap is enough.
---

# Can I make it between these classes?

$ARGUMENTS

## Read this before you answer anything

**The walking data underneath this skill is systematically optimistic, and you
cannot fix that by being careful in prose.** Every duration in
`walk-edges.json` is computed, never measured:

    distanceMeters = haversine(centroid, centroid) × 1.3
    seconds        = distanceMeters ÷ 1.4

It leaves out **five things, all in the same direction**: real doors (every
building routes from its centre), time inside the buildings, waiting at
crossings, class-change crowding, and the fact that 1.3 and 1.4 are themselves
assumptions. There is no `measurement` block on any edge, so there is **no
median and no p90** — and the p90 is the honest number for "will I make it".

`scripts/lib/routing.mjs` holds a single documented `SAFETY_MARGIN` constant that
stands in for the missing p90: **×1.35 on the walk, plus 180 fixed seconds.**
Everything below is downstream of that one constant. If you find yourself doing
walking arithmetic in your head, stop — you are recomputing something the script
already did more honestly.

## The four rules

**1. Never report a single number.** Every answer is a range, and both ends get
said out loud. The low end is what the data literally claims; the high end is what
it claims once its known omissions are added back. `formatRange()` is the only
formatter in the codebase and it cannot emit one number. Do not undo that by
picking the middle, quoting "about 8 minutes", or averaging the ends.

**2. Anything inside the margin is "tight, leave early". Never "yes".** The band
between the two ends is not slack to spend — it is the part of the trip the data
forgot to count. `tight` is the verdict for a gap that fits the optimistic figure
but not the realistic one, and it means *go now*, not *you'll be fine*.

**3. Any leg touching a location the data cannot resolve REFUSES.** Not "estimates
with a caveat". A student timetabled in `WCB` gets told there is no answer, not a
number derived from a building that happens to be nearby. Only 32 of FSU's 500-odd
buildings ship, so this comes up constantly and is completely ordinary.

**4. "I can't tell you" is a correct answer.** A student who gets a hedge walks
faster. A student who gets a confident wrong answer misses a class. Those costs
are not symmetric and the answer is not centred.

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --data-dir "$CLAUDE_PLUGIN_DATA"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --day thursday
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --from HCB --to BEL --gap 15
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --json

`--from/--to/--gap` is for a question that is not about the stored schedule —
"how long from Bellamy to HCB". `--data-dir` mode reads the stored schedule and
checks every back-to-back pair.

Exit codes: **0** something was answered, **2** could not run, **3** *nothing* was
answerable because every leg refused. Exit 3 is a result. Report it as one.

**Run the script. Do not do this arithmetic yourself.** The safety margin, the
verdict thresholds, the refusals and the range formatting are all in the script
precisely so that they happen whether or not you remember them.

## The verdicts, and what each one means to a student

| Verdict | What to say |
| --- | --- |
| `comfortable` | The gap clears the high end. Say the range anyway, and that it assumes the class lets out on time. |
| `tight` | **Leave the moment you're packed.** The gap fits the low end and not the high one — the data cannot tell you which side of it you are on. Never soften this into "should be fine". |
| `no` | It does not fit. This is the one verdict you can state plainly, and the reason is worth giving: the estimate is *already* too generous, so a walk that fails it fails for real. |
| `cannot-determine` | The walk is estimable but whether the two classes ever share a day is not — a half-term course FSU has published no dates for. Give the conditional answer *as a conditional*. Never collapse it into "no conflict". |
| `not-applicable` | The next class is online. There is no walk; say so rather than inventing one. |
| `refuse` | There is no answer. See below. |

## Every case where this skill refuses

Say which one it is and why. Do not offer a substitute estimate for any of them.

| Refusal | When | What to tell the student |
| --- | --- | --- |
| `building-not-in-data` | Either end is a building code outside the 32 that ship — `WCB` above all, which is 24 classrooms and the single largest omission | There is no coordinate for that building, so there is no walk to estimate. A nearby building is not a stand-in. `DATA-GAPS.md` §4. |
| `location-tba` | Either end is `locationTba: true` | FSU hasn't announced the room yet. Ask again when it is posted. |
| `unknown-origin` | The **earlier** class is online | Where they are walking from is unknown. Offer: tell me where you'll be and this becomes answerable. |
| `accessible-routes-unsupported` | `preferences.requiresAccessibleRoutes` is true | **There is no accessibility data anywhere in this dataset** — not on entrances, not on edges, not on garage exits. Say that plainly and point at FSU Student Accessibility Services. Never quietly return the default route. `DATA-GAPS.md` §9. |
| `no-route` | Both buildings ship but the graph does not connect them | A data defect, not a fact about campus. Say so rather than producing a duration. |

The step-4 screenshot schedule is the live example: four of its five courses are
in `WCB`, so **every single leg refuses** and the script exits 3. That is the
right outcome. Report it as "I can't route any of these, and here is why",
not as an error and not as a partial estimate.

## What an answer looks like

> **Tuesday, ENC1101 → CHM1045, 10-minute gap: tight. Leave as soon as you're packed.**
>
> Bellamy to the Kellogg Building is **8–14 minutes**. Your gap is 10, which sits
> inside that range — the data genuinely cannot tell you which side of it you're on.
>
> The low end is what the shipped data says. The high end adds back what it's known
> to leave out: every walking time here is measured centre-of-building to
> centre-of-building, never door to door, and nothing in it counts stairs, road
> crossings, or the class-change crowd. None of that has ever been walked with a
> stopwatch.

And a refusal:

> **ISM3541 → FIN4424: I can't tell you.**
>
> Both are in WCB, the Wertheim Center, which isn't in this plugin's campus data —
> it's new enough that no coordinate could be sourced for it. I could name a
> building nearby and give you a number, but it would be a number about a different
> building, so I'd rather say I don't know. Everything else about those classes is
> stored correctly.

## Never

- Never report one number, an average, or a "roughly N minutes".
- Never call a gap inside the margin "yes", "fine", "doable", or "you'll make it".
- Never estimate across a building that is not in the shipped data, even
  approximately, even when the student asks you to guess.
- Never substitute a nearby building for a missing one.
- Never answer a step-free routing question from the default route.
- Never turn `cannot-determine` into "no conflict".
- Never present these as measured times. Nothing here has been walked.
- Never answer a parking question from this skill; that is the `parking` skill and
  it has a blackout check this one does not run.
