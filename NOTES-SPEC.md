# Plugin spec notes

Fetched 2026-08-27 from the live docs, so we don't re-fetch later. Sources:

- <https://code.claude.com/docs/en/plugins>
- <https://code.claude.com/docs/en/plugins-reference>
- <https://code.claude.com/docs/en/plugin-marketplaces>

Local CLI at the time of writing: `claude 2.1.168`. Several documented features carry higher
minimum versions; those are called out below because they constrain what we can use today.

## plugin.json

Lives at `<plugin-root>/.claude-plugin/plugin.json`. **Only `name` is required.** The manifest
itself is optional if every component sits in a default location — but a published plugin wants
one for the metadata.

Fields we use:

| Field | Notes |
| --- | --- |
| `name` | Required. kebab-case, no spaces, no path separators. Becomes the skill namespace: `/fsu-schedule:import`. |
| `displayName` | Optional. May contain spaces/casing. Falls back to `name`. |
| `version` | Optional but recommended. Setting it **pins** the plugin: users only get updates when it is bumped. If set in both `plugin.json` and the marketplace entry, **`plugin.json` wins**. |
| `description`, `author`, `license`, `keywords`, `homepage`, `repository` | Straightforward metadata. `author` is an object `{name, email?, url?}` — not a string. |
| `$schema` | `https://json.schemastore.org/claude-code-plugin-manifest.json`. Ignored at load time; editor autocomplete only. |

Fields we are deliberately not using yet: `skills`, `commands`, `agents`, `hooks`, `mcpServers`,
`lspServers`, `userConfig`, `dependencies`, `defaultEnabled`, `metadata`, `experimental`.

Path-field behaviour, for when we do add components:

- `skills` **adds to** the default `skills/` scan. All other component path fields **replace** the default.
- All paths must be relative to the plugin root and start with `./`. (`skills` also accepts `"."`.)

Unrecognized top-level fields are **warnings, not errors** — the plugin still loads. `--strict`
turns warnings into errors.

## marketplace.json

Lives at `<marketplace-root>/.claude-plugin/marketplace.json`.

Required root fields: `name`, `owner` (object with required `name`), `plugins` (array).
Optional: `$schema`, `description`, `version`, `metadata.pluginRoot`, `renames`,
`allowCrossMarketplaceDependenciesOn`.

Each plugin entry requires `name` and `source`. Everything else (`description`, `version`,
`author`, `license`, `keywords`, `category`, `tags`, `displayName`, `defaultEnabled`, `strict`)
is optional.

### Reserved marketplace names — checked

The docs publish an explicit permanently-reserved list:

> `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`,
> `claude-plugins-community`, `claude-community`, `anthropic-marketplace`, `anthropic-plugins`,
> `agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`,
> `claude-for-legal`, `claude-for-financial-services`, `financial-services-plugins`,
> `first-party-plugins`, `healthcare`

Names that *impersonate* official marketplaces (e.g. `official-claude-plugins`,
`anthropic-plugins-v2`) are also blocked.

**`fsu-campus` is not on that list and does not impersonate an official marketplace — clear to use.**

For plugin names, the docs publish **no reserved list at all** and no length limit. The only
stated rules are kebab-case, no spaces, no path separators. **`fsu-schedule` is clear to use.**

### Relative path resolution — the part that is easy to get wrong

Relative sources resolve against the **marketplace root** (the directory *containing*
`.claude-plugin/`), **not** against the `.claude-plugin/` directory. So from
`fsu-campus/.claude-plugin/marketplace.json`, the source `"./plugins/fsu-schedule"` resolves to
`fsu-campus/plugins/fsu-schedule`. That is the layout we use.

Constraints:

- No `../` escaping the marketplace root.
- Relative paths **do not work** if the marketplace is distributed as a bare URL to the
  `marketplace.json` file. Fine for us: we intend git/GitHub distribution.
- Bare names (`"fsu-schedule"` with no `./`) require `metadata.pluginRoot`, which needs
  **v2.1.239+**. Our local CLI is 2.1.168, so we use the explicit `./plugins/...` form, which
  works on every version.

## Where skills live

