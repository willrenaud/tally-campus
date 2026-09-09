---
name: can-i-make-it
description: Work out whether a student can get from one FSU class to the next in the gap between them — walking time between buildings, back-to-back feasibility, "do I have time to stop at Strozier", "how long from Bellamy to HCB", "can I drive between these". Reports a range with its assumptions rather than a single number; when a leg is too long to walk it says so and names driving and the campus shuttle instead of returning a flat no; and it refuses on legs the shipped campus data cannot route. Use whenever a student asks about getting between classes, walking or driving times, or whether a schedule gap is enough.
---

## STOP. No script, no answer.

**Everything this skill knows comes from running its script.** This file contains no
data. It contains instructions for running a program and for reading what the program
prints, and nothing else.

So there is exactly one gate, and it is not a matter of judgement:

> **If the script did not run, you have no answer. Say so and stop.**

That covers every way it can fail to run: no tool available to execute commands, `node`
not installed, the file not found, a non-zero exit you did not expect, output you cannot
parse, or a surface that will not run local programs at all. In every one of those cases
the honest and only output is that you could not run it.

**You must not, under any circumstance, answer anyway from:**

- **the examples in this file.** Every date, time, duration, building code, room number
  and course code in every example below is a **deliberate fake** — `ZZZ`, `AAA1111`,
  `<DATE>`, `NN–NN minutes`. They are placeholders chosen to look obviously wrong if
  they ever reach a student. If you find yourself about to quote one, that is the bug
  this gate exists to catch.
- **anything you know about Florida State** — its calendar, its buildings, its parking,
  its walking distances. Your training is not this plugin's data and must never stand in
  for it.
- **the student's own words.** They told you their schedule; that is the input, not a
  verified answer.
- **an earlier answer in this conversation.** A number that came from a successful run
  is about that run's question, not this one.

**A plausible answer here is worse than no answer.** The whole point of this plugin is
that its refusals live in the script — the ranges that cannot collapse to a single
number, the verdicts with no `yes` rung, the calendar that expires, the dates it will
not invent. None of that protects anyone if the script does not run and you answer from
memory. You would be producing exactly the confident, unverifiable, wrong-looking-right
answer the whole design exists to prevent, with the plugin's name on it.

### What to say when it will not run

Name what you tried to run, say plainly that it did not run, and give the likely reason:

> I can't answer this. This plugin's skills work by running a script on your machine,
> and I wasn't able to run it here.
>
> **This plugin requires Claude Code.** The regular Claude desktop and web apps can load
> these instructions but cannot execute the scripts they depend on, so the plugin has no
> way to work there. If you are in Claude Code and still seeing this, the command I tried
> was `<the command>` and it failed with `<the error>`.

Then stop. Do not offer a partial answer, a guess, a "rough idea", or a caveated
estimate. There is nothing to be partial about: with no script output there is no
information here at all.

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
with a caveat". A student timetabled in a building the data does not ship gets told
there is no answer, not a number derived from a building that happens to be nearby. Only 33 of FSU's 500-odd
buildings ship, so this comes up constantly and is completely ordinary.

**4. "I can't tell you" is a correct answer.** A student who gets a hedge walks
faster. A student who gets a confident wrong answer misses a class. Those costs
are not symmetric and the answer is not centred.

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --data-dir "$CLAUDE_PLUGIN_DATA"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --day thursday
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --from <FROM> --to <TO> --gap <MINUTES>
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --from <FROM> --to <TO> --gap <MINUTES> --date <YYYY-MM-DD>
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/can-i-make-it.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --json

Pass `--date` whenever a drive alternative might come up: it is what lets the
blackout check run against the drive plan. `--time` and `--permits` refine which
garage is offered.

