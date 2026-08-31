# Progress

The running record of what each step of this build delivered, what is still
outstanding, and where the next step picks up. **Append a section at the end of
every step.** Newest step last.

This file exists because the state of the project is not recoverable from the code
alone: several decisions here are about what was deliberately *not* built, and a
commit log does not record those.

---

## Step 1 — Scaffold (`d249172`)

Marketplace and plugin manifests, and the shape of the data contracts.

- `.claude-plugin/marketplace.json` and `plugins/fsu-schedule/.claude-plugin/plugin.json`.
- Repository layout settled: `tools/` and `package.json` at the root, never inside
  the plugin, so that nothing a student installs carries a dependency.
- `NOTES-SPEC.md` — what the live plugin docs actually say about manifest schemas,
  skill layout, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` and relative
  source resolution, recorded so it never has to be re-fetched.

## Step 2 — Campus data and validators (`26faf2c`)

Real, sourced FSU data plus the tooling that guards it.

- 32 buildings, 85 walk edges, 6 parking garages, the Fall 2026 calendar.
- `tools/validate-schemas.mjs` and `tools/validate-data.mjs` (Ajv, dev-only).
- Three schema fixes fell out of validating real data against them.
- **The standing rule, set here:** never write a data record from memory. A record
  is read off a page actually retrieved, or computed from records that were, or it
  is logged in `DATA-GAPS.md`. Every shipped record carries a `provenance` block.

## Step 3 — The import skill (`2e1f1dc`, `221c41d`)

Plugin 0.3.0. Made unresolvable facts explicit, then shipped the importer.

- `import-schedule` SKILL.md, four dependency-free scripts, `lib/` shared code.
- The adversarial fixture suite (01–06) and `npm test`, including the **PARITY**
  section: `lib/validate.mjs` re-implements two schemas by hand because the plugin
  cannot ship Ajv, and parity against Ajv is the only thing stopping it drifting.
- Four contracts written into the schemas rather than left as convention:
  1. `partOfTerm` has **three** outcomes. Fall sessions are unpublished, so a
     non-full-term meeting is UNRESOLVABLE and a conflict answer must be able to
     say "cannot determine" — never "no conflict".
  2. `parkingBlackouts` carries seven Fall 2026 home football dates (two not
     Saturdays). The contract is **refusal**, not a hedge.
  3. `locationTba: true` (physical, unknown) and `location: null` (online) are
     different, and the schema forbids mixing them.
  4. An unknown building code is an **ordinary** outcome. 32 of ~500 ship.

## Step 4 — Draft first, ask second (`60c394c`)

Plugin 0.4.0. A design fix, found by running the 0.3.0 skill against a real
screenshot: **it interrogated before it showed anything.** That import opened with
four blocking questions — which term, what are the section numbers, does this
Thursday course really meet once, and a digit-by-digit recital of five room
numbers — before the student saw a single row of their own schedule.

**The rule now written into the skill:** a question must earn its place. Ask only
when the answer cannot be inferred **and** getting it wrong would produce a
schedule that is quietly incorrect — wrong in a way the student would not catch
while reading the draft. Everything else is a stated assumption under the table,
correctable in one word.

What changed:

- **Term is derived, not asked.** New `current-term.mjs` + `currentTerm()` in
  `lib/campus.mjs`, from today's date and the shipped calendar. It reports a
  `basis` — `calendar` / `next-term` / `month` — because the three do not deserve
  equal confidence, and only `month` is weak enough to be worth a question.
- **`section` and `title` were `required` in `course-meeting.schema.json`.** That
  was the schema defect forcing the interrogation: a grid screenshot carries
  neither. Both are optional now, with the reasoning recorded at the field, and
  `lib/validate.mjs` mirrors it. Meeting ids no longer need a section:
  `ism3541-lecture-th`.
- **A once-weekly course is ordinary.** Noted as an observation under the table,
  never asked about.
- **OCR rooms keep the check, lose the interrogation.** Bold in the draft table,
  one closing question.
- **`review-schedule.mjs` computes the split itself**, printing `ASSUMPTIONS` and
  `MUST ASK` *after* the week. The ordering is a property of the tool now, not a
  hope about the model. Blocking is exactly: an unparsed row, an ambiguous time,
  or a genuine full-term collision.

Deliberately unchanged: unknown buildings still import with a warning and never
fail a schedule; `partOfTerm` is still never guessed; nothing is invented to make
a record validate; the write path still validates for itself.

Tests: **154 checks.** Fixture **07** is the regression — the exact screenshot that
produced four questions, asserting **zero**. Every fixture carries an exact
`blockingQuestions` count, and a `FLOW` section asserts `THE WEEK` precedes
`MUST ASK` in the text a student actually sees, including on fixture 05 which does
have something to ask.

---

## Outstanding

Carried forward until fixed. Nothing here blocks step 5.

- **`owner.name` and `author.name` are `"TODO"`** in both manifests. Harmless for a
  local install; must be real before this is published anywhere.
- **A session caches skill text.** Editing `SKILL.md` and running
  `claude plugin update` is not enough — the running session keeps serving the
  already-loaded version, and `/reload-plugins` or a restart is required. Verified
  the hard way in the step 4 session: a re-invocation after updating to 0.4.0
  still served 0.3.0 instructions. Worth remembering before concluding a skill
  edit "didn't work".
- **A directory-source marketplace resolves the skill's base directory to the
  working tree**, not to the versioned install under
  `~/.claude/plugins/cache/`. So a local install does not fully isolate a student's
  copy from an edit in progress. Fine for development; check it before relying on
  the cache being the source of truth.
- **`lib/validate.mjs`'s header comment names `tests/validator-parity.test.mjs`**,
  which does not exist — the parity section lives inside `tests/run-tests.mjs`.
  Documentation drift only; the test itself is real and passing.
- **No real building entrances** ship, so every route is building-centroid to
  building-centroid. `DATA-GAPS.md` §1.
- **Fall half-term session dates are unpublished** by FSU, which is why
  `sessionsStatus` is `not-published` and why "do these two conflict?" has a third
  answer. Not fixable by us.

---

## Step 5 starts here

**Step 5 is the query skills** — walking times, parking, conflicts, deadlines.
They were explicitly deferred out of step 3 and are still the next thing.

Start by reading the four contracts in **Step 3** above and the new one in
**Step 4**; they are the acceptance criteria, not background. Concretely, a query
skill must:

1. Be able to answer **"cannot determine"** for a `partOfTerm` that does not
   resolve, and never collapse that into "no conflict".
2. **Refuse** on a `parkingBlackouts` date and point at
   `transportation.fsu.edu/GameDay`, rather than hedging.
3. Treat an **unknown building as ordinary**: degrade that one course's answer,
   never fail the query or substitute a lookalike. The step 4 screenshot is the
   live example — four of its five meetings are in `WCB`, which does not ship, so
   a routing answer over that schedule is *mostly* degraded and must still be
   useful.
4. Inherit **draft-first**: state assumptions and answer, rather than interrogating
   before answering. A query skill has even less licence to ask than the importer,
   because the student is mid-question.

Reuse rather than rebuild: `lib/campus.mjs` already exposes `buildings()`,
`termCalendar()`, `termCalendars()`, `resolveBuilding()` and `currentTerm()`.
`lib/store.mjs` reads the stored schedule. Scripts stay Node-builtins-only, and
**changing a schema means running `npm test`** — the parity section is what catches
`lib/validate.mjs` drifting.

Room-number-to-floor derivation is verified against 736 real FSU rooms: a
four-digit room starting with `0` carries the floor in its first two digits,
anything else in its first digit. `deriveFloor` refuses room numbers starting with
a letter (`G700`, `A0101`) rather than guessing.
