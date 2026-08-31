# fsu-campus

A Claude Code plugin marketplace for Florida State University students.

```
/plugin marketplace add <this repo>
/plugin install fsu-schedule@fsu-campus
```

## Plugins

| Plugin | Version | What it does |
| --- | --- | --- |
| [`fsu-schedule`](plugins/fsu-schedule/) | 0.7.0 | Import your class schedule once, then ask Claude about walking times between classes, parking, conflicts, and deadlines. |

## Status

**Six skills, and two travel modes.** `fsu-schedule` 0.7.0 ships six JSON Schemas with a
worked example of each, real FSU campus data — 33 buildings, 85 walk edges, the six parking garages,
and the Fall 2026 academic calendar — and:

- [`import-schedule`](plugins/fsu-schedule/skills/import-schedule/SKILL.md) turns a paste from
  Student Central, an `.ics` export, a screenshot, or a spoken description into a validated schedule.
- [`whats-next`](plugins/fsu-schedule/skills/whats-next/SKILL.md) answers what is next, today, or
  this week.
- [`can-i-make-it`](plugins/fsu-schedule/skills/can-i-make-it/SKILL.md) answers whether the gap
  between two classes is enough — on foot, and when it is not, by car.
- [`check-conflicts`](plugins/fsu-schedule/skills/check-conflicts/SKILL.md) answers whether two
  courses collide — with three outcomes, not two.
- [`deadlines`](plugins/fsu-schedule/skills/deadlines/SKILL.md) answers drop/add, withdrawal,
  holidays, breaks and finals, and works before anything is imported.
- [`parking`](plugins/fsu-schedule/skills/parking/SKILL.md) answers where to park for a class.

**`WCB` now ships.** The Herbert Wertheim Center for Business Excellence — 24 classrooms, the home of
the business school, and previously the largest single gap in the campus data — was added in 0.6.0
after three independent geocoders and two FSU cross-references agreed on where it is. It is the only
building whose coordinate comes from address geocoding rather than an OpenStreetMap polygon, so it
ships at `low` confidence with the full derivation in [`DATA-GAPS.md`](DATA-GAPS.md) §3.

**The two query skills are built around the weakness of the data underneath them.** Walking times
are centroid-to-centroid estimates that have never been measured and omit doors, stairs, crossings
and class-change crowds — every omission in the optimistic direction — so `can-i-make-it` reports a
**range** rather than a number, treats anything inside the margin of error as *tight, leave early*
rather than *yes*, and **refuses outright** on any leg touching a building the data does not ship.
When a walk is simply too long it says **not on foot** and names driving and the campus shuttle, rather
than a flat no — and a drive answer has **no total**, because time to find a parking space cannot be
estimated from six garages with no capacity data and would swamp everything else.
Parking is six garages and no surface lots, so every parking answer says so, surfaces the rule's
`enforcementNote` verbatim including FSU's unresolved disagreement with itself about student hours,
and **refuses** on the seven home football dates rather than hedging. Both behaviours live in the
scripts, not in prose: the refusals return before any arithmetic runs, and the only duration
formatter in the codebase cannot emit a single number.

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

Start with [`PROGRESS.md`](PROGRESS.md) for where the build is and what step comes next.

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
│       ├── skills/                    six skills: import, whats-next, can-i-make-it,
│       │                              check-conflicts, deadlines, parking
│       └── scripts/                   dependency-free helpers the skills run
├── tools/                            validators, the walk-graph generator and the packer
│                                     (dev only, never shipped to users)
├── tests/                            import fixtures and the test suite (dev only)
├── package.json                      dev dependencies for tools/ and tests/ — not the plugin
├── PROGRESS.md                       what each step delivered, and where the next one starts
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

Regenerate the walk graph after changing any building coordinate:

```bash
node tools/build-walk-graph.mjs --check    # reproduce the shipped graph and diff it
node tools/build-walk-graph.mjs --write    # regenerate walk-edges.json and every campusZone
```

The graph is a pure function of the shipped centroids, and `campusZone` is a function of their mean,
so **adding one building can displace an existing edge and reclassify others** — adding `WCB` removed
`krb-to-law`. `--check` is what makes that safe: it must reproduce the shipped file exactly before
`--write` is trusted, and `npm test` runs it.

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

### Testing the shipped copy rather than your working tree

A directory-source marketplace resolves a skill's base directory to **the directory it points at**,
not to a versioned copy under `~/.claude/plugins/cache/`. Adding this repository as a marketplace
therefore points the "installed" plugin straight at your working tree, and a half-finished edit is
live in it the moment you save. That is convenient while writing a skill and useless while testing
one.

`npm run pack` fixes it by freezing the plugin into `dist/marketplace/` — a directory nobody edits —
so you can install *that* and let the working tree move independently:

```bash
npm run pack
# then, in Claude Code:
#   /plugin marketplace add <the absolute path it prints>
#   /plugin install fsu-schedule@fsu-campus
```

To test a change: `npm run pack` again, then `/plugin marketplace update fsu-campus`,
`/plugin update fsu-schedule`, and **`/reload-plugins`**. That last step is not optional — a running
session caches skill text and keeps serving the version it already loaded, which is how an edit can
appear to have no effect. `dist/PACK-INFO.json` stamps every pack with the plugin version, the git
commit, whether the tree was dirty, and a hash of the packed files, so "am I looking at a cached
copy?" is answerable rather than a guess. `dist/` is gitignored, and `npm test` checks that the
frozen copy is byte-identical to the source and still runs.

[`NOTES-SPEC.md`](NOTES-SPEC.md) records what the current plugin docs actually say about the
manifest schemas, skill layout, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`, and relative
source resolution — including the places where the docs contradict reasonable assumptions.

## Not affiliated with FSU

Independent project, not affiliated with, endorsed by, or supported by Florida State University.
Campus data is transcribed from public sources and may be wrong or out of date.

## License

MIT — see [LICENSE](LICENSE).
