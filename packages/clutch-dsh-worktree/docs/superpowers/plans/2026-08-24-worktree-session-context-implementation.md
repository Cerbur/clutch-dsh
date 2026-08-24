# Worktree Session Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one browser-local Main branch or active Worktree branch context in the active native Conversation title row: `Session title → Agent mode → branch / Worktree`.

**Architecture:** Add a Client-fiber-scoped Worktree context projection to this plugin, with one pure resolver and one cancellable snapshot store consumed by the existing Session-header action list and a plugin-only Hero title overlay. The plugin reuses the existing `/api` WorktreeManager and browser-local membership projection; it does not modify native DSH data or replace native Conversation components.

**Scope correction (2026-08-24):** the user approved the plugin-only `shell.overlay` approach for the blank Hero after the initial design exposed that the current DSH release has no additive Hero seat. The overlay is a visual fallback anchored to the native `[data-phase="hero"]` headline; it is not a `conversation.hero.context` slot and must be removed or replaced when DSH provides a stable Hero headline extension point.

## Current execution checklist

- [x] Keep the native DSH repository out of the implementation; its `master` tree contains no Hero-slot change.
- [x] Resolve the current Session to the Main branch or active Worktree branch through one pure resolver.
- [x] Share one cancellable browser-local projection between the plugin entry and the Session-header consumer.
- [x] Register `conversation.session.header.actions` at order `-5` and compose the Hero suffix through the existing `shell.overlay` entry.
- [x] Resolve `recentWorkspaceId` for a cold Hero without a current Session and update the suffix after Workspace changes.
- [x] Document that the Hero context is a visual plugin-only overlay, not a native Hero slot.
- [x] Verify resolver, stale-response, invalidation, disposal, composition, typecheck, build, lint, formatting, workspace, patch, and package tests.

The detailed Task 1–Task 7 sections below are retained as historical design
material from the superseded two-placement proposal. They are not execution
instructions for the current plugin-only scope; the checklist above and the
current source/tests are authoritative.

**Tech Stack:** TypeScript, React 18, DSH SlotMap/SlotRegistry, DSH `SnapshotStore`, existing WorktreeManager `/api` adapter, CSS Modules, Vitest in DSH, Node test runner in `clutch-dsh`.

## Global Constraints

- Preserve the active title-row order: `Session title → Agent mode → branch / Worktree`.
- Main context is the current `BranchRecord` where `isCurrent === true`; active Worktree context is `WorktreeRecord.branch`.
- Missing, stale, detached, repair, mismatched, or not-yet-ready context renders no label; never retain a previous Session's label or infer a Worktree from cwd alone.
- Context labels are read-only and must not mutate DSH Workspace data, Session metadata, cwd, transcripts, Git state, or sidecar records.
- Do not modify native DSH source, hijack `conversation.hero.workspace`, replace `conversation.hero.agentPreset`, or replace `conversation.session.header`. The approved Hero fallback may position its own read-only suffix through `shell.overlay` DOM queries; it must never mutate the native nodes or Workspace/Session data.
- The active Session-header consumer owns the one projection/resolver and one request-generation/disposal policy; rendering must not issue an RPC per render, and late responses must not overwrite newer state.
- Keep branch and Worktree values raw; localize only accessible prefixes and UI status copy.
- Use `apply_patch` for local source, tests, documentation, and plan edits. Do not stage the existing untracked `docs/superpowers/drafts/` directory.
- Each task ends with its focused tests and a small commit; generated `lib/`, coverage, sidecar data, credentials, and temporary fixtures stay untracked.

---

## File map and ownership

The plugin implementation belongs to this package:

- Create `src/client/worktree-context.ts` — pure context value types and the deterministic Session → Main/Worktree resolver.
- Create `src/client/worktree-context-store.ts` — Client-fiber-scoped async projection, cache invalidation, request generation, and disposal.
- Create `src/client/WorktreeContext.tsx` — shared read-only label plus the Session-header action consumer.
- Create `src/client/worktree-context.css` — scoped header-label presentation.
- Modify `src/client/entry.ts` — create/dispose the projection and register the Session-header consumer only.
- Modify `src/client/WorktreeSurface.tsx` — invalidate the shared projection after Worktree/binding mutations and full Worktree reads.
- Modify `src/client/worktree-view.ts` — expose the existing single-Workspace Worktree read shape to the projection without duplicating Manager read logic.
- Modify `src/client/locales.ts` — add localized accessible context labels.
- Modify `package.json` — inject and type against `@deepseek-ai/dsh-client-ui-conversation`; align its native compatibility version after the DSH slot lands.
- Modify `src/client/README.md` and `README.md` — document the active Session-header location, read-only semantics, and native compatibility prerequisite.
- Create `test/worktree-context.test.mjs` — pure resolver cases.
- Create `test/worktree-context-store.test.mjs` — async refresh, stale response, invalidation, and disposal cases.
- Modify `test/client-composition.test.mjs`, `test/client-surface.test.mjs`, and add context tests — slot registration, order, locale, resolver, projection, and no-overlay regression assertions.

