# Fireworks Plugin MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an installable `@cerbur/clutch-dsh-fireworks` plugin that registers the `happy_fireworks` agent tool and renders an emoji fireworks celebration in the DSH Web UI.

**Architecture:** The Host registers a normal DSH tool whose successful top-level result carries a private presentation marker. The plugin's session projection folds the existing `tool/result` event into a `fireworks` signal, so no new DSH event or source change is needed. The browser half contributes an additive `shell.overlay` entry, observes the active session's projection through the standard `useSessions` hook, and animates deterministic emoji particles.

**Tech Stack:** TypeScript, Cordis plugin metadata, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-session-projection`, DSH client slots, React 18, CSS animations, `zod`, Node's built-in test runner, and `tsdown`.

## Global Constraints

- The implementation is plugin-only: do not modify DSH source packages, generated DSH catalogs, or existing plugins.
- The package identity is `@cerbur/clutch-dsh-fireworks`; its directory is `packages/clutch-dsh-fireworks` and its initial `package.json` version is `0.1.0`.
- `happy_fireworks` has no required parameters and accepts one optional short `message` string.
- Trigger the browser animation only after a successful direct top-level `tool/result`; failures, cancellations, and historical replay do not launch a new burst.
- Reuse the existing `tool/result` event and `shell.overlay` slot; do not add an unknown custom session event, endpoint, or DSH UI fork.
- Preserve the SVG extension point as a typed `emoji`/`svg` visual union, while the MVP renderer emits emoji visuals only.
- Keep English and Chinese README sections in this order: overview with screenshot, capabilities, installation with npm first then source, and detailed usage with image.
- Do not commit, publish, push, merge, or create release tags without explicit user authorization; local build and pack preview are allowed.

## Post-release correction for 0.1.1

The initial 0.1.0 manifest below used a `prepare` build and wildcard DSH peer ranges. After the
package was published, release feedback identified two packaging issues: GitHub dependency
installs can unexpectedly build from source, and npm semver excludes DSH prerelease hosts from a
wildcard peer range. The 0.1.1 release changes the package manifest to use `prepublishOnly` and
explicit prerelease-aware peer ranges, updates the release instructions to build before pack
preview, and documents that generated `lib/` is not committed. The MVP runtime architecture is
unchanged.

## File map

Create the new plugin under `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_6b92994f-f9a5-4cc2-acca-5e7d1c63dda3/packages/clutch-dsh-fireworks`:

- `.gitignore`, `package.json`, `tsconfig.json`, and `cordis.patch.yml` define the publishable package, ignored generated output, Host bundle insertion, and Web client dependency closure.
- `src/contract/index.ts` owns the public tool/projection constants, wire signal type, and `SessionProjectionMap` augmentation.
- `src/fireworks-projection.ts` owns metadata validation, projection reduction, and the session projection definition.
- `src/fireworks-tool.ts` owns the `happy_fireworks` definition and its canonical/presentation projections.
- `src/index.ts` is the Host Cordis plugin entry and exports the stable contract.
- `src/client/fireworks-renderer.ts` owns deterministic emoji particles and the future SVG visual interface.
- `src/client/FireworksOverlay.tsx`, `src/client/fireworks.css`, and `src/client/css.d.ts` own the browser animation, styling, and CSS-module typing.
- `src/client/entry.ts` registers the additive root overlay and exports browser-side visual types.
- `scripts/build-client.mjs` produces the DSH ModuleLoader-compatible browser closure and injects scoped CSS.
- `test/` contains package metadata, Host/projection, and renderer tests.
- `README.md`, `README.zh.md`, `assets/screenshots/fireworks-mvp.svg`, `docs/RELEASING.md`, and `RELEASE-LOG.md` document the public package.

---

### Task 1: Scaffold the publishable plugin package

**Files:**

- Create: `packages/clutch-dsh-fireworks/.gitignore`
- Create: `packages/clutch-dsh-fireworks/package.json`
- Create: `packages/clutch-dsh-fireworks/tsconfig.json`
- Create: `packages/clutch-dsh-fireworks/cordis.patch.yml`
- Create: `packages/clutch-dsh-fireworks/test/package-manifest.test.mjs`
- Modify: `pnpm-lock.yaml` after the manifest is in place

**Interfaces:**

- Produces the package identity consumed by every later task: `@cerbur/clutch-dsh-fireworks`.
- Declares the Host bundle patch and browser injection dependencies consumed by Tasks 2–5.

- [ ] **Step 1: Write the manifest test.**

Create `test/package-manifest.test.mjs` with checks for the package name, plugin metadata, build scripts, patch reference, browser dependencies, and absence of a default Host export requirement:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

test('declares an installable DSH plugin package', () => {
  assert.equal(manifest.name, '@cerbur/clutch-dsh-fireworks');
  assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(manifest.clutchDsh, {
    plugin: '@cerbur/clutch-dsh-fireworks',
    role: 'plugin',
    serviceDefinition: '@cerbur/clutch-dsh-fireworks',
  });
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
  ]);
  for (const script of ['build', 'lint', 'typecheck', 'test']) {
    assert.equal(typeof manifest.scripts[script], 'string');
  }
});

test('keeps generated browser artifacts and the patch in the npm file list', () => {
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'assets']);
  assert.equal(manifest.exports['./client'].default, './lib/client.js');
  assert.equal(manifest.exports['./contract'].import, './lib/contract/index.js');
});
```