- `skills/<skill-name>/SKILL.md` at the **plugin root** — never inside `.claude-plugin/`. Only
  `plugin.json` goes in `.claude-plugin/`. This is the mistake the docs call out by name.
- A plugin shipping exactly one skill may put `SKILL.md` at the plugin root instead. We won't:
  this plugin will grow several.
- `commands/` (flat `.md` files) is the legacy layout. Docs say use `skills/` for new plugins.

SKILL.md frontmatter fields:

| Field | Notes |
| --- | --- |
| `name` | Skill invocation name, kebab-case. **Set it explicitly.** Without it the name falls back to the directory basename, which the docs describe as unstable for marketplace installs. |
| `description` | What it does *and when to use it* — this is what Claude matches on. |
| `model` | Optional preferred model. |
| `maxTokens` | Optional. |
| `disable-model-invocation` | `true` makes the skill user-invoked only. |
| `visibility` | `public` (default) or `hidden`. |

`$ARGUMENTS` in the body captures text typed after the skill name.

## Environment variables

| Variable | Resolves to |
| --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to the plugin install directory. Scripts, binaries, bundled data. |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/{id}/` — persistent, **survives plugin updates**, created on first reference. |
| `${CLAUDE_PROJECT_DIR}` | Project root. |

Verified specifics for `${CLAUDE_PLUGIN_DATA}`, since the whole persistence design rests on it:

- Docs: *"Persistent directory that survives plugin updates, created on first reference"* and
  *"The data directory outlives any single plugin version."*
- It **is deleted** when the plugin is uninstalled from the last scope where it is installed. So it
  survives updates, not uninstalls. An imported schedule is therefore convenience-cached, not
  archival — a re-import must always be possible.
- All three variables are **exported as real environment variables** to hook processes and to MCP
  and LSP subprocesses, not merely string-substituted. So a script can read `$CLAUDE_PLUGIN_DATA`
  directly.
- Substitution also resolves inside skill and agent *content*, hook and monitor commands, MCP
  `command`/`args`/`env`/`url`/`headers`, and LSP `command`/`args`/`env`/`workspaceFolder`.
- The `{id}` is the install id with any character outside `a-z A-Z 0-9 _ -` replaced by `-`. Ours
  will be `fsu-schedule@fsu-campus` → `~/.claude/plugins/data/fsu-schedule-fsu-campus/`.
- Quote it in shell commands: `"${CLAUDE_PLUGIN_ROOT}"/scripts/foo.sh`.

## Validation

```bash
claude plugin validate <path>          # plugin OR marketplace manifest
claude plugin validate <path> --strict # warnings become errors; use in CI
```

Passing prints `✔ Validation passed` (or `… with warnings`). Unrecognized fields are warnings;
misspellings 1–2 characters off a real field name get a suggestion.

## Things that differed from prior assumptions

1. **`author` is an object, not a string.** `"author": "Name"` is wrong.
2. **The manifest is optional entirely** if components use default locations. Only `name` is
   required when you do have one.
3. **Relative sources resolve from the marketplace root, not from `.claude-plugin/`.** The
   `.claude-plugin/` nesting is a red herring for path resolution.
4. **`${CLAUDE_PLUGIN_DATA}` is deleted on uninstall.** It survives *updates* only. Worth knowing
   before treating it as durable storage.
5. **Reserved names are a marketplace-only concept.** There is no published reserved list for
   plugin names.
6. **`metadata.pluginRoot` / bare source names need v2.1.239+**, and archive sources need
   v2.1.224+, command sources v2.1.229+, `defaultEnabled` v2.1.154+, `renames` v2.1.193+. Our
   local CLI is older than several of these.
7. **Skills are namespaced `/plugin-name:skill-name`**, always. A standalone `.claude/` skill of
   the same name does *not* get overridden by a plugin skill — both stay available. Agents behave
   the opposite way: project/user `.claude/agents/` definitions **do** override same-named plugin
   agents.
8. **`/reload-plugins`** picks up edits without restarting Claude Code. `--plugin-dir ./path` loads
   a plugin for local testing and takes precedence over a same-named installed plugin.
