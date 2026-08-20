# Worktree Surface Interaction Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Worktree browser a dynamically bounded, scrollable overlay with native-style Workspace/Session actions, ordering, expansion, and Worktree health indicators without modifying native DSH source.

**Architecture:** Keep `shell.overlay` as the additive Client entry. A focused browser geometry hook reads the native New Session and footer rectangles and gives `WorktreeSurface` a runtime `top/height`. The surface uses injected native DSH Workspace/Session callbacks for rename, delete, and ordering, while Worktree lifecycle and transient health remain in the plugin's existing Host/Manage boundary.

**Tech Stack:** TypeScript, React 18, CSS Modules, DSH rc.8 Client primitives, Node test runner, pnpm workspace, Git worktree adapter.

## Global Constraints

- Do not modify the native DSH source repository or native DSH package implementations.
- Keep the existing `shell.overlay` and `sidebar.footer.action` slot ownership; do not replace the native Sidebar or Workspace browser.
- DSH remains the source of truth for Workspace identity/registration, Session identity/metadata/history, and native Workspace/Session ordering.
- The plugin sidecar continues to persist only Worktree metadata and Worktree/Session relationships; transient Worktree health is never persisted.
- The Worktree overlay covers only the interval from the native New Session top edge to the native footer top edge; never use a fixed vertical height or fallback that blocks the whole sidebar.
- Use public DSH primitives and semantic tokens; do not add a second UI kit or literal status palette.
- Use `apply_patch` for local source, test, documentation, and plan edits.
- Preserve the current worktree/session recovery semantics and all user changes already in the repository.
- Do not add generated `lib/`, coverage, sidecar data, credentials, or temporary fixtures to Git.

---

## File map

The implementation keeps the existing package seams and adds one focused browser geometry module:

- `src/client/overlay-bounds.ts` — pure rectangle math and the browser-safe bounds value used by the overlay hook.
- `src/client/sidebar-overlay-geometry.ts` — React hook that finds native sidebar anchors, observes geometry/mutations, and keeps the current dynamic sidebar width behavior.
- `src/client/entry.ts` — injects native Workspace rename/delete/reorder and Session reorder callbacks.
- `src/client/WorktreeSurface.tsx` — removes the mode Tab, composes Workspace rows, Session groups, menus, drag state, rename/delete dialogs, health dots, and dynamic bounds.
- `src/client/worktree.css` — dynamic surface positioning, scroll containment, native row geometry, fixed action columns, drag markers, expand controls, and status-dot placement.
- `src/contract/index.ts` — adds the optional transient `WorktreeHealth` projection while keeping persisted lifecycle values unchanged.
- `src/provider/sidecar.ts` — strips transient health before sidecar writes and keeps the exact persisted schema validator unchanged.
- `src/manage/manager.ts` — derives health from the Git Worktree projection when listing records.
- `test/client-overlay-bounds.test.mjs` — pure geometry tests.
- `test/client-surface.test.mjs` — Client source/behavior regression tests.
- `test/client-composition.test.mjs` — injected callback composition assertions.
- `test/manage.test.mjs` — active/missing/removed Worktree health tests.
- `test/host-remote.test.mjs` — plain-JSON health projection test.
- `README.md` and `src/client/README.md` — document the overlay boundary and native-style interactions.

## Task 1: Add dynamic overlay-bound geometry

**Files:**

- Create: `src/client/overlay-bounds.ts`
- Create: `src/client/sidebar-overlay-geometry.ts`
- Create: `test/client-overlay-bounds.test.mjs`
- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`

**Interfaces:**

```ts
export interface RectLike {
  readonly top: number;
  readonly bottom: number;
}

export interface OverlayBounds {
  readonly ready: boolean;
  readonly top: number;
  readonly height: number;
}

export function computeOverlayBounds(
  frame: RectLike,
  newSession: RectLike | undefined,
  footer: RectLike | undefined,
): OverlayBounds;
```

The hook returns the current `ref`, sidebar `width`, and `bounds`. It finds the
native New Session button through `aria-label` values (`新建会话`/`New session`)
with a text-content fallback (`新会话`/`New Session`), finds the Sidebar footer
from the native root's final direct child, and computes rectangles relative to
`[data-shell-overlay]`.

- [ ] **Step 1: Write the failing pure geometry tests.**

Add `test/client-overlay-bounds.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOverlayBounds } from '../lib/client/overlay-bounds.js';

