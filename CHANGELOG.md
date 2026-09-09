# Changelog

All notable changes to `nole-schedule` and the `tally-campus` marketplace.

Versions before 0.1.0 were **pre-release and never published**. They exist in the git history
and in [`PROGRESS.md`](PROGRESS.md) as 0.1.0 through 0.7.0 under the old names `fsu-schedule`
and `fsu-campus`; nobody could install them, so 0.1.0 below is the first version anyone has.
Version numbers therefore go *down* at this point in the history, once, deliberately.

## 0.1.0 — 2026-09-09

The first public release.

### Renamed, for trademark reasons

"FSU" and "Seminoles" are Florida State University's marks and this is an unaffiliated student
project, so the previous names implied an official product. The plugin is now **`nole-schedule`**
and the marketplace **`tally-campus`**, throughout: manifests, directory names, schema `$id`
namespace, README, skill text, scripts, tests and pack tooling. FSU is still named factually —
"data sourced from the FSU Registrar" — because that is what the data is. Every user-facing
surface carries the non-affiliation statement.

Nothing had been published, so **no `renames` map ships**. Any future rename *does* need one:
the plugin name keys existing installs, and their stored schedules live under
`~/.claude/plugins/data/nole-schedule-tally-campus/`.

### Six skills

- **`import-schedule`** — a Student Central paste, an `.ics` export, a screenshot, or a spoken
  description, into one validated schedule. Draft-first: it shows the whole week back with its
  assumptions before it asks anything, and a clean import asks nothing at all.
- **`whats-next`** — next class, today, this week. Handles weekends, holidays, the Homecoming
  half day, finals week and the end of term without inventing a class.
- **`can-i-make-it`** — walking feasibility between two classes as a **range**, never a single
  number, with a stated safety margin. Too far to walk returns *not on foot* and names driving
  and the shuttle rather than a flat no.
- **`check-conflicts`** — time collisions with **three** outcomes: overlap, ruled out by dates,
  and *cannot be decided*, because FSU publishes fall session dates for summer terms only.
- **`deadlines`** — drop/add, tuition, drop without a grade, withdrawal, S/U, holidays, breaks
  and the finals period, quoted in the Registrar's own wording. Works before anything is
  imported.
- **`parking`** — which garage, whether a permit is valid in that window, and what the
  enforcement note actually says.

### Campus data

33 buildings, 85 walk edges, 6 parking garages and the Fall 2026 academic calendar. Every
record carries a `provenance` block naming the page it came from, the date it was fetched, and
how much to trust it. Nothing was written from memory; what could not be sourced is listed in
[`DATA-GAPS.md`](DATA-GAPS.md) instead.

### Refusals, which are the feature

Enforced in the scripts rather than in prose: home football dates and the evening before one,
buildings outside the shipped 33, unresolved locations, accessible-route questions, and any date
with no shipped calendar. A refusal returns before any arithmetic runs and carries **exit code
3**, distinct from 0, so a caller that only checks for zero cannot read a refusal as success.
A drive answer has **no total**, because time to find a space in a garage cannot be estimated
from six garages with no capacity data — and there is no field to read a number off.

### New in this release: the calendar expires

`term-calendar.json` is Fall 2026 only. Once today's date is past the last shipped term,
`deadlines` and `whats-next` **refuse** with `calendar-out-of-date` and `parking` reports
`staleCalendar`, all pointing at the Registrar, instead of serving deadlines from a term that is
over. Nothing else caught this: a term looked up by code returns a valid record forever, so only
a comparison against today can tell. A date *before* a shipped term is deliberately **not** this
case — the term has simply not started, which is when most people import — and importing is
never blocked, because parsing a schedule needs no calendar. Tested with an injected clock at
March 2027.

### Fixed

- The shipped building count read **32** in nine places across the scripts, skills and docs. It
  has been 33 since `WCB` was added. The three user-facing strings now derive the number from
  the data, so it cannot go stale again.
- Two skill files still described `WCB` as "the single largest omission". It ships.
- `author.name` and `owner.name` were `"TODO"` in both manifests, and the LICENSE copyright line
  with them.

### Repository

MIT licensed, `license` set in both manifests. `keywords`, `homepage` and `repository` point at
<https://github.com/willrenaud/tally-campus>. `npm run validate`, `claude plugin validate .` and
**268 test checks** pass. The packed plugin is asserted to contain no dev tooling and no import
that is not a Node builtin or a relative path.

### Published

Pushed to <https://github.com/willrenaud/tally-campus> and tagged `v0.1.0`. The public
install path was then tested from a clean state — local marketplace removed first, added
from GitHub, installed, and one query run end to end in a fresh session. A GitHub source
installs a **commit-pinned copy** under `~/.claude/plugins/cache/tally-campus/nole-schedule/0.1.0/`,
unlike a directory source, which points at the directory itself; 51 files, no dev tooling.

## 0.1.1 — 2026-09-09

A student installed 0.1.0 on the regular Claude desktop app. The skills loaded and
nothing they instruct could run: the import read their screenshot, then could not save
it, could not resolve a building, could not check the calendar. Two fixes, nothing else.

### Requires Claude Code — now stated, above the install commands

The regular Claude desktop app and claude.ai in a browser load this plugin's
instructions but do not run the programs those instructions depend on, and **every**
skill here is a program it has to run. There is no reduced version that works without
them. That is now a banner at the top of the README, a paragraph immediately above the
two install commands, a row in the coverage table, and a banner on the plugin README.

The README's "check it worked" step is now an **import**, not a deadline question.
`deadlines` is the one skill that answers without writing anything, so it is the one
most likely to look fine on a surface where everything else is broken — which is
exactly how 0.1.0 passed its own release check.

### Every skill refuses when its script cannot run

A gate above the title in all six skills: **if the script did not run, there is no
answer.** It covers every way that happens — no tool to run commands, no `node`, file
not found, unexpected exit, unparseable output, a surface that will not run programs —
and forbids answering from the examples, from training, from the student's own words,
or from an earlier answer.

**And the examples are defused, which is the part that does not depend on the model
reading the gate.** Every worked example across the six skills now uses placeholders
chosen to look wrong if quoted: `ZZZ`, `AAA1111`, `<DATE>`, `NN–NN minutes`. No real
building code, deadline date, walking duration or course code remains in any example
text. On a surface where the scripts cannot run there is now nothing plausible left to
fabricate an answer from.

This closes a hole the design had not examined: every guard in this project lives in
the scripts, which assumes the scripts run. Where they do not, the skill text was a
worked example of a confident answer with real values in it.

### Not in this release

`$P` (a prose shorthand issued as if it were a shell variable), the 11 unbraced
`$CLAUDE_PLUGIN_DATA` references, `store.mjs`'s false claim that Claude Code exports
that variable to a subprocess, and two stale examples calling `WCB` unshipped. All
real, all confirmed, all in 0.1.2 — they produce visible errors rather than confident
wrong answers, which is why they wait.

### Verified

With `import-schedule` against the GitHub install, in a fresh session: drafted the
week, resolved `BEL` and `HCB` against the shipped data, wrote
`~/.claude/plugins/data/nole-schedule-tally-campus/schedules/2026-fall.json`, and the
file validated and read back correctly through `whats-next`. 268 checks,
`npm run validate`, and `claude plugin validate . --strict` all pass.
