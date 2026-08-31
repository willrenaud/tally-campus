---
name: import-schedule
description: Import an FSU class schedule from text pasted out of myFSU or Student Central, an .ics calendar export, a screenshot, or the student describing their courses one at a time. Parses it, resolves buildings against the shipped campus data, shows the week back for confirmation, and saves it. Use whenever a student wants to add, replace, re-import, or correct their class schedule for a term.
---

# Import a class schedule

You are turning whatever a student has to hand into one validated
`student-schedule` document at `${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json`.

$ARGUMENTS

## Draft first. Always.

**Parse everything you can, then show the week. The table is the confirmation
step.** A student who pastes a schedule and gets questions back has been asked to
do work before receiving any; that import gets abandoned. A student who gets their
week rendered back, with the assumptions listed under it, can correct it in one
word — and correcting a table they can see is both faster and more accurate than
answering questions about data they cannot.

So the shape of every import is:

> parse → resolve → draft the document → **show the week and the assumptions** →
> ask only what genuinely could not be resolved → save on a yes

Never invert that. Do not ask a question before the table exists, however sure you
are that you will need the answer. If something is unresolvable, put your best
reading in the draft, mark it, and raise it *underneath* the week.

## A question must earn its place

This is the rule the rest of the skill is built on. Ask **only** when both are true:

1. The answer **cannot be inferred** from the source, the shipped data, or the date; **and**
2. **Getting it wrong would produce a schedule that is quietly incorrect** — wrong in a
   way the student would not catch while reading the draft table.

Everything failing that test becomes a **stated assumption** printed under the
draft. Assumptions are not hedging and they are not decoration: they are how a
student corrects you in one word instead of one exchange.

Worked examples of the rule, because it is easy to agree with and hard to apply:

| Situation | Question or assumption? | Why |
| --- | --- | --- |
| No term stated anywhere | **Assumption** | Derivable from today's date. Wrong is visible on the draft's first line. |
| No section numbers in the source | **Assumption** | Nothing is computed from a section. Fabricating `0001` is worse than omitting it. |
| Building code not in `buildings.json` | **Assumption** | The student cannot fix FSU's missing data, and the import still works. |
| Room says `TBA` | **Assumption** | Omit `room`; the building still routes. |
| A course meets once a week | **Assumption** | Ordinary. Note it; never ask about it. |
| A room number read off an image | **Assumption**, checked in the table | Shown in full in the week; one closing check covers it. |
| A row that could not be parsed at all | **QUESTION** | A silently missing class is exactly what scanning a table will not catch. |
| `TH` in a day column | **QUESTION** | Tuesday+Thursday or Thursday alone. Both common, and the draft would look correct either way. |
| A bare `1:50` with no meridiem | **QUESTION** | 01:50 and 13:50 both render as a plausible class. |
| Two full-term courses genuinely overlapping | **QUESTION** | Usually a misread time; occasionally a real registration problem. Only the student knows. |

`review-schedule.mjs` computes this split for you and prints it as `ASSUMPTIONS`
and `MUST ASK`. Trust its `MUST ASK` list as the floor, not the ceiling: it can
only see what reached the document, so a genuine ambiguity you resolved while
reading the source belongs there too — record it as a warning and it will appear.

## The four rules, in priority order

When these conflict, the earlier one wins.

**1. Never invent a field to make a record validate.** An unknown building, a
missing room, a section that is not printed: none of these becomes a plausible
value. But note what this rule does *not* say — it does not say "ask". Most of
them become an **omitted field and a stated assumption**. `section`, `title` and
`room` are all optional in the schema precisely so that absent can be represented
honestly. Fabrication is the sin; a question is only sometimes the remedy.

**2. An unknown building code is expected, not exceptional.** Only 32 of FSU's
500-plus buildings ship with this plugin. When a code is not in `buildings.json`
the import **succeeds** with that meeting marked location-unresolved, and you tell
the student plainly which features will not work for that course. Never fail a
whole import over one course. Never substitute a building because the name looked
close. Never ask the student to pick a different one.

**3. Confirm before writing.** Show the parsed schedule back as a weekly table and
get an explicit yes. An error caught here costs a sentence; the same error caught
three weeks in costs a missed class.

**4. Validate before writing.** `save-schedule.mjs` refuses invalid documents, and
that refusal is a backstop, not the plan. Run `review-schedule.mjs` first.

## The scripts

All are dependency-free Node and run with no install. `$P` below is
`${CLAUDE_PLUGIN_ROOT}/scripts`.