The plan deliberately does not modify the existing Worktree contract or Remote
method list: branch and binding data already exist in the stable contract.

## Task 1: Native Hero context seat — superseded (historical)

This task is intentionally not executed. The current plugin-only scope does not
modify `/Users/yuancheng/Documents/Code/deepseek-harness` and does not require a
`conversation.hero.context` slot. The native working-tree change was reverted
locally before plugin implementation continued. The active implementation begins
at Task 2 below; references to a Hero consumer in the historical task text are
retained only as design history and are not acceptance criteria.

**Repository:** `/Users/yuancheng/Documents/Code/deepseek-harness`

**Files:**

- Modify: `/Users/yuancheng/Documents/Code/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts`
- Modify: `/Users/yuancheng/Documents/Code/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`
- Modify: `/Users/yuancheng/Documents/Code/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`
- Test: `/Users/yuancheng/Documents/Code/deepseek-harness/packages/client/ui-conversation/tests/chat-apply.client.spec.tsx`
- Test: `/Users/yuancheng/Documents/Code/deepseek-harness/packages/client/ui-conversation/tests/skeleton.client.spec.tsx`

**Interfaces:**

- Consumes: the existing root-scoped `conversation.hero.workspace` and `conversation.hero.agentPreset` seats.
- Produces: a declared root-scoped additive `conversation.hero.context` list that renders after Agent preset and is available to independently loaded Client plugins.

- [ ] **Step 1: Add failing native slot-ledger and order tests.**

In `chat-apply.client.spec.tsx`, extend the existing `occupies the slots`
test with the exact contract assertion:

~~~ts
expect(b.slots.spec('conversation.hero.context')).toEqual({
  kind: 'list',
  scope: 'root',
})
~~~

In `skeleton.client.spec.tsx`, make the render fixture return a distinct
marker for the three Hero row slots and assert their order:

~~~ts
expect(b.slotCalls).toEqual(expect.arrayContaining([
  'conversation.hero.workspace',
  'conversation.hero.agentPreset',
  'conversation.hero.context',
]))
expect(b.slotCalls.indexOf('conversation.hero.workspace'))
  .toBeLessThan(b.slotCalls.indexOf('conversation.hero.agentPreset'))
expect(b.slotCalls.indexOf('conversation.hero.agentPreset'))
  .toBeLessThan(b.slotCalls.indexOf('conversation.hero.context'))
~~~

Keep the assertion scoped to the Hero render path so a registration that is
never rendered cannot satisfy the test.

- [ ] **Step 2: Run the native focused tests and verify RED.**

Run from `/Users/yuancheng/Documents/Code/deepseek-harness`:

~~~bash
pnpm exec vitest run \
  packages/client/ui-conversation/tests/chat-apply.client.spec.tsx \
  packages/client/ui-conversation/tests/skeleton.client.spec.tsx
~~~

Expected: FAIL because rc.8 does not declare `conversation.hero.context` and
`ConversationRoot` does not render the slot.

- [ ] **Step 3: Declare the native slot and owner type.**

In `contract/slots.ts`, add a root-scoped list entry beside the existing Hero
seats and add it to `ConversationSlotProps`:

~~~ts
'conversation.hero.context': {
  kind: 'list'
  scope: 'root'
  owner: HeroContextOwnerProps
}

export interface HeroContextOwnerProps {}
~~~

The owner share stays empty so the plugin receives its browser-local projection
through its own `inject` face rather than through native Conversation data.

- [ ] **Step 4: Add the slot to native assembly and render it after Agent preset.**

In `apply.ts`, add the child declaration:

~~~ts
'conversation.hero.context': { kind: 'list', scope: 'root' },
~~~

In `ConversationRoot.tsx`, keep the existing Workspace and Agent preset calls
unchanged and append the context render directly after the Agent preset:

~~~tsx
{renderSlot('conversation.hero.context', {})}
~~~

This is the only new render line: leave the existing Workspace owner object and
the existing `conversation.hero.workspace` and
`conversation.hero.agentPreset` calls unchanged, then append this line
immediately after Agent preset. Do not change Workspace picker behavior or Hero
layout ownership.

