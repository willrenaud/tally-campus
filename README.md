# fsu-campus

A Claude Code plugin marketplace for Florida State University students.

```
/plugin marketplace add <this repo>
/plugin install fsu-schedule@fsu-campus
```

## Plugins

| Plugin | Version | What it does |
| --- | --- | --- |
| [`fsu-schedule`](plugins/fsu-schedule/) | 0.1.0 | Import your class schedule once, then ask Claude about walking times between classes, parking, conflicts, and deadlines. |

## Status

**Scaffolding and data contracts only.** `fsu-schedule` 0.1.0 ships six JSON Schemas and a worked
example of each, and nothing else — no skills, no commands, no hooks, and no campus data yet.
Installing it does nothing useful today. The schemas are the thing to review.

Start with [`plugins/fsu-schedule/schemas/README.md`](plugins/fsu-schedule/schemas/README.md),
which explains the model: how buildings, entrances, walk edges, parking rules, course meetings, and
the term calendar fit together, and which pieces are shipped static data versus per-user data.

## Repository layout

```
fsu-campus/
├── .claude-plugin/marketplace.json   marketplace manifest
├── plugins/
│   └── fsu-schedule/                 the plugin
├── NOTES-SPEC.md                     notes from the live plugin docs, so we don't re-fetch
├── LICENSE                           MIT
└── README.md
```

Plugin sources in `marketplace.json` are relative paths, which resolve against this directory — the
marketplace root — rather than against `.claude-plugin/`.

## Developing

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