| Script | Use it for |
| --- | --- |
| `node "$P"/current-term.mjs` | The term to assume, from today's date and the shipped calendar. |
| `node "$P"/parse-ics.mjs <file>` | Unfolding and reading an `.ics` export into drafts. |
| `node "$P"/resolve-buildings.mjs "HCB 216" ...` | Turning a raw location string into a building code, or finding out that it cannot be. |
| `node "$P"/review-schedule.mjs draft.json` | Validating, rendering the week, listing assumptions, and separating them from genuine questions. Writes nothing. |
| `node "$P"/save-schedule.mjs --plan --term 2026-fall` | What is already stored, so you can say what you are about to replace. |
| `node "$P"/save-schedule.mjs draft.json` | Validating again and writing. |

Write the draft to a temporary file and pass its path; do not try to hold a large
JSON document in a shell argument.

## Procedure

1. **Establish the term without asking.** Run `current-term.mjs`. It returns a
   `termCode` and a `basis`. State it on the draft — "assuming Fall 2026" — so it
   is correctable in one word. Ask only if the basis is `month`, which means no
   shipped calendar covers or follows today and the value is a shape rather than a
   fact. If the source itself names a term, that always wins.
2. **Check what is already stored:** `save-schedule.mjs --plan --term <termCode>`.
   If a schedule exists, say so in the draft message, not before it.
3. **Parse** by the route for the source type below. Parse *everything* you can
   before stopping for anything.
4. **Resolve every location** through `resolve-buildings.mjs`.
5. **Build the draft document** and write it to a temp file. Record every
   assumption and unresolved value as an `import.warnings` entry as you go.
6. **Review:** `review-schedule.mjs draft.json`. Fix any schema error; do not work
   around it by dropping a field.
7. **Show the week, then the assumptions, then the questions** — in that order,
   and only that order. Ask for an explicit yes.
8. **Save:** `save-schedule.mjs draft.json`. Report what it did, including any
   replacement and archive.

## What the draft message looks like

The week first, as a table the student can scan. Then assumptions. Then, only if
`MUST ASK` is non-empty, the questions. Then the request for a yes.