- [ ] **Step 5: Run the native tests and verify GREEN.**

Run the same focused Vitest command from Step 2. Expected: PASS, including the
new slot spec and render-order assertions.

- [ ] **Step 6: Commit the native prerequisite in its own repository.**

Run from `/Users/yuancheng/Documents/Code/deepseek-harness`:

~~~bash
git add packages/client/ui-conversation/src/client/contract/slots.ts \
  packages/client/ui-conversation/src/client/apply.ts \
  packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx \
  packages/client/ui-conversation/tests/chat-apply.client.spec.tsx \
  packages/client/ui-conversation/tests/skeleton.client.spec.tsx
git commit -m "feat(ui-conversation): add Hero context slot"
~~~

Record the resulting native package version for Task 6; do not publish or push
from this task.

## Task 2: Define and test the pure Session context resolver

**Files:**

- Create: `src/client/worktree-context.ts`
- Test: `test/worktree-context.test.mjs`

**Interfaces:**

- Consumes: `BranchRecord`, `SessionBinding`, and `WorktreeRecord` from `src/contract/index.ts`, plus structural DSH Session/Workspace snapshots.
- Produces: `WorktreeSessionContext` and `resolveWorktreeSessionContext(input)`, used by the async store and both UI consumers.

- [ ] **Step 1: Write the failing resolver tests.**

Create Node tests importing the built module:

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorktreeSessionContext } from '../lib/client/worktree-context.js';

const workspace = (sessionIds) => ({ workspaceId: 'ws1', sessionIds });
const branch = (name, isCurrent = false) => ({ name, isCurrent, checkedOut: false });
const worktree = (status = 'active') => ({
  worktreeId: 'wt1', workspaceId: 'ws1', absolutePath: '/tmp/wt1',
  branch: 'feature/context', status,
});
const binding = (status = 'active') => ({
  workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1', status,
});

test('resolves Main to the current local branch', () => {
  assert.deepEqual(resolveWorktreeSessionContext({
    currentSessionId: 's1',
    workspaces: [workspace(['s1'])],
    branches: [branch('main', true)],
    worktrees: [],
    bindings: [],
  }), { kind: 'main', workspaceId: 'ws1', label: 'main', source: 'current-branch' });
});

test('resolves an active binding to the Worktree branch', () => {
  assert.deepEqual(resolveWorktreeSessionContext({
    currentSessionId: 's1',
    workspaces: [workspace(['s1'])],
    branches: [branch('main', true)],
    worktrees: [worktree()],
    bindings: [binding()],
  }), { kind: 'worktree', workspaceId: 'ws1', worktreeId: 'wt1',
    label: 'feature/context', source: 'active-binding' });
});

test('does not classify detached, missing, mismatched, or stale data as Main', () => {
  const result = resolveWorktreeSessionContext({
    currentSessionId: 's1',
    workspaces: [workspace(['s1'])],
    branches: [branch('main', true)],
    worktrees: [worktree('removed')],
    bindings: [binding('detached')],
  });
  assert.equal(result.kind, 'none');
});

test('returns no-session and unbound states without a label', () => {
  assert.equal(resolveWorktreeSessionContext({
    currentSessionId: undefined, workspaces: [], branches: [], worktrees: [], bindings: [],
  }).kind, 'none');
  assert.equal(resolveWorktreeSessionContext({
    currentSessionId: 's1', workspaces: [], branches: [branch('main', true)],
    worktrees: [], bindings: [],
  }).kind, 'none');
});
~~~

Add explicit cases for no current branch, Workspace mismatch, missing Worktree
record, and an active binding whose record is `removed`; each must return a
typed `kind: 'none'` reason rather than a fallback label.

- [ ] **Step 2: Run the resolver tests and verify RED.**

Run from this package directory:

~~~bash
pnpm run build
pnpm exec node --test test/worktree-context.test.mjs
~~~

Expected: FAIL with module-not-found or missing-export errors because the pure
resolver does not exist yet.

- [ ] **Step 3: Define the structural input/output types and resolver.**

Add the following stable shape to `src/client/worktree-context.ts`:

~~~ts
export type WorktreeSessionContext =
  | { readonly kind: 'main'; readonly workspaceId: string; readonly label: string; readonly source: 'current-branch' }
  | { readonly kind: 'worktree'; readonly workspaceId: string; readonly worktreeId: string; readonly label: string; readonly source: 'active-binding' }
  | { readonly kind: 'none'; readonly reason: 'no-session' | 'not-ready' | 'unbound' | 'detached' | 'repair' | 'stale' | 'workspace-mismatch' };

