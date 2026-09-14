[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-fireworks

`@cerbur/clutch-dsh-fireworks` adds a short celebration overlay to the DSH Web UI. An agent can
call `happy_fireworks` after a meaningful milestone, optionally with a brief message, and the
current conversation shows a burst of emoji fireworks.

The plugin is an additive DSH extension. It registers its own tool and Web UI overlay without
modifying DSH source code or changing conversation history.

## Installation

### Install from npm

With an installed DSH CLI:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
dsh web
```

When using a DeepSeek Harness source checkout without a standalone `dsh` command, use the
equivalent `pnpm dsh` form.

### Install from a local checkout

Build the package and the DSH source checkout, then add the package by absolute path:

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-fireworks build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-fireworks
pnpm dsh web
```

The generated `lib/` directory is not committed, so use this built local checkout flow rather than
installing the package from a raw `github:` path. Re-run the absolute-path install command after
changing `package.json` or `cordis.patch.yml`.

## Features

| Feature                              | Preview                                                                                                 | What it does                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Automatic milestone celebrations** | <img src="assets/screenshots/fireworks-mvp.svg" width="420" alt="Happy fireworks celebration preview">  | The bundled guidance encourages an agent to call `happy_fireworks` after finishing a design or plan, completing and verifying a feature, resolving a complex bug, or passing full verification. Routine file reads and isolated checks are not milestones. |
| **Fireworks overlay**                | <img src="assets/screenshots/screenshots-zh.png" width="420" alt="Fireworks overlay in the DSH Web UI"> | A successful call displays a short, click-through overlay over the selected DSH conversation and can show the optional celebration message.                                                                                                                |
| **Safe replay behavior**             | —                                                                                                       | Failed or cancelled calls stay quiet. Opening a Session, refreshing the page, or switching Sessions does not replay an old celebration.                                                                                                                    |

## Usage

### Celebrate a meaningful milestone

After installation, the agent sees guidance for the `happy_fireworks` tool. It may use the tool in
a concluding turn when work reaches a meaningful milestone, such as a finished design, verified
feature, resolved complex bug, or complete refactor verification.

The tool is not intended for routine intermediate actions, including reading a file, inspecting
Git status, or running one isolated check.

### Manual testing

You can explicitly ask an agent to test the overlay:

```text
After a meaningful milestone, call happy_fireworks with:
{"message":"The fireworks MVP is ready to test!"}
```

A successful call appears in the conversation and plays the overlay for a few seconds. The
optional message is trimmed and limited to a short banner. Programmatic tool-call dispatches are
supported as well as direct top-level tool results.

## Requirements

| Component | Requirement                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DSH       | A Web profile providing the DSH Session, Session Projection, Tools, UI Renderer, UI Session, and UI Slots services at the package's declared peer ranges. |
| Cordis    | `@deepseek-ai/cordis` `4.0.1` or a compatible version allowed by the package peer range.                                                                  |
| Browser   | DSH Web UI with the plugin's Web client bundle loaded.                                                                                                    |

## Behavior and limitations

- The overlay lasts for a short burst and renders deterministic emoji visuals for each successful
  signal. The optional `message` is normalized to a maximum of 120 characters.
- The plugin reacts only to successful fireworks results. Errors and cancellations do not show an
  overlay, and the first historical signal observed when a Session opens is intentionally silent.
- Switching Sessions clears the active overlay. A new signal must have a new tool-call identity
  before it can play again.
- When the host exposes DSH's `systemPrompt` service, the plugin adds the milestone guidance used
  for autonomous calls. If that optional service is absent, the tool remains available but the
  guidance section is not added.
- The package contributes its own Cordis bundle and Web client metadata; it does not patch DSH
  source code or persist a copy of the conversation.

## Development

Build, type-check, and test the package from the workspace root:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks typecheck
pnpm --filter @cerbur/clutch-dsh-fireworks build
pnpm --filter @cerbur/clutch-dsh-fireworks test
```

Package release parameters and source-install constraints are documented in
[docs/RELEASING.md](docs/RELEASING.md).

## Uninstall

With the DSH CLI:

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-fireworks
```

From a DeepSeek Harness checkout, use `pnpm dsh plugin --profile web remove` with the same package
name.

## Friendly Links

- [LINUX DO](https://linux.do/) — A new ideal community.
