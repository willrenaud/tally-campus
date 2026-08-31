---
name: deadlines
description: FSU academic deadlines for the term — drop/add, tuition payment, the last day to drop without a grade, withdrawal, S/U election, holidays, breaks and the final exam period. Reads the shipped Registrar calendar, so it works even before a schedule is imported. Use whenever a student asks about a deadline, a drop or withdrawal date, when a holiday or break falls, or when finals are.
---

# Deadlines

$ARGUMENTS

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/deadlines.mjs --data-dir "$CLAUDE_PLUGIN_DATA"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/deadlines.mjs --term 2026-fall --within 30
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/deadlines.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --json

Exit codes: **0** answered, **2** could not run, **3** **refused** — no shipped
calendar covers the term or date asked about.

**This skill works without a stored schedule.** Deadlines are a property of the
term, not of the student, so someone who has never run the importer still gets
their drop deadline. A schedule is used only to add the half-term caveat below.

## Quote the Registrar, do not paraphrase

Each deadline carries FSU's own wording in `description`, and it is there on
purpose. The difference between

> last day to **drop a course** without receiving a grade

and

> last day to **withdraw from school** without receiving a grade

is a real distinction on the **same date** — 9 October 2026 is both. Paraphrase
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
across 7–11 December is simply wrong.

Send the student to the grid:
<https://registrar.fsu.edu/fall-2026-exam-schedule>

### 2. Every shipped deadline is a full-term deadline

`sessions` is empty and `sessionsStatus` is `not-published`, because FSU publishes
session date ranges for summer terms only. A **half-term course has its own, much
earlier drop and withdrawal dates**, and none of them are in this data.

The script checks the stored schedule for courses whose `partOfTerm` does not
resolve and names them. If a student has one, say plainly that the dates above do
**not** apply to it and send them to their department or Student Central. Telling a
first-half student "you have until 9 October to drop" may be a month late.

## Homecoming Friday is a half day

20 November 2026 cancels classes **from 12:00 p.m.** while morning classes meet.
The record has `classesCancelled: false` — which alone reads as an ordinary day —
so the schema carries `cancelledFromTime` and the script reports it as a partial
day. Surface it as one. Reporting it as a normal day sends someone to a 2 p.m.
class that is not happening.

Note also that Thanksgiving break runs 25–27 November, and **27 November is also a
home football game** — the Florida game. If parking comes up for that date, the
`parking` skill refuses on it, and correctly.

## What an answer looks like

> **The next one that matters is 9 October — and it's three deadlines at once.**
>
> - **Last day to drop a course without receiving a grade.** Also the last day to
>   reduce course load without a dean's permission; dean's permission is required
>   to drop below 12 hours.
> - **Last day to elect S/U grading**, or to change an S/U option back.
> - **Last day to withdraw from school without receiving a grade** — that's
>   withdrawing from the *university*, not from a course. Different thing, same date.
>
> After that: 13 November is the late-drop deadline with a dean's permission, and
> 4 December is the last day to withdraw from the University at all.
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