`--from/--to/--gap` is for a question that is not about the stored schedule —
"how long from one named building to another". `--data-dir` mode reads the stored schedule and
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
| `not-walkable` | The walk does not fit — and that is a statement about **walking**, not about whether they can make the class. **Never render this as a bare "no".** Name the alternatives; see below. |
| `no` | Reserved for meetings that actually **overlap in time**. There is no gap to travel in, which is a scheduling conflict rather than a transport problem. |
| `cannot-determine` | The walk is estimable but whether the two classes ever share a day is not — a half-term course FSU has published no dates for. Give the conditional answer *as a conditional*. Never collapse it into "no conflict". |
| `not-applicable` | The next class is online. There is no walk; say so rather than inventing one. |
| `refuse` | There is no answer. See below. |

## `not-walkable` is a mode answer, not a refusal

**The plugin models walking. A student may not be walking.** A long leg used to
come back as a flat "no", which is a true statement about a mode the student might
never use — and it reads as "you cannot make this class". That is the wrong answer
to the question they asked.

So a leg too long to walk stops at **"not on foot"** and names what else exists.
The script attaches the alternatives itself, so this cannot be forgotten.

### The drive answer: four parts, and the middle one is unknown

When both ends are shipped buildings, the script produces a drive plan. **It has no
total, and it must never be given one.**

| Step | Confidence |
| --- | --- |
| 1. Walk to the car | Estimate, and a **weak** one — straight-line to a garage centroid, because no walk edge has a parking endpoint. |
| 2. Drive | Estimate from stated constants (`×1.45` circuity, `6.7 m/s ≈ 15 mph`). Both **chosen, not measured**. |
| 3. **Find a space** | **UNKNOWN. Not estimable at all.** |
| 4. Walk in from the garage | Same weak straight-line estimate as step 1. |

**Step 3 is the whole point.** Six garages ship with **no capacity, no
`typicalFullBy`, no occupancy feed and no fill history** (`DATA-GAPS.md` §7), so
there is nothing to estimate a search time from — and on a weekday morning it is
routinely the *largest* term in the trip. `lib/driving.mjs` returns it as
`{ estimable: false }` with no seconds key on the object, and the plan carries no
total field at all. There is nothing for you to add up.

Report the **components** and the `knownMinimum`, which is labelled *"before you
start looking for a space"*. If a student asks for one number, the answer is that
there isn't one — and say why, because the why is actionable: *budget generously,
leave early.* A student told "unknown" leaves early and makes it. A student told
"12 minutes" gets there late because PG5 was full. That is the same harm the
`parking` skill refuses on game days.

**Do not subtract.** The gap minus the known minimum is *not* "time available to
find a space".

### The margin is applied once — say which parts carry it

A drive leg has two walking components, and the safety margin is a multiplier
**plus a flat 180 seconds**. The flat part covers doors, in-building time and a
crossing — a per-journey allowance, and a drive journey still has one origin and
one destination building. So the two walk legs are **summed first** and the margin
applied **once**. The drive leg carries **no** walking margin, because doors,
stairs and class-change crowds are not things a car is subject to. Every component
reports its own `carriesMargin`; pass that on rather than implying the whole trip
is margined.

### Blackout dates refuse the drive too

A drive answer is a parking answer with a journey in front of it. On one of the
seven home football dates the drive plan **refuses**, exactly as `parking` does.
Pass `--date` so this can be checked; without one, say the drive option assumes it
is not a game day.

### Seminole Express

Named, with **no times**. Seven routes run 7am–8pm Monday–Friday in fall and
spring, and **none of their stops, times or paths are in this plugin** — a GTFS
feed exists and has not been imported (`DATA-GAPS.md` §11). Say the shuttle exists,
say you cannot tell whether it helps on this leg, and point at the Transit app.
Never invent a bus time or claim a route serves a building.

## Every case where this skill refuses

Say which one it is and why. Do not offer a substitute estimate for any of them.