test('computes coverage from New Session top to footer top', () => {
  assert.deepEqual(
    computeOverlayBounds(
      { top: 100, bottom: 900 },
      { top: 260, bottom: 298 },
      { top: 820, bottom: 900 },
    ),
    { ready: true, top: 160, height: 560 },
  );
});

test('clamps a footer that is above the New Session anchor to zero height', () => {
  assert.deepEqual(
    computeOverlayBounds(
      { top: 100, bottom: 900 },
      { top: 700, bottom: 738 },
      { top: 650, bottom: 730 },
    ),
    { ready: true, top: 600, height: 0 },
  );
});

test('returns zero coverage when either anchor is unavailable', () => {
  assert.deepEqual(
    computeOverlayBounds({ top: 100, bottom: 900 }, undefined, { top: 820, bottom: 900 }),
    { ready: false, top: 0, height: 0 },
  );
  assert.deepEqual(
    computeOverlayBounds({ top: 100, bottom: 900 }, { top: 260, bottom: 298 }, undefined),
    { ready: false, top: 0, height: 0 },
  );
});
```

- [ ] **Step 2: Run the geometry test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-overlay-bounds.test.mjs
```

Expected: the test fails because `lib/client/overlay-bounds.js` does not yet
exist.

- [ ] **Step 3: Implement the pure helper.**

Implement `computeOverlayBounds` with no DOM access:

```ts
export function computeOverlayBounds(
  frame: RectLike,
  newSession: RectLike | undefined,
  footer: RectLike | undefined,
): OverlayBounds {
  if (newSession === undefined || footer === undefined) {
    return { ready: false, top: 0, height: 0 };
  }
  const top = Math.max(0, newSession.top - frame.top);
  const footerTop = Math.max(top, footer.top - frame.top);
  return { ready: true, top, height: footerTop - top };
}
```

- [ ] **Step 4: Run the pure test and verify GREEN.**

Run the same command. Expected: all three tests pass.

- [ ] **Step 5: Add the observing hook and use the bounds in the surface.**

Replace the current `useSidebarWidth` helper with the focused geometry hook.
The effect must:

1. Locate the frame overlay from the surface ref.
2. Locate the sidebar column, its native root, the semantic New Session
   button, and the footer.
3. Read `getBoundingClientRect()` values and call `computeOverlayBounds`.
4. Observe the frame, sidebar root, anchor, and footer with
   `ResizeObserver`.
5. Observe the sidebar root subtree with `MutationObserver` and coalesce
   recalculation through `requestAnimationFrame`.
6. Disconnect every observer and cancel the pending frame on cleanup.

Render the `<aside>` with `top` and `height` inline styles only when bounds are
ready; otherwise use `height: 0` and `visibility: hidden`. Change `.surface`
from `inset: 0 auto 0 0` to a top-left positioned box with no bottom inset.
Keep its dynamic width transition unchanged.

- [ ] **Step 6: Add the focused source assertions and run them.**

Extend `test/client-surface.test.mjs` to assert that `WorktreeSurface.tsx`
uses the geometry hook and that the CSS no longer uses a full-column bottom
inset. Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='overlay|geometry'
```

Expected: the new assertions pass and the existing Client tests remain green.

- [ ] **Step 7: Commit the overlay slice.**

```bash
git add src/client/overlay-bounds.ts src/client/sidebar-overlay-geometry.ts src/client/WorktreeSurface.tsx src/client/worktree.css test/client-overlay-bounds.test.mjs test/client-surface.test.mjs
git commit -m "feat(worktree): bound overlay to native sidebar content"
```

## Task 2: Add native Workspace and Session callbacks

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/entry.ts`
- Modify: `test/client-composition.test.mjs`

**Interfaces:**

Extend `WorktreeSurfaceInjected` with:

