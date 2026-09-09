# nole-schedule

> **⚠ Requires Claude Code.** Every skill here works by running a program on your machine.
> The regular Claude desktop app and claude.ai in a browser load these instructions but do
> not run those programs, so the plugin cannot work there — it will read your schedule and
> then fail to save it. Get Claude Code at <https://claude.com/claude-code>.

Import your class schedule once, then ask Claude about it.

**Not affiliated with Florida State University.** Independent student project; FSU is referred
to here only to say factually where the data came from. Parking and timing answers are
estimates — verify them against official signage and the Registrar.

The goal is to make questions like these answerable from structured data instead of guesswork:

- *Can I make it from my 9:05 in HCB to my 9:35 in WMS?*
- *Where do I park for a 2pm in HCB?*
- *What's due this week?*
- *Do these two courses conflict?*

## Version 0.1.2 — six skills, two travel modes. Claude Code only.

| Skill | What it does |
| --- | --- |
| [`import-schedule`](skills/import-schedule/SKILL.md) | Turns a Student Central paste, an `.ics` export, a screenshot, or a spoken description into a validated schedule. Draft-first: it shows your week back before it asks you anything. |
| [`whats-next`](skills/whats-next/SKILL.md) | Next class, today, this week — time, building and room. |
| [`can-i-make-it`](skills/can-i-make-it/SKILL.md) | Whether the gap between two classes is enough to walk it — and when it is not, what driving costs, with the part that cannot be estimated left visibly unestimated. |
| [`check-conflicts`](skills/check-conflicts/SKILL.md) | Time collisions, with three outcomes rather than two. |
| [`deadlines`](skills/deadlines/SKILL.md) | Drop/add, withdrawal, holidays, breaks and finals. Works before you import anything. |
| [`parking`](skills/parking/SKILL.md) | Where to park for a class, and what the rule at that moment actually is. |

```
nole-schedule/
├── .claude-plugin/plugin.json    manifest
├── schemas/                      the data contracts
│   ├── common.defs.schema.json   shared primitives, and the time/date policy
│   ├── building.schema.json      walk-edge, parking-zone, course-meeting,
│   ├── …                         term-calendar, student-schedule
│   ├── examples/                 one hand-written instance per schema
│   └── README.md                 the model explained in prose — start here
├── data/                         33 buildings, 85 walk edges, 6 garages, Fall 2026
├── scripts/                      dependency-free helpers the skills run
└── skills/                       the six above
```

Read [`schemas/README.md`](schemas/README.md) for what each schema is for and how they join, and
[`data/README.md`](data/README.md) for where every shipped value came from.

### What these answers are worth

**The query skills are deliberately unwilling to sound confident**, because the data underneath them
does not support it:

- Every walking time is computed from **building centres**, has **never been measured**, and leaves
  out doors, stairs, road crossings and class-change crowds — all in the optimistic direction. So
  `can-i-make-it` reports a **range**, calls anything inside the margin **tight, leave early** rather
  than *yes*, and **refuses** any leg touching a building that is not in the shipped data rather than
  substituting a nearby one.
- The plugin models **walking and driving**. A leg too long to walk says so and names the
  alternatives instead of refusing. A drive answer is reported as **components, never a total**: the
  walk to the car, the drive and the walk in are estimated, and **how long it takes to find a space
  is not estimable at all** from six garages with no capacity or occupancy data — so it is returned
  as an explicit unknown that can swamp the rest.
- Parking is **six garages and no surface lots**, and on FSU's seven home football dates the shipped
  rules are known to be wrong. `parking` says the first out loud in every answer and **refuses** on
  the second, pointing at [FSU Game Day](https://transportation.fsu.edu/GameDay).
- FSU publishes half-term session dates for **summer terms only**, so for Fall 2026 a first-half or
  second-half course cannot be placed on the calendar at all. `check-conflicts` answers **cannot
  determine** for those, which is not the same as "no conflict" and is never reported as one.
- Final exams are **not** at a course's normal meeting time and this data has no exam grid, so
  `deadlines` and `whats-next` never expand a weekly schedule across finals week.
- The shipped calendar is **Fall 2026 only, and it expires**. Once today is past the last shipped
  term, `deadlines`, `whats-next` and `parking` refuse with `calendar-out-of-date` and send the
  student to the Registrar. A real date from a term that is over is the most convincing kind of
  wrong answer available here, and nothing else catches it: a term looked up by code returns a
  valid record forever, so only a comparison against today can tell.

"I can't tell you" is a correct answer here. A student who gets a hedge walks faster, parks
elsewhere, or checks with their department; a student who gets a confident wrong answer misses a
class or gets towed.

## How data will be stored

**Static campus data** — buildings, the walk graph, parking zones, term calendars — ships with the
plugin under `${CLAUDE_PLUGIN_ROOT}/data/` and is identical for every student.

**Your imported schedule** is the only per-user data. It is written to:

```
${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json
```

which resolves to `~/.claude/plugins/data/nole-schedule-tally-campus/schedules/`. That directory is
created on first use and survives plugin updates, so importing once is genuinely once. It is
removed if you uninstall the plugin, so the stored schedule is a cache rather than an archive and
re-importing will always be a one-step operation.

Nothing is sent anywhere. Your schedule stays on your machine.

## Installing

```
/plugin marketplace add willrenaud/tally-campus
/plugin install nole-schedule@tally-campus
```

Then restart Claude Code. The repository README has the full walkthrough, the coverage limits,
and what to ask first.

Or, for local development from the repo root:

```
claude --plugin-dir ./plugins/nole-schedule
```

## Not affiliated with FSU

This is an independent project. It is not affiliated with, endorsed by, or supported by Florida
State University. Campus data will be transcribed from public sources and may be wrong or out of
date; parking rules in particular change between academic years. Check the official FSU sources
before relying on anything here for a decision that costs money.

## License

MIT. See [LICENSE](../../LICENSE) at the repository root.