export interface WorktreeContextInput {
  readonly currentSessionId?: string;
  readonly workspaces: readonly { readonly workspaceId: string; readonly sessionIds: readonly string[] }[];
  readonly branches: readonly BranchRecord[];
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
}

export function resolveWorktreeSessionContext(
  input: WorktreeContextInput,
): WorktreeSessionContext;
~~~

Implement the decision order exactly:

1. No current Session → `none/no-session`.
2. Find the Workspace whose native or browser-local membership contains the
   current Session; absence → `none/unbound`.
3. If a binding exists for the Session, require matching `workspaceId`,
   `status === 'active'`, a matching active `WorktreeRecord`, and a non-empty
   `branch`; otherwise return `none` with the relevant reason.
4. If no binding exists, require a non-empty `BranchRecord.name` where
   `isCurrent === true`; return Main with that raw name.
5. Never inspect cwd to infer a Worktree or reuse a previous context.

- [ ] **Step 4: Run the resolver tests and verify GREEN.**

Run:

~~~bash
pnpm run build
pnpm exec node --test test/worktree-context.test.mjs
~~~

Expected: all resolver cases PASS.

- [ ] **Step 5: Commit the pure context contract.**

~~~bash
git add src/client/worktree-context.ts test/worktree-context.test.mjs
git commit -m "feat(worktree): add session context resolver"
~~~

## Task 3: Build the shared cancellable Client projection

**Files:**

- Create: `src/client/worktree-context-store.ts`
- Test: `test/worktree-context-store.test.mjs`
- Modify: `src/client/worktree-view.ts`

**Interfaces:**

- Consumes: `resolveWorktreeSessionContext`, `WorktreeManager`, the existing `loadWorktreeView()` three-way read, and DSH `ObservableSnapshot` stores.
- Produces: `createWorktreeContextProjection(input)`, a `SnapshotStore<WorktreeContextState>` plus `refresh`, `invalidate`, and `dispose` methods for `entry.ts` and `WorktreeSurface`.

- [ ] **Step 1: Write failing async projection tests.**

Use controllable deferred Manager promises and a small fake Session/Workspace
snapshot store. Cover the required lifecycle:

~~~js
test('refreshes the current Session context from one Workspace read', async () => {
  const manager = managerWith({
    worktrees: [activeWorktree('feature/context')],
    branches: [currentBranch('main')],
    bindings: [activeBinding('s1', 'wt1')],
  });
  const projection = createWorktreeContextProjection({
    sessions: snapshot({ current: 's1', byId: { s1: {} } }),
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  await projection.refresh();

  assert.deepEqual(projection.store.getSnapshot().value, {
    kind: 'worktree', workspaceId: 'ws1', worktreeId: 'wt1',
    label: 'feature/context', source: 'active-binding',
  });
  assert.equal(manager.calls.listWorktrees, 1);
  assert.equal(manager.calls.listBranches, 1);
  assert.equal(manager.calls.listBindings, 1);
});

test('late data for the previous Session cannot overwrite the current Session', async () => {
  const first = deferred();
  const second = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {}, s2: {} } });
  const projection = projectionWithSequencedReads({ sessions, reads: [first, second] });

  const firstRefresh = projection.refresh();
  sessions.set({ current: 's2', byId: { s1: {}, s2: {} } });
  const secondRefresh = projection.refresh();
  second.resolve(dataFor('s2', 'feature/two'));
  await secondRefresh;
  first.resolve(dataFor('s1', 'feature/one'));
  await firstRefresh;

  assert.equal(projection.store.getSnapshot().sessionId, 's2');
  assert.equal(projection.store.getSnapshot().value.label, 'feature/two');
});

test('dispose aborts/ignores in-flight reads and clears visible context', async () => {
  const pending = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const projection = projectionWithPendingRead({ sessions, pending });
  const refresh = projection.refresh();
  projection.dispose();
  pending.resolve(dataFor('s1', 'main'));
  await refresh;
  assert.equal(projection.store.getSnapshot().value.kind, 'none');
});
~~~

Also cover `invalidate('ws1')`, binding failure, no current Session, branch
refresh, and manager error. A manager error must produce `value.kind ===
'none'` with a retryable store error; it must never produce a Main label.

- [ ] **Step 2: Run the store tests and verify RED.**

Run:

~~~bash
pnpm run build
pnpm exec node --test test/worktree-context-store.test.mjs
~~~

