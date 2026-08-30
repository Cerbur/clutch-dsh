# @cerbur/clutch-dsh-fireworks

## Overview

`@cerbur/clutch-dsh-fireworks` adds a small celebration layer to the DSH Web UI. When an
agent completes a meaningful milestone and calls `happy_fireworks`, the selected conversation
gets a short burst of emoji fireworks.

![Happy fireworks overlay](assets/screenshots/fireworks-mvp.svg)

This is a plugin-only extension. It uses DSH's existing tool-result, session-projection, and
`shell.overlay` extension points and does not modify DSH source code.

## Capabilities

- Registers the `happy_fireworks` agent tool.
- Accepts no required arguments and an optional short `message` for the celebration banner.
- Plays only after a successful direct top-level tool result; failures and cancellations stay quiet.
- Renders a click-through full-screen overlay with 40 emoji visuals per burst, including at least
  10 🎉, 5 🌟, and 5 ✨; the remaining 20 visuals use a seeded roll from an expanded celebration
  palette.
- Keeps historical replay and session switching from replaying an old burst.
- Exposes typed `emoji` and `svg` visual variants through `FireworksRenderer` for a future SVG renderer.
- Requires no DSH source patch; the package contributes only its own Cordis bundle and Web client metadata.

## Installation

### Install from npm (recommended)

With an installed DSH CLI:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
dsh web
```

### Install from a repository checkout

Build the plugin, then install its absolute path into the DSH Web profile:

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

The DSH Web profile and its native UI must already start successfully. Re-run the source install
command after changing the package manifest or `cordis.patch.yml`.

## Usage

An agent decides when a result is worth celebrating. A useful instruction for a manual test is:

```text
After a meaningful milestone, call happy_fireworks with:
{"message":"The fireworks MVP is ready to test!"}
```

The tool result appears in the conversation, and the visual layer appears over the currently
selected session for a few seconds:

![Fireworks animation concept](assets/screenshots/fireworks-mvp.svg)

The first signal already present when a session is opened is intentionally silent, so a refresh
does not replay old celebrations. In the current DSH tool contract, nested Code Mode dispatches
do not receive `presentationMeta`; the MVP therefore animates direct top-level calls.

To remove the plugin from a profile:

```bash
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-fireworks
```
