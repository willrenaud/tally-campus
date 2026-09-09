# Two tiers: what the model may read, and what only a script may compute

**Status: design only. Nothing here is implemented, and nothing should be built from
it until the boundary below is agreed.**

This document exists because a whole surface cannot execute scripts. On the regular
Claude desktop app and on claude.ai, `nole-schedule` 0.1.2 loads its instructions,
runs nothing, and — since 0.1.1 — correctly refuses everything. That refusal is right
and it is also a total loss: the plugin knows FSU's drop deadline, has it on disk in
the install directory, and will not tell a student what it is, because the only path
to that fact runs through a subprocess.

The question is whether the subprocess is load-bearing for every question or only for
some.

---

## 1. The claim

**Some of this plugin's questions are lookups. The rest are computations wrapped in
refusal logic. Only the second kind needs a script, and today both kinds go through
one.**

`deadlines --term 2026-fall` reads a JSON file, filters an array by date, and prints
it. There is no arithmetic, no estimate, no safety margin, no verdict ladder. The
script's contribution is a date comparison and some formatting. A model with the file
open does that correctly, and its failure mode is a typo.

`can-i-make-it --from X --to Y --gap 20` traverses a graph, applies a documented
safety margin, tests a five-rung verdict ladder in a fixed order, and formats a range
that is structurally incapable of being one number. The script's contribution *is* the
answer's honesty. A model doing it by hand produces a plausible number every time,
which is the whole failure this project was built against.

Those are not the same kind of work and they do not need the same guarantees.

---

## 2. The two tiers

### Tier 1 — facts the model may read directly

A question is tier 1 when **the answer is a value present in a shipped file**, reached
by selection (filter, match, sort) rather than by derivation, and when **the worst
realistic error is a transcription mistake** rather than a fabricated quantity.

| Question | Reads | Why it is tier 1 |
| --- | --- | --- |
| "When is the last day to drop?" | `term-calendar.deadlines` | Filter by date, print the Registrar's own `description`. The wording is already in the file and must be quoted verbatim anyway. |
| "When is Thanksgiving break / Homecoming?" | `term-calendar.nonClassDays` | A date range and a name, already written down. |
| "When is finals week?" | `term-calendar.finals` | Two dates and a URL. The skill's rule is *never produce a per-course exam time*, which is a rule about **not** computing. |
| "What does HCB stand for?" / "Is Bellamy in the data?" | `buildings[].code/name/aliases` | String match against a 33-row table. |
| "Which garages exist? What are they called?" | `parking-zones[].id/name/aliases` | Six rows. |
| "What does my permit allow in PG2 on a weekday?" | `parking-zones[].rules[].enforcementNote` | The answer is a quoted note. See §5 for the large caveat. |
| "What term is it?" | `term-calendar.startDate/endDate` vs today | One date comparison. |
| "Is the shipped calendar out of date?" | same | One date comparison — and the *most* important one to keep working on every surface, because it is the guard on everything else. |
| "What did I import?" | the stored schedule | Reading back the student's own document. Nothing is derived. |

### Tier 2 — computations only a script may perform

A question is tier 2 when the answer is **derived** — arithmetic, traversal, or a
verdict — or when its correctness depends on **refusal logic running in a fixed order
before any value is produced**.

| Question | Why it can never move |
| --- | --- |
| "Can I make it from A to B in N minutes?" | Graph traversal, `SAFETY_MARGIN`, a five-rung ladder checked in order, and `formatRange()` — the only duration formatter in the codebase, written so it *cannot* emit a single number. Every one of those is a guarantee that evaporates if a model does the sum. |
| "How long is the walk?" | Same, minus the verdict. A single number is exactly the wrong shape and a model asked for a duration will produce one. |
| "Where should I park for my 2pm?" | `blackoutCheck()` must run and exit **before** any garage is ranked. The ordering is the safety property. |
| "Can I drive between these?" | `planDrive()` has four components, one of which (`PARKING_SEARCH`) deliberately **has no seconds key** so no caller can total around it. A model with the same data will happily add three numbers and call it a total. |
| "Do these two courses conflict?" | Three outcomes, and the third exists only because `resolveSpan()` returns null and the null is checked first. Two-outcome thinking is the default and re-emerges instantly without the code. |
| "What's my next class?" | Walks forward day by day, consults three-valued `dayStatus()`, stops at term end rather than wrapping, returns nothing during finals. Four ways to invent a class that is not there. |
| "Is this schedule valid?" / saving | `lib/validate.mjs`, plus writing to disk — which a non-executing surface cannot do at all regardless of tier. |

---

## 3. How the boundary is enforced structurally

This is the part that decides whether the design is worth building, because a boundary
described in prose is the same class of thing as `$P`: correct when written, and
silently wrong the first time someone reasons past it. Three mechanisms, in increasing
order of how much they actually buy.