Expected: FAIL because the projection factory and store do not exist yet.

- [ ] **Step 3: Define the projection state and factory.**

Use DSH's React-free store primitive instead of adding a new event system:

~~~ts
export interface WorktreeContextState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly sessionId?: string;
  readonly value: WorktreeSessionContext;
  readonly error?: WorktreeViewError;
}

export interface WorktreeContextProjection {
  readonly store: SnapshotStore<WorktreeContextState>;
  refresh(): Promise<void>;
  invalidate(workspaceId?: string): Promise<void>;
  dispose(): void;
}
~~~

Before the async tests, define these test-local helpers; they are not
production exports: `snapshot<T>(initial)` returns a small mutable
`SnapshotStore<T>` fake with `getSnapshot`, `subscribe`, and `set`;
`managerWith({ worktrees, branches, bindings })` returns a
`WorktreeManager` fake whose `listWorktrees`, `listBranches`, and
`listBindings` methods return those values and whose `calls` object counts
each method; `deferred<T>()` returns
`{ promise, resolve(value) }`; `activeWorktree(name)`,
`currentBranch(name)`, and `activeBinding(sessionId, worktreeId)` return
the structural records used by the resolver tests; and `dataFor(sessionId,
branchName)` returns the three Manager-read results needed for one
`WorktreeViewData` fixture. `projectionWithSequencedReads({ sessions,
reads })` and `projectionWithPendingRead({ sessions, pending })` construct
the real projection with a Manager fake whose `loadWorktreeView` reads are
resolved by the supplied deferred values. Keep all helpers in
`test/worktree-context-store.test.mjs`.

Implement `createWorktreeContextProjection` with these exact rules:

- Subscribe once to `sessions` and `workspaces`; schedule a refresh when either
  snapshot changes. Deduplicate same-tick schedules.
- Read the current Session and its owning Workspace before calling Manager.
- Call the existing `loadWorktreeView(manager, workspaceId)` so Worktree,
  branch, and binding reads keep one error/readiness interpretation.
- Store `status: 'loading'`, `sessionId`, and `none/not-ready` before a new read;
  do not retain the previous label while identity changes.
- Increment a generation for every refresh. Apply a result only when the
  generation, current Session ID, and Workspace ID still match.
- `invalidate(workspaceId)` increments the generation and refreshes the current
  Workspace if it matches; otherwise it is a no-op. Resolve it after the latest
  refresh settles so mutation callers can await a deterministic update.
- `dispose()` marks the projection closed, unsubscribes from both snapshots, and
  ignores late results. The existing `manager.dispose()` remains the owner of
  aborting Connection signals.

Expose the pure resolver rather than duplicating the Main/Worktree decision
inside the store.

- [ ] **Step 4: Refactor only the shared read seam in `worktree-view.ts`.**

Keep `loadWorktreeView()` as the one function that turns the three Manager
calls into `WorktreeViewData`. If the projection needs a structural type, export
that existing result type instead of copying these fields. Do not change the
Remote method list or WorktreeManager contract.

- [ ] **Step 5: Run the store tests and verify GREEN.**

Run:

~~~bash
pnpm run build
pnpm exec node --test test/worktree-context-store.test.mjs
~~~

Expected: all refresh, stale-response, invalidation, error, and disposal cases
PASS.

- [ ] **Step 6: Commit the shared projection.**

~~~bash
git add src/client/worktree-context-store.ts src/client/worktree-view.ts \
  test/worktree-context-store.test.mjs
git commit -m "feat(worktree): add shared context projection"
~~~

## Task 4: Implement the two read-only context consumers

**Files:**

- Create: `src/client/WorktreeContext.tsx`
- Create: `src/client/worktree-context.css`
- Modify: `src/client/locales.ts`
- Test: `test/client-context.test.mjs`

**Interfaces:**

- Consumes: `WorktreeContextState`, the injected `SnapshotStore`, `PropsRuntime` for the Hero/header slots, and `PropsLocale<typeof WORKTREE_NS>`.
- Produces: `WorktreeHeroContext` for `conversation.hero.context` and `WorktreeHeaderContext` for `conversation.session.header.actions`, both backed by the same `WorktreeContextLabel` presentation primitive.

- [ ] **Step 1: Add failing source/component contract tests.**

Create `test/client-context.test.mjs` with assertions that protect the actual
slot/UI boundary:

