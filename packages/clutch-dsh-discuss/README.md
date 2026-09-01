# @cerbur/clutch-dsh-discuss

## Feature introduction

`@cerbur/clutch-dsh-discuss` adds a small, predictable discussion entrypoint to a DSH
profile. It keeps the conversation in DSH and steers the approved brainstorming workflow
when the user wants to turn a topic into a reviewed design document.

![clutch-dsh-discuss MVP flow](assets/screenshots/discuss-mvp.svg)

The plugin has no custom UI, session store, or persistence layer. Its runtime behavior is
limited to one bundled skill and one human command, so the normal DSH conversation and
plugin precedence rules remain in control.

## Capabilities

- Register the `brainstorming` skill with both model and user invocation enabled.
- Bundle the brainstorming instructions and their visual companion and spec-reviewer
  resources with the package.
- Register `/discuss [topic]` as a human command with an optional topic and
  `recordInput: false`, avoiding a duplicate command message in the conversation log.
- Steer `/discuss` to `/brainstorming` and steer `/discuss <topic>` to one user message
  containing `/brainstorming`, a blank line, and the trimmed topic.
- Direct approved design documents to
  `docs/clutch/specs/YYYY-MM-DD-<topic>-design.md`.
- Return an explicit command error when the receiving agent cannot accept the steered
  message.

The package uses `package.json` as the source of truth for its version. The README and
installation commands intentionally do not repeat a version number.

## Installation

### Install from npm

With an installed DSH CLI, add the plugin to the profile that will run the Web UI:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
dsh web
```

When using a DeepSeek Harness source checkout without a standalone `dsh` command, use the
equivalent `pnpm dsh` form.

### Install from a repository checkout

Build the package from the `clutch-dsh` checkout, then add its absolute path to the DSH
profile:

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-discuss build

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-discuss
pnpm dsh web
```

The profile must already provide the DSH command and skill services. The package declares
those DSH packages as peer dependencies and does not copy them into runtime dependencies.

## Detailed usage

After installation, use the command from a DSH conversation:

```text
/discuss
```

This starts the brainstorming workflow without a topic. To provide a starting point, pass
ordinary text after the command:

```text
/discuss Design a login flow for invited users
```

The plugin trims the input and sends the brainstorming gesture as one user message. The
skill then requires project-context exploration, clarification, alternative approaches,
design approval, spec self-review, and user review before implementation planning. The
bundled resource directory contains the visual-companion and spec-reviewer templates used
by that workflow.

![Detailed `/discuss` to design-document flow](assets/screenshots/discuss-mvp.svg)

The command itself does not create a session or write a file. Once the user approves a
design, the skill's documented destination is `docs/clutch/specs/`; subsequent planning or
implementation remains an ordinary DSH workflow.
