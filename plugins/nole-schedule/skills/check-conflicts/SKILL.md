---
name: check-conflicts
description: Check an imported FSU schedule for time collisions between courses. Reports three outcomes rather than two — a genuine overlap, a pair ruled out because one runs first-half and the other second-half, and pairs that CANNOT BE DECIDED because FSU does not publish fall session dates. Use whenever a student asks whether two courses conflict, whether their schedule works, or whether they can add a section.
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

# Do these classes conflict?

$ARGUMENTS

## The script

    node "${CLAUDE_PLUGIN_ROOT}"/scripts/check-conflicts.mjs --data-dir "$CLAUDE_PLUGIN_DATA"
    node "${CLAUDE_PLUGIN_ROOT}"/scripts/check-conflicts.mjs --data-dir "$CLAUDE_PLUGIN_DATA" --json

Exit codes: **0** answered — *including* answering "cannot determine" — **2** could
not run, **4** no schedule imported.

There is deliberately **no refusal exit code here**. "Cannot determine" is a
finding, not a refusal, and it is reported alongside everything that could be
decided rather than instead of it.

**This is also the one calendar-dependent skill that does not refuse when the
shipped calendar expires.** A collision is a fact about two meetings in the stored
schedule — "these overlap on Tuesday at 11" stays true after the term ends — so
withholding it would be its own kind of dishonesty. What does go stale is every
date the answer points at afterwards. When `calendarStale` is true the script
prints a banner saying so; carry it into your answer, keep the verdicts, and send
the student to <https://registrar.fsu.edu/bulletins/calendar> for anything dated.

## Three outcomes, and the third is the common one

| Verdict | Means |
| --- | --- |
| `conflict` | They share a day, overlap on the clock, and their date ranges overlap. A real problem. |
| `no-conflict` | They overlap on the clock but never in the same weeks — one is first-half, the other second-half. A **positive** finding that needs dates to support it. |
| `cannot-determine` | At least one course's `partOfTerm` cannot be placed on the calendar at all. Whether they collide is **unknown**. |

**Right now the third is the normal outcome for any half-term course.** FSU's
Registrar publishes first-half/second-half session date ranges for **summer terms
only**. The shipped Fall 2026 calendar therefore carries
`sessionsStatus: "not-published"` and an empty `sessions` array, so a course marked
`first-half` or `second-half` has no dates to compare against.

## Make it read as informative, not broken

This is the part that needs care. "I cannot tell you whether these conflict" sounds
like a tool failure, and it is not one — it is a precise fact about what FSU
publishes, and it comes with a one-step fix. Say all three parts:

1. **What is unknown, and why.** FSU does not publish fall session dates. This
   isn't the plugin missing something it could have.
2. **What it is not.** It is *not* "no conflict". Told "no conflict", a student
   registers for both and finds out in week one.
3. **How the student settles it in one step.** They know their own course dates —
   the first and last meeting are on the syllabus. Give those and the course
   becomes `partOfTerm: "custom"` with a `dateRange`, which resolves exactly.

**`AAA1111`, `BBB2222` and the times below are fake placeholders**, not real courses.
Fill them from the script's output.

> **AAA1111 and BBB2222 — I can't tell you, and here's exactly why.**
>
> They're both `<days>` `<TIME>`–`<TIME>`, so on the clock they're identical. But
> AAA1111 is a first-half course and BBB2222 is second-half, which would normally mean
> they're fine — different halves of the term, no overlap.
>
> The problem is that FSU only publishes session date ranges for *summer* terms.
> There's no published first-half/second-half date range for the term in question, so
> I have nothing to compare. They might never overlap, or they might collide every
> week.
>
> **This is not the same as "no conflict"** — I'd be guessing, and the guess costs
> you a registration problem you find out about in week one.
>
> One-step fix: your syllabus will give the first and last meeting date for each.
> Tell me those and I can settle it exactly.

## Never collapse the third outcome

The script counts the three verdicts separately and prints all three counts, so
"no conflicts found" cannot be printed over a schedule with an undecidable pair in
it. Do not undo that in your summary. A schedule with one real conflict and one
undecidable pair has **two** things worth saying, and the undecidable one is the
one the student has to go and check.

## Half-term courses affect deadlines too

The script lists courses whose `partOfTerm` does not resolve, separately from the
collisions. Those courses have their own, much earlier drop and withdrawal dates,
and **none of them are in the shipped calendar** — every deadline it carries is a
full-term one. If a student has such a course, say so; the `deadlines` skill says
it too.

## A genuine conflict is usually a parse error

When two full-term courses really do overlap, the most common cause is a misread
time at import, not a registration mistake. Say the collision plainly, then offer
the cheaper explanation first: *is that time right?* FSU will not normally let a
student register for two overlapping full-term sections, so a genuine conflict in
stored data is more often a bad row than a bad schedule.

## Never

- Never report `cannot-determine` as "no conflict", or fold it into a total.
- Never guess a `partOfTerm`, or assume an unresolvable one is full-term.
- Never say "your schedule is fine" while an undecidable pair exists.
- Never fill in a `dateRange` on the student's behalf — offer it, let them supply
  the dates.
- Never treat an asynchronous course as conflict-free; it has no meeting time, so
  there is nothing to claim either way.