~~~js
test('defines both context consumers without using shell overlay or a menu', async () => {
  const source = await readFile(new URL('../src/client/WorktreeContext.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/client/worktree-context.css', import.meta.url), 'utf8');

  assert.match(source, /WorktreeHeroContext/);
  assert.match(source, /WorktreeHeaderContext/);
  assert.match(source, /useWorktreeContext/);
  assert.match(source, /conversation\.hero\.context/);
  assert.match(source, /conversation\.session\.header\.actions/);
  assert.doesNotMatch(source, /Menu/);
  assert.doesNotMatch(source, /querySelector|document\.querySelector|shell\.overlay/);
  assert.match(css, /contextLabel/);
  assert.match(css, /text-overflow: ellipsis/);
});

test('keeps branch values raw and routes accessible prefixes through locale keys', async () => {
  const source = await readFile(new URL('../src/client/WorktreeContext.tsx', import.meta.url), 'utf8');
  const locale = await readFile(new URL('../src/client/locales.ts', import.meta.url), 'utf8');
  assert.match(source, /label/);
  assert.match(source, /aria-label/);
  assert.match(locale, /context\.main/);
  assert.match(locale, /context\.worktree/);
});
~~~

- [ ] **Step 2: Run the focused context tests and verify RED.**

Run:

~~~bash
pnpm exec node --test test/client-context.test.mjs
~~~

Expected: FAIL because the two components, CSS module, and locale keys do not
exist.

- [ ] **Step 3: Add the shared label and slot-specific wrappers.**

Define the injected face once:

~~~tsx
interface WorktreeContextInjected {
  hooks: {
    worktreeContext: SnapshotStore<WorktreeContextState>;
  };
}

function WorktreeContextLabel({
  value,
  variant,
  t,
}: {
  value: WorktreeSessionContext;
  variant: 'hero' | 'header';
  t: WorktreeTranslate;
}) {
  if (value.kind === 'none') return null;
  const ariaLabel = value.kind === 'main'
    ? t('context.main', { name: value.label })
    : t('context.worktree', { name: value.label });
  return (
    <span className={variant === 'hero' ? styles.heroContext : styles.headerContext}
      title={value.label} aria-label={ariaLabel}>
      <IconBranchOutline16 size={variant === 'hero' ? 16 : 14} aria-hidden="true" />
      <span className={styles.contextLabel}>{value.label}</span>
    </span>
  );
}
~~~

`WorktreeHeroContext` reads the shared snapshot and returns the Hero variant.
`WorktreeHeaderContext` reads the snapshot, verifies that the projection's
`sessionId` equals its injected `sessionId`, and returns the header variant;
otherwise it returns `null`. Neither wrapper owns a fetch, menu, click handler,
or local copy of the resolver.

- [ ] **Step 4: Add localized accessibility keys and scoped CSS.**

Add these keys to both `zh` and `en` dictionaries, preserving the raw
branch value:

~~~ts
'context.main': '当前分支：{name}',
'context.worktree': 'Worktree：{name}',
~~~

Use the English equivalents `Current branch: {name}` and `Worktree: {name}`.
The Hero wrapper should mirror the native Agent preset seat's inline 13px/20px
geometry. The header wrapper should mirror the native Agent preset label's
static 12px/22px chrome. Both wrappers must set `min-width: 0`, `max-width`,
`overflow: hidden`, and `text-overflow: ellipsis`; the icon is non-shrinking.

- [ ] **Step 5: Run the focused tests and verify GREEN.**

Run:

~~~bash
pnpm exec node --test test/client-context.test.mjs
~~~

Expected: all component boundary and locale/CSS assertions PASS.

- [ ] **Step 6: Commit the consumers.**

~~~bash
git add src/client/WorktreeContext.tsx src/client/worktree-context.css \
  src/client/locales.ts test/client-context.test.mjs
git commit -m "feat(worktree): render session context labels"
~~~

## Task 5: Wire Client slot registrations and mutation invalidation

**Files:**

