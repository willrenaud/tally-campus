---
name: deadlines
description: FSU academic deadlines for the term — drop/add, tuition payment, the last day to drop without a grade, withdrawal, S/U election, holidays, breaks and the final exam period. Reads the shipped Registrar calendar, so it works even before a schedule is imported. Use whenever a student asks about a deadline, a drop or withdrawal date, when a holiday or break falls, or when finals are.
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

# Deadlines

$ARGUMENTS

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/deadlines.mjs --data-dir "${CLAUDE_PLUGIN_DATA}"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/deadlines.mjs --term 2026-fall --within 30
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/deadlines.mjs --data-dir "${CLAUDE_PLUGIN_DATA}" --json

Exit codes: **0** answered, **2** could not run, **3** **refused** — either no
shipped calendar covers the term asked about (`no-calendar`), or today is past
every shipped term and the data has expired (`calendar-out-of-date`, below).

**This skill works without a stored schedule.** Deadlines are a property of the
term, not of the student, so someone who has never run the importer still gets
their drop deadline. A schedule is used only to add the half-term caveat below.


## The shipped calendar expires, and the script knows it

This plugin ships **one term** — Fall 2026 — and that term ends. From the moment
today's date is past the last shipped term, the script **refuses with exit 3 and
kind `calendar-out-of-date`** instead of answering, because everything it could
say is a real, correctly transcribed date belonging to a term that is over. That
is the most convincing kind of wrong answer available here, and it needs no bug to
happen: a term looked up by code returns a valid record forever, so only a
comparison against today catches it.

When the script refuses this way:

- **Do not quote a date out of the shipped data anyway**, not even "for reference"
  or "last year this was…". That number is the one the student will remember.
- Say plainly that this copy of the plugin is out of date, and send them to the
  Registrar: <https://registrar.fsu.edu/bulletins/calendar>.
- If they ask you to fix it, the fix is a maintainer's: add the new term to
  `data/term-calendar.json`. The repository README has the procedure.

A date **before** a shipped term is not this case — the term simply has not started
— and the script answers normally.

## Quote the Registrar, do not paraphrase

Each deadline carries FSU's own wording in `description`, and it is there on
purpose. The difference between

> last day to **drop a course** without receiving a grade

and

> last day to **withdraw from school** without receiving a grade

is a real distinction on the **same date** — in the shipped term, one date carries
both. Paraphrase
destroys it, and a student who conflates the two drops out of a course when they
meant to drop the university, or the reverse. Use the Registrar's phrasing.

## Two traps, both built into the data

### 1. Finals is a date range with no exam grid

`finalsPeriod` carries `startDate`, `endDate`, `note` and `url` — and **nowhere to
put a mapping from meeting pattern to exam block**. So there is no per-course exam
time in this data, and the script cannot emit one because there is no field to
emit it from.

**Never expand a weekly schedule across finals week.** Exams do not fall at a
course's normal meeting time; FSU publishes a separate block grid with different
rules for MUT/STA/AST/PHY/BUL/CHM and the foreign languages. A schedule expanded
across the finals date range is simply wrong.

Send the student to the grid. The script prints the URL from the shipped record; use
the one it printed, not one written here.

### 2. Every shipped deadline is a full-term deadline

`sessions` is empty and `sessionsStatus` is `not-published`, because FSU publishes
session date ranges for summer terms only. A **half-term course has its own, much
earlier drop and withdrawal dates**, and none of them are in this data.

The script checks the stored schedule for courses whose `partOfTerm` does not
resolve and names them. If a student has one, say plainly that the dates above do
**not** apply to it and send them to their department or Student Central. Telling a
first-half student the full-term drop date may be a month late.

## Homecoming Friday is a half day

One Friday in the shipped term cancels classes **from midday** while morning classes
meet. The script is what knows which Friday and what time; do not name either from here.
The record has `classesCancelled: false` — which alone reads as an ordinary day —
so the schema carries `cancelledFromTime` and the script reports it as a partial
day. Surface it as one. Reporting it as a normal day sends someone to a 2 p.m.
class that is not happening.

Note also that Thanksgiving break overlaps a **home football game** in the shipped
term. If parking comes up for a date in that window, the `parking` skill refuses on it,
and correctly.

## What an answer looks like

**The dates below are `<PLACEHOLDER>` tokens, not real deadlines.** Fill them from
the script's output. If you have no script output, you have no dates — see the gate at
the top of this file.

> **The next one that matters is `<DATE-A>` — and it's three deadlines at once.**
>
> - **Last day to drop a course without receiving a grade.** Also the last day to
>   reduce course load without a dean's permission; dean's permission is required
>   to drop below `<N>` hours.
> - **Last day to elect S/U grading**, or to change an S/U option back.
> - **Last day to withdraw from school without receiving a grade** — that's
>   withdrawing from the *university*, not from a course. Different thing, same date.
>
> After that: `<DATE-B>` is the late-drop deadline with a dean's permission, and
> `<DATE-C>` is the last day to withdraw from the University at all.
>
> One caveat on all of it: FSU only publishes session dates for summer terms, so
> every date I have is a **full-term** date. If any of your courses is a half-term
> one, its real drop deadline is earlier and isn't in my data.

## Never

- Never paraphrase a deadline description into something shorter.
- Never give a per-course final exam time. There is no grid in this data.
- Never expand a weekly schedule across the finals date range.
- Never give a full-term deadline to a course you know is half-term.
- Never report Homecoming Friday as an ordinary day.
- Never invent a deadline for a term with no shipped calendar — the script refuses,
  and the refusal is the answer.
- Never quote a date out of an expired calendar, however you frame it.
