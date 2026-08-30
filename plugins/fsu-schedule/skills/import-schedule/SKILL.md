---
name: import-schedule
description: Import an FSU class schedule from text pasted out of myFSU or Student Central, an .ics calendar export, a screenshot, or the student describing their courses one at a time. Parses it, resolves buildings against the shipped campus data, shows the week back for confirmation, and saves it. Use whenever a student wants to add, replace, re-import, or correct their class schedule for a term.
---

# Import a class schedule

You are turning whatever a student has to hand into one validated
`student-schedule` document at `${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json`.

$ARGUMENTS

## The four rules, in priority order

When these conflict, the earlier one wins.

**1. Never invent a field to make a record validate.** Unparseable days, an unknown
building, a missing room, a course code that will not parse: every one of these
becomes a question to the student, not a plausible value. If you catch yourself
reasoning "it is probably the 9:05 section" or "TR almost certainly means Tuesday
and Thursday here", stop and ask. A schedule is acted on for four months; a
question costs one exchange.

**2. An unknown building code is expected, not exceptional.** Only 32 of FSU's
500-plus buildings ship with this plugin. When a code is not in `buildings.json`
the import **succeeds** with that meeting marked location-unresolved, and you tell
the student plainly which features will not work for that course. Never fail a
whole import over one course. Never substitute a building because the name looked
close.

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
| `node "$P"/parse-ics.mjs <file>` | Unfolding and reading an `.ics` export into drafts. |
| `node "$P"/resolve-buildings.mjs "HCB 216" ...` | Turning a raw location string into a building code, or finding out that it cannot be. |
| `node "$P"/review-schedule.mjs draft.json` | Validating, rendering the week, and reporting time collisions. Writes nothing. |
| `node "$P"/save-schedule.mjs --plan --term 2026-fall` | What is already stored, so you can say what you are about to replace. |
| `node "$P"/save-schedule.mjs draft.json` | Validating again and writing. |

Write the draft to a temporary file and pass its path; do not try to hold a large
JSON document in a shell argument.

## Procedure

1. **Establish the term** before anything else, as `YYYY-season` using the year
   classes begin — `2026-fall`. Ask if it is not obvious from the source. Every
   meeting carries it and it is the filename.
2. **Check what is already stored:** `save-schedule.mjs --plan --term <termCode>`.
   If a schedule exists, say so now, before the student invests effort.
3. **Parse**, by the route for the source type below.
4. **Resolve every location** through `resolve-buildings.mjs`.
5. **Ask about everything ambiguous**, using the decision table. Batch the
   questions into one message rather than interrogating field by field.
6. **Build the draft document** and write it to a temp file.
7. **Review:** `review-schedule.mjs draft.json`. Fix any schema error; do not
   work around it by dropping a field.
8. **Show the week and the caveats, and ask for an explicit yes.**
9. **Save:** `save-schedule.mjs draft.json`. Report what it did, including any
   replacement and archive.

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
  when a rejoin changes what a field means, confirm that row explicitly.
- One course section often produces **several rows** — a lecture and a lab, or
  different days in different rooms. Each becomes its own meeting record sharing
  `courseCode` and `section`. Do not collapse them.
- A row you cannot parse is **not silently dropped**. Record an `unparsed-row`
  warning with the row text in `rawValue`, and ask about it.

### An .ics export

Run `parse-ics.mjs`. It handles line unfolding, escaped values, and `RRULE`
`BYDAY`/`INTERVAL`/`UNTIL`, and returns drafts plus warnings.

What a calendar file does **not** contain: `deliveryMode`, `meetingType`, `section`,
`partOfTerm`, and usually the course title in any clean form. Those come from the
student. A `.ics` with no `LOCATION` does not mean online — it means the field is
empty, which is a question.

Set `import.sourceFormat` to `ics`.

### A screenshot

You read the image; no script can. Everything else is identical, with two
additions:

- Set `import.sourceFormat` to `screenshot-ocr`, which is the schema's signal that
  every value in the document should be hedged about.
- **Read room numbers back digit by digit in the confirmation step.** `0216` and
  `0218`, `1101` and `1191`, `B` and `8` are exactly what image reading gets wrong,
  and a wrong room is silent until someone is standing in the wrong doorway.

### Dictation, one course at a time

Set `import.sourceFormat` to `manual-entry`. Collect course by course. Ask for the
building the way a student says it — "Bellamy", "HCB" — and run it through
`resolve-buildings.mjs`, which understands aliases. Read the whole week back at the
end, not after each course.

## Decision table for ambiguous input

Apply top to bottom; the first matching row wins.