- Modify: `src/client/entry.ts`
- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree-view.ts`
- Modify: `test/client-composition.test.mjs`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: `createWorktreeContextProjection`, `WorktreeHeroContext`, `WorktreeHeaderContext`, the existing `manager`, and the native `conversation.hero.context` declaration from Task 1.
- Produces: one projection per Client fiber, two disposed slot registrations, and explicit invalidation after Worktree/binding mutations.

- [ ] **Step 1: Add failing registration and invalidation assertions.**

In `test/client-composition.test.mjs`, assert the registration ledger contains:

~~~js
assert.deepEqual([...fixture.registrationsBySlot.keys()].sort(), [
  'conversation.hero.context',
  'conversation.session.header.actions',
  'sidebar.footer.action',
  'shell.overlay',
]);
assert.equal(
  fixture.registrationsBySlot.get('conversation.session.header.actions').options.order,
  -5,
);
~~~

Use the existing fixture's disposer test to assert both new entries disappear
and the projection's `dispose()` is called once.

In `test/client-surface.test.mjs`, add source assertions that the surface calls
the injected invalidator after successful Worktree creation/removal and binding
retry, and that no context code calls `ctx.remote` or adds a second transport.

- [ ] **Step 2: Run focused tests and verify RED.**

Run from this package directory:

~~~bash
pnpm exec node --test test/client-composition.test.mjs test/client-surface.test.mjs
~~~

Expected: FAIL because `entry.ts` currently registers only the footer and
`shell.overlay` slots and `WorktreeSurfaceInjected` has no invalidation face.

- [ ] **Step 3: Create and dispose one projection in `entry.ts`.**

Add a type-only dependency on the native Conversation Client contract and add
`@deepseek-ai/dsh-client-ui-conversation` to the Client inject list. Create the
projection immediately after the existing Manager and membership objects:

~~~ts
const contextProjection = createWorktreeContextProjection({
  sessions: ctx.sessions.list,
  workspaces: ctx.workspaces.list,
  manager,
});

ctx.effect(
  () => () => contextProjection.dispose(),
  'clutch-dsh-worktree: session context cleanup',
);
~~~

Register the Hero list entry and header action through the existing slot
injection pattern:

~~~ts
ctx.slots.inject('conversation.hero.context', () => ctx.slots.register({
  name: 'conversation.hero.context',
  id: 'clutch-dsh-worktree-context-hero',
  locale: WORKTREE_NS,
  inject: () => ({ hooks: { worktreeContext: contextProjection.store } }),
}, WorktreeHeroContext));

ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
  name: 'conversation.session.header.actions',
  id: 'clutch-dsh-worktree-context-header',
  order: -5,
  locale: WORKTREE_NS,
  inject: () => ({ hooks: { worktreeContext: contextProjection.store } }),
}, WorktreeHeaderContext));
~~~

Keep the existing footer and overlay registrations unchanged. The Hero
registration must only be enabled against a DSH build that declares the slot;
do not add a runtime DOM fallback.

- [ ] **Step 4: Add the invalidation face to WorktreeSurface and actions.**

Extend `WorktreeSurfaceInjected` with:

~~~ts
readonly invalidateWorktreeContext?: (workspaceId?: string) => Promise<void>;
~~~

Pass `contextProjection.invalidate` from the `shell.overlay` inject factory.
Call it only after the relevant operation succeeds:

- after `createSessionForWorktree` binds and opens a Worktree Session;
- after Worktree creation plus its automatic Session flow completes;
- after successful Worktree removal;
- after successful binding retry;
- after a full Worktree surface refresh reads the current Workspace data.

Do not invalidate after a failed mutation, because the existing error surface
must preserve the prior valid projection. Do not add an invalidation call to
pure reorder operations because branch/binding identity is unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN.**

Run:

~~~bash
pnpm exec node --test test/client-composition.test.mjs test/client-surface.test.mjs
~~~

Expected: all registration, disposal, order, and invalidation assertions PASS.

- [ ] **Step 6: Commit the Client wiring.**

~~~bash
git add src/client/entry.ts src/client/WorktreeSurface.tsx \
  src/client/worktree-view.ts test/client-composition.test.mjs \
  test/client-surface.test.mjs
git commit -m "feat(worktree): wire context slots and invalidation"
~~~

## Task 6: Align package compatibility and documentation

**Files:**

- Modify: `package.json`
- Modify: `src/client/README.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: the exact native package version that contains `conversation.hero.context` from Task 1.
- Produces: install/build metadata and public documentation that cannot advertise the Hero consumer against an older DSH contract.

- [ ] **Step 1: Add a failing metadata/documentation check.**

Extend the existing package/source checks or add assertions to
`test/client-composition.test.mjs` requiring:

~~~js
const manifest = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url), 'utf8',
));
const clientReadme = await readFile(
  new URL('../src/client/README.md', import.meta.url), 'utf8',
);
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

assert.match(manifest.dsh.client.inject, /@deepseek-ai\/dsh-client-ui-conversation/);
assert.match(clientReadme, /conversation\.hero\.context/);
assert.match(readme, /branch|Worktree/);
~~~

The check must also assert that the plugin's peer and dev dependency versions
for `@deepseek-ai/dsh-client-ui-conversation` equal the native feature version
recorded from the DSH package.

