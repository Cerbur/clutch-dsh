[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-discuss

`@cerbur/clutch-dsh-discuss` adds `/discuss [topic]` to a DSH profile. It hands the current
conversation to the bundled brainstorming workflow, helping turn an idea into a reviewed design
document.

The command keeps the work inside the existing DSH conversation. It is an entry point to a
workflow, not a replacement Session or a separate document editor.

## Installation

### Install from npm

With an installed DSH CLI:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
dsh web
```

When using a DeepSeek Harness source checkout without a standalone `dsh` command, use the
equivalent `pnpm dsh` form.

### Install from a local checkout

Build this package and the DSH source checkout, then add the package by absolute path:

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-discuss build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-discuss
pnpm dsh web
```

The target DSH profile must provide the command and skill services declared by this package. Re-run
the absolute-path install command after changing `package.json` or `cordis.patch.yml`.

## Features

| Feature                    | Preview                                                                                                                         | What it does                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/discuss` entry point** | <img src="assets/screenshots/discuss-mvp.svg" width="420" alt="Discuss brainstorming workflow from command to design document"> | Start structured brainstorming from the current DSH conversation with `/discuss` or `/discuss <topic>`. The workflow explores context, clarifies the problem, compares alternatives, gets approval, reviews the spec, and then moves toward implementation planning. |

## Usage

### Start a discussion

Run the command in a DSH conversation without a topic:

```text
/discuss
```

Or provide a topic:

```text
/discuss Design a login flow for invited users
```

The command starts the bundled brainstorming workflow. It guides the conversation through project
context, clarification, alternatives, design approval, spec self-review, and user review.

### Review the design document

After the design is approved, the workflow's default target is:

`docs/clutch/specs/YYYY-MM-DD-<topic>-design.md`

`/discuss` does not create a Session or write a file by itself. The skill writes the design after
the workflow reaches its review gate. Implementation planning and coding remain later, ordinary DSH
workflows.

## Requirements

| Component            | Requirement                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| DSH commands and LLM | The DSH command and LLM services in the package's declared peer range: `>=0.1.1-rc.2 <0.2.0-0` or a compatible `0.1.2`-line release. |
| DSH skill            | The DSH skill service in the package's declared peer range: `>=0.1.0-rc.8 <0.2.0-0` or a compatible `0.1.2`-line release.            |
| Cordis               | `@deepseek-ai/cordis` `>=4.0.1 <5.0.0`.                                                                                              |
| Profile              | A DSH profile that provides the command, LLM, and skill services.                                                                    |

## Behavior and limitations

- The plugin registers one bundled `brainstorming` skill and one human `/discuss` command. It does
  not add custom UI, a Session store, or a separate persistence layer.
- With no topic, the command starts `/brainstorming`. With a topic, it trims the input and sends the
  brainstorming gesture followed by the topic in one user message.
- If the receiving agent cannot accept the steered message, the command returns an explicit error
  instead of claiming that the discussion started.
- The bundled skill includes its visual companion and spec-reviewer resources. They are shipped with
  the package and are available to the workflow at runtime.
- The design-document path is part of the bundled skill contract and should remain under
  `docs/clutch/specs/`.

## Development

Build, type-check, and test the package from the workspace root:

```bash
pnpm --filter @cerbur/clutch-dsh-discuss typecheck
pnpm --filter @cerbur/clutch-dsh-discuss build
pnpm --filter @cerbur/clutch-dsh-discuss test
```

Package-specific release and resource-publishing constraints are documented in
[docs/RELEASING.md](docs/RELEASING.md).

## Uninstall

With the DSH CLI:

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-discuss
```

From a DeepSeek Harness checkout, use `pnpm dsh plugin --profile web remove` with the same package
name.

## Friendly Links

- [LINUX DO](https://linux.do/) — A new ideal community.
