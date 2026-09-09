---
name: parking
description: Answer where to park at FSU for a given class, building, date and time — which garage, whether a permit is valid in that window, and what the enforcement actually is. Covers FSU's six parking garages only; refuses outright on home football game dates, on the evening before one, on dates with no shipped calendar, and on buildings that are not in the campus data. Use whenever a student asks about parking, garages, permits, or where to leave the car.
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

# Where to park

$ARGUMENTS

## Read this before you answer anything

Two facts about the shipped data set the shape of every answer:

**1. Six garages, and nothing else.** `parking-zones.json` holds FSU's six parking
garages. It holds **no surface lot of any kind** — not reserved green-striped
lots, not employee lots, not the student overnight or DeGraff resident lots, not
metered or visitor parking, not park-and-ride. FSU's parking map is behind the
same key-gated vendor application as its campus map, and the prose pages name
permit *types* rather than *places*. So a garage recommendation is never a list of
a student's options. It is a list of the garages.

**2. On seven Fall 2026 dates the shipped rules are known to be wrong.** FSU says
that "multiple campus parking areas will be closed for reserved Seminole Booster
parking on home football game days", that vehicles must be out "by 11:59 PM the
night before game day", and that a vehicle in a reserved Garnet area "will be
towed at your expense". It never says **which** areas, or which garages, or when
access returns. The dates are encoded to force a **refusal**, not to enable an
answer.

A hedged wrong answer gets the car towed exactly as thoroughly as a confident one.
That asymmetry is why this skill refuses in places where the rest of the plugin
would hedge.

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/where-to-park.mjs --building <CODE> --date <YYYY-MM-DD> --time <HH:MM>
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/where-to-park.mjs --building <CODE> --permits student-commuter
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/where-to-park.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --course <COURSE> --date <YYYY-MM-DD>
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/where-to-park.mjs --building <CODE> --json

Exit codes: **0** answered, **2** could not run, **3** **refused by design**.

A `no-calendar` refusal carrying `staleCalendar: true` means something more
specific than a gap in coverage: today is past every term this plugin ships, so
this copy is **out of date**. Say that, rather than implying the file merely lacks
one term, and add <https://registrar.fsu.edu/bulletins/calendar> to the Game Day link.

**Always run the script, and always pass a real date.** The blackout check is the
first thing it does and it exits before reading a single parking rule — there is
no code path from a game day to a recommendation. Answering from memory, or from
the rules without the date, is exactly the failure this design exists to prevent.
If the student has not said which day, use today's date and say which date you
used, in the answer, so they can correct it.

## Every case where this skill refuses

All five exit 3. A refusal is a correct answer. Do not soften any of them into a
hedged recommendation, and do not name a garage "just in case".

| Refusal | When | What to tell the student |
| --- | --- | --- |
| `blackout` | The date is one of the seven Fall 2026 home football dates | FSU closes and reserves campus parking that day and does not publish which areas. This data cannot be evaluated for that date. Send them to <https://transportation.fsu.edu/GameDay>. Quote FSU's own wording, including "towed at your expense". |
| `blackout-eve` | The date is the day **before** a game and the time is 17:00 or later | FSU requires vehicles out of reserved areas "by 11:59 PM the night before". A car left from the evening before is plausibly still there at that deadline. Same refusal, same link. |
| `no-calendar` | No shipped term calendar covers the date — anything outside Fall 2026 | This is the one that is easy to get wrong. A date with **no calendar** is not a normal day; it is a day whose game status is *unknown*. Say that, rather than assuming it is clear. |
| `building-not-in-data` | The building is not one of the 33 that ship | There is no coordinate for it, so no garage can be ranked against it. Naming one anyway is a guess about a building the data has never seen. |
| `location-tba` / `no-location` | The named course has no announced room, or is online | Nothing to park near yet. |

**Not every blackout date is a Saturday** — the shipped term includes a Monday and a
Friday game, both on dates a student would otherwise be on campus. The script reads
the list; never assume a weekday is clear. Treating game days as a
weekend problem misses both. This is a reason to always pass the real date rather
than reasoning about the day of the week.

## What every answer must contain

Not optional, and not only when it seems relevant:

1. **The date and time the answer is for.** Rules are time-windowed; an answer
   without a moment attached is not an answer.
2. **That surface lots are not covered.** Six garages, nothing else. A student who
   reads a garage list as their full set of options drives past a lot they could
   have used, or parks in one this data cannot vouch for.
