# nole-schedule

> ## ⚠ This plugin requires Claude Code. It does not work in the Claude app.
>
> **It will not work in the regular Claude desktop app, and it will not work at claude.ai in
> a browser.** Those apps can load this plugin's instructions but cannot run the programs
> those instructions depend on — and every single thing this plugin does is a program it has
> to run. There is no reduced version that works without them.
>
> Installed in the wrong app, it looks present, reads your screenshot, and then cannot save
> it, cannot look up a building, and cannot check a deadline. That is not a bug to work
> around. It is the wrong app.
>
> **Claude Code** is the separate coding tool that runs in a terminal:
> <https://claude.com/claude-code>. It is also a desktop app and a VS Code / JetBrains
> extension — those run local programs, so those work.
>
> **Plain-English test:** if you type `/plugin` and nothing happens, you are in the wrong app.

**Import your class schedule once, then ask Claude where your next class is, whether you can
make it there in time, where to park, and when the drop deadline is.** It answers from campus
data that ships with the plugin — buildings, a walking-time graph, the parking garages and the
Registrar's calendar — so it is working from real records rather than guessing.

> **Not affiliated with Florida State University.** This is an independent, student-built
> project. It is not endorsed by, supported by, or connected to FSU in any way. Campus data is
> transcribed from public FSU pages and other public sources. **Parking and timing answers are
> estimates.** Check them against official signage, FSU Transportation & Parking Services, and
> the University Registrar before doing anything that costs you money or a class.

---

## Coverage and limits — read this before you install

None of this is buried, because all of it changes whether the answer you get is useful. This
plugin is deliberately small and says so:

