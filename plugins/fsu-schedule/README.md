# fsu-schedule

Import your Florida State University class schedule once, then ask Claude about it.

The goal is to make questions like these answerable from structured data instead of guesswork:

- *Can I make it from my 9:05 in HCB to my 9:35 in WMS?*
- *Where do I park for a 2pm in HCB?*
- *What's due this week?*
- *Do these two courses conflict?*

## Status: scaffolding only

**Version 0.1.0. There is no working functionality yet.** This release contains the data contracts
and nothing else — no skills, no commands, no hooks, no MCP servers, and no campus data. Installing
it will do nothing useful. It exists so the shapes can be reviewed and argued with before anything
is built on top of them.

What is here:

```
fsu-schedule/
├── .claude-plugin/plugin.json    manifest
├── schemas/                      the data contracts — the substance of this release
│   ├── common.defs.schema.json   shared primitives, and the time/date policy
│   ├── building.schema.json
│   ├── walk-edge.schema.json
│   ├── parking-zone.schema.json
│   ├── course-meeting.schema.json
│   ├── term-calendar.schema.json
│   ├── student-schedule.schema.json
│   ├── examples/                 one hand-written instance per schema
│   └── README.md                 the model explained in prose — start here
├── data/                         empty; static campus data lands here
├── scripts/                      empty; import and routing helpers land here
└── skills/                       empty; skills land here
```

Read [`schemas/README.md`](schemas/README.md) for what each schema is for, how they join, and why
the shapes are what they are.

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