- [ ] **Step 2: Run the manifest test to verify the scaffold is absent.**

Run from the release worktree:

```bash
node packages/clutch-dsh-fireworks/test/package-manifest.test.mjs
```

Expected: FAIL because `packages/clutch-dsh-fireworks/package.json` does not exist yet.

- [ ] **Step 3: Add the package manifest, compiler config, and patch.**

Create `package.json` with the following concrete shape. The DSH host packages stay peers so the plugin uses the DSH installation's existing runtime; the listed development versions match the current workspace lock's rc.8 Host seam and rc.2 client seam.

```json
{
  "name": "@cerbur/clutch-dsh-fireworks",
  "version": "0.1.0",
  "description": "Adds a celebratory fireworks overlay to the DSH Web UI through a happy_fireworks agent tool.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Cerbur/clutch-dsh.git",
    "directory": "packages/clutch-dsh-fireworks"
  },
  "homepage": "https://github.com/Cerbur/clutch-dsh/tree/main/packages/clutch-dsh-fireworks",
  "packageManager": "pnpm@10.32.1",
  "keywords": ["deepseek-harness", "dsh", "dsh-plugin", "fireworks", "celebration"],
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "import": "./lib/index.js",
      "default": "./lib/index.js"
    },
    "./contract": {
      "types": "./lib/contract/index.d.ts",
      "import": "./lib/contract/index.js",
      "default": "./lib/contract/index.js"
    },
    "./client": {
      "types": "./lib/client/entry.d.ts",
      "default": "./lib/client.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "assets"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "prepare": "pnpm run build",
    "build": "tsc -p tsconfig.json && node scripts/build-client.mjs",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "pnpm run build && node --test test/*.test.mjs"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-layout"],
      "platform": "web"
    }
  },
  "clutchDsh": {
    "plugin": "@cerbur/clutch-dsh-fireworks",
    "role": "plugin",
    "serviceDefinition": "@cerbur/clutch-dsh-fireworks"
  },
  "dependencies": {
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/dsh-client-runtime": "*",
    "@deepseek-ai/dsh-client-ui-layout": "*",
    "@deepseek-ai/dsh-client-ui-slots": "*",
    "@deepseek-ai/dsh-session": "*",
    "@deepseek-ai/dsh-session-projection": "*",
    "@deepseek-ai/dsh-tools": "*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-layout": "0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.1-rc.2",
    "@deepseek-ai/dsh-session": "0.1.1-rc.2",
    "@deepseek-ai/dsh-session-projection": "0.1.0-rc.8",
    "@deepseek-ai/dsh-tools": "0.1.0-rc.8",
    "@types/node": "^22.15.3",
    "@types/react": "~18.3.1",
    "react": "^18.2.0",
    "tsdown": "0.22.2"
  }
}
```

Create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib",
    "types": ["node"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Create `cordis.patch.yml`:

```yaml
- insert:
    - id: clutch-dsh-fireworks
      name: '@cerbur/clutch-dsh-fireworks'
```

- [ ] **Step 4: Install the new workspace dependency graph and rerun the manifest test.**

Run:

```bash
pnpm install --lockfile-only
node packages/clutch-dsh-fireworks/test/package-manifest.test.mjs
```

Expected: the lockfile is updated with the new importer and the manifest test passes.

---

### Task 2: Define the contract, Host tool, and persistence-safe projection

**Files:**

- Create: `packages/clutch-dsh-fireworks/src/contract/index.ts`
- Create: `packages/clutch-dsh-fireworks/src/fireworks-projection.ts`
- Create: `packages/clutch-dsh-fireworks/src/fireworks-tool.ts`
- Create: `packages/clutch-dsh-fireworks/src/index.ts`
- Create: `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs`

**Interfaces:**

- Produces `FIREWORKS_TOOL_NAME`, `FIREWORKS_PROJECTION_KEY`, `FIREWORKS_META_KIND`, `FireworksSignal`, and `FireworksProjection`.
- Produces `applyFireworksProjection(state, event)` and `createFireworksProjectionDefinition()` for the Host and tests.
- Produces `happyFireworksTool`, `name = 'clutch-dsh-fireworks'`, `inject = ['tools']`, and the `apply(ctx)` Cordis plugin function.

- [ ] **Step 1: Write the failing Host/projection tests.**

Create `test/fireworks-host.test.mjs` with direct tests for the tool contract, the metadata marker, the projection reducer, and plugin registration:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
  FIREWORKS_TOOL_NAME,
} from '../lib/contract/index.js';
import { applyFireworksProjection } from '../lib/fireworks-projection.js';
import { apply, happyFireworksTool, inject, name } from '../lib/index.js';

const directExec = { callId: 'call-42' };

function resultEvent({ callId = 'call-42', meta, error } = {}) {
  return {
    type: 'tool/result',
    seq: 3,
    time: 1,
    data: {
      message: { source: { kind: 'tool', callId } },
      ...(meta === undefined ? {} : { meta }),
      ...(error === undefined ? {} : { error }),
    },
  };
}

