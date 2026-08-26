# Worktree Workspace Expand-State Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist Workspace, Main, and Worktree expansion choices in browser-local storage while keeping Session overflow expansion transient and leaving DSH source and data untouched.

**Architecture:** Add a focused browser-only worktree-expand-state.ts module that owns the JSON state shape, normalization, selectors, persistence key, and mutations over a DSH SnapshotStore. Create that store once in src/client/entry.ts and pass it through the existing shell.overlay injection; WorktreeSurface.tsx subscribes with useSyncExternalStore while the existing view-mode slot store remains unchanged. Ready Worktree snapshots prune only missing entity IDs, and parent toggles clear only the transient Session-group expansion records. Because the rc.8 browser runtime is loaded through `window.__ModuleLoader__`, production passes its official `createSnapshotStore` as an injected `SnapshotStoreFactory`; focused Node tests provide a persistence-capable test factory. Store creation retries without `persist` when persistence setup itself throws, preserving the required in-memory fallback.

**Tech Stack:** TypeScript, React useSyncExternalStore, DSH rc.8 createSnapshotStore, browser localStorage, Node's built-in test runner, pnpm workspace scripts.

## Global Constraints

- Use the browser-local key clutch-dsh-worktree.expand-state; do not reuse or change clutch-dsh-worktree.view-mode.
- Persist only collapsedWorkspaceIds, collapsedMainWorkspaceIds, and collapsedWorktreeIds; missing IDs mean expanded.
- Key Workspace and Main state by workspaceId; key Worktree state by worktreeId; never use display names, branch names, or array positions.
- Keep expandedSessionGroups in component memory; do not persist it, and clear affected group keys when a parent collapses.
- Prune expand-state only when readState.status === 'ready'; never prune during idle, loading, or error.
- A detached Worktree remains retained while it is present in the ready snapshot; prune it only after it disappears completely.
- localStorage parse, availability, quota, and write failures are non-fatal and must fall back to an in-memory store without a Worktree-domain error.
- Do not add a DSH API, RPC endpoint, sidecar field, Host/Manage/Provider import, or cross-tab storage listener.
- Do not modify the DSH source checkout or the package manifest; the existing rc.8 runtime dependency already provides createSnapshotStore.
- Do not stage generated lib/, coverage, screenshots, temporary files, or unrelated drafts.
- Keep the existing ready-projection refresh behavior, Worktree ordering, Session binding, and error surfaces unchanged.

## File Map

- Create: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts — browser-local state type, storage key, normalization, selectors, store factory, toggle actions, and the retain action used by ready-snapshot pruning.
- Create: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs — direct persistence, normalization, toggle, selector, and prune tests.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts — add the injected expand-state store contract.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/entry.ts — create one expand-state store per Client fiber and inject it into shell.overlay.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx — replace the three structural useState maps, subscribe to the store, clear transient Session groups on parent collapse, and prune only ready IDs.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-surface-selectors.ts — add a pure helper for removing transient Session-group keys without mutating the source record.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-composition.test.mjs — verify the new injected store is separate from the view-mode store and exposes the expected actions.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-surface-selectors.test.mjs — test transient Session-group key removal.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-surface.test.mjs — add source-level wiring and refresh/prune regression assertions.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/README.md — document browser-local structural expansion persistence and transient Session overflow.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/README.zh.md — keep the Chinese public behavior documentation synchronized.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/README.md — document the Client-side storage boundary and failure semantics.
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/docs/superpowers/drafts/2026-08-26-worktree-workspace-expand-state.md — mark the reconnaissance draft as resolved and link the confirmed spec.

---

### Task 1: Define the expand-state contract with failing tests

**Files:**

- Create: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs
- Create in Task 2: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts

**Interfaces:**

- Consumes: browser localStorage and the state identity rules in the confirmed spec.
- Produces: failing tests that define WORKTREE_EXPAND_STATE_STORAGE_KEY, WorktreeExpandState, WorktreeExpandStateStore, SnapshotStoreFactory, createWorktreeExpandStateStore, isWorkspaceExpanded, isMainExpanded, isWorktreeExpanded, and the toggle/retain action signatures.

