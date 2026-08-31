# 07 — a screenshot with no sections, no titles, and a building we do not have

**There is no `input.txt`, and that is the fixture.** The source was an image
pasted into a conversation. No script can read it, so there is nothing to checksum
and `import.sourceChecksum` is deliberately absent — which the schema allows, and
which the test suite has to tolerate rather than treat as a malformed fixture.

## What this pins down

This is the regression test for the draft-first rework. The same input, under the
0.3.0 skill, produced **four blocking questions before the student saw anything**:
which term, what are the section numbers, does the Thursday course really meet only
once, and a digit-by-digit recital of five room numbers. Every one of them failed
the "a question must earn its place" test, and an import that opens with four
questions is an import that gets abandoned.

So the assertion that matters here is **`blockingQuestions === 0`**. Everything the
old flow asked about is now either derived or stated as an assumption:

| Was asked | Now |
| --- | --- |
| "Which term?" | Derived by `current-term.mjs` from today's date and the shipped calendar. |
| "What are the section numbers?" | Omitted. `section` is optional in the schema — nothing about location, conflicts or walking times reads it. |
| "Does ISM3541 really meet only on Thursday?" | Stated as an observation. A once-weekly course is ordinary, not suspicious. |
| "Read me back room G-7-0-0…" | Room numbers appear in the week table; one closing check covers them. |

The four courses in WCB exercise rule 2 at scale: **four of five meetings have an
unresolvable building and the import still succeeds**. Fixture 04 proves one
unknown building does not fail an import; this one proves that a schedule which is
*mostly* unknown buildings still imports, still validates, and still asks nothing.
PDB resolves normally alongside them, so the failure is per-meeting rather than
per-schedule.

## The shape of the data

Five meeting blocks, not nine. A course meeting Tuesday and Thursday at one time in
one room is **one** record with two `daysOfWeek`, not one record per day — miscounting
that is an easy way to produce phantom conflicts, so it is worth stating.

No `title` on any meeting either. A grid screenshot prints course codes; inventing
titles from them, or echoing the code into the title field, would both be
fabrication.

`floor` is present only where `deriveFloor` actually succeeds — 2703 → 2 and
1701 → 1. `G700` and `A0101` start with a letter and derive nothing, so the field is
omitted rather than guessed. That the building is unknown does not stop the floor
being derivable: the floor is a property of the room number, not of the building.

## What changed in 0.6.0: `WCB` ships

This was **the** motivating case for closing the WCB gap. Four of these five courses
are in the Wertheim Center, so until 0.6.0 this schedule was mostly unroutable:
`can-i-make-it` refused every one of its legs and exited 3, and `parking` refused
outright. That is now reversed, and the test that used to assert *"every leg
refuses"* asserts *"every leg answers"*.

Two things did **not** change, deliberately:

- **The meetings themselves.** Same courses, same days, same times, same rooms. The
  only edit was removing the four `unknown-building-code` warnings, which a fresh
  import today would not raise.
- **`blockingQuestions === 0`.** The draft-first regression this fixture was built
  for is untouched by the building shipping, and it is still the primary assertion.

Worth recording: the room numbers this fixture carries, read off an image by OCR,
**check out against FSU's real room inventory** now that it can be consulted.
`2703` and `1701` are both listed as `(110) CLASSROOM` in building 4540, and `G700`
is a real room on the ground floor typed as something else. The one part of a
screenshot import most likely to be wrong turned out to be right.