test('registers the happy_fireworks tool with no required input', async () => {
  assert.equal(name, 'clutch-dsh-fireworks');
  assert.deepEqual(inject, ['tools']);
  assert.equal(happyFireworksTool.name, FIREWORKS_TOOL_NAME);
  assert.deepEqual(await happyFireworksTool.execute({ message: '  MVP shipped!  ' }, directExec), {
    id: 'call-42',
    message: 'MVP shipped!',
  });
  assert.deepEqual(await happyFireworksTool.execute({}, directExec), { id: 'call-42' });
  assert.deepEqual(
    happyFireworksTool.output.presentationMeta({}, { id: 'call-42', message: 'MVP shipped!' }),
    { kind: FIREWORKS_META_KIND, id: 'call-42', message: 'MVP shipped!' },
  );
});

test('reduces only a valid successful fireworks result', () => {
  const initial = null;
  const signal = applyFireworksProjection(
    initial,
    resultEvent({
      meta: { kind: FIREWORKS_META_KIND, id: 'call-42', message: 'MVP shipped!' },
    }),
  );
  assert.deepEqual(signal, { id: 'call-42', message: 'MVP shipped!' });

  assert.equal(
    applyFireworksProjection(
      signal,
      resultEvent({
        meta: { kind: 'other-plugin', id: 'call-43' },
      }),
    ),
    signal,
  );
  assert.equal(
    applyFireworksProjection(
      signal,
      resultEvent({
        callId: 'different-call',
        meta: { kind: FIREWORKS_META_KIND, id: 'call-42' },
      }),
    ),
    signal,
  );
  assert.equal(
    applyFireworksProjection(
      signal,
      resultEvent({
        error: { name: 'CancelledError', code: 'ABORTED' },
        meta: { kind: FIREWORKS_META_KIND, id: 'call-42' },
      }),
    ),
    signal,
  );
});

test('registers both the projection when available and the tool', () => {
  const tools = [];
  const projections = [];
  apply({
    tools: { register: (tool) => tools.push(tool) },
    inject: (deps, callback) => {
      assert.deepEqual(deps, ['sessionProjections']);
      callback({ sessionProjections: { register: (definition) => projections.push(definition) } });
    },
  });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [FIREWORKS_TOOL_NAME],
  );
  assert.deepEqual(
    projections.map((definition) => definition.key),
    [FIREWORKS_PROJECTION_KEY],
  );
});
```

- [ ] **Step 2: Run the Host tests to verify the implementation is absent.**

Run:

```bash
node --test packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs
```

Expected: FAIL because the `lib/` modules have not been generated.

- [ ] **Step 3: Implement the shared contract.**

Create `src/contract/index.ts`:

```ts
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';

export const FIREWORKS_TOOL_NAME = 'happy_fireworks' as const;
export const FIREWORKS_PROJECTION_KEY = 'fireworks' as const;
export const FIREWORKS_META_KIND = 'clutch-dsh-fireworks' as const;
export const FIREWORKS_DURATION_MS = 3_200;
export const MAX_FIREWORKS_MESSAGE_CHARS = 120;

export interface FireworksSignal {
  readonly id: string;
  readonly message?: string;
}

export type FireworksProjection = FireworksSignal | null;

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    fireworks: FireworksProjection;
  }
}

export type { SessionProjectionMap };
```

- [ ] **Step 4: Implement and test the projection reducer.**

Create `src/fireworks-projection.ts`:

```ts
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { z } from 'zod';
import {
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
  MAX_FIREWORKS_MESSAGE_CHARS,
  type FireworksProjection,
} from './contract/index.js';

export const fireworksProjectionSchema = z.union([
  z.object({ id: z.string(), message: z.string().optional() }),
  z.null(),
]);

export function normalizeFireworksMessage(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const message = input.trim();
  if (message.length === 0) return undefined;
  return message.slice(0, MAX_FIREWORKS_MESSAGE_CHARS);
}

interface FireworksMeta {
  readonly kind: typeof FIREWORKS_META_KIND;
  readonly id: string;
  readonly message?: string;
}

export function parseFireworksMeta(input: unknown): FireworksMeta | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (
    record.kind !== FIREWORKS_META_KIND ||
    typeof record.id !== 'string' ||
    record.id.length === 0
  ) {
    return undefined;
  }
  if (record.message !== undefined && typeof record.message !== 'string') return undefined;
  return {
    kind: FIREWORKS_META_KIND,
    id: record.id,
    ...(normalizeFireworksMessage(record.message) === undefined
      ? {}
      : { message: normalizeFireworksMessage(record.message) }),
  };
}

export function applyFireworksProjection(
  state: FireworksProjection,
  event: SessionEvent,
): FireworksProjection {
  if (event.type !== 'tool/result' || event.data.error !== undefined) return state;
  const meta = parseFireworksMeta(event.data.meta);
  if (meta === undefined) return state;
  if (String(event.data.message.source.callId) !== meta.id) return state;
  return {
    id: meta.id,
    ...(meta.message === undefined ? {} : { message: meta.message }),
  };
}

export function createFireworksProjectionDefinition(): ProjectionDefinition<
  typeof FIREWORKS_PROJECTION_KEY,
  FireworksProjection
