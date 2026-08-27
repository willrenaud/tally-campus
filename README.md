# fsu-campus

A Claude Code plugin marketplace for Florida State University students.

```
/plugin marketplace add <this repo>
/plugin install fsu-schedule@fsu-campus
```

## Plugins

| Plugin | Version | What it does |
| --- | --- | --- |
| [`fsu-schedule`](plugins/fsu-schedule/) | 0.2.0 | Import your class schedule once, then ask Claude about walking times between classes, parking, conflicts, and deadlines. |

## Status

**Data contracts and campus data. No skills yet.** `fsu-schedule` 0.2.0 ships six JSON Schemas, a
worked example of each, and a first cut of real FSU campus data — 30 buildings, 78 walk edges, the
six parking garages, and the Fall 2026 academic calendar. There are still no skills, commands, or
hooks, so installing it does nothing useful on its own.

Every shipped record carries a `provenance` block naming the page it came from, the date it was
fetched, and how much to trust it. Nothing was written from memory: a record is either read off a
page actually retrieved, or computed from records that were, or it is listed in
[`DATA-GAPS.md`](DATA-GAPS.md) instead.

Three things to read, in order:

- [`plugins/fsu-schedule/data/README.md`](plugins/fsu-schedule/data/README.md) — what shipped, where
  each value came from, and the walking-time model with its constants.
- [`DATA-GAPS.md`](DATA-GAPS.md) — what is missing and what was tried. Read this before trusting an
  answer. The headline: **no real building entrances exist**, and **parking is six garages with no
  home-game dates**.
- [`plugins/fsu-schedule/schemas/README.md`](plugins/fsu-schedule/schemas/README.md) — the model:
  how buildings, entrances, walk edges, parking rules, course meetings, and the term calendar fit
  together, and which pieces are shipped static data versus per-user data.

## Repository layout

```
fsu-campus/
├── .claude-plugin/marketplace.json   marketplace manifest
├── plugins/
│   └── fsu-schedule/                 the plugin
│       ├── schemas/                  the data contracts
│       └── data/                     shipped campus data
├── tools/                            validators (dev only, never shipped to users)
├── package.json                      dev dependencies for tools/ — not the plugin
├── DATA-GAPS.md                      what the campus data is missing, and what was tried
├── NOTES-SPEC.md                     notes from the live plugin docs, so we don't re-fetch
├── LICENSE                           MIT
└── README.md
```

`tools/` and `package.json` sit at the repository root rather than inside the plugin on purpose:
Ajv is a development dependency of this repo, not of `fsu-schedule`, and nothing under
`plugins/fsu-schedule/` should carry a dependency a student would have to install.

Plugin sources in `marketplace.json` are relative paths, which resolve against this directory — the
marketplace root — rather than against `.claude-plugin/`.

## Developing

Validate the schemas, the examples, and the shipped data:

```bash
npm install               # once: Ajv 8 + ajv-formats, dev only
npm run validate          # exits nonzero on any failure
```

Validate the manifests:

```bash
claude plugin validate .
claude plugin validate ./plugins/fsu-schedule
```

Load the plugin without installing it:

```bash
claude --plugin-dir ./plugins/fsu-schedule
```

Then `/reload-plugins` picks up edits without restarting.

[`NOTES-SPEC.md`](NOTES-SPEC.md) records what the current plugin docs actually say about the
manifest schemas, skill layout, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`, and relative
source resolution — including the places where the docs contradict reasonable assumptions.

## Not affiliated with FSU

Independent project, not affiliated with, endorsed by, or supported by Florida State University.
Campus data is transcribed from public sources and may be wrong or out of date.

## License

MIT — see [LICENSE](LICENSE).
