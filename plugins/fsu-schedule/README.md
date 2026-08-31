# fsu-schedule

Import your Florida State University class schedule once, then ask Claude about it.

The goal is to make questions like these answerable from structured data instead of guesswork:

- *Can I make it from my 9:05 in HCB to my 9:35 in WMS?*
- *Where do I park for a 2pm in HCB?*
- *What's due this week?*
- *Do these two courses conflict?*

## Status: version 0.5.0 — three skills

| Skill | What it does |
| --- | --- |
| [`import-schedule`](skills/import-schedule/SKILL.md) | Turns a Student Central paste, an `.ics` export, a screenshot, or a spoken description into a validated schedule. Draft-first: it shows your week back before it asks you anything. |
| [`can-i-make-it`](skills/can-i-make-it/SKILL.md) | Whether the gap between two classes is enough to walk it. |
| [`parking`](skills/parking/SKILL.md) | Where to park for a class, and what the rule at that moment actually is. |

```
fsu-schedule/
├── .claude-plugin/plugin.json    manifest
├── schemas/                      the data contracts
│   ├── common.defs.schema.json   shared primitives, and the time/date policy
│   ├── building.schema.json      walk-edge, parking-zone, course-meeting,
│   ├── …                         term-calendar, student-schedule
│   ├── examples/                 one hand-written instance per schema
│   └── README.md                 the model explained in prose — start here
├── data/                         32 buildings, 85 walk edges, 6 garages, Fall 2026
├── scripts/                      dependency-free helpers the skills run
└── skills/                       the three above
```

Read [`schemas/README.md`](schemas/README.md) for what each schema is for and how they join, and
[`data/README.md`](data/README.md) for where every shipped value came from.

### What these answers are worth

**The two query skills are deliberately unwilling to sound confident**, because the data underneath
them does not support it:

- Every walking time is computed from **building centres**, has **never been measured**, and leaves
  out doors, stairs, road crossings and class-change crowds — all in the optimistic direction. So
  `can-i-make-it` reports a **range**, calls anything inside the margin **tight, leave early** rather
  than *yes*, and **refuses** any leg touching a building that is not in the shipped data rather than
  substituting a nearby one.
- Parking is **six garages and no surface lots**, and on FSU's seven home football dates the shipped
  rules are known to be wrong. `parking` says the first out loud in every answer and **refuses** on
  the second, pointing at [FSU Game Day](https://transportation.fsu.edu/GameDay).

"I can't tell you" is a correct answer here. A student who gets a hedge walks faster or parks
elsewhere; a student who gets a confident wrong answer misses a class or gets towed.

## How data will be stored

**Static campus data** — buildings, the walk graph, parking zones, term calendars — ships with the
plugin under `${CLAUDE_PLUGIN_ROOT}/data/` and is identical for every student.

**Your imported schedule** is the only per-user data. It is written to:

```
${CLAUDE_PLUGIN_DATA}/schedules/<termCode>.json
```

which resolves to `~/.claude/plugins/data/fsu-schedule-fsu-campus/schedules/`. That directory is
created on first use and survives plugin updates, so importing once is genuinely once. It is
removed if you uninstall the plugin, so the stored schedule is a cache rather than an archive and
re-importing will always be a one-step operation.

Nothing is sent anywhere. Your schedule stays on your machine.

## Installing

```
/plugin marketplace add <this repo>
/plugin install fsu-schedule@fsu-campus
```

Or, for local development from the repo root:

```
claude --plugin-dir ./plugins/fsu-schedule
```

## Not affiliated with FSU

This is an independent project. It is not affiliated with, endorsed by, or supported by Florida
State University. Campus data will be transcribed from public sources and may be wrong or out of
date; parking rules in particular change between academic years. Check the official FSU sources
before relying on anything here for a decision that costs money.

## License

MIT. See [LICENSE](../../LICENSE) at the repository root.
