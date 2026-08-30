# Fireworks Plugin MVP Design

## Context

Add a standalone `fireworks` plugin to the `wt-fireworks-0.1.0/release` worktree. The plugin must work through DSH's existing plugin extension points only; no DSH source files or upstream packages may be modified.

## Goals

- Provide an agent tool named `happy_fireworks`.
- Accept no required arguments and an optional congratulatory `message`.
- Play a celebratory animation in the DSH Web UI after a successful tool result.
- Ship a small, installable MVP quickly with English and Chinese documentation.
- Leave a typed extension point for replacing emoji particles with SVG visuals later.

## Non-goals

- No changes to DSH source code, generated DSH catalogs, or existing plugins.
- No custom server endpoint or DSH UI fork.
- No persistence of a new event type.
- No user-interactive controls in the first version.

## Architecture

### Host tool

The package registers `happy_fireworks` through `ctx.tools`. The tool returns a small JSON value containing a stable invocation id and the optional message. Its `presentationMeta` includes a plugin marker and the same id.

The tool's model-facing result is rendered as a short success message. The host does not append a new session event. Instead, the existing DSH agent flow persists the normal `tool/result` event, including the tool presentation metadata.

### Host-to-client signal

The plugin registers a session projection named `fireworks`. Its reducer watches only the existing `tool/result` event for `happy_fireworks` and a valid plugin marker, then exposes the latest signal `{ id, message? }`.

This avoids introducing an unknown custom session event, which keeps the plugin compatible with DSH's existing persistence and replay behavior while remaining plugin-only.

### Web UI

The client registers one additive `shell.overlay` slot. The overlay reads the active session's `fireworks` projection via the global sessions snapshot, remembers the last seen invocation id per session, and starts an animation only when a new signal arrives while that session is active. Replayed historical signals do not reanimate on initial mount or session switching.

The overlay is pointer-events-free and covers the viewport. It renders a short-lived collection of emoji particles (`🎉`, `🌟`, `🎊`, `✨`, and confetti marks) with deterministic CSS positions and delays. An optional message is shown in a small celebratory banner.

### Visual extension point

The client visual model is a discriminated union with `emoji` and `svg` variants. The initial renderer creates only emoji particles. The renderer interface accepts a signal and returns visual particles, so a later implementation can provide SVG asset references without changing the host tool or projection contract.

## Package shape

Create `packages/clutch-dsh-fireworks` with:

- `package.json` containing the DSH bundle patch and Web client injection metadata.
- `cordis.patch.yml` inserting the host plugin into the DSH bundle.
- `tsconfig.json` and `src/index.ts`.
- `src/contract/` for the projection contract and public shared types.
- `src/client/entry.ts` and client visual modules.
- A small client bundling script, tests, English/Chinese READMEs, and a visual README asset.

The package will use `@cerbur/clutch-dsh-fireworks` as its npm identity and `0.1.0` as its initial version.

## Verification

- Workspace/package manifest and patch checks.
- Fireworks package typecheck and build.
- Unit tests for tool metadata/projection reduction and particle generation.
- Confirm the release worktree contains no DSH source changes.