> {
  return {
    key: FIREWORKS_PROJECTION_KEY,
    schema: fireworksProjectionSchema,
    init: () => null,
    apply: applyFireworksProjection,
    view: (state) => state,
    stateVersion: 1,
  };
}
```

The reducer must return the existing `state` reference for unrelated events, reject failed results, match the metadata id to the existing tool-result call id, and expose only a bounded optional message.

- [ ] **Step 5: Implement the tool and Host plugin entry.**

Create `src/fireworks-tool.ts`:

```ts
import { defineTool } from '@deepseek-ai/dsh-tools';
import { FIREWORKS_META_KIND, FIREWORKS_TOOL_NAME } from './contract/index.js';
import { normalizeFireworksMessage } from './fireworks-projection.js';

export const happyFireworksTool = defineTool({
  name: FIREWORKS_TOOL_NAME,
  description:
    'Celebrate a major implementation milestone or another moment worth making the user happy. ' +
    'Call this after a meaningful success. The optional message is a short phrase shown in the celebration banner.',
  parameters: {
    message: {
      type: 'string',
      description: 'Optional short congratulatory message for the user.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        message: { type: 'string' },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text:
          value.message === undefined
            ? 'Happy fireworks launched! 🎉'
            : `Happy fireworks launched: ${value.message} 🎉`,
      },
    ],
    presentationMeta: (_args, value) => ({
      kind: FIREWORKS_META_KIND,
      id: value.id,
      ...(value.message === undefined ? {} : { message: value.message }),
    }),
  },
  presentCall: () => ({
    card: 'generic',
    title: 'Launch happy fireworks',
    kind: 'other',
  }),
  presentResult: (_args, result) => ({
    card: 'generic',
    title: result.isError ? 'Fireworks failed' : 'Happy fireworks 🎉',
    content: result.content,
  }),
  execute(args, exec) {
    const message = normalizeFireworksMessage(args.message);
    return Promise.resolve({
      id: String(exec.callId),
      ...(message === undefined ? {} : { message }),
    });
  },
});
```

Create `src/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis';
import { createFireworksProjectionDefinition } from './fireworks-projection.js';
import { happyFireworksTool } from './fireworks-tool.js';

export * from './contract/index.js';
export { createFireworksProjectionDefinition } from './fireworks-projection.js';
export { happyFireworksTool } from './fireworks-tool.js';

export const name = 'clutch-dsh-fireworks';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionContext) => {
    projectionContext.sessionProjections.register(createFireworksProjectionDefinition());
  });
  ctx.tools.register(happyFireworksTool);
}
```

Do not add a default export: the DSH loader's object-plugin unwrap behavior relies on the named `name`, `inject`, and `apply` exports for this function-style plugin.

- [ ] **Step 6: Build and rerun the Host tests.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks build
node --test packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs
```

Expected: the TypeScript build succeeds and all Host/projection tests pass.

---

### Task 3: Implement the deterministic visual renderer and its tests

**Files:**

- Create: `packages/clutch-dsh-fireworks/src/client/fireworks-renderer.ts`
- Create: `packages/clutch-dsh-fireworks/test/fireworks-renderer.test.mjs`

**Interfaces:**

- Consumes: `FireworksSignal` from `src/contract/index.ts`.
- Produces: `FireworksEmojiVisual`, `FireworksSvgVisual`, `FireworksVisual`, `FireworksRenderer`, `createEmojiFireworksVisuals()`, and `emojiFireworksRenderer`.

- [ ] **Step 1: Write the failing renderer tests.**

Create `test/fireworks-renderer.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmojiFireworksVisuals,
  emojiFireworksRenderer,
} from '../lib/client/fireworks-renderer.js';

test('creates a deterministic full-screen emoji burst', () => {
  const signal = { id: 'call-42', message: 'MVP shipped!' };
  const first = createEmojiFireworksVisuals(signal);
  const second = createEmojiFireworksVisuals(signal);
  assert.deepEqual(first, second);
  assert.equal(first.length, 28);
  assert.ok(first.every((visual) => visual.kind === 'emoji'));
  assert.ok(first.every((visual) => visual.glyph.length > 0));
  assert.ok(first.every((visual) => visual.left >= 4 && visual.left <= 96));
  assert.ok(first.every((visual) => visual.top >= -8 && visual.top <= 108));
  assert.ok(first.every((visual) => visual.delayMs >= 0 && visual.delayMs <= 720));
});

test('exposes the renderer interface used by the overlay', () => {
  assert.deepEqual(
    emojiFireworksRenderer.createVisuals({ id: 'call-1' }),
    createEmojiFireworksVisuals({ id: 'call-1' }),
  );
});
```

- [ ] **Step 2: Run the renderer tests to verify they fail.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks build
node --test packages/clutch-dsh-fireworks/test/fireworks-renderer.test.mjs
```

Expected: FAIL because `src/client/fireworks-renderer.ts` does not exist yet.

- [ ] **Step 3: Implement the emoji renderer and SVG extension point.**

Create `src/client/fireworks-renderer.ts`:

```ts
import type { FireworksSignal } from '../contract/index.js';