3. **The matched rule's `enforcementNote`, in full.** This is where the real
   content is. It carries the phrase "unless denoted by signage" — which is *part
   of the rule*, not a disclaimer — and it records that **FSU's own two pages
   disagree** about student white-space hours: the garages page says 5:45 AM to
   midnight, the general parking page says Monday–Friday 7:30 AM to 4:30 PM. That
   conflict is recorded, not resolved. Pass it on unresolved.
4. **That the sign at the space wins.** Every time.

The script prints all four. Relay them; do not summarise the enforcement note down
to "a permit is required".

## Reading the output

- Garages marked **"listed for this building"** come from the record's curated
  `servesBuildings` — local knowledge, and they outrank geometry. Lead with these.
- Garages marked **"nearest by geometry only"** are ranked by straight-line
  distance because nothing in the data connects them to that building. Say so if
  you mention one.
- The walk time to the building is a **straight-line estimate, not a graph route**
  — no walk edge in the shipped data has a parking endpoint, so a garage-to-class
  walk cannot be routed properly. It carries the same safety margin as
  `can-i-make-it` and is reported as a range for the same reason.
- `eligible: null` means the student has not said which permits they hold. That is
  *unanswered*, not "not allowed". Ask only if the answer would change what you
  say; otherwise state the allowed classes and let them match themselves.

## What the data cannot tell you, ever

Say so rather than reaching for a plausible answer:

- **Which floors are student and which are faculty/staff.** Third-party summaries
  say first floor is R/RP and upper floors are W. That sentence is on no FSU page
  fetched for this build, so it is not in the data and must not be asserted.
- **Capacity, or when a garage fills.** Not published anywhere reachable.
- **Where the pedestrian exits are.** Each garage has one stand-in access point at
  the structure's centre. There is no "leave by the north stairwell".
- **Anything about accessible parking beyond the `ada-accessible` permit class.**
  No ADA space counts, no lift information. `DATA-GAPS.md` §9.

## What an answer looks like

**Every building code, garage, date, time and duration below is a fake placeholder.**
`ZZZ`, `<PGn>`, `NN–NN`. Fill them from the script's output; with no output, see the
gate at the top of this file.

> **For your `<TIME>` in ZZZ on `<weekday>` `<DATE>`:**
>
> **`<garage name>` (`<PGn>`)** is the closest of the garages the data lists for ZZZ —
> roughly a **NN–NN minute** walk, though that is a straight-line estimate rather
> than a real route. `<garage name>` (`<PGn>`) is another one listed, about NN–NN.
>
> At that hour on a weekday both are **permit-required**, and student commuter permits
> are on the allowed list.
>
> Two things you should hear in full. First, the rule the script printed carries a
> **"unless denoted by signage"** clause — the signage clause is part of the rule, so a
> sign at the space overrides all of this. Second, FSU's own pages disagree with each
> other about student hours, and the script surfaces both; nobody has resolved that,
> including me. Quote the `enforcementNote` the script gave you, verbatim.
>
> And the big caveat: **only the six garages are in this data.** No surface lot,
> metered space or reserved lot is in it at all, so this isn't a list of where you
> could park — it's a list of the garages.

And a refusal:

> **`<DATE>` is a home game — `<the fixture the script named>` — and I won't guess at
> parking for it.**
>
> FSU closes and reserves campus parking areas on home football game days, requires
> vehicles out "by 11:59 PM the night before", and tows from reserved Garnet areas
> at your expense. What it does *not* publish is which areas, which garages, or
> when access comes back. So the parking rules I have are known to be wrong for
> that date and I have nothing honest to put in their place.
>
> Check <https://transportation.fsu.edu/GameDay> before you drive in. Worth knowing
> that the restriction can start the evening before, too.

## Never

- Never answer for a blackout date, in any form, however hedged, however much the
  student presses. Point at the FSU page instead.
- Never treat "no shipped calendar for this date" as "the date is clear".
- Never assume game days are Saturdays. Two of the seven are not.
- Never name a garage for a building that is not in the shipped data.
- Never present the six garages as FSU's parking, or omit that surface lots are
  missing.
- Never drop or summarise away the `enforcementNote`.
- Never resolve FSU's contradiction about white-space hours. Report both.
- Never assert the first-floor/upper-floor permit split. It is not sourced.
- Never say a space is free or safe. Say what the rule says, and that the sign wins.