| | What ships | What that means for you |
| --- | --- | --- |
| **Buildings** | **33 of FSU's 500-plus.** | If your class is in a building that is not in the data, the plugin **says so and refuses** rather than routing you to something nearby with a similar name. |
| **Parking** | **Six garages. No surface lots at all.** | No metered spaces, no residence-hall lots, no park-and-ride, no reserved lots. Every parking answer states this. |
| **Game days** | Nothing. | On the **seven home football dates** FSU closes and reserves campus parking and does not publish which areas, so the shipped rules are known to be wrong. `parking` **refuses outright** on those dates and on the evening before one. |
| **Walking times** | Computed, **never measured.** | Estimates from building centre to building centre. They leave out real doors, stairs, waiting at crossings and class-change crowds — every omission in the optimistic direction. You get a **range**, never a single number, and anything close is called *tight, leave early* rather than *yes*. |
| **The shuttle** | **No Seminole Express data.** | The plugin will name the bus as an option when a walk is too long. It has no routes, no stops and no times, and it will not pretend otherwise. |
| **The calendar** | **Fall 2026 only.** | After that term ends, every calendar-dependent skill **stops answering** and points you at the Registrar rather than serving deadlines from a term that is over. See [Refreshing the calendar](#refreshing-the-calendar-for-a-new-term). |
| **Accessibility** | Nothing. | There is no accessible-route data in this dataset, so `can-i-make-it` refuses accessible-route questions instead of handing back the default walking route. |
| **Where it runs** | **Claude Code only.** | Every skill works by running a program on your machine. The regular Claude desktop and web apps load the instructions but never run the programs, so the plugin cannot function there at all. See the banner at the top. |

These are honest boundaries, not apologies. A plugin that guessed at the buildings it does not have,
put a number on how long it takes to find a space in a full garage, or quoted a shuttle time it
does not have would be more pleasant to use and would get someone towed or late. **"I can't tell
you" is a real answer here**, and you will get it fairly often.

Everything that *does* ship carries a record of where it came from — the page, the date it was
fetched, and how much to trust it. See [`DATA-GAPS.md`](DATA-GAPS.md) for the full account of
what is missing and what was tried.

---

## Installing

**Before you copy anything: this requires Claude Code.** Not the regular Claude desktop app,
not claude.ai in a browser. Both will install something that cannot work, and will fail
halfway through your first import rather than up front. See the banner at the top of this page.

You need [Claude Code](https://claude.com/claude-code) installed. Open it in a terminal by
running `claude`, then type these two commands **at the Claude Code prompt** (not in your normal
shell):

```
/plugin marketplace add willrenaud/tally-campus
/plugin install nole-schedule@tally-campus
```

The first command tells Claude Code where to find the plugin; the second installs it. Then
**restart Claude Code** — quit and run `claude` again. New skills are picked up when a session
starts, so a plugin installed in a running session will not answer until you restart it.

To check it worked, ask: *import my class schedule* and give it anything — even one line like
"AAA1111 Monday 9am in Bellamy". It should read the week back to you and offer to save it.
**If it reads your schedule but cannot save it, you are in the wrong app** — that is exactly
the symptom the banner above describes.

Deliberately not a deadline question as the check: `deadlines` is the one skill that answers
without needing to write anything, so it is the one most likely to look fine on a surface where
everything else is broken.

To update later: `/plugin update nole-schedule`. To remove it: `/plugin uninstall nole-schedule`.

## Importing your schedule

Say **"import my class schedule"** and then give Claude whatever you have. Any of these work:

- **A paste from Student Central or myFSU.** Select your class schedule, copy, paste it in.
  Messy line wrapping and repeated headers are expected and handled.
- **A screenshot of your week.** Drag it in.
- **An `.ics` export** from your calendar.
- **Just telling it.** "I have ECO 2013 Monday Wednesday Friday at 9:05 in HCB 103" and so on.

It reads everything it can first, then **shows you your whole week as a table** with its
assumptions listed underneath — the term it assumed, any room it was unsure about — and asks
only about things it genuinely could not work out. Clean input usually asks nothing at all. Say
"yes" or correct a line, and it saves.

Your schedule is stored on your own machine, at
`~/.claude/plugins/data/nole-schedule-tally-campus/schedules/`. Nothing is uploaded anywhere.
You import once per term, and re-importing replaces the old copy.

## Five things to ask it

1. **"What's my next class?"** — time, building and room, correctly handling weekends, holidays,
   the Homecoming half day and finals week, and never inventing a class that is not there.
2. **"Can I get from Bellamy to HCB in fifteen minutes?"** — a range with the assumptions
   stated. If it is too far to walk it says *not on foot* and names driving and the shuttle
   instead of a flat no.
3. **"Where do I park for my 2pm on Thursday?"** — which garage, whether your permit is valid in
   that window, and what the enforcement note actually says. On a home game date it refuses and
   sends you to FSU Game Day.
4. **"Do these two classes conflict?"** — with three possible answers, not two: they overlap,
   they are ruled out because one is first-half and the other second-half, or **it cannot be
   decided**, because FSU does not publish fall session dates.
5. **"When is the last day to drop without a grade?"** — quoted in the Registrar's own wording,
   because "drop a course" and "withdraw from school" fall on the same date in Fall 2026 and
   mean completely different things.

## What it will refuse to do, and why that is the point

- Give you a parking answer on a **home football date**, or the evening before one.
- Route to or from a **building it does not ship**.
- Put a number on **how long it takes to find a space** in a garage. It has no capacity or
  occupancy data, so a drive answer is reported as separate components and **has no total** —
  the search can easily be the largest part of the trip.
- Quote a **Seminole Express time**.
- Say **"no conflict"** about a pair of classes it cannot actually decide.
- Give you a **per-course final exam time**. Exams are not at your normal meeting time, and the
  exam grid is not in this data. It links you to the Registrar's grid instead.
- Answer anything calendar-dependent **once the shipped calendar has expired** (see below).

---

## Refreshing the calendar for a new term

**For maintainers.** The plugin ships one term at a time —
`plugins/nole-schedule/data/term-calendar.json` currently holds Fall 2026 only. Once today's
date is past the end of the last shipped term, `deadlines`, `whats-next` and `parking` refuse
with `calendar-out-of-date` and send the student to the Registrar, because a real date from a
term that is over is the most convincing kind of wrong answer this plugin could give. Importing
a schedule still works; nothing about parsing needs a calendar.

To add a term:

1. **Read the dates off the Registrar**, do not write them from memory:
   <https://registrar.fsu.edu/bulletins/calendar>. The standing rule for this repository is that
   every shipped record is read off a page actually retrieved, computed from records that were,
   or logged in [`DATA-GAPS.md`](DATA-GAPS.md) as a gap.
2. **Append a record** to `term-calendar.json`, following the shape of the Fall 2026 entry and
   `schemas/term-calendar.schema.json`. Fill in `provenance` with the URL and the date you
   fetched it. Set `sessionsStatus` honestly — FSU publishes half-term session dates for summer
   terms only, and an empty `sessions` array with the status left unset reads as "this term has
   no half-terms", which is a different and false claim.
3. **Home football dates** go in `parkingBlackouts`, from the published schedule. They are what
   makes `parking` refuse; a missing date means a confident wrong answer on a game day.
4. Run `npm run validate` and `npm test`. The staleness tests use an injected clock, so they
   keep working without waiting for the calendar to expire in real life.
5. Bump the version in **both** manifests, add a `CHANGELOG.md` entry, and tag the release.

## Repository layout

```
tally-campus/                        the marketplace
├── .claude-plugin/marketplace.json  marketplace manifest
├── plugins/
│   └── nole-schedule/               THE PLUGIN — this is all a student installs
│       ├── schemas/                 the data contracts
│       ├── data/                    33 buildings, 85 walk edges, 6 garages, Fall 2026
│       ├── skills/                  import-schedule, whats-next, can-i-make-it,
│       │                            check-conflicts, deadlines, parking
│       └── scripts/                 dependency-free helpers the skills run
├── tools/                           validators, walk-graph generator, packer (dev only)
├── tests/                           fixtures and the test suite (dev only)
├── package.json                     dev dependencies for tools/ and tests/ — NOT the plugin
├── PROGRESS.md                      what each step delivered, and where the next one starts
├── DATA-GAPS.md                     what the campus data is missing, and what was tried
├── NOTES-SPEC.md                    notes from the live plugin docs, so we don't re-fetch
├── CHANGELOG.md                     releases
└── LICENSE                          MIT
```

`tools/` and `package.json` sit at the repository root rather than inside the plugin on purpose:
Ajv is a development dependency of this repo, not of `nole-schedule`, and nothing under
`plugins/nole-schedule/` should carry a dependency a student would have to install. A test walks
the packed plugin and fails if any of it leaks in.

Plugin sources in `marketplace.json` are relative paths, which resolve against the marketplace
root — this directory — rather than against `.claude-plugin/`.

## How the answers are built

- [`plugins/nole-schedule/data/README.md`](plugins/nole-schedule/data/README.md) — every shipped
  value, where it came from, and the walking-time model with its constants.
- [`DATA-GAPS.md`](DATA-GAPS.md) — what is missing and what was tried. Read this before trusting
  an answer.
- [`plugins/nole-schedule/schemas/README.md`](plugins/nole-schedule/schemas/README.md) — how
  buildings, walk edges, parking rules, course meetings and the term calendar fit together.
- [`PROGRESS.md`](PROGRESS.md) — the build record, step by step, including what was deliberately
  not built.

The safety behaviour lives in the scripts rather than in prose the model might skip: refusals
return before any arithmetic runs, the only duration formatter in the codebase physically cannot
emit a single number, and the quantity that cannot be estimated has no field to read it from.

## Developing

```bash
npm install               # once: Ajv 8 + ajv-formats, dev only
npm run validate          # schemas, examples and shipped data
npm test                  # unit, parity, fixtures, storage, routing, staleness, pack
npm run test:all          # both
```

`npm test` includes a **parity** check that runs the plugin's own hand-written validator and Ajv
over the same documents and fails if they ever disagree. The shipped plugin cannot carry Ajv, so
that hand-written validator is what actually guards a student's file. Change a schema, run the
tests.

Regenerate the walk graph after changing any building coordinate:

```bash
node tools/build-walk-graph.mjs --check    # reproduce the shipped graph and diff it
node tools/build-walk-graph.mjs --write    # regenerate walk-edges.json and every campusZone
```

The graph is a pure function of the shipped centroids, and `campusZone` is a function of their
mean, so **adding one building can displace an existing edge and reclassify others**. `--check`
is what makes that safe: it must reproduce the shipped file exactly before `--write` is trusted,
and `npm test` runs it.

Validate the manifests:

```bash
claude plugin validate .
claude plugin validate ./plugins/nole-schedule
```

Load the plugin without installing it: `claude --plugin-dir ./plugins/nole-schedule`, then
`/reload-plugins` to pick up edits.

### Testing the shipped copy rather than your working tree

A directory-source marketplace resolves a skill's base directory to **the directory it points
at**. Adding this repository as a local marketplace therefore points the "installed" plugin
straight at your working tree, and a half-finished edit is live the moment you save it.

`npm run pack` freezes the plugin into `dist/marketplace/` — a directory nobody edits — so you
can install *that* and let the working tree move independently:

```bash
npm run pack
# then, in Claude Code:
#   /plugin marketplace add <the absolute path it prints>
#   /plugin install nole-schedule@tally-campus
```

To test a change: `npm run pack` again, then `/plugin marketplace update tally-campus`,
`/plugin update nole-schedule`, and **`/reload-plugins`**. That last step is not optional — a
running session caches skill text and keeps serving the version it already loaded, which is how
an edit can appear to have no effect. `dist/PACK-INFO.json` stamps every pack with the plugin
version, the git commit, whether the tree was dirty, and a hash of the packed files, so "am I
looking at a cached copy?" is answerable rather than a guess. `dist/` is gitignored.

[`NOTES-SPEC.md`](NOTES-SPEC.md) records what the current plugin docs actually say about the
manifest schemas, skill layout, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`, and relative
source resolution — including the places where the docs contradict reasonable assumptions.

## Not affiliated with Florida State University

Independent student project. Not affiliated with, endorsed by, or supported by Florida State
University. "FSU", "Florida State" and "Seminoles" are the university's marks and are used here
only to describe factually where the data came from.

Campus data is transcribed from public sources and may be wrong or out of date; parking rules in
particular change between academic years. **Parking and timing answers are estimates.** Verify
against official signage, FSU Transportation & Parking Services, and the University Registrar
before relying on one.

## License

MIT — see [LICENSE](LICENSE).