### 3.1 The data is split into separate files, and only one set is readable

Tier-1 facts move into files whose **path is the permission**. Something like:

```
data/readable/    deadlines.json  holidays.json  buildings-index.json  garages-index.json
data/computed/    walk-edges.json  parking-rules.json  (+ the full building records)
```

A skill's instructions name a directory, not a policy. `readable/` is small, flat,
pre-filtered, and contains no field from which a duration or a verdict could be
derived — **`walk-edges.json` never appears there, so a walking time cannot be
computed from tier 1 even by a model that decides to try.** The enforcement is that
the inputs are absent, not that the action is forbidden.

This is the same move as `PARKING_SEARCH` having no `seconds` key. Make the wrong
answer unrepresentable rather than warning against it.

### 3.2 A tier-1 file cannot contain a tier-2 input — asserted in the suite

The section-12 pattern, extended: a test walks `data/readable/` and fails if any record
carries a coordinate, a distance, a duration, a graph edge, or a garage rule window.
Those are the raw materials of every tier-2 answer. If someone later adds `centroid` to
the readable buildings index "because it's handy", the suite fails and names the tier
it broke.

Mutation-tested like the rest, or it is not a guard.

### 3.3 The skill is split, so tier boundaries are skill boundaries

Not one skill with a policy inside, but separate skills whose *scope* is the tier:

- `deadlines` — tier 1 only. Reads `readable/`, works everywhere.
- `can-i-make-it`, `parking`, `check-conflicts` — tier 2 only. Keep the 0.1.1 gate
  verbatim; on a non-executing surface they refuse, exactly as now.
- `whats-next` — **split**, and this is the interesting one. See §5.

The model never chooses a tier. It chooses a skill, and the skill has one tier's data
and one tier's instructions. A tier-2 skill physically cannot answer from tier-1 data
because it was never given any.

**What still rots, honestly:** nothing above stops a model answering a walking-time
question *from training* while inside a tier-1 skill. Nothing can. The 0.1.1 gate and
the defused examples are still the only defence there, and they are a real but
probabilistic one. The split narrows the blast radius; it does not eliminate it.

---

## 4. What reshaping the data actually requires

The current files are **archival records, not lookup tables**, and that is the whole
cost of this design. Measured today:

| File | Size | Records | Shape problem for direct reading |
| --- | --- | --- | --- |
| `buildings.json` | 78.5 KB | 33 | ~1.9 KB per building. Each carries `provenance`, `entrances`, `floorCount`, `typicalClassroomFloors`, `notes`. A name lookup needs ~40 bytes of it. |
| `walk-edges.json` | 133.0 KB | 85 | Tier 2 only. Never becomes readable. |
| `parking-zones.json` | 37.9 KB | 6 | Rules are nested time-window objects; the `enforcementNote` a student needs is three levels down. |
| `term-calendar.json` | 14.7 KB | 1 | Closest to usable already — but one `provenance.note` is **2,222 characters** of sourcing narrative. |

So the work is:

1. **A projection step, not a rewrite.** A `tools/build-readable.mjs` that generates
   `data/readable/` from the archival files, exactly as `build-walk-graph.mjs`
   generates the graph — including a `--check` mode that regenerates and diffs, so the
   projection can never drift from its source. The archival records stay canonical and
   keep every provenance block; the readable projection is derived and disposable.
2. **Pre-flattening the lookups.** Deadlines as a flat sorted array of
   `{date, weekday, type, description}`. Buildings as `{code, name, aliases}` and
   nothing else. Garages as `{id, name, aliases}`. Rules pre-resolved per garage per
   day-type, so the answer is a string to quote rather than a structure to interpret.
3. **Provenance handled deliberately.** It cannot be dropped — the standing rule of
   this project is that every shipped record says where it came from. It also cannot
   sit inline in a lookup table. Proposal: one `data/readable/PROVENANCE.md` covering
   the projection as a whole, plus a per-file `sourceUrl`, with the full archival
   record remaining the authority.
4. **A staleness stamp inside every readable file**, because §5 makes it load-bearing.

Rough size after projection: **under 8 KB total**, from 264 KB of archival data.

---

## 5. What I would *not* move to tier 1, though it looks like a lookup

This is where the design lives or dies, and every item here is a case I initially
sorted into tier 1 and then moved back.