| Refusal | When | What to tell the student |
| --- | --- | --- |
| `building-not-in-data` | Either end is a building code outside the 33 that ship | There is no coordinate for that building, so there is no walk to estimate. A nearby building is not a stand-in. `DATA-GAPS.md` §4. |
| `location-tba` | Either end is `locationTba: true` | FSU hasn't announced the room yet. Ask again when it is posted. |
| `unknown-origin` | The **earlier** class is online | Where they are walking from is unknown. Offer: tell me where you'll be and this becomes answerable. |
| `accessible-routes-unsupported` | `preferences.requiresAccessibleRoutes` is true | **There is no accessibility data anywhere in this dataset** — not on entrances, not on edges, not on garage exits. Say that plainly and point at FSU Student Accessibility Services. Never quietly return the default route. `DATA-GAPS.md` §9. |
| `no-route` | Both buildings ship but the graph does not connect them | A data defect, not a fact about campus. Say so rather than producing a duration. |

A schedule can refuse on **every** leg — if each of its courses sits in a building
the data does not ship, the script exits 3 having answered nothing. That is the right
outcome. Report it as "I can't route any of these, and here is why", not as an error
and not as a partial estimate.

## What an answer looks like

**Every value below is a fake placeholder** — `AAA1111`, `ZZZ`, `NN–NN`. They are not
defaults and not fallbacks. Fill them from the script's output; with no output, see the
gate at the top of this file.

> **`<weekday>`, AAA1111 → BBB2222, `<N>`-minute gap: tight. Leave as soon as you're packed.**
>
> `<building name>` to `<building name>` is **NN–NN minutes**. Your gap is `<N>`, which
> sits inside that range — the data genuinely cannot tell you which side of it you're on.
>
> The low end is what the shipped data says. The high end adds back what it's known
> to leave out: every walking time here is measured centre-of-building to
> centre-of-building, never door to door, and nothing in it counts stairs, road
> crossings, or the class-change crowd. None of that has ever been walked with a
> stopwatch.

And a leg that does not work on foot:

> **AAA1111 in ZZZ → BBB2222 in YYY, `<N>`-minute gap: not on foot.**
>
> The walk is **NN–NN minutes** — the two are at opposite ends of campus. That's a
> real number, not a rounding problem.
>
> **If you drive**, the parts I can estimate are: about `<N>` min walking to `<garage>`,
> about `<N>` min driving to `<garage>`, about `<N>` min walking in. With the safety
> margin applied once across both walks, that's **`<N>` minutes before you start looking
> for a space**.
>
> **And that's where it stops.** I have no capacity, no fill times and no occupancy
> data for any garage, so *how long it takes to find a space is unknown* — on a
> weekday morning it's usually the biggest part of the trip. I'm not going to give
> you a total, because any total I gave you would be leaving out the part that
> decides it. Budget generously and leave when the first class ends.
>
> Seminole Express runs on weekdays, but none of its stops or times are in my data, so
> I can't tell you whether a bus helps here. The Transit app has live times.

And a refusal:

> **AAA1111 → BBB2222: I can't tell you.**
>
> Both are in ZZZ, which isn't in this plugin's campus data — only a fraction of
> campus ships. I could name a building nearby and give you a number, but it would be
> a number about a different building, so I'd rather say I don't know. Everything else
> about those classes is stored correctly.

## Never

- Never report one number, an average, or a "roughly N minutes".
- Never call a gap inside the margin "yes", "fine", "doable", or "you'll make it".
- **Never render `not-walkable` as a bare "no".** It answers about walking only.
- **Never total a drive.** There is no honest total while step 3 is unknown, and no
  field to read one from.
- Never present the gap minus the known minimum as time available to park.
- Never quote a Seminole Express time. None ship.
- Never estimate across a building that is not in the shipped data, even
  approximately, even when the student asks you to guess.
- Never substitute a nearby building for a missing one.
- Never answer a step-free routing question from the default route.
- Never turn `cannot-determine` into "no conflict".
- Never present these as measured times. Nothing here has been walked.
- Never answer a parking question from this skill; that is the `parking` skill and
  it has a blackout check this one does not run.