> **Fall 2026** — 5 courses, 5 meeting blocks. *(assuming Fall 2026, from today's date)*
>
> | | Mon | Tue | Wed | Thu | Fri |
> | --- | --- | --- | --- | --- | --- |
> | 08:00–09:15 | | | | ISM3541 · WCB **G700** | |
> | 11:30–12:45 | | FIN4424 · WCB **2703** | | FIN4424 · WCB **2703** | |
>
> **Assumptions** — correct any of these in a word:
> - Assuming Fall 2026 from today's date; the screenshot does not say.
> - No section numbers in the image, so none stored. Nothing about location,
>   conflicts or walking times uses them; say the word if you want them.
> - All five treated as full-term — the source does not say otherwise.
> - WCB is not in the shipped campus data (see below).
> - ISM3541 meets once a week, on Thursday. Ordinary, but correct me if a day was cut off.
> - Read from an image, so **room numbers** are the likeliest thing to be wrong —
>   they are bolded above. Check them.
>
> Anything to fix, or shall I save it?

Room numbers get **bold** in the table and a single closing check. That is the
whole OCR safeguard: prominent where the student is already looking, and one
question at the end rather than a digit-by-digit recital they will skim and
approve. A misread room is silent until someone is at the wrong door, so it does
need checking — it does not need an interrogation.

## Source types

### Text pasted from myFSU or Student Central

The messy case, and the common one. Expect ragged columns, lines wrapped mid-field,
the header row repeated wherever the source paginated, blank separator rows, and
`TBA` in location and instructor columns.

- **Read the whole paste before parsing any of it.** The column order is not fixed
  and is only discoverable from the header. Find a header row, use it, and then
  ignore every later repetition of it.
- **Rejoin wrapped lines.** A line that carries no course code, no time and no day
  letters is almost always the tail of the line above. Rejoining is a judgement, so
  when a rejoin changes what a field means, state it as an assumption under the
  draft — the rejoined value is visible in the table.
- One course section often produces **several rows** — a lecture and a lab, or
  different days in different rooms. Each becomes its own meeting record sharing
  `courseCode` and `section`. Do not collapse them.
- A row you cannot parse is **not silently dropped**. Record an `unparsed-row`
  warning with the row text in `rawValue`. This is one of the few genuine
  questions, and `review-schedule.mjs` will list it under `MUST ASK`.

Set `import.sourceFormat` to `text-paste`.

### An .ics export

Run `parse-ics.mjs`. It handles line unfolding, escaped values, and `RRULE`
`BYDAY`/`INTERVAL`/`UNTIL`, and returns drafts plus warnings.

What a calendar file does **not** contain: `deliveryMode`, `meetingType`, `section`,
`partOfTerm`, and usually the course title in any clean form. Omit what you cannot
read and say so under the draft; do not collect them course by course. A `.ics`
with no `LOCATION` does not mean online — it means the field is empty, which goes
in the draft as an unresolved location, not as a guess.

Set `import.sourceFormat` to `ics`.

### A screenshot

You read the image; no script can. Everything else is identical, with two
additions:

- Set `import.sourceFormat` to `screenshot-ocr`, which is the schema's signal that
  every value in the document should be hedged about.
- **Put room numbers in the draft table in bold, and ask once at the end whether
  anything looks wrong.** Not digit by digit, and not before the table.

A grid screenshot typically carries no sections, no titles, no part-of-term and no
class numbers. That is normal and none of it is a question. Omit all of them.

### Dictation, one course at a time

Set `import.sourceFormat` to `manual-entry`. Collect course by course — this is the
one source type where the student is generating the data as you go, so there is no
draft to show until they are done. Ask for the building the way a student says it —
"Bellamy", "HCB" — and run it through `resolve-buildings.mjs`, which understands
aliases. Read the whole week back at the end, not after each course.

## Decision table for ambiguous input

Apply top to bottom; the first matching row wins. **A → in the last column means a
stated assumption, not a question.**

| What you see | What to do |
| --- | --- |
| No term named in the source | **A.** Use `current-term.mjs`. State it. |
| No section anywhere in the source | **A.** Omit `section`. Note it once for the whole schedule, not per course. |
| No course title in the source | **A.** Omit `title`. Not worth a line of its own unless nothing else is assumed. |
| A course meeting on exactly one day | **A.** Ordinary. Note it under the table so a cropped screenshot is still catchable. |
| `TH` or `TTH` in a day column | **Ask.** FSU spells Thursday `R`, so `TH` reads as Tuesday+Thursday under FSU's scheme and as Thursday alone under most others. Both are common, and the draft looks right either way. `expandDays` refuses this on purpose. |
| Bare `TU`, `FR`, `SU` as the entire day field | **Ask.** Each is both a two-letter abbreviation and a valid pair of FSU letters (`FR` = Friday, or Friday+Thursday). |
| `MWF`, `TR`, `M`, `Mon/Wed/Fri`, `Tue, Thu` | Expand mechanically. These are unambiguous. |
| A time with no AM/PM, hour 1–9, e.g. `1:50` | **Ask**, unless the other end of the same range carries a meridiem that makes exactly one reading produce a positive span under twelve hours — `parseTimeRange` already applies that and nothing else. |
| A time like `13:50`, `09:05`, `0955` | Take it as 24-hour. Unambiguous. |
| Location column says `TBA`, `TBD`, `ARR`, `To Be Announced`, or is empty | **A.** Physical class, location unannounced: `locationTba: true`, `location` absent. **Not** online. |
| Location column says `Online`, `WEB`, `Remote`, `Canvas`, `Zoom` | **A.** No physical location: `location: null`. **Never** `locationTba`, and never a building code of `WEB`. |
| Building resolves, room says `TBA` | **A.** Keep the building, omit `room` entirely. Never store the string `"TBA"` in `room`. Add a `missing-room` warning. |
| Building code not in `buildings.json` | **A. Import it anyway.** Keep `buildingCode` as printed, put the original string in `buildingCodeRaw`, add an `unknown-building-code` warning, and tell the student what will not work. Do not ask them to pick a different building. |
| `resolve-buildings.mjs` says `ambiguous` | **Ask**, offering the candidate codes and names it returned. |
| Course code will not parse, e.g. a special-topics or cross-listed number | Ask the student to read it back. If it genuinely does not fit the pattern, it cannot be stored — say so rather than mangling it into something that validates. |
| Course code parses but is non-canonical | **A.** Store it and set `canonicalNumbering: false`. Nothing downstream may refuse it. |
| A row has days and times but no course code | **Ask.** Do not infer the course from an adjacent row. |
| Days and times are both absent, mode looks online | **A.** Likely `online-asynchronous`: no `daysOfWeek`, no `startTime`, no `endTime`, `location: null`. Record an `assumed-delivery-mode` warning and state it under the draft. |
| A course clearly meets but `partOfTerm` is not stated | **A.** Leave it at the default `full-term` and say so. Do **not** guess a half. |
| Two courses overlap and either runs a non-full-term session | `review-schedule.mjs` reports **CANNOT TELL**, not "no conflict". Repeat that distinction to the student as a statement; do not resolve it yourself, and do not make it a question they cannot answer. |
| A genuine time collision between two full-term courses | **Ask.** Report it prominently under the draft. It usually means a parse error, occasionally a real registration problem. |
| The same meeting appears twice in the source | **A.** Keep one, add a `duplicate-meeting` warning. |
| A row that cannot be parsed at all | **Ask.** Record `unparsed-row` with the text in `rawValue`. |

## Half-term courses: three outcomes, not two

FSU's Registrar publishes session date ranges for summer terms only. The shipped
Fall 2026 calendar therefore carries `sessionsStatus: "not-published"` and an empty
`sessions` array, and a `partOfTerm` of `first-half` or `second-half` **cannot be
resolved to dates**.

So when two meetings share a day and a time and either one is not full-term, the
honest answer is *"I cannot tell whether these collide"* — not *"no conflict"*.
`review-schedule.mjs` prints `CANNOT TELL` for exactly this and explains why. Pass
that on in those words.

The student can fix it for their own schedule by giving the real dates: set
`partOfTerm: "custom"` with a `dateRange`, which the schema requires together. Offer
that if they know the dates. Never fill it in for them, and never guess a half in
the first place.

## Unknown buildings: what to actually say

Say which course, that the building is not in the shipped data, and what that costs:

> BUL3310 meets in WCB 1010. WCB — the Wertheim Center — is not in this plugin's
> campus data, so I have kept the class exactly as you gave it but I cannot compute
> walking times to or from it, cannot tell you whether you can make it there from
> your previous class, and cannot answer parking questions anchored on it. Times,
> days, and the room number are all stored correctly and everything else in your
> schedule works normally.

Do not apologise at length, do not offer to substitute a nearby building, do not
ask the student to choose one, and do not suggest editing `buildings.json` — an
unsourced coordinate is exactly what this project refuses to ship. `DATA-GAPS.md`
§4 lists which buildings are missing and why.

## Meeting ids

Unique slugs within the schedule. Sections are usually absent, so the shape is
course, type, days:

    ism3541-lecture-th
    fin4424-lecture-tuth
    bsc2010l-lab-we

Include the section only when the source actually carried one
(`enc1101-0001-lecture-mowefr`). If two blocks would collide on the same id,
suffix `-2`, `-3`. Never pad with a fabricated section to make ids unique.

## Re-import: replace, never merge

A second import for a term **replaces** the stored schedule. It does not merge.

The reason is dropped courses. A student re-imports because something changed, and a
merge cannot express a deletion — it would keep the dropped class and keep routing
them to it. Replacement can. `save-schedule.mjs` copies the file it is replacing
into `schedules/archive/` first and keeps the five most recent per term.

Say what it will do as part of the draft message, not before it:

> You already have a Fall 2026 schedule stored: 5 courses, 7 meeting blocks,
> imported on 20 August from a text paste. Saving this replaces it. The old version
> is archived, so this is undoable. The new import has 4 courses — POS2041 is not in
> it. Was that a drop?

That last question earns its place: a course disappearing between imports is either
a drop or a parse failure, the two have opposite fixes, and the student is the only
one who knows which.

If the source text is byte-identical to what produced the stored schedule, the
checksum matches, nothing is written, and you say so.

## Building the document

- `schemaVersion` is the plugin version — `0.7.0`.
- `import.importedAt` is a real RFC 3339 timestamp **with an offset**, not a
  date. `date -u +%Y-%m-%dT%H:%M:%SZ` will do.
- `import.sourceChecksum` is the lowercase hex SHA-256 of the raw source text,
  which is what makes a duplicate re-import a no-op. Omit it if you genuinely do
  not have the raw text, as with a screenshot or dictation.
- `import.warnings` is not decoration. Every assumption you made, every field you
  could not fill, and every unresolved building belongs in it with the right
  `code`. It is what `review-schedule.mjs` turns into the `ASSUMPTIONS` list, and
  months later it is the only record of why an answer is hedged.
- Every meeting's `termCode` must equal the schedule's.

## Never

- Never ask a question before the student has seen their week.
- Never ask for a section, a title, or a term. Omit, derive, and state.
- Never treat a once-weekly course as suspicious.
- Never write a building code that is not in the source, including `WEB`, `ONLINE`
  or `TBA` as a building.
- Never store `"TBA"` as a room. Omit `room`.
- Never drop a course you could not parse. Ask, or warn.
- Never save without an explicit confirmation.
- Never present a computed walking time or a parking answer during an import; those
  belong to other skills and this one has not checked their preconditions.
