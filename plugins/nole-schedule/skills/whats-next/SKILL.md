---
name: whats-next
description: Tell a student what class they have next, what is on today, or what their week looks like — time, building and room, read from their imported FSU schedule. Handles the end of the day, weekends, holidays, the Homecoming half day, finals week and the gaps between terms without inventing a next class. Use whenever a student asks what is next, what they have today or tomorrow, when their first or last class is, or what their week looks like.
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

# What's next

$ARGUMENTS

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/whats-next.mjs --data-dir "${CLAUDE_PLUGIN_DATA}"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/whats-next.mjs --data-dir "${CLAUDE_PLUGIN_DATA}" --json
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/whats-next.mjs --data-dir "${CLAUDE_PLUGIN_DATA}" --now <YYYY-MM-DD>T<HH:MM>

It prints NEXT CLASS, TODAY and THIS WEEK in one pass — answer whichever the
student asked for and ignore the rest. `--now` exists for testing and for a
student asking about a specific moment; without it the clock is real, resolved in
**America/New_York**, which is the only timezone this data is written in.

Exit codes: **0** answered, **2** could not run, **3** **refused — the shipped
calendar has expired** (`calendar-out-of-date`), **4** **no schedule imported**.

## Exit 3: this copy of the plugin is out of date

This plugin ships **one term** — Fall 2026 — and that term ends. Once today is past
the last shipped term there is no calendar behind "next", "today" or "this week",
so the script refuses rather than reporting an empty week. **An empty week and an
expired plugin look identical to a student**, and only one of them means "you have
no classes".

Do not fill the gap from the stored schedule yourself. Say the data is out of date,
and send them to the Registrar: <https://registrar.fsu.edu/bulletins/calendar>. Adding the new term to
`data/term-calendar.json` is the maintainer fix; the repository README has it.

A date **before** a shipped term is not this case — the term has not started, and
the script answers normally.

**Run the script rather than reading the stored JSON yourself.** Whether today is
a class day at all is a three-valued question, and the script is what makes it so.

## Exit 4 is the most likely outcome you will hit

A student who has never run the importer is the most likely caller of this skill.
The script exits 4 and says so. Do not paper over it, and above all **do not
report it as "you have no classes today"** — that is indistinguishable from a real
free day and sends them to a class they do have.

> You haven't imported a schedule yet, so I have nothing to read. Paste your
> schedule from Student Central, drop in an `.ics` export, or send a screenshot of
> your week and I'll set it up — it only has to be done once for the term.

## Never invent a next class

The five cases the script separates, and what each one means:

| Case | What the script does | What to say |
| --- | --- | --- |
| Ordinary class day | Lists meetings in time order | The straight answer. |
| After the last class today | Searches forward day by day | "Nothing else today — next is `<weekday>` at `<TIME>`." |
| Weekend or holiday | `dayStatus` returns `none` with the reason | Name the reason the script gave. "`<weekday>` is `<holiday name>`, so nothing until `<weekday>`." |
| **Finals week** | Returns **no meetings at all** | The weekly pattern does not apply. Exams are not at the normal meeting time. Send them to the Registrar's exam grid. **Never expand the weekly schedule across the finals range the script reports.** |
| Term over / between terms | Stops rather than wrapping | "`<term>` classes ended `<DATE>`." Do not roll forward into a term with no shipped calendar. |

The search walks forward one real calendar day at a time and **stops at the end of
the term**. It never wraps around to the start. If it comes back empty, that is
the answer.

## The Homecoming half day

One Friday in the shipped term cancels classes **from midday**, while morning classes
meet as normal. The script is what knows which Friday and what time — do not name
either from here. The shipped record has `classesCancelled: false`, which on its own
reads as an ordinary day — so the schema now carries `cancelledFromTime` and the
script reports the day as `partial`, lists the morning classes, and lists the
afternoon ones under **CANCELLED**.

Surface both halves. A student told they have an afternoon class that day walks to a
locked room.

## Location-unresolved courses are listed, never omitted

A course whose building is not in the shipped data, or whose room FSU has not
announced, still appears in the list **with its time**, flagged inline:

> **`<weekday>`** — AAA1111 `<TIME>`–`<TIME>`, ZZZ 0000 · BBB2222 `<TIME>`–`<TIME>`,
> ZZZ 1111 · CCC3333 `<TIME>`–`<TIME>`, YYY 2222 *(`<building name>`)*

(Fake codes, as everywhere in this file. The shape is the lesson: one line per class,
time first, place after, nothing omitted.)

The time is right even when the place is not. Dropping a class to keep the answer
tidy is the failure a student cannot catch — they trust the list, miss the class,
and stop trusting the list. Say what is unresolved and carry on.

Import caveats travel with the answer too: the script attaches each meeting's
`import.warnings` to it, so a room read off a screenshot months ago can still be
flagged as the least reliable thing on the line.

## What an answer looks like

**Every course code, building code, room and time below is a fake placeholder.**
`AAA1111`, `ZZZ`, `<TIME>` — they are not real and they are not defaults. Fill them
from the script's output; if you have none, see the gate at the top of this file.

> **Next up: AAA1111 at `<TIME>` in ZZZ 0000** — the `<building name>`. You've got
> about `<N>` hours.
>
> Rest of today: BBB2222 at `<TIME>` (ZZZ 1111), then CCC3333 at `<TIME>` over in
> YYY 2222. That last one is the only walk worth planning — ZZZ to YYY is across
> campus. Ask me "can I make it" if you want the number.

And a non-day:

> **Nothing today — it's `<holiday name>`.** Classes are cancelled all day.
>
> Next is `<weekday>`: AAA1111 at `<TIME>` in ZZZ 0000.
>
> Worth knowing separately: that day is also a home football game, so if you were
> planning to park on campus for anything else, ask me about parking first.

Note what the shape teaches and the values do not: name the course, the time and the
place; say what is left today; flag the one leg worth planning; name the holiday rather
than going blank. All of that comes from the script.

## Never

- Never report "no schedule imported" as an empty day.
- Never invent a next class past the end of the term.
- Never expand the weekly schedule across finals week.
- Never treat Homecoming Friday as a normal day.
- Never drop a location-unresolved course from a day's list.
- Never compute a walking time here — that is `can-i-make-it`, which has a safety
  margin this skill does not apply.