```ts
readonly renameWorkspace?: (workspaceId: string, title: string) => Promise<void>;
readonly deleteWorkspace?: (workspaceId: string) => Promise<void>;
readonly insertWorkspaceBefore?: (
  workspaceId: string,
  beforeWorkspaceId?: string,
) => Promise<void>;
readonly insertSessionBefore?: (
  workspaceId: string,
  sessionId: string,
  beforeSessionId?: string,
) => Promise<void>;
```

Inject them from the existing native Client services:

```ts
renameWorkspace: (workspaceId, title) =>
  ctx.workspaces.rename(workspaceId, title),
deleteWorkspace: (workspaceId) =>
  ctx.workspaces.delete(workspaceId),
insertWorkspaceBefore: (workspaceId, beforeWorkspaceId) =>
  ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId),
insertSessionBefore: (workspaceId, sessionId, beforeSessionId) =>
  ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId),
```

- [ ] **Step 1: Write the failing composition assertions.**

Extend the existing `injects native Session actions into the Worktree surface`
test in `test/client-composition.test.mjs` to read `src/client/entry.ts` and
assert `renameWorkspace`, `deleteWorkspace`, `insertWorkspaceBefore`, and
`insertSessionBefore`, plus the corresponding `ctx.workspaces` calls.

- [ ] **Step 2: Run the focused composition test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='native Session actions|Workspace callbacks'
```

Expected: the new callback assertions fail because the entry does not inject
native Workspace mutation/order callbacks yet.

- [ ] **Step 3: Implement the four thin callback injections.**

Add the four callbacks to the `shell.overlay` inject object in `src/client/entry.ts`
without changing the existing Worktree Manager or Session binding flow.

- [ ] **Step 4: Run the focused composition test and verify GREEN.**

Run the same command. Expected: the injection assertions pass and existing
Client composition tests remain green.

- [ ] **Step 5: Commit the callback slice.**

```bash
git add src/client/entry.ts src/client/WorktreeSurface.tsx test/client-composition.test.mjs
git commit -m "feat(worktree): expose native workspace ordering actions"
```

## Task 3: Implement native-style Workspace rows

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

```ts
interface WorkspaceDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}
```

Create a focused `WorktreeWorkspaceRow` component with these props:

```ts
interface WorktreeWorkspaceRowProps {
  readonly workspace: WorkspaceLike;
  readonly expanded: boolean;
  readonly actionPending: boolean;
  readonly menuOpen: boolean;
  readonly drag: WorkspaceDragProps;
  readonly onToggle: () => void;
  readonly onCreateWorktree: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}
```

The row must render a disclosure button, folder icon/title, a `Menu` with
`Rename` and `Delete`, and the Workspace `+` in one fixed trailing action
column. The row itself is `draggable`; drag events set `effectAllowed = 'move'`,
report before/after hover halves, and commit through the parent callback.

- [ ] **Step 1: Write failing Workspace parity source tests.**

Add tests to `test/client-surface.test.mjs` that assert the source contains:

```js
assert.match(source, /renameWorkspace/);
assert.match(source, /deleteWorkspace/);
assert.match(source, /insertWorkspaceBefore/);
assert.match(source, /draggable/);
assert.match(source, /onDragOver/);
assert.match(source, /onDrop/);
assert.match(source, /Rename/);
assert.match(source, /Delete/);
assert.match(source, /data-workspace-drag/);
```

- [ ] **Step 2: Run the Workspace parity test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='Workspace parity|Workspace row'
```

Expected: the new assertions fail because Workspace rows have no native menu
or drag handlers.

- [ ] **Step 3: Add Workspace drag state and commit logic.**

In `WorktreeSurface`, add:

```ts
interface WorkspaceDragState {
  readonly workspaceId: string;
  readonly over: { readonly workspaceId: string; readonly half: 'before' | 'after' } | null;
}
```

On drop, resolve the anchor exactly as native DSH does: `before` uses the
target Workspace id; `after` uses the next Workspace id or `undefined` for the
end. Do not call the native callback when the source would remain in the same
position. On callback failure, preserve the DSH projection and put a retryable
navigation error into the existing error surface.

- [ ] **Step 4: Add Workspace rename/delete dialog state.**