| What you see | What to do |
| --- | --- |
| `TH` or `TTH` in a day column | **Ask.** FSU spells Thursday `R`, so `TH` reads as Tuesday+Thursday under FSU's scheme and as Thursday alone under most others. Both are common. `expandDays` refuses this on purpose. |
| Bare `TU`, `FR`, `SU` as the entire day field | **Ask.** Each is both a two-letter abbreviation and a valid pair of FSU letters (`FR` = Friday, or Friday+Thursday). |
| `MWF`, `TR`, `M`, `Mon/Wed/Fri`, `Tue, Thu` | Expand mechanically. These are unambiguous. |
| A time with no AM/PM, hour 1–9, e.g. `1:50` | **Ask**, unless the other end of the same range carries a meridiem that makes exactly one reading produce a positive span under twelve hours — `parseTimeRange` already applies that and nothing else. |
| A time like `13:50`, `09:05`, `0955` | Take it as 24-hour. Unambiguous. |
| Location column says `TBA`, `TBD`, `ARR`, `To Be Announced`, or is empty | Physical class, location unannounced: `locationTba: true`, `location` absent. **Not** online. |
| Location column says `Online`, `WEB`, `Remote`, `Canvas`, `Zoom` | No physical location: `location: null`. **Never** `locationTba`, and never a building code of `WEB`. |
| Building resolves, room says `TBA` | Keep the building, omit `room` entirely. Never store the string `"TBA"` in `room`. Add a `missing-room` warning. |
| Building code not in `buildings.json` | **Import it anyway.** Keep `buildingCode` as printed, put the original string in `buildingCodeRaw`, add an `unknown-building-code` warning, and tell the student what will not work. Do not ask them to pick a different building. |
| `resolve-buildings.mjs` says `ambiguous` | **Ask**, offering the candidate codes and names it returned. |
| Course code will not parse, e.g. a special-topics or cross-listed number | Ask the student to read it back. If it genuinely does not fit the pattern, it cannot be stored — say so rather than mangling it into something that validates. |
| Course code parses but is non-canonical | Store it and set `canonicalNumbering: false`. No question needed. Nothing downstream may refuse it. |
| A row has days and times but no course code | **Ask.** Do not infer the course from an adjacent row. |
| Days and times are both absent, mode looks online | Likely `online-asynchronous`: no `daysOfWeek`, no `startTime`, no `endTime`, `location: null`. Confirm with the student, and record an `assumed-delivery-mode` warning if you inferred rather than read it. |
| A course clearly meets but `partOfTerm` is not stated | Leave it at the default `full-term` and say so. Do **not** guess a half. |
| Two courses overlap and either runs a non-full-term session | `review-schedule.mjs` reports **CANNOT TELL**, not "no conflict". Repeat that distinction to the student; do not resolve it yourself. See below. |
| A genuine time collision between two full-term courses | Report it prominently. It usually means a parse error, occasionally a real registration problem. Ask before saving either way. |
| The same meeting appears twice in the source | Keep one, add a `duplicate-meeting` warning. |

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
that if they know the dates. Never fill it in for them.

## Unknown buildings: what to actually say

Say which course, that the building is not in the shipped data, and what that costs:

> BUL3310 meets in WCB 1010. WCB — the Wertheim Center — is not in this plugin's
> campus data, so I have kept the class exactly as you gave it but I cannot compute
> walking times to or from it, cannot tell you whether you can make it there from
> your previous class, and cannot answer parking questions anchored on it. Times,
> days, and the room number are all stored correctly and everything else in your
> schedule works normally.

Do not apologise at length, do not offer to substitute a nearby building, and do
not suggest editing `buildings.json` — an unsourced coordinate is exactly what this
project refuses to ship. `DATA-GAPS.md` §4 lists which buildings are missing and
why.

## Re-import: replace, never merge

A second import for a term **replaces** the stored schedule. It does not merge.

The reason is dropped courses. A student re-imports because something changed, and a
merge cannot express a deletion — it would keep the dropped class and keep routing
them to it. Replacement can. `save-schedule.mjs` copies the file it is replacing
into `schedules/archive/` first and keeps the five most recent per term.

Before saving a replacement, say what it will do, in the shape of:

> You already have a Fall 2026 schedule stored: 5 courses, 7 meeting blocks,
> imported on 20 August from a text paste. Saving this replaces it. The old version
> is archived, so this is undoable. The new import has 4 courses — POS2041 is not in
> it. Was that a drop?

That last question matters. A course disappearing between imports is either a drop
or a parse failure, and the student is the only one who knows which.

If the source text is byte-identical to what produced the stored schedule, the
checksum matches, nothing is written, and you say so.

## Building the document

- `schemaVersion` is the plugin version — `0.3.0`.
- `import.importedAt` is a real RFC 3339 timestamp **with an offset**, not a
  date. `date -u +%Y-%m-%dT%H:%M:%SZ` will do.
- `import.sourceChecksum` is the lowercase hex SHA-256 of the raw source text,
  which is what makes a duplicate re-import a no-op. Omit it if you genuinely do
  not have the raw text, as with dictation.
- `import.warnings` is not decoration. Every question you had to ask, every field
  you could not fill, and every unresolved building belongs in it with the right
  `code`. Months later it is the only record of why an answer is hedged.
- Meeting `id`s must be unique slugs within the schedule. `enc1101-0001-lecture-mowefr`
  is the shape: course, section, type, days.
- Every meeting's `termCode` must equal the schedule's.

## Never

- Never write a building code that is not in the source, including `WEB`, `ONLINE`
  or `TBA` as a building.
- Never store `"TBA"` as a room. Omit `room`.
- Never drop a course you could not parse. Ask, or warn.
- Never save without an explicit confirmation.
- Never present a computed walking time or a parking answer during an import; those
  belong to other skills and this one has not checked their preconditions.
