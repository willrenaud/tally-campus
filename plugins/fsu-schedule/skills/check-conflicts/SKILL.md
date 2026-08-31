---
name: check-conflicts
description: Check an imported FSU schedule for time collisions between courses. Reports three outcomes rather than two — a genuine overlap, a pair ruled out because one runs first-half and the other second-half, and pairs that CANNOT BE DECIDED because FSU does not publish fall session dates. Use whenever a student asks whether two courses conflict, whether their schedule works, or whether they can add a section.
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

> **REL3170 and PHI2100 — I can't tell you, and here's exactly why.**
>
> They're both Tue/Thu 10:00–11:15, so on the clock they're identical. But REL3170
> is a first-half course and PHI2100 is second-half, which would normally mean
> they're fine — different halves of the term, no overlap.
>
> The problem is that FSU only publishes session date ranges for *summer* terms.
> There's no published first-half/second-half date range for Fall 2026 anywhere, so
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