Add controlled state for rename target/draft/pending/error and delete target/
pending/error. Rename disables confirmation for blank or duplicate titles and
calls `renameWorkspace`. Delete calls `deleteWorkspace` only after confirmation,
keeps the dialog open on failure, and uses copy that states the directory,
Sessions, and Git Worktrees are retained.

- [ ] **Step 5: Render the focused Workspace row component.**

Replace the current inline Workspace row JSX with `WorktreeWorkspaceRow` and
pass the existing Worktree creator, expansion, and action state through its
props. Keep Workspace filtering and Worktree view lookup unchanged.

- [ ] **Step 6: Run the focused source tests and verify GREEN.**

Run the same test command. Expected: Workspace menu, drag, and dialog source
assertions pass.

- [ ] **Step 7: Commit the Workspace row slice.**

```bash
git add src/client/WorktreeSurface.tsx src/client/worktree.css test/client-surface.test.mjs
git commit -m "feat(worktree): match native workspace row actions"
```

## Task 4: Add Session drag, grouping, and expand-more behavior

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

Update `WorktreeSessionRow` to receive:

```ts
interface SessionDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}
```

Add a `WorktreeSessionGroup` component that accepts a `groupKey`, complete
Session id list, Workspace id, and the native reorder callback. It renders
five ids until expanded and renders an expand/collapse button only when the
group has more than five ids.

- [ ] **Step 1: Write failing Session behavior tests.**

Extend `test/client-surface.test.mjs` with source assertions:

```js
assert.match(source, /insertSessionBefore/);
assert.match(source, /draggable/);
assert.match(source, /onDragOver/);
assert.match(source, /onDrop/);
assert.match(source, /Expand|Show.*more/);
assert.match(source, /Collapse/);
assert.doesNotMatch(source, /status=\{record\.status === 'active' \? 'bound' : 'detached'\}/);
```

- [ ] **Step 2: Run the Session behavior test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='Session drag|expand|bound'
```

Expected: the new assertions fail because Session rows are not draggable and
all rows render without an expand-more limit.

- [ ] **Step 3: Add group-scoped Session drag state.**

Use a group key such as `main:${workspaceId}` or
`worktree:${worktreeId}`. Only rows whose group key matches the active drag
accept `dragover`/`drop`. Compute the native anchor from the target half and
call:

```ts
await insertSessionBefore(workspaceId, sessionId, beforeSessionId);
```

Do not call the callback when the move is a no-op. Do not move ids between Main
and Worktree groups.

- [ ] **Step 4: Add the five-row limit and expand/collapse control.**

Track `expandedSessionGroups` as a browser-local record. Render
`sessionIds.slice(0, 5)` while collapsed, all ids while expanded, and a button
with `aria-expanded` after the rows when the total exceeds five. The button
label must include the hidden count when collapsed and `Collapse` when open.

- [ ] **Step 5: Convert Session row rendering to native-style drag markup.**

Keep the existing portal `Menu` and Rename/Fork/Archive callbacks. Add row-level
`draggable`, `onDragStart`, `onDragOver`, `onDrop`, and `onDragEnd`; add before/
after marker classes; and remove the visible `status` prop and all `bound` or
`detached` text.

- [ ] **Step 6: Run the focused Session tests and verify GREEN.**

Run the same test command. Expected: Session drag, expand-more, and no-bound
assertions pass.

- [ ] **Step 7: Commit the Session slice.**

```bash
git add src/client/WorktreeSurface.tsx src/client/worktree.css test/client-surface.test.mjs
git commit -m "feat(worktree): add native session ordering and expansion"
```

## Task 5: Add transient Worktree health projection

**Files:**

- Modify: `src/contract/index.ts`
- Modify: `src/provider/sidecar.ts`
- Modify: `src/manage/manager.ts`
- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `test/manage.test.mjs`
- Modify: `test/host-remote.test.mjs`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

Add:

```ts
export type WorktreeHealth = 'ready' | 'repair';