export interface FireworksVisualPlacement {
  readonly left: number;
  readonly top: number;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly rotationDeg: number;
  readonly scale: number;
}

export interface FireworksEmojiVisual extends FireworksVisualPlacement {
  readonly kind: 'emoji';
  readonly glyph: string;
}

export interface FireworksSvgVisual extends FireworksVisualPlacement {
  readonly kind: 'svg';
  /** A future renderer supplies a trusted local or package asset URL. */
  readonly src: string;
  readonly alt?: string;
}

export type FireworksVisual = FireworksEmojiVisual | FireworksSvgVisual;

export interface FireworksRenderer {
  createVisuals(signal: FireworksSignal): readonly FireworksVisual[];
}

const EMOJI = ['🎉', '🌟', '🎊', '✨', '💫', '🟡', '🔵', '🟣', '🟢', '🔴'] as const;

function hashSignalId(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

export function createEmojiFireworksVisuals(
  signal: FireworksSignal,
): readonly FireworksEmojiVisual[] {
  const seed = hashSignalId(signal.id);
  return Array.from({ length: 28 }, (_, index) => ({
    kind: 'emoji' as const,
    glyph: EMOJI[(seed + index * 7) % EMOJI.length],
    left: 4 + ((seed + index * 37) % 93),
    top: -8 + ((seed + index * 53) % 117),
    delayMs: (seed + index * 41) % 721,
    durationMs: 2_300 + ((seed + index * 17) % 1_000),
    rotationDeg: -35 + ((seed + index * 29) % 71),
    scale: 0.75 + ((seed + index * 11) % 70) / 100,
  }));
}

export const emojiFireworksRenderer: FireworksRenderer = {
  createVisuals: createEmojiFireworksVisuals,
};
```

- [ ] **Step 4: Build and run the renderer tests.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks build
node --test packages/clutch-dsh-fireworks/test/fireworks-renderer.test.mjs
```

Expected: both renderer tests pass and the generated declaration exposes the SVG-capable union.

---

### Task 4: Add the Web UI overlay and CSS animation

**Files:**

- Create: `packages/clutch-dsh-fireworks/src/client/FireworksOverlay.tsx`
- Create: `packages/clutch-dsh-fireworks/src/client/fireworks.css`
- Create: `packages/clutch-dsh-fireworks/src/client/css.d.ts`

**Interfaces:**

- Consumes: `PropsRuntime<'shell.overlay'>`, the global `useSessions` hook, `FireworksProjection`, `FireworksRenderer`, and `FIREWORKS_DURATION_MS`.
- Produces: a click-through, root-scoped `FireworksOverlay` that animates only a new active-session signal.

- [ ] **Step 1: Implement replay-safe burst detection.**

Create `src/client/FireworksOverlay.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import {
  FIREWORKS_DURATION_MS,
  type FireworksProjection,
  type FireworksSignal,
} from '../contract/index.js';
import { emojiFireworksRenderer, type FireworksVisual } from './fireworks-renderer.js';
import styles from './fireworks.css';

type FireworksOverlayProps = PropsRuntime<'shell.overlay'>;

interface Burst {
  readonly key: string;
  readonly signal: FireworksSignal;
}

function VisualNode({ visual }: { visual: FireworksVisual }) {
  const style = {
    left: `${visual.left}%`,
    top: `${visual.top}%`,
    '--fireworks-delay': `${visual.delayMs}ms`,
    '--fireworks-duration': `${visual.durationMs}ms`,
    '--fireworks-rotation': `${visual.rotationDeg}deg`,
    '--fireworks-scale': String(visual.scale),
  } as CSSProperties;

  if (visual.kind === 'svg') {
    return (
      <img className={styles.particle} src={visual.src} alt={visual.alt ?? ''} style={style} />
    );
  }
  return (
    <span className={styles.particle} aria-hidden="true" style={style}>
      {visual.glyph}
    </span>
  );
}

export function FireworksOverlay({ useSessions }: FireworksOverlayProps) {
  const current = useSessions((state) => {
    const sessionId = state.current;
    if (sessionId === undefined) return undefined;
    const signal = state.byId[sessionId]?.projectionValues?.fireworks as
      FireworksProjection | undefined;
    return { sessionId: String(sessionId), signal };
  });
  const seen = useRef(new Map<string, string | null>());
  const activeSession = useRef<string | undefined>();
  const [burst, setBurst] = useState<Burst | undefined>();

  useEffect(() => {
    if (current === undefined) {
      activeSession.current = undefined;
      setBurst(undefined);
      return;
    }

    const marker = current.signal?.id ?? null;
    const sessionChanged = activeSession.current !== current.sessionId;
    activeSession.current = current.sessionId;

    if (!seen.current.has(current.sessionId)) {
      seen.current.set(current.sessionId, marker);
      if (sessionChanged) setBurst(undefined);
      return;
    }

    const previous = seen.current.get(current.sessionId) ?? null;
    seen.current.set(current.sessionId, marker);
    if (sessionChanged) {
      setBurst(undefined);
      return;
    }
    if (current.signal !== undefined && current.signal !== null && marker !== previous) {
      setBurst({
        key: `${current.sessionId}:${current.signal.id}`,
        signal: current.signal,
      });
    }
  }, [current?.sessionId, current?.signal?.id, current?.signal?.message]);

  useEffect(() => {
    if (burst === undefined) return undefined;
    const timer = window.setTimeout(() => setBurst(undefined), FIREWORKS_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [burst]);

  if (burst === undefined) return null;
  return (
    <div className={styles.overlay} key={burst.key} aria-live="polite">
      <div className={styles.banner} role="status">
        {burst.signal.message ?? 'A big milestone deserves fireworks!'} 🎉
      </div>
      <div className={styles.particles} aria-hidden="true">
        {emojiFireworksRenderer.createVisuals(burst.signal).map((visual, index) => (
          <VisualNode key={`${burst.key}:${index}`} visual={visual} />
        ))}
      </div>
    </div>
  );
}
```

The `Map.has()` check is required so a first observed `null` signal is different from an unseen session. The first signal observed after mounting or switching sessions is recorded but not animated; only a later id change in the active session launches a burst.

- [ ] **Step 2: Add the click-through animation stylesheet.**

Create `src/client/fireworks.css`:

```css
.overlay {
  position: fixed;
  z-index: 1000;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.banner {
  position: absolute;
  z-index: 2;
  top: 16%;
  left: 50%;
  max-width: min(76vw, 560px);
  padding: 10px 18px;
  border: 1px solid rgba(255, 255, 255, 0.44);
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, rgba(111, 67, 220, 0.92), rgba(232, 74, 157, 0.92));
  box-shadow: 0 12px 36px rgba(80, 35, 122, 0.28);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  transform: translateX(-50%);
  animation: fireworks-banner 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.particles {
  position: absolute;
  inset: 0;
}

.particle {
  position: absolute;
  display: block;
  font-size: clamp(22px, 3.2vw, 46px);
  line-height: 1;
  transform-origin: center;
  animation: fireworks-drift var(--fireworks-duration) cubic-bezier(0.22, 0.61, 0.36, 1)
    var(--fireworks-delay) both;
  filter: drop-shadow(0 4px 8px rgba(109, 56, 126, 0.18));
}

.particle[src] {
  width: clamp(24px, 3.5vw, 48px);
  height: clamp(24px, 3.5vw, 48px);
  object-fit: contain;
}

@keyframes fireworks-drift {
  0% {
    opacity: 0;
    transform: translate3d(0, -14px, 0) rotate(var(--fireworks-rotation)) scale(0.42);
  }
  12% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate3d(0, 30vh, 0) rotate(calc(var(--fireworks-rotation) + 160deg))
      scale(var(--fireworks-scale));
  }
}

@keyframes fireworks-banner {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(-16px) scale(0.88);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .particle {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
  .banner {
    animation-duration: 1ms;
  }
}
```

Create `src/client/css.d.ts` so TypeScript understands the class map emitted by the client bundler:

```ts
declare module '*.css' {
  const classNames: Record<string, string>;
  export default classNames;
}
```

- [ ] **Step 3: Run typecheck to catch the overlay contract errors.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks typecheck
```

Expected: if the `shell.overlay` declaration has not yet been imported by the client entry, TypeScript reports the missing slot; Task 5 adds that declaration import before the final typecheck.

---

### Task 5: Wire the browser entry and build closure

**Files:**

- Create: `packages/clutch-dsh-fireworks/src/client/entry.ts`
- Create: `packages/clutch-dsh-fireworks/scripts/build-client.mjs`
- Modify: `packages/clutch-dsh-fireworks/package.json` only if dependency metadata needs the final client type imports

**Interfaces:**

- Consumes: `FireworksOverlay` and the DSH `shell.overlay` declaration from `@deepseek-ai/dsh-client-ui-layout/client`.
- Produces the `@cerbur/clutch-dsh-fireworks/client` browser module loaded by DSH's ModuleLoader.

- [ ] **Step 1: Register the additive shell overlay.**

Create `src/client/entry.ts`:

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { FireworksOverlay } from './FireworksOverlay.js';

export type {
  FireworksEmojiVisual,
  FireworksRenderer,
  FireworksSvgVisual,
  FireworksVisual,
} from './fireworks-renderer.js';

export const inject = ['slots'];

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'clutch-dsh-fireworks-overlay',
        order: 10,
      },
      FireworksOverlay,
    ),
  );
}
```

This entry only contributes a list item; it never replaces `root`, `conversation`, `sidebar`, or `details`.

- [ ] **Step 2: Add the ModuleLoader-compatible client bundler.**

Create `scripts/build-client.mjs` with the same closure contract as the existing Worktree plugin, changing only the package-derived client id and CSS prefix to `@cerbur/clutch-dsh-fireworks`:

```js
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'tsdown';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const packageManifest = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const clientId = packageManifest.name;
const CSS_PREFIX = '\0clutch-dsh-fireworks-css:';
const CSS_SUFFIX = '.mjs';
const clientExternals = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
];

await build({
  name: `${clientId}/client`,
  cwd: packageDirectory,
  entry: { client: 'lib/client/entry.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: clientExternals,
    alwaysBundle: (id) => !clientExternals.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [
    {
      name: 'clutch-dsh-fireworks-css',
      resolveId(source, importer) {
        if (!source.endsWith('.css')) return null;
        const emitted =
          importer === undefined
            ? path.resolve(packageDirectory, source)
            : path.resolve(path.dirname(importer), source);
        const candidate = existsSync(emitted)
          ? emitted
          : path.resolve(packageDirectory, 'src/client', source.replace(/^\.\//, ''));
        return `${CSS_PREFIX}${candidate}${CSS_SUFFIX}`;
      },
      async load(id) {
        if (!id.startsWith(CSS_PREFIX) || !id.endsWith(CSS_SUFFIX)) return null;
        const fileId = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length);
        this.addWatchFile(fileId);
        const css = await readFile(fileId, 'utf8');
        const classNames = [...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)]
          .map((match) => match[1])
          .filter((className, index, names) => names.indexOf(className) === index);
        const classMap = Object.fromEntries(
          classNames.map((className) => [
            className,
            `${clientId.replaceAll(/[^A-Za-z0-9_-]/g, '-')}-${className}`,
          ]),
        );
        const scopedCss = css.replace(
          /\.([A-Za-z_][A-Za-z0-9_-]*)/g,
          (_match, className) => `.${classMap[className]}`,
        );
        const styleId = `${clientId}/${path.basename(fileId)}`;
        return [
          `const css = ${JSON.stringify(scopedCss)};`,
          `const styleId = ${JSON.stringify(styleId)};`,
          "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=\\\"' + styleId + '\\\"]') === null) {",
          "  const tag = document.createElement('style');",
          `  tag.dataset.plugin = ${JSON.stringify(clientId)};`,
          '  tag.dataset.pluginCss = styleId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n');
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientId)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
});
```

- [ ] **Step 3: Build the browser closure and inspect its boundary.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks build
test -f packages/clutch-dsh-fireworks/lib/index.js
test -f packages/clutch-dsh-fireworks/lib/client.js
rg -n "clutch-dsh-fireworks-overlay|shell.overlay|happy_fireworks" packages/clutch-dsh-fireworks/lib
```

Expected: `lib/client.js` contains the ModuleLoader registration and overlay id, while the generated client bundle does not contain Node-only Host imports such as `@deepseek-ai/dsh-tools`.

---

### Task 6: Document installation, usage, release parameters, and the visual reference

**Files:**

- Create: `packages/clutch-dsh-fireworks/README.md`
- Create: `packages/clutch-dsh-fireworks/README.zh.md`
- Create: `packages/clutch-dsh-fireworks/assets/screenshots/fireworks-mvp.svg`
- Create: `packages/clutch-dsh-fireworks/docs/RELEASING.md`
- Create: `packages/clutch-dsh-fireworks/RELEASE-LOG.md`

**Interfaces:**

- Documents the public package and its exact npm/source installation commands.
- Produces the screenshot path referenced by both README files.

- [ ] **Step 1: Create the visual reference asset.**

Create `assets/screenshots/fireworks-mvp.svg` as a small self-contained illustration of a DSH-like white conversation surface with a purple celebration banner and scattered emoji particles. It must be a static documentation asset, not a runtime dependency:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 680" role="img" aria-labelledby="title desc">
  <title id="title">Happy fireworks overlay preview</title>
  <desc id="desc">A DSH conversation surface covered by emoji fireworks after a successful tool call.</desc>
  <rect width="1200" height="680" rx="28" fill="#eef3f8"/>
  <rect x="120" y="48" width="1032" height="584" rx="24" fill="#fff" stroke="#d8e0e8"/>
  <rect x="120" y="48" width="1032" height="72" rx="24" fill="#f8fafc"/>
  <text x="158" y="92" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#263241">DSH conversation</text>
  <rect x="424" y="150" width="352" height="54" rx="27" fill="#7a50df"/>
  <text x="600" y="184" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#fff">MVP shipped! 🎉</text>
  <g font-family="system-ui, sans-serif" font-size="46" text-anchor="middle">
    <text x="210" y="198">✨</text><text x="338" y="302">🎊</text><text x="492" y="252">🌟</text>
    <text x="720" y="300">🎉</text><text x="910" y="218">💫</text><text x="1038" y="356">🎊</text>
    <text x="244" y="462">🌟</text><text x="440" y="542">🎉</text><text x="680" y="484">✨</text>
    <text x="882" y="548">🌟</text><text x="1060" y="500">🎉</text>
  </g>
  <g fill="#ef4d8d"><circle cx="286" cy="250" r="8"/><circle cx="815" cy="252" r="7"/><circle cx="610" cy="420" r="8"/></g>
  <g fill="#f4b635"><circle cx="370" cy="420" r="7"/><circle cx="1002" cy="280" r="8"/></g>
  <rect x="270" y="566" width="732" height="38" rx="19" fill="#f3f6f9"/>
</svg>
```

- [ ] **Step 2: Write the English README in the required section order.**

`README.md` must contain, in order:

1. `## Overview` with the screenshot `![Happy fireworks overlay](assets/screenshots/fireworks-mvp.svg)` and a statement that the plugin is plugin-only and leaves DSH source untouched.
2. `## Capabilities` listing the `happy_fireworks` tool, optional `message`, successful-result trigger, emoji MVP, click-through overlay, and SVG extension point.
3. `## Installation` with npm first:

   ```bash
   dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
   dsh web
   ```

   Then source checkout installation:

   ```bash
   cd /absolute/path/to/clutch-dsh
   pnpm install
   pnpm --filter @cerbur/clutch-dsh-fireworks build
   cd /absolute/path/to/deepseek-harness
   pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-fireworks
   pnpm dsh web
   ```

4. `## Usage` with the screenshot again and a concrete prompt/tool payload example:

   ```text
   After a meaningful milestone, call happy_fireworks with:
   {"message":"The fireworks MVP is ready to test!"}
   ```

   Explain that the overlay appears in the currently selected session, the first replayed signal is intentionally silent, and nested Code Mode dispatches do not carry `presentationMeta` in the current DSH tool contract.

- [ ] **Step 3: Write the Chinese README with the same behavior and section order.**

`README.zh.md` must mirror the English README's four sections and commands: overview with screenshot, capabilities, npm installation before source installation, and usage with the same image and JSON payload. Keep package names, commands, error-free behavior, and the plugin-only/no-DSH-source-change limitation identical across languages.

- [ ] **Step 4: Add package release metadata.**

Create `docs/RELEASING.md` with the concrete package parameters:

```md
# Fireworks package release notes

This package follows the repository release lifecycle in [`../../docs/RELEASING.md`](../../docs/RELEASING.md).

| Parameter        | Value                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| npm package      | `@cerbur/clutch-dsh-fireworks`                                                                 |
| release name     | `fireworks`                                                                                    |
| source directory | `packages/clutch-dsh-fireworks`                                                                |
| bundle patch     | `cordis.patch.yml`                                                                             |
| source install   | `pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-fireworks` |

The plugin has no package-specific publish step. Build and `npm pack --dry-run` run in the release worktree; publishing remains a user-run command from the release worktree. Do not modify DSH source files when validating installation.
```

Create `RELEASE-LOG.md` with Chinese entries first and English entries second, one sentence per public change:

```md
# 发布记录

## 未发布

- 新增 `happy_fireworks` 工具，并在 DSH Web UI 中播放 emoji 礼花。

# Release log

## Unreleased

- Added the `happy_fireworks` tool and an emoji fireworks celebration in the DSH Web UI.
```

---

### Task 7: Run the complete release-worktree verification

**Files:**

- Modify only generated `pnpm-lock.yaml` or generated `packages/clutch-dsh-fireworks/lib/` files as required by the build; do not hand-edit generated output.

**Interfaces:**

- Verifies the package is discoverable by the workspace, its patch parses, its Host and browser halves build, tests pass, and the npm tarball contains the expected artifacts.

- [ ] **Step 1: Run targeted formatting, lint, type, and test checks.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks exec prettier --check package.json tsconfig.json cordis.patch.yml src test scripts README.md README.zh.md docs/RELEASING.md RELEASE-LOG.md assets/screenshots/fireworks-mvp.svg
pnpm --filter @cerbur/clutch-dsh-fireworks lint
pnpm --filter @cerbur/clutch-dsh-fireworks typecheck
pnpm --filter @cerbur/clutch-dsh-fireworks test
```

Expected: every command exits zero; `test` rebuilds before running all `test/*.test.mjs` files.

- [ ] **Step 2: Run workspace shape and patch validation.**

Run:

```bash
pnpm run check:workspace
pnpm run check:patches
```

Expected output includes `workspace shape ok` and `cordis patches ok`, with the new package included in both scans.

- [ ] **Step 3: Preview the npm tarball in the release worktree.**

Run from the package directory:

```bash
cd packages/clutch-dsh-fireworks
npm pack --dry-run
```

Expected file list includes `README.md`, `README.zh.md`, `package.json`, `cordis.patch.yml`, the documentation `assets/`, and generated `lib/`; no `src/`, tests, plans, or local credentials are included.

- [ ] **Step 4: Prove the change stayed plugin-only.**

Run from the release worktree:

```bash
git status --short --untracked-files=all
git diff --check
git diff --name-only
```

Review that all source changes are under `packages/clutch-dsh-fireworks`, with only the allowed workspace lockfile and documentation plan/spec outside it. In particular, there must be no changes under DSH source packages or the existing `packages/clutch-dsh-worktree` implementation.

- [ ] **Step 5: Leave integration actions for the user.**

Do not run `npm publish`, `git push`, a release merge, or tag creation. Hand off the absolute package path and the exact source-install command after verification.

## Plan self-review

- Spec coverage: Task 1 covers the installable package; Task 2 covers the tool and persistence-safe Host-to-client signal; Tasks 3–5 cover emoji UI, SVG typing, and native `shell.overlay`; Task 6 covers bilingual docs and visual explanation; Task 7 covers the requested build/install readiness checks.
- Placeholder scan: all commands, file paths, package fields, public names, and code interfaces are concrete; no `TBD`, `TODO`, or unspecified implementation step is required.
- Type consistency: `FireworksSignal` feeds `FireworksRenderer`, `FireworksProjection` augments `SessionProjectionMap`, `createFireworksProjectionDefinition()` registers key `fireworks`, and `FireworksOverlay` reads that same key from `SessionSummary.projectionValues`.
