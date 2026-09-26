[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-title

@cerbur/clutch-dsh-title gives new DSH Sessions configurable, scannable titles. In DSH Web,
open Settings → Session Title to choose a built-in or saved template, or create your own.

A title can combine the session date, fixed text, a controlled category, and a short description
of the first prompt, for example 0912 | 🚀 | add token statistics. The result stays in DSH's
native Session list; this package adds the title provider and settings manager without replacing
that list.

## Installation

### Install from npm

With an installed DSH CLI, add the package to the Web profile and start DSH Web:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-title
dsh web
```

When using a DeepSeek Harness source checkout without a standalone dsh command, use the equivalent
pnpm dsh form.

### Install from a local checkout

The package's lib/ directory is generated and is not committed. Build both this workspace package
and the DSH source checkout, then add the package by absolute path:

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-title build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title
pnpm dsh web
```

After changing source files, package metadata, or cordis.patch.yml, rebuild the package and repeat
the absolute-path add command.

## Features

| Feature                  | Preview                                                                                                                      | What it does                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native Session titles    | <img src="assets/screenshots/session-title-list.png" width="420" alt="Custom session titles in the native DSH Session list"> | The selected template automatically composes a compact title from date, category, fixed text, and first-prompt summary. Titles remain in DSH's native Session list; the plugin does not take over that list. |
| Template manager         | <img src="assets/screenshots/title-settings.png" width="420" alt="Session title template manager in DSH Settings">           | Settings → Session Title supports preview, duplicate, edit, save, activate, and delete. The same page enables or disables custom title generation.                                                           |
| Flexible template fields | —                                                                                                                            | datetime and literal fields resolve deterministically without a model. llm-enum and llm-text fields are model-backed; referenced LLM fields are extracted in one structured request.                         |
| Generation statistics    | —                                                                                                                            | View generation count, cumulative input/output/total tokens, and the latest generation details when available. Reset the stored statistics after confirmation.                                               |

## Usage

### Choose a title template

1. Start DSH Web with dsh web.
2. Open Settings → Session Title.
3. Keep Use title templates enabled, choose a row, and select Activate.
4. Create a new Session, or use DSH's native title refresh action for an existing Session.

The read-only default template is selected in a fresh settings file. A newly selected format does
not rewrite existing titles until DSH explicitly generates or refreshes one.

### Manage templates

Fresh settings include an editable emoji template while the built-in default template remains
selected. The emoji template can be edited or deleted; deleting it does not recreate it on a later
settings registration.

- Duplicate any row, including default, to open an editable copy.
- Give a copy a unique name, edit its YAML, and select Save. Saving does not activate it.
- Select Activate when a saved template should become effective.
- View or select default, but do not edit or delete it.
- Deleting the active custom template selects default.
- Each row shows an illustrative example while editing. Examples do not call a model.

### Create a custom template

The editor accepts a template and optional fields. A template reference such as
${daytime} is resolved from fields.daytime, and ${desc} is resolved from fields.desc:

Each ${fieldName} reference is resolved by fields.<fieldName>; it is a field substitution, not
an instruction or expression.

```yaml
template: '${daytime} | ${desc}'
fields:
  daytime:
    kind: datetime
    source: session.createdAt
    format: MMDD
    timezone: Asia/Shanghai
  desc:
    kind: llm-text
    instruction: Summarize the first prompt in a few words
    maxCharacters: 32
```

Use datetime or literal for deterministic values. Use llm-enum for a controlled model-selected
value, or llm-text for a short model-generated value. Saving validates the YAML and field
definitions before the template can be activated.

### Refresh / regenerate a title

Use DSH's native Session title refresh action to explicitly run the current provider again. The
refresh uses the current template and the Session's original createdAt value, so a datetime field
does not change merely because the title was refreshed.

### Disable custom titles

Turn off Use title templates in Settings → Session Title. The package keeps the saved templates and
selection, but DSH resumes its native first-prompt title generator.

### View generation statistics

Open Settings → Session Title to see cumulative title-model generations with valid usage data, input
tokens, output tokens, total tokens, and the latest call details when the model reports them. Reset
requires confirmation. Deterministic-only templates make no model request and therefore do not add a
generation statistic.

A generation whose first response is unusable does not disappear silently. The package records the
incident, the rejection reason, and the bounded raw response in the clutch_title_diagnostics storage
domain, exposes the same record through the titleStats remote namespace (getDiagnostics and
resetDiagnostics), and logs one warning per incident. The Settings panel currently shows token
statistics only; diagnostics are read from the storage domain.

## Template reference

Templates use simple field substitution:

| Field kind | Purpose                                             | Uses a model |
| ---------- | --------------------------------------------------- | ------------ |
| datetime   | Format the Session timestamp from session.createdAt | No           |
| literal    | Insert fixed text                                   | No           |
| llm-enum   | Select one of the declared controlled values        | Yes          |
| llm-text   | Generate a short text value                         | Yes          |

Use the placeholder form ${identifier}. The identifier must name a declared field. Placeholders
do not support functions, expressions, conditions, loops, or arbitrary code. Unknown fields,
malformed YAML, and invalid field definitions are rejected during validation.

## Configuration

Template settings are stored under the clutch-dsh-title section of
$DSH_HOME/settings.yaml. This settings file is the source of truth for the template map, active
template, and enabled state.

DSH normally uses ~/.dsh/settings.yaml as the default location for that file, but the documented
source of truth is $DSH_HOME/settings.yaml rather than a hard-coded home-directory path. The
package does not use browser storage or clutch.yaml.

External edits to the settings file are picked up by DSH's settings reload path. Invalid template
entries remain visible in Settings so they can be repaired instead of silently disappearing.

Profile configuration may additionally set:

- repairAttempts: how many extra model calls one title generation may spend after the model returns
  unusable output. Defaults to 1; accepted values are 0 through 3, and larger values are rejected.
  These calls share the single timeoutMs budget and are never used for transport, cancellation, or
  deadline failures.

## Behavior and limitations

- Only the first eligible user prompt contributes to an automatic title. Later messages do not
  automatically replace it.
- A long first prompt is bounded by the configured input-byte budget while preserving its head and
  tail. The original Session message is not modified.
- A changed template affects future generation or an explicit refresh. Existing titles are not
  batch-rewritten.
- If the active template is missing or invalid, the settings manager uses the built-in default
  template.
- If field extraction, rendering, or custom title generation fails, DSH's normal first-prompt
  generator handles the title instead. That fallback is DSH's own truncation of the first prompt, so
  it does not follow the template.
- The model is asked for exactly one JSON object whose keys are exactly the declared fields, one of
  the declared literal values for each enum field, and a literal shape example. When a response is
  still unusable, the package sends one bounded corrective turn that quotes the rejected response
  back verbatim and states the rejection reason, up to repairAttempts extra calls.
- Only unusable output is repaired. A transport error, a cancellation, or an exhausted deadline
  keeps its own error and falls back immediately; every attempt shares the one timeoutMs budget.
- Each incident is logged once with its provider, model, message seqs, rejection reason, and the raw
  response bounded to 2000 characters, and is persisted in the clutch_title_diagnostics storage
  domain (at most four attempts per incident, and at most 64 incidents buffered in memory while
  storage is unavailable). Persistence is best effort and never delays or fails a title.
- DSH remains responsible for title length limits, title persistence, manual rename pinning,
  refresh and unpin behavior, fork title-event inheritance, cancellation, and stale-result
  protection.
- The bundle patch disables DSH's default session-title-first-prompt-llm provider before inserting
  this provider. DSH permits only one session-title provider: do not re-enable the default or
  install another title provider in the same profile. A second registration is rejected by DSH's
  single-provider invariant.

## Requirements

- DSH peers: @deepseek-ai/dsh-settings, @deepseek-ai/dsh-storage-domain,
  @deepseek-ai/dsh-typert-protocol, @deepseek-ai/dsh-api-remotes, @deepseek-ai/dsh-client-locale,
  @deepseek-ai/dsh-client-ui-settings, @deepseek-ai/dsh-client-ui-slots,
  @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-llm, @deepseek-ai/dsh-session,
  @deepseek-ai/dsh-session-title, @deepseek-ai/dsh-session-title-llm, @deepseek-ai/dsh-timeout,
  and @deepseek-ai/dsh-util-values, all at >=0.1.2-rc.1.
- Cordis: @deepseek-ai/cordis 4.0.1.
- Profile: a DSH Web profile that provides the session, session-title, LLM, settings, storage,
  remote, and browser settings services declared by the package.

### Compatibility

Cordis configuration using template and fields remains supported. When those values come from the
profile configuration, Settings exposes them as an editable legacy row. The current Settings template
manager and the legacy configuration use the same validation rules.

Model routing and optional reasoning settings are profile-level configuration, not template field
settings. Keep the DSH default title provider disabled and do not compose a second title provider
with this package.

## Development

Build, type-check, and test the package from the workspace root:

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
pnpm --filter @cerbur/clutch-dsh-title test
```

Package-specific release parameters and source-install constraints are documented in
[docs/RELEASING.md](docs/RELEASING.md). User-facing release history is in
[RELEASE-LOG.md](RELEASE-LOG.md).

## Uninstall

With the DSH CLI:

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-title
```

From a DeepSeek Harness source checkout, use pnpm dsh plugin --profile web remove with the same
package name.

## Friendly Links

- [LINUX DO](https://linux.do/) — A new ideal community.