export interface WorktreeRecord {
  readonly worktreeId: WorktreeId;
  readonly workspaceId: WorkspaceId;
  readonly absolutePath: string;
  readonly branch: string;
  readonly status: WorktreeStatus;
  /** Runtime-only; never written to the sidecar. */
  readonly health?: WorktreeHealth;
}
```

`WorktreeManagerImpl.listWorktrees` reads the sidecar snapshot, asks the Git
adapter for the current Worktree projection, and maps active records to
`health: 'ready'` only when their normalized absolute path is present. A Git
listing failure maps active records to `health: 'repair'` while leaving removed
records as lifecycle history. `WorkspaceShardedSidecarRepository.upsertWorktree`
must strip `health` before constructing a snapshot so exact sidecar keys remain
`absolutePath`, `branch`, `status`, `workspaceId`, and `worktreeId`.

- [ ] **Step 1: Write failing health tests.**

Add Manage tests using the existing injected Git/sidecar fixture:

```js
test('projects repair health when an active Worktree path is missing from Git', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, sidecar }) => {
    const record = makeRecord({
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_missing'),
    });
    await sidecar.upsertWorktree(record);
    const baseGit = new LocalGitAdapter();
    const git = {
      validateRepository: (...args) => baseGit.validateRepository(...args),
      listBranches: (...args) => baseGit.listBranches(...args),
      listWorktrees: async () => [{ absolutePath: workspaceRoot }],
      createWorktree: (...args) => baseGit.createWorktree(...args),
      removeWorktree: (...args) => baseGit.removeWorktree(...args),
    };
    const manager = createWorktreeManager({ dsh, dshHome, sidecar, git });
    const result = await manager.listWorktrees({ workspaceId: 'ws_one' });
    assert.equal(result[0].health, 'repair');
  });
});

test('projects ready health when an active Worktree path is present in Git', async () => {
  await withGitFixture(async ({ provider, workspaceRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/health']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/health' });
    const result = await provider.listWorktrees({ workspaceId: 'ws_one' });
    assert.equal(result.find((candidate) => candidate.worktreeId === record.worktreeId).health, 'ready');
  });
});

test('does not persist transient Worktree health', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const record = makeRecord({
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_health'),
    });
    await sidecar.upsertWorktree({ ...record, health: 'repair' });
    const raw = await readFile(sidecar.getShardPath('ws_one'), 'utf8');
    assert.doesNotMatch(raw, /health/);
  });
});
```

Add a Remote test that passes a record with `health: 'repair'` through
`createWorktreeRemoteProjection` and asserts the result remains plain JSON.

- [ ] **Step 2: Run health tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='health|transient Worktree'
```

Expected: the tests fail because `health` is not part of the contract and
`listWorktrees` does not derive Git health.

- [ ] **Step 3: Add the optional transient contract field and persistence strip.**

Add `WorktreeHealth` and `health?` to the contract. In `upsertWorktree`, create
the persisted value with object destructuring:

```ts
const { health: _health, ...persistedRecord } = record;
```

Use `persistedRecord` for comparison, snapshot insertion, and return values.
Keep `WORKTREE_KEYS` and `assertWorktreeRecord` unchanged so sidecar schema
validation still rejects persisted health fields.

- [ ] **Step 4: Derive health in Manage.**

Normalize paths with the same `path.resolve` boundary used by the existing
Manager. Catch only Git health-list failures for the per-record projection;
sidecar and DSH errors must keep their current failure behavior. Return removed
records without `health`, active matching records with `health: 'ready'`, and
active non-matching/failure records with `health: 'repair'`.

- [ ] **Step 5: Render native state dots.**

Import `StateDot` from the public DSH primitives. Map:

```tsx
const state = record.status === 'removed'
  ? 'warning'
  : record.health === 'repair'
    ? 'error'
    : 'done';
```

Render the dot immediately before the Worktree branch/name, with an accessible
label/title for `active`, `detached`, or `repair/error`. Do not render the old
visible `active`/`detached` status text.

- [ ] **Step 6: Run health tests and verify GREEN.**

Run the same test command. Expected: all health, Remote, sidecar, and existing
Manage tests pass.

- [ ] **Step 7: Commit the health slice.**

