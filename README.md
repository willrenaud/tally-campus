# fsu-campus

A Claude Code plugin marketplace for Florida State University students.

```
/plugin marketplace add <this repo>
/plugin install fsu-schedule@fsu-campus
```

## Plugins

| Plugin | Version | What it does |
| --- | --- | --- |
| [`fsu-schedule`](plugins/fsu-schedule/) | 0.4.0 | Import your class schedule once, then ask Claude about walking times between classes, parking, conflicts, and deadlines. |

## Status

**One skill: importing a schedule.** `fsu-schedule` 0.4.0 ships six JSON Schemas with a worked
example of each, real FSU campus data — 32 buildings, 85 walk edges, the six parking garages, and
the Fall 2026 academic calendar — and the
[`import-schedule`](plugins/fsu-schedule/skills/import-schedule/SKILL.md) skill, which takes a
paste from Student Central, an `.ics` export, a screenshot, or a spoken description and turns it
into a validated schedule. Nothing yet *queries* that schedule; walking times, parking and conflict
answers are the next step.

The import is **draft-first**: it parses everything it can, shows the week back as a table with its
assumptions listed under it, and asks only what genuinely could not be resolved. The term comes from
today’s date and the shipped calendar; absent sections and titles are omitted rather than demanded;
an unknown building is stated, not queried. A question is only asked when the answer cannot be
inferred *and* a wrong guess would be invisible to someone reading the draft — an unreadable row, a
`TH` that could mean two things, a genuine collision. The test suite pins an exact question count on
every fixture, and the clean cases ask nothing at all.

The scripts the skill runs are dependency-free by design: Ajv validates the campus data at build
time, but a student installs the plugin and it works with nothing else on their machine.

Every shipped record carries a `provenance` block naming the page it came from, the date it was
fetched, and how much to trust it. Nothing was written from memory: a record is either read off a
page actually retrieved, or computed from records that were, or it is listed in
[`DATA-GAPS.md`](DATA-GAPS.md) instead.

Three things to read, in order:

- [`plugins/fsu-schedule/data/README.md`](plugins/fsu-schedule/data/README.md) — what shipped, where
  each value came from, and the walking-time model with its constants.
- [`DATA-GAPS.md`](DATA-GAPS.md) — what is missing and what was tried. Read this before trusting an
  answer. The headline: **no real building entrances exist**; **parking is six garages**, and on the
  seven home football dates the rules cannot be evaluated at all, so the only correct answer is to
  refuse; and **fall half-term dates are unpublished**, so "do these two classes conflict?" has a
  third answer besides yes and no.
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
│       ├── data/                      shipped campus data
│       ├── skills/import-schedule/    the import skill
│       └── scripts/                   dependency-free helpers the skill runs
├── tools/                            validators (dev only, never shipped to users)
├── tests/                            import fixtures and the test suite (dev only)
├── package.json                      dev dependencies for tools/ and tests/ — not the plugin
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
npm run validate          # schemas, examples and shipped data
npm test                  # the import suite: unit, parity, fixtures, storage
npm run test:all          # both
```

`npm test` includes a **parity** check that runs the plugin's own hand-written validator and Ajv
over the same documents and fails if they ever disagree. The shipped plugin cannot carry Ajv, so
that hand-written validator is what actually guards a student's file; the parity check is the only
thing keeping it in step with the schemas. Change a schema, run the tests.

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