- [ ] **Step 2: Run the metadata check and verify RED.**

Run:

~~~bash
pnpm exec node --test test/client-composition.test.mjs
~~~

Expected: FAIL because the plugin manifest and documentation do not yet mention
the native Conversation dependency or the two context locations.

- [ ] **Step 3: Update package injection and dependencies.**

Add `@deepseek-ai/dsh-client-ui-conversation` to `dsh.client.inject`,
`peerDependencies`, and `devDependencies`. Set all three version entries to
the exact native package version from Task 1; if the native release bumps the DSH
family, align the related rc versions together rather than mixing contracts.

- [ ] **Step 4: Document the behavior and compatibility boundary.**

In `src/client/README.md`, document that the Client contributes a root Hero
context list entry and a session-header action, both read-only and backed by a
shared browser-local projection. State that current DSH must provide the native
`conversation.hero.context` seat.

In `README.md`, add the user-visible behavior to the feature/limitations
sections:

~~~text
Blank Session: Workspace → Agent mode → current branch or Worktree branch.
Active Session: title → Agent mode → the same branch/Worktree context.
~~~

State that branch and Worktree values are display-only and disappear when the
binding is detached, invalid, or unavailable. Do not copy a transient package
version into README; document the compatibility requirement by package/seat.

- [ ] **Step 5: Run metadata and documentation checks.**

Run:

~~~bash
pnpm exec node --test test/client-composition.test.mjs
pnpm run check:workspace
pnpm run check:patches
~~~

Expected: PASS with no changes to the untracked drafts directory.

- [ ] **Step 6: Commit metadata and docs.**

~~~bash
git add package.json src/client/README.md README.md \
  test/client-composition.test.mjs
git commit -m "docs(worktree): document session context compatibility"
~~~

## Task 7: Run package verification and local visual QA

**Files:**

- No planned source changes; inspect the commits and working tree.

**Interfaces:**

- Consumes: all Tasks 1–6 outputs, the native feature build, and the existing local DSH Web profile.
- Produces: verified typecheck/build/test results and a visual confirmation of both placements.

- [ ] **Step 1: Run pure and focused plugin tests.**

From `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree`:

~~~bash
pnpm exec node --test \
  test/worktree-context.test.mjs \
  test/worktree-context-store.test.mjs \
  test/client-context.test.mjs \
  test/client-composition.test.mjs \
  test/client-surface.test.mjs
~~~

Expected: PASS with no stale-context, slot-order, or overlay assertions failing.

- [ ] **Step 2: Run package typecheck, build, and complete test suite.**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: PASS; generated `lib/` remains ignored/untracked according to the
repository policy.

- [ ] **Step 3: Run native contract tests against the feature DSH build.**

From `/Users/yuancheng/Documents/Code/deepseek-harness`:

~~~bash
pnpm exec vitest run \
  packages/client/ui-conversation/tests/chat-apply.client.spec.tsx \
  packages/client/ui-conversation/tests/skeleton.client.spec.tsx
~~~

Expected: PASS with the Hero context slot declared and rendered after Agent
preset.

- [ ] **Step 4: Build/reinstall the local plugin and inspect the open Arc page.**

Build the plugin, rebuild/restart the local DSH Web profile using the native
feature version, and inspect the existing Arc page with Computer Use. Verify:

- blank Main Session shows `Workspace → 极简模式 → main`;
- blank Worktree Session shows `Workspace → 极简模式 → <record.branch>`;
- after sending the first prompt, the same value appears beside `极简模式` in
  the title row;
- switching Session or Sidebar mode removes/replaces the old value without a
  flash of stale context;
- detached/repair data renders no misleading label.

- [ ] **Step 5: Review final repository state.**

Run:

~~~bash
git status --short --branch
git diff --check HEAD~1..HEAD
~~~

Confirm that only intended source/docs/tests are tracked, the existing drafts
remain user-owned and untouched, and no generated artifacts, credentials, or
sidecar data were added.

## Self-review checklist

- Native slot contract, root render order, and plugin registration are covered.
- Main, active Worktree, no-session, unbound, detached, repair, stale, and
  Workspace-mismatch resolver cases are covered.
- Request generation, invalidation, Manager errors, and disposal are covered.
- Hero and active title-row presentation, raw label handling, accessibility,
  locale, and long-label behavior are covered.
- No task introduces a second RPC transport, Session mutation, cwd inference,
  DOM overlay, or separate Worktree-name field.
- The current package's `AGENTS.md`, README, native compatibility boundary,
  and verification commands are represented in the task sequence.