```bash
git add src/contract/index.ts src/provider/sidecar.ts src/manage/manager.ts src/client/WorktreeSurface.tsx src/client/worktree.css test/manage.test.mjs test/host-remote.test.mjs test/client-surface.test.mjs
git commit -m "feat(worktree): project worktree repair health"
```

## Task 6: Finish surface layout, alignment, and integration tests

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `test/client-surface.test.mjs`
- Modify: `test/client-composition.test.mjs`

- [ ] **Step 1: Write failing layout assertions.**

Add source assertions for all final surface requirements:

```js
assert.doesNotMatch(surfaceSource, /role="tablist"|role='tablist'/);
assert.doesNotMatch(surfaceSource, /Workspace<\/button>[\s\S]*Worktree<\/button>/);
assert.match(surfaceSource, /data-worktree-surface/);
assert.match(styleSource, /overflow: auto/);
assert.match(styleSource, /min-height: 0/);
assert.match(styleSource, /treeActionSlot|workspaceActions|worktreeActions/);
assert.match(surfaceSource, /StateDot/);
assert.doesNotMatch(surfaceSource, /\bactive\b.*\bstatus\b/);
assert.doesNotMatch(surfaceSource, /\bbound\b/);
```

- [ ] **Step 2: Run the final layout test and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='final surface layout|Tab|scroll|alignment'
```

Expected: any assertions not already satisfied by earlier tasks fail.

- [ ] **Step 3: Remove the mode switch and unify action columns.**

Delete the `modeSwitch` JSX and its CSS. Keep the close button and footer
toggle. Add one shared trailing action class used by Workspace rows, Main
header, and active Worktree rows. Reserve the action width even when menu
buttons are hidden, and keep the `+` at the same right edge.

- [ ] **Step 4: Make the computed content interval scroll.**

Set `.wideContent` to `min-height: 0`, keep `.content` as the flex child with
`overflow: auto`, and ensure `.workspaceList` cannot force its parent wider or
taller. Add focus-visible styles to the scrollable content and preserve the
existing rail behavior.

- [ ] **Step 5: Run the full Client surface test file.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='surface|Client|Workspace|Session|overlay'
```

Expected: all Client source, geometry, composition, connection, and mode tests
pass.

- [ ] **Step 6: Commit the integrated Client slice.**

```bash
git add src/client/WorktreeSurface.tsx src/client/worktree.css test/client-surface.test.mjs test/client-composition.test.mjs
git commit -m "feat(worktree): polish native-style worktree surface"
```

## Task 7: Update package documentation and run repository verification

**Files:**

- Modify: `README.md`
- Modify: `src/client/README.md`
- Modify: `docs/superpowers/plans/2026-08-21-worktree-surface-optimization.md`

- [ ] **Step 1: Update the Client documentation.**

Document that the surface is a dynamic overlay from New Session to footer,
that the mode Tab no longer exists, that Workspace and Session actions use the
existing DSH Client APIs, that Session ordering stays within its visual group,
and that Worktree health is transient and not persisted.

- [ ] **Step 2: Mark completed plan steps with exact verification commands.**

After each task's commit, replace its checkboxes with `[x]` and record the
actual command results in the final verification section. Do not mark a task
green based on an unrun command.

- [ ] **Step 3: Run focused package checks.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check:workspace
pnpm run check:patches
```

Expected: all commands exit 0; generated `lib/` remains ignored/untracked.

- [ ] **Step 4: Run repository checks appropriate to the changed package.**

Run:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check
git diff --check
```

Expected: all commands exit 0, or any pre-existing unrelated failure is
reported with its exact command and output rather than hidden.

- [ ] **Step 5: Verify final scope.**

Run:

```bash
git status --short
git diff --name-only
git diff --name-only -- /Users/yuancheng/Documents/Code/deepseek-harness
```

Expected: no unstaged native DSH file is modified and no generated artifacts
are tracked. Review the commit list separately to confirm every changed file
belongs to this package.

- [ ] **Step 6: Commit documentation and final plan state.**

```bash
git add README.md src/client/README.md docs/superpowers/plans/2026-08-21-worktree-surface-optimization.md
git commit -m "docs(worktree): record native-style surface behavior"
```
