[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-fireworks

`@cerbur/clutch-dsh-fireworks` adds a short celebration overlay to the DSH Web UI. An agent can
call `happy_fireworks` after a meaningful milestone, optionally with a brief message, and the
DSH window shows a burst of emoji fireworks, even when the originating Session is in the background.
A clickable toast opens the Session that triggered the celebration.

The plugin is an additive DSH extension. It registers its own tool and Web UI overlay without
modifying DSH source code or adding custom events to conversation history.

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

| Feature                              | Preview                                                                                                                                                   | What it does                                                                                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Automatic milestone celebrations** | <img src="assets/screenshots/fireworks-mvp.svg" width="420" alt="Happy fireworks celebration preview">                                                    | The bundled guidance encourages an agent to call `happy_fireworks` after finishing a design or plan, completing and verifying a feature, resolving a complex bug, or passing full verification. Routine file reads and isolated checks are not milestones. |
| **Fireworks overlay**                | <img src="assets/screenshots/screenshots-zh.png" width="420" alt="Fireworks overlay in the DSH Web UI">                                                   | A successful call displays a short, click-through overlay across the DSH window, independently of the selected Session, and shows a clickable celebration toast.                                                                                           |
| **Jump to the source Session**       | <img src="assets/screenshots/global-fireworks-toast.png" width="420" alt="Background Session fireworks and clickable toast on the real DSH plugins page"> | Click the toast to open its originating Session through DSH navigation. Dismiss it without interrupting the animation. Captured from an installed plugin after a real background tool call.                                                                |
| **Safe replay behavior**             | —                                                                                                                                                         | Failed or cancelled calls stay quiet. Opening a Session, refreshing the page, or switching Sessions does not replay an old celebration.                                                                                                                    |

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
optional message is trimmed and limited to a short toast. Programmatic tool-call dispatches are
supported as well as direct top-level tool results. You can switch to another Session or an app page
while the work runs: the global effect still plays. Click **Open session →** on the toast to return
to the originating Session, or use **×** to dismiss the toast.

## Requirements

| Component | Requirement                                                                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DSH       | A Web UI providing DSH Connection RPC, Session, Session Projection, Tools, UI Renderer, UI Slots, and UI Workspace navigation. Requires DSH 0.2.0 or later; 0.2.0 and 0.2.1 prereleases are explicitly supported. The peer ranges in `package.json` are the source of truth. |
| Cordis    | Compatible Cordis `4.x`; development uses `4.0.4`.                                                                                                                                                                                                                           |
| Browser   | DSH Web UI with the plugin's Web client bundle loaded.                                                                                                                                                                                                                       |

## Behavior and limitations

- Each burst lasts about 3 seconds and uses deterministic emoji visuals. The optional `message`
  is normalized to a maximum of 120 characters. Only the toast accepts clicks; particles remain
  click-through.
- Only successful live fireworks results trigger playback. Errors, cancellations, historical
  Session loads, and page refreshes do not replay old celebrations.
- Switching Sessions or app pages does not clear the animation. The toast remains for up to
  8 seconds unless it is dismissed or replaced by the next queued celebration.
- Celebrations queue across Sessions. Duplicate Session/tool-call identities are ignored. The
  transient feed and playback queue are bounded to 128 entries each, and events expire after
  30 seconds. Expired or overflowed pending events are dropped. Brief disconnects can catch up
  within those limits.
- Each connected owner page consumes independently. The effect stays inside its DSH window;
  it does not create an operating-system desktop overlay. A successful tool result records the
  request, not confirmation that a browser displayed it.
- The plugin uses the authenticated DSH Connection shared route `/api/clutch_fireworks/events`
  and event `clutch_fireworks/launch`. It adds no generated DSH catalog entries or custom Session event
  types. The global feed is available to the Host owner; restricted non-owner peers cannot read it.
- When the Host exposes DSH's `systemPrompt` service, the plugin adds milestone guidance.
  Without that optional service, the tool remains available without the guidance section.
- The package does not patch DSH source code or persist a copy of the conversation.

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