**Parking rules — the whole of `parking`, not just game days.** A permit rule reads
like a lookup: match the day and time to a window, print `enforcementNote`. But
`blackoutCheck()` must run *first* and refuse on seven dates, and correctness depends
entirely on **ordering that a lookup has no way to express**. A model reading a rules
table will match a window and answer, because that is what the table invites. The
refusal is not a field in the data; it is a step that happens before the data is
consulted. Tier 2, permanently. *(An honest tier-1 sliver exists — "which garages
exist and what are they called" — and it is nearly worthless on its own.)*

**"Is today a class day?" and anything touching `nonClassDays`.** Looks like a date
range match. Is not: `dayStatus()` is three-valued, and the third value exists because
Homecoming Friday carries `classesCancelled: false` **and** `cancelledFromTime: 12:00`.
The boolean alone reads as an ordinary day. A model doing the obvious lookup reads the
boolean, gets "classes meet", and sends someone to a 2 p.m. class in a locked room.
The listing of holidays is tier 1; the *verdict* about a specific day is tier 2, and
they are one question apart.

**The finals date range.** Two dates and a URL — as pure a lookup as exists here. But
the rule attached to it is *never produce a per-course exam time*, and a model holding
a term calendar plus the student's weekly schedule has everything it needs to do
exactly that, plausibly, in the same breath. The data is safe; the **adjacency** is
not. If it ships in tier 1 it ships in a file with no meeting patterns anywhere near
it, and the instruction stays adamant.

**Half-term / `partOfTerm` anything.** `sessionsStatus: "not-published"` means the
correct answer is a third outcome. Every instinct — and every training prior — collapses
three outcomes to two. This is the single most fragile invariant in the project and it
survives because `findCollisions()` has three branches and no default. Prose cannot
hold it. Tier 2.

**"What did I import?" — with one exception.** Reading a stored schedule back is pure
lookup and I put it in tier 1 above. But *anything computed across it* — counts,
"do I have class Tuesday", "what's my earliest start" — is not, and the boundary is
invisible from the outside. This is where the "4 courses and 7 blocks" incident came
from: a count is the most innocent-looking derived value in the system and it is the
one a student uses to check nothing was lost. **If tier 1 is allowed to read the
schedule, it must be forbidden to count it**, and I do not yet know how to enforce
that structurally rather than by instruction. Unresolved, and it is the strongest
argument for keeping the stored schedule out of tier 1 entirely.

**Anything at all when the calendar is stale.** The staleness check is tier 1 by
mechanism — one date comparison — and it must run *before* every other tier-1 answer,
which reintroduces the ordering problem that put parking in tier 2. The mitigation is
that each readable file carries its own `validUntil`, so the fact and its expiry cannot
be separated: a model reading the deadlines file necessarily reads the date past which
it is void. That is the one place in this design where ordering is enforced by
**co-location** rather than by control flow, and it needs scrutiny before it is built.

---

## 6. What the desktop and web surfaces would honestly get

With tier 1 shipped, on a surface that cannot run anything:

**Would work.** Drop/add, withdrawal, S/U and tuition deadlines with the Registrar's
exact wording. Holiday and break dates. The finals date range plus the exam-grid link.
Building code ↔ name ↔ alias. Garage names. What term it is, and whether the shipped
calendar has expired.

**Would not, and would say so.** Walking times, feasibility, driving, parking
recommendations, conflict checking, "what's next", and importing or saving anything —
a non-executing surface cannot write a file, so `import-schedule` stays impossible
there no matter how the tiers fall.

**That is a real subset**, and it is roughly the questions a student asks before they
have imported anything — which is most first contacts with the plugin. It is also
exactly the subset that would have made the reported failure a non-event: the student's
first question would have been answered, and the refusal would have arrived at import
time with a clear reason rather than as a plugin that appeared broken.

---

## 7. The honest case against building this

1. **It doubles the surface area of the thing this project is most careful about.**
   Two data representations, a projection tool, a new test class, and a boundary that
   must be re-argued every time a question is added.
2. **The tier-1 subset cannot save a schedule**, so on desktop and web the plugin
   remains permanently half a plugin. The banner in 0.1.1 is already an honest fix for
   that, and it cost nothing.
3. **§5 has an unresolved item.** "Read the stored schedule but never count it" has no
   structural enforcement yet. Shipping tier 1 with that unresolved reintroduces the
   exact failure that started this.
4. **The alternative is cheaper.** If Claude Code is the only supported surface — which
   it currently is, stated in three places — then the correct amount of tier-1 work is
   zero, and the correct next step is Spring 2027's calendar.

My recommendation: **do not build this yet.** Build it if and when the desktop or web
surface is a real distribution channel for this plugin. If it is, start with the
deadlines slice alone — it is the highest-value, has the cleanest boundary, and its
staleness stamp is the mechanism §5 says needs scrutiny. Prove that one, then decide
about the rest.

The part worth doing *regardless* of this design is §3.2's assertion pattern: it is a
generalisation of section 12 and it would catch tier violations, staleness drift, and
provenance loss with the same machinery.