- [ ] Step 1: Add the focused failing test file.

Create test/client-worktree-expand-state.test.mjs with this content:

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_EXPAND_STATE_STORAGE_KEY,
  createWorktreeExpandStateStore,
  isMainExpanded,
  isWorktreeExpanded,
  isWorkspaceExpanded,
} from '../lib/client/worktree-expand-state.js';

class MemoryStorage {
  #values = new Map();

  clear() {
    this.#values.clear();
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }
}

const storage = new MemoryStorage();

/** Test-only SnapshotStoreFactory; production passes the rc.8 runtime factory. */
function createSnapshotStore(initial, options) {
  let snapshot = initial;
  const subscribers = new Set();
  const persistName = options?.persist?.name;
  if (persistName !== undefined) {
    try {
      const raw = storage.getItem(persistName);
      if (raw !== null) snapshot = JSON.parse(raw);
    } catch {
      // Persistence is optional browser-local state.
    }
  }
  const persist = () => {
    if (persistName === undefined) return;
    try {
      storage.setItem(persistName, JSON.stringify(snapshot));
    } catch {
      // Persistence is optional browser-local state.
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    set: (next) => {
      snapshot = next;
      persist();
      for (const listener of subscribers) listener();
    },
    update: (mutator) => {
      const draft = structuredClone(snapshot);
      mutator(draft);
      snapshot = draft;
      persist();
      for (const listener of subscribers) listener();
    },
  };
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

test('defaults Workspace, Main, and Worktree rows to expanded', () => {
  storage.clear();
  const store = createWorktreeExpandStateStore(createSnapshotStore);

  assert.deepEqual(store.getSnapshot(), {
    collapsedWorkspaceIds: {},
    collapsedMainWorkspaceIds: {},
    collapsedWorktreeIds: {},
  });
  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-one'), true);
  assert.equal(isMainExpanded(store.getSnapshot(), 'ws-one'), true);
  assert.equal(isWorktreeExpanded(store.getSnapshot(), 'wt-one'), true);
});

test('toggles only the selected structural IDs and persists the exception records', () => {
  storage.clear();
  const store = createWorktreeExpandStateStore(createSnapshotStore);

  store.actions.toggleWorkspace('ws-one');
  store.actions.toggleMain('ws-one');
  store.actions.toggleWorktree('wt-one');

  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-one'), false);
  assert.equal(isMainExpanded(store.getSnapshot(), 'ws-one'), false);
  assert.equal(isWorktreeExpanded(store.getSnapshot(), 'wt-one'), false);
  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-two'), true);

  assert.deepEqual(JSON.parse(storage.getItem(WORKTREE_EXPAND_STATE_STORAGE_KEY)), {
    collapsedWorkspaceIds: { 'ws-one': true },
    collapsedMainWorkspaceIds: { 'ws-one': true },
    collapsedWorktreeIds: { 'wt-one': true },
  });

  store.actions.toggleWorkspace('ws-one');
  assert.equal(isWorkspaceExpanded(store.getSnapshot(), 'ws-one'), true);
  assert.equal(
    JSON.parse(storage.getItem(WORKTREE_EXPAND_STATE_STORAGE_KEY)).collapsedWorkspaceIds['ws-one'],
    undefined,
  );
});

test('rehydrates the independent key and normalizes malformed records', () => {
  storage.clear();
  storage.setItem(WORKTREE_EXPAND_STATE_STORAGE_KEY, JSON.stringify({
    collapsedWorkspaceIds: { kept: true, rejected: false, empty: true },
    collapsedMainWorkspaceIds: null,
    collapsedWorktreeIds: ['not-a-record'],
    unrelated: { shouldBeIgnored: true },
  }));

  const store = createWorktreeExpandStateStore(createSnapshotStore);

  assert.deepEqual(store.getSnapshot(), {
    collapsedWorkspaceIds: { kept: true, empty: true },
    collapsedMainWorkspaceIds: {},
    collapsedWorktreeIds: {},
  });
});

test('retains only IDs present in the ready Workspace and Worktree snapshots', () => {
  storage.clear();
  const store = createWorktreeExpandStateStore(createSnapshotStore);
  store.actions.toggleWorkspace('ws-kept');
  store.actions.toggleWorkspace('ws-deleted');
  store.actions.toggleMain('ws-kept');
  store.actions.toggleMain('ws-deleted');
  store.actions.toggleWorktree('wt-kept');
  store.actions.toggleWorktree('wt-deleted');

  store.actions.retain(['ws-kept'], ['wt-kept']);

  assert.deepEqual(store.getSnapshot(), {
    collapsedWorkspaceIds: { 'ws-kept': true },
    collapsedMainWorkspaceIds: { 'ws-kept': true },
    collapsedWorktreeIds: { 'wt-kept': true },
  });
});
~~~

- [ ] Step 2: Build and run the focused test to verify the intended missing-module failure.

From /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state, run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs
~~~

Expected: the build exits 0, then Node exits non-zero with an ERR_MODULE_NOT_FOUND for lib/client/worktree-expand-state.js. Do not implement the module before confirming the test is exercising the intended interface.

- [ ] Step 3: Commit the failing contract tests.

~~~bash
git add packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs
git commit -m "test(worktree): define expand-state persistence contract"
~~~

Do not stage generated lib/ output or the existing reconnaissance draft.

### Task 2: Implement the browser-local expand-state store

**Files:**

- Create: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts
- Test: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs

**Interfaces:**

- Consumes: the failing tests from Task 1 and the public rc.8 createSnapshotStore API.
- Produces: a WorktreeExpandStateStore that is both an observable SnapshotStore and exposes actions.toggleWorkspace, actions.toggleMain, actions.toggleWorktree, and actions.retain.

- [ ] Step 1: Add the focused module with the exact state and normalization logic.

Create src/client/worktree-expand-state.ts with this content:

~~~ts
import type {
  createSnapshotStore as runtimeCreateSnapshotStore,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client';

/** Browser-local storage identity; never sent to DSH or the plugin sidecar. */
export const WORKTREE_EXPAND_STATE_STORAGE_KEY = 'clutch-dsh-worktree.expand-state';

/** Persisted structural exceptions; absent IDs are expanded. */
export interface WorktreeExpandState {
  collapsedWorkspaceIds: Record<string, true>;
  collapsedMainWorkspaceIds: Record<string, true>;
  collapsedWorktreeIds: Record<string, true>;
}

/** The browser-facing mutation set for the expand-state store. */
export interface WorktreeExpandStateActions {
  toggleWorkspace: (workspaceId: string) => void;
  toggleMain: (workspaceId: string) => void;
  toggleWorktree: (worktreeId: string) => void;
  retain: (workspaceIds: readonly string[], worktreeIds: readonly string[]) => void;
}

/** Observable expand state plus browser-facing actions. */
export interface WorktreeExpandStateStore extends SnapshotStore<WorktreeExpandState> {
  readonly actions: WorktreeExpandStateActions;
}

export type SnapshotStoreFactory = typeof runtimeCreateSnapshotStore;

function emptyState(): WorktreeExpandState {
  return {
    collapsedWorkspaceIds: {},
    collapsedMainWorkspaceIds: {},
    collapsedWorktreeIds: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIds(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([id, collapsed]) => id.length > 0 && collapsed === true),
  );
}

/** Turn any persisted JSON value into the current state shape. */
export function normalizeWorktreeExpandState(value: unknown): WorktreeExpandState {
  const source = isRecord(value) ? value : {};
  return {
    collapsedWorkspaceIds: normalizeIds(source.collapsedWorkspaceIds),
    collapsedMainWorkspaceIds: normalizeIds(source.collapsedMainWorkspaceIds),
    collapsedWorktreeIds: normalizeIds(source.collapsedWorktreeIds),
  };
}

export function isWorkspaceExpanded(state: WorktreeExpandState, workspaceId: string): boolean {
  return state.collapsedWorkspaceIds[workspaceId] !== true;
}

export function isMainExpanded(state: WorktreeExpandState, workspaceId: string): boolean {
  return state.collapsedMainWorkspaceIds[workspaceId] !== true;
}

export function isWorktreeExpanded(state: WorktreeExpandState, worktreeId: string): boolean {
  return state.collapsedWorktreeIds[worktreeId] !== true;
}

function toggle(record: Record<string, true>, id: string): void {
  if (record[id] === true) delete record[id];
  else record[id] = true;
}

function retain(record: Record<string, true>, ids: readonly string[]): void {
  const allowed = new Set(ids);
  for (const id of Object.keys(record)) {
    if (!allowed.has(id)) delete record[id];
  }
}

/** Create one apply-scoped store; component remounts share this instance. */
export function createWorktreeExpandStateStore(
  snapshotStoreFactory: SnapshotStoreFactory,
): WorktreeExpandStateStore {
  let store: SnapshotStore<WorktreeExpandState>;
  try {
    store = snapshotStoreFactory<WorktreeExpandState>(emptyState(), {
      persist: { name: WORKTREE_EXPAND_STATE_STORAGE_KEY },
    });
  } catch {
    // A throwing browser storage getter can fail before runtime persistence's own guard.
    store = snapshotStoreFactory<WorktreeExpandState>(emptyState());
  }

  // Runtime persistence handles invalid JSON; normalize valid but wrong-shaped JSON.
  store.set(normalizeWorktreeExpandState(store.getSnapshot()));

  const actions: WorktreeExpandStateActions = {
    toggleWorkspace: (workspaceId) => {
      store.update((draft) => { toggle(draft.collapsedWorkspaceIds, workspaceId); });
    },
    toggleMain: (workspaceId) => {
      store.update((draft) => { toggle(draft.collapsedMainWorkspaceIds, workspaceId); });
    },
    toggleWorktree: (worktreeId) => {
      store.update((draft) => { toggle(draft.collapsedWorktreeIds, worktreeId); });
    },
    retain: (workspaceIds, worktreeIds) => {
      store.update((draft) => {
        retain(draft.collapsedWorkspaceIds, workspaceIds);
        retain(draft.collapsedMainWorkspaceIds, workspaceIds);
        retain(draft.collapsedWorktreeIds, worktreeIds);
      });
    },
  };

  return Object.assign(store, { actions });
}
~~~

- [ ] Step 2: Run typecheck, build, and the focused tests.

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs
~~~

Expected: typecheck and build exit 0; all six focused tests pass, including storage-failure fallback. The implementation must preserve input IDs, keep all records JSON-serializable, and leave unknown persisted fields out of the snapshot.

The focused test file also asserts the exact storage key and verifies that a persistence setup failure leaves a usable in-memory store.

- [ ] Step 3: Commit the store implementation.

~~~bash
git add packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts
git commit -m "feat(worktree): add browser-local expand-state store"
~~~

### Task 3: Inject the store and replace structural component state

**Files:**

- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts:1-70
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/entry.ts:1-170
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx:1-160,505-523,811-1020
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-composition.test.mjs
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-surface.test.mjs

**Interfaces:**

- Consumes: WorktreeExpandStateStore from Task 2.
- Produces: one apply-scoped expandState injection, useSyncExternalStore subscription in WorktreeSurface, and no structural useState<Record<string, boolean>> maps.

- [ ] Step 1: Add failing injection and surface-wiring assertions.

Append this test to test/client-composition.test.mjs:

~~~js
test('injects a separate structural expand-state store alongside view mode', async () => {
  const fixture = await loadClientEntry();
  const overlay = fixture.registrationsBySlot.get('shell.overlay');
  const injected = overlay.options.inject();
  const viewStore = overlay.options.store.create();

  assert.equal(typeof injected.expandState.getSnapshot, 'function');
  assert.equal(typeof injected.expandState.subscribe, 'function');
  assert.equal(typeof injected.expandState.actions.toggleWorkspace, 'function');
  assert.equal(typeof injected.expandState.actions.toggleMain, 'function');
  assert.equal(typeof injected.expandState.actions.toggleWorktree, 'function');
  assert.equal(typeof injected.expandState.actions.retain, 'function');
  assert.notEqual(injected.expandState, viewStore);

  for (const dispose of fixture.disposers.reverse()) dispose();
});
~~~

Append this source-level assertion to test/client-surface.test.mjs:

~~~js
test('uses the injected expand-state store for structural rows', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const types = await readFile(
    new URL('../src/client/worktree-surface-types.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /useSyncExternalStore/);
  assert.match(source, /expandState\\.actions\\.toggleWorkspace/);
  assert.match(source, /expandState\\.actions\\.toggleMain/);
  assert.match(source, /expandState\\.actions\\.toggleWorktree/);
  assert.match(source, /isWorkspaceExpanded/);
  assert.match(source, /isMainExpanded/);
  assert.match(source, /isWorktreeExpanded/);
  assert.doesNotMatch(source, /useState<Record<string, boolean>>/);
  assert.match(types, /WorktreeExpandStateStore/);
  assert.match(types, /readonly expandState:/);
});
~~~

Run from /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: build succeeds, then the new tests fail because expandState is not injected and the surface still owns the three local maps.

- [ ] Step 2: Add the injected store contract and create it once in apply().

In src/client/worktree-surface-types.ts, add the type-only import and injected field:

~~~ts
import type { WorktreeExpandStateStore } from './worktree-expand-state.js';

export interface WorktreeSurfaceInjected {
  readonly available: boolean;
  readonly expandState: WorktreeExpandStateStore;
  // existing fields remain unchanged
}
~~~

In src/client/entry.ts, add the import and create the store beside viewStore:

~~~ts
import { createWorktreeExpandStateStore } from './worktree-expand-state.js';

// existing code
const viewStore = createWorktreeViewStore();
const expandState = createWorktreeExpandStateStore(createSnapshotStore);
~~~

Add the same apply-scoped object to the existing shell.overlay injection without changing the slot's store: viewStore:

~~~ts
inject: () => ({
  available: true,
  expandState,
  hooks: { worktreeContext: contextProjection.store },
  manager,
  // existing injected callbacks remain unchanged
}),
~~~

Do not add expandState to the Sidebar footer registration; that slot still needs only the view-mode store.

- [ ] Step 3: Subscribe to the store and replace the three structural maps.

In src/client/WorktreeSurface.tsx, import useSyncExternalStore:

~~~ts
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
~~~

Destructure expandState from WorktreeSurface props and replace the three useState declarations with one synchronous snapshot:

~~~ts
const expandSnapshot = useSyncExternalStore(
  expandState.subscribe,
  expandState.getSnapshot,
  expandState.getSnapshot,
);
~~~

Replace the existing toggle functions with:

~~~ts
const toggleWorkspace = (workspaceId: string): void => {
  expandState.actions.toggleWorkspace(workspaceId);
};

const toggleMain = (workspaceId: string): void => {
  expandState.actions.toggleMain(workspaceId);
};

const toggleWorktree = (worktreeId: string): void => {
  expandState.actions.toggleWorktree(worktreeId);
};
~~~

At the existing render sites, use these selectors:

~~~ts
const expanded = isWorkspaceExpanded(expandSnapshot, workspace.workspaceId);
const mainExpanded = isMainExpanded(expandSnapshot, workspace.workspaceId);
const worktreeExpanded = isWorktreeExpanded(expandSnapshot, record.worktreeId);
~~~

Keep expandedSessionGroups as its existing local state. Do not change the five-row limit or its default-collapsed semantics in this task.

- [ ] Step 4: Run focused wiring tests and package checks.

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: typecheck exits 0, the injection test sees a distinct observable store, and the package test suite passes.

- [ ] Step 5: Commit the injection and structural-state wiring.

~~~bash
git add packages/clutch-dsh-worktree/src/client/worktree-surface-types.ts \
  packages/clutch-dsh-worktree/src/client/entry.ts \
  packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx \
  packages/clutch-dsh-worktree/test/client-composition.test.mjs \
  packages/clutch-dsh-worktree/test/client-surface.test.mjs
git commit -m "feat(worktree): persist structural expansion state"
~~~

### Task 4: Clear transient Session groups and prune only ready IDs

**Files:**

- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-surface-selectors.ts:1-80
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx:120-210,505-540,811-1118
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-surface-selectors.test.mjs
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-surface.test.mjs

**Interfaces:**

- Consumes: the expandedSessionGroups local record, viewByWorkspace, the ready readState, and expandState.actions.retain.
- Produces: deterministic parent-collapse cleanup and a refresh-safe prune effect.

- [ ] Step 1: Add failing pure-helper and source assertions.

Append this test to test/client-surface-selectors.test.mjs and import clearSessionGroupExpansion from ../lib/client/worktree-surface-selectors.js:

~~~js
test('clears only the transient Session groups belonging to a collapsed parent', () => {
  const current = {
    'main:ws-one': true,
    'worktree:wt-one': true,
    'worktree:wt-two': true,
    'main:ws-two': true,
  };

  assert.deepEqual(
    clearSessionGroupExpansion(current, ['main:ws-one', 'worktree:wt-one']),
    {
      'worktree:wt-two': true,
      'main:ws-two': true,
    },
  );
  assert.deepEqual(current, {
    'main:ws-one': true,
    'worktree:wt-one': true,
    'worktree:wt-two': true,
    'main:ws-two': true,
  });
});
~~~

Append this pure snapshot-completeness test to test/client-surface-selectors.test.mjs:

~~~js
test('requires the ready Worktree snapshot to cover the current Workspace ids', () => {
  assert.equal(
    isCompleteWorktreeWorkspaceSnapshot(
      ['workspace-one', 'workspace-two'],
      [{ workspaceId: 'workspace-one' }],
    ),
    false,
  );
  assert.equal(
    isCompleteWorktreeWorkspaceSnapshot(
      ['workspace-one', 'workspace-two'],
      [{ workspaceId: 'workspace-two' }, { workspaceId: 'workspace-one' }],
    ),
    true,
  );
});
~~~

Append this source-level test to test/client-surface.test.mjs:

~~~js
test('clears transient groups on parent collapse and prunes only ready snapshots', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /clearSessionGroupExpansion/);
  assert.match(source, /readState\.status !== 'ready'/);
  assert.match(source, /isCompleteWorktreeWorkspaceSnapshot/);
  assert.match(source, /expandState\.actions\.retain\(/);
  assert.match(source, /main:/);
  assert.match(source, /worktree:/);
  assert.doesNotMatch(source, /expandedSessionGroups.*localStorage/);
});
~~~

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: the selector tests fail until clearSessionGroupExpansion and isCompleteWorktreeWorkspaceSnapshot exist, and the source test fails until the surface contains the ready guard, completeness guard, and retain action.

- [ ] Step 2: Implement the pure transient-record helper.

Add this function to src/client/worktree-surface-selectors.ts:

~~~ts
export function clearSessionGroupExpansion(
  current: Readonly<Record<string, boolean>>,
  groupKeys: readonly string[],
): Record<string, boolean> {
  const next = { ...current };
  for (const key of groupKeys) delete next[key];
  return next;
}
~~~

The helper must return a new record and leave current unchanged, including when groupKeys is empty.

- [ ] Step 3: Clear transient groups when a structural parent collapses.

Import clearSessionGroupExpansion and the three expand selectors in WorktreeSurface.tsx. Replace the structural toggle functions with:

~~~ts
const clearSessionGroups = (groupKeys: readonly string[]): void => {
  if (groupKeys.length === 0) return;
  setExpandedSessionGroups((current) => clearSessionGroupExpansion(current, groupKeys));
};

const toggleWorkspace = (workspaceId: string): void => {
  const wasExpanded = isWorkspaceExpanded(expandSnapshot, workspaceId);
  expandState.actions.toggleWorkspace(workspaceId);
  if (!wasExpanded) return;
  const worktreeIds = viewByWorkspace.get(workspaceId)?.worktrees
    .map((record) => record.worktreeId) ?? [];
  clearSessionGroups([
    'main:' + workspaceId,
    ...worktreeIds.map((worktreeId) => 'worktree:' + worktreeId),
  ]);
};

const toggleMain = (workspaceId: string): void => {
  const wasExpanded = isMainExpanded(expandSnapshot, workspaceId);
  expandState.actions.toggleMain(workspaceId);
  if (wasExpanded) clearSessionGroups(['main:' + workspaceId]);
};

const toggleWorktree = (worktreeId: string): void => {
  const wasExpanded = isWorktreeExpanded(expandSnapshot, worktreeId);
  expandState.actions.toggleWorktree(worktreeId);
  if (wasExpanded) clearSessionGroups(['worktree:' + worktreeId]);
};
~~~

The existing viewByWorkspace memo is already available before these callbacks are invoked. Preserve structural child preferences when a parent closes; only transient Session-group records are deleted.

- [ ] Step 4: Add the ready-only prune effect.

Add this effect after viewByWorkspace is available and before render derives visible rows:

~~~ts
useEffect(() => {
  if (
    readState.status !== 'ready' ||
    !isCompleteWorktreeWorkspaceSnapshot(workspaceIds, readState.views)
  ) return;
  expandState.actions.retain(
    workspaceIds,
    readState.views.flatMap((view) =>
      view.worktrees.map((record) => record.worktreeId),
    ),
  );
}, [expandState, readState.status, readState.views, workspaceIds]);
~~~

Do not prune until the ready views cover the current Workspace ID set; a stale ready snapshot from before a Workspace-list update is not complete. Do not derive the Worktree allowlist from visibleWorkspaces, the search result, or only active Worktrees. Use every Worktree in the complete ready snapshot so detached rows remain retained.

- [ ] Step 5: Run focused tests and commit the lifecycle behavior.

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: the selector helper test, ready-guard source test, existing refresh-preservation tests, and the full package suite all pass.

~~~bash
git add packages/clutch-dsh-worktree/src/client/worktree-surface-selectors.ts \
  packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx \
  packages/clutch-dsh-worktree/test/client-surface-selectors.test.mjs \
  packages/clutch-dsh-worktree/test/client-surface.test.mjs
git commit -m "fix(worktree): reset transient groups on collapse"
~~~

### Task 5: Update public documentation and the reconnaissance draft

**Files:**

- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/README.md
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/README.zh.md
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/README.md
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/docs/superpowers/drafts/2026-08-26-worktree-workspace-expand-state.md
- Modify: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-surface.test.mjs

**Interfaces:**

- Consumes: the confirmed behavior implemented in Tasks 2–4.
- Produces: synchronized English/Chinese public behavior documentation and a draft that points to the confirmed spec.

- [ ] Step 1: Add failing documentation assertions.

Extend the first documentation test in test/client-surface.test.mjs with the missing Chinese README read and these assertions:

~~~js
const readmeZh = await readFile(new URL('../README.zh.md', import.meta.url), 'utf8');
assert.match(readme, /browser-local.*expansion|expansion.*browser-local/i);
assert.match(readme, /Session.*overflow.*transient|Session.*five-row.*refresh/i);
assert.match(readmeZh, /浏览器本地.*展开|展开.*浏览器本地/);
assert.match(readmeZh, /Session.*临时|五行.*刷新/);
assert.match(clientReadme, /browser-local.*expansion|浏览器本地.*展开/i);
~~~

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: only the new documentation assertions fail before the copy is added.

- [ ] Step 2: Add synchronized English and Chinese public copy.

Add this English capability bullet to README.md:

~~~md
- Persist Workspace, Main, and Worktree expansion choices in browser-local storage; the five-row Session overflow state remains transient and resets after refresh or parent collapse.
~~~

Add this Chinese capability bullet to the corresponding capability list in README.zh.md:

~~~md
- 将 Workspace、Main 和 Worktree 的展开选择保存到浏览器本地存储；Session 五行溢出展开保持临时状态，并在刷新或父级折叠后重置。
~~~

Add this English section to src/client/README.md near the Worktree surface contract:

~~~md
### Browser-local expansion state

The Client persists Workspace, Main, and Worktree expansion exceptions under
clutch-dsh-worktree.expand-state in browser-local storage. Missing IDs are
expanded by default. The five-row Session overflow control remains transient,
and parent collapse clears its affected temporary group state. Storage failure
falls back to in-memory behavior and does not change DSH or sidecar data.
~~~

Keep command names, storage key, ID names, and source-of-truth wording identical across the bilingual root README files. The implementation-boundary README remains English, matching its existing style.

- [ ] Step 3: Resolve the reconnaissance draft.

Change the draft header to:

~~~md
**状态：** 已完成调研，设计已确认；实现计划见 docs/superpowers/plans/2026-08-26-worktree-workspace-expand-state.md
~~~

Replace its native “待调研” section with a completed finding that records dsh.workspace.view.v5, Workspace-ID keying, and transient five-row Session overflow behavior. Keep the current-plugin observations and acceptance bullets as historical context; do not remove them.

- [ ] Step 4: Run README parity and package tests.

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: the README parity test and all package tests pass; the English and Chinese heading shapes remain unchanged.

- [ ] Step 5: Commit the documentation slice.

~~~bash
git add packages/clutch-dsh-worktree/README.md \
  packages/clutch-dsh-worktree/README.zh.md \
  packages/clutch-dsh-worktree/src/client/README.md \
  packages/clutch-dsh-worktree/docs/superpowers/drafts/2026-08-26-worktree-workspace-expand-state.md \
  packages/clutch-dsh-worktree/test/client-surface.test.mjs
git commit -m "docs(worktree): document persistent expansion state"
~~~

### Task 6: Run final package and workspace verification

**Files:**

- Inspect: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/worktree-expand-state.ts
- Inspect: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/entry.ts
- Inspect: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx
- Inspect: /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state/packages/clutch-dsh-worktree/test/client-worktree-expand-state.test.mjs

**Interfaces:**

- Consumes: all committed implementation and documentation slices from Tasks 1–5.
- Produces: a clean, verified feature worktree with no DSH source or generated artifacts staged.

- [ ] Step 1: Run package typecheck, build, and tests.

From /private/tmp/clutch-dsh-wt-worktree-0.1.6-expand-state, run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: every command exits 0. The package test runs its own build first and exercises the generated client closure, direct expand-state store, surface selectors, refresh behavior, composition, and README parity.

- [ ] Step 2: Run workspace checks.

~~~bash
pnpm run check:workspace
pnpm run check:patches
pnpm run check
~~~

Expected: every command exits 0. If a script is unavailable in the current planning-stage workspace, report the exact missing script instead of adding an artificial implementation.

- [ ] Step 3: Run diff and status checks.

~~~bash
git diff --check
git status --short --branch
git diff wt-worktree-0.1.6/release...HEAD -- packages/clutch-dsh-worktree/src/client packages/clutch-dsh-worktree/test packages/clutch-dsh-worktree/README.md packages/clutch-dsh-worktree/README.zh.md
~~~

Expected: no whitespace errors; only the intended plugin Client, tests, docs, and plan/spec files are changed; no DSH checkout, Host/Manage/Provider code, sidecar schema, lib/, coverage, or temporary files appear in the diff.

- [ ] Step 4: Do not create a synthetic verification commit.

If all previous task commits are present and clean, hand off the existing scoped commits and exact command results. Any release aggregation remains outside this plan and requires the separate release-worktree workflow.

## Plan Self-Review

- Spec coverage: browser-local boundary and no-DSH-change rule are covered by Tasks 2, 3, and 6; the three persisted structural layers by Tasks 1–3; transient Session-group reset by Task 4; ready-only pruning and detached retention by Tasks 1 and 4; storage failure and normalization by Tasks 1–2; public documentation by Task 5; final verification by Task 6.
- Placeholder scan: every step has concrete paths, signatures, code snippets, commands, expected results, and commit messages; the plan does not rely on unspecified implementation or error-handling steps.
- Type consistency: WorktreeExpandStateStore is created by createWorktreeExpandStateStore with a SnapshotStoreFactory, injected as expandState, exposes getSnapshot/subscribe plus the four named actions, and is consumed by the exact selectors and effects described in Tasks 3–4. Production passes the official rc.8 factory; tests pass a persistence-capable test factory; persistence setup failure retries without persist.
- Scope check: this is one browser-state subsystem with pure store, surface wiring, transient cleanup, docs, and tests; it does not require a separate DSH, Host, or sidecar project.
