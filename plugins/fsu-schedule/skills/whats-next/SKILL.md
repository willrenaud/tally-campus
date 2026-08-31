---
name: whats-next
description: Tell a student what class they have next, what is on today, or what their week looks like — time, building and room, read from their imported FSU schedule. Handles the end of the day, weekends, holidays, the Homecoming half day, finals week and the gaps between terms without inventing a next class. Use whenever a student asks what is next, what they have today or tomorrow, when their first or last class is, or what their week looks like.
---

# What's next

$ARGUMENTS

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/whats-next.mjs --data-dir "$CLAUDE_PLUGIN_DATA"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/whats-next.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --json
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/whats-next.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --now 2026-11-20T13:00

It prints NEXT CLASS, TODAY and THIS WEEK in one pass — answer whichever the
student asked for and ignore the rest. `--now` exists for testing and for a
student asking about a specific moment; without it the clock is real, resolved in
**America/New_York**, which is the only timezone this data is written in.

Exit codes: **0** answered, **2** could not run, **4** **no schedule imported**.

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
| After the last class today | Searches forward day by day | "Nothing else today — next is Tuesday 11:30." |
| Weekend or holiday | `dayStatus` returns `none` with the reason | Name the reason. "Monday is Labor Day, so nothing until Tuesday." |
| **Finals week** | Returns **no meetings at all** | The weekly pattern does not apply. Exams are not at the normal meeting time. Send them to the Registrar's exam grid. **Never expand the weekly schedule across Dec 7–11.** |
| Term over / between terms | Stops rather than wrapping | "Fall 2026 classes ended 4 December." Do not roll forward into a term with no shipped calendar. |

The search walks forward one real calendar day at a time and **stops at the end of
the term**. It never wraps around to the start. If it comes back empty, that is
the answer.

## The Homecoming half day

Friday 20 November 2026 cancels classes **from 12:00 p.m.**, while morning classes
meet as normal. The shipped record has `classesCancelled: false`, which on its own
reads as an ordinary day — so the schema now carries `cancelledFromTime` and the
script reports the day as `partial`, lists the morning classes, and lists the
afternoon ones under **CANCELLED**.

Surface both halves. A student told "you have ECO2013 at 2pm" that day walks to a
locked room.

## Location-unresolved courses are listed, never omitted

A course whose building is not in the shipped data, or whose room FSU has not
announced, still appears in the list **with its time**, flagged inline:

> **Thu** — ISM3541 8:00–9:15, WCB G700 · FIN4424 11:30–12:45, WCB 2703 ·
> SOP3004 3:00–4:15, PDB A0101 *(Psychology)*

The time is right even when the place is not. Dropping a class to keep the answer
tidy is the failure a student cannot catch — they trust the list, miss the class,
and stop trusting the list. Say what is unresolved and carry on.

Import caveats travel with the answer too: the script attaches each meeting's
`import.warnings` to it, so a room read off a screenshot months ago can still be
flagged as the least reliable thing on the line.

## What an answer looks like

> **Next up: FIN4424 at 11:30 in WCB 2703** — the Wertheim Center. You've got
> about two hours.
>
> Rest of today: FIN4453 at 1:15 (WCB 1701), then SOP3004 at 3:00 over in PDB
> A0101. That last one is the only walk worth planning — WCB to Psychology is
> across campus. Ask me "can I make it" if you want the number.

And a non-day:

> **Nothing today — it's Labor Day.** FSU has classes cancelled all day.
>
> Next is Tuesday: FIN4424 at 11:30 in WCB 2703.
>
> Worth knowing separately: Labor Day Monday is also a home football game, so if
> you were planning to park on campus for anything else, ask me about parking
> first.

## Never

- Never report "no schedule imported" as an empty day.
- Never invent a next class past the end of the term.
- Never expand the weekly schedule across finals week.
- Never treat Homecoming Friday as a normal day.
- Never drop a location-unresolved course from a day's list.
- Never compute a walking time here — that is `can-i-make-it`, which has a safety
  margin this skill does not apply.
