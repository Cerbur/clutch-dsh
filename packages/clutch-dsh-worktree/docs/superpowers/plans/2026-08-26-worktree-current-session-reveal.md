# Worktree View Current Session Reveal and Positioning Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: Highlight the DSH current Session in Worktree view, temporarily reveal its
Workspace/Main/Worktree path and overflow row when needed, and scroll it into
the Worktree overlay without changing persisted expansion preferences.

Architecture: Keep DSH sessions.current as the only selection fact. Add pure
browser-side selectors that resolve the current Session to Main or a Worktree
group, keep reveal suppression in WorktreeSurface memory, and pass effective
expansion plus a current marker down to the existing row components. Use a
small DOM-scoped positioning helper and a generation-guarded layout effect so
entering Worktree mode or changing the current Session positions exactly once,
while ordinary refreshes and stale callbacks do not move the user's scroll.

Tech Stack: TypeScript, React useLayoutEffect/useSyncExternalStore, CSS
Modules, DSH Client session/workspace snapshots, Node's built-in test runner,
and pnpm workspace scripts.

## Global Constraints

- DSH sessions.current is the only source of truth for the highlighted Session.
- The feature is browser-local presentation behavior; it must not alter DSH Workspace or Session data, Session metadata, transcripts, Worktree bindings, Git state, Host APIs, Remote contracts, or sidecar records.
- Automatic reveal is in-memory only and must not call expandState.actions or write clutch-dsh-worktree.expand-state.
- Existing persisted Workspace, Main, and Worktree expansion preferences remain authoritative when there is no active current-Session reveal.
- A manual collapse of an automatically revealed row takes precedence for the current Session without changing the persisted collapsed record; the suppression resets when the current Session changes or Worktree mode exits.
- Main, active Worktree, and detached Worktree bindings must resolve to their existing visual groups; missing or incomplete data returns no reveal target and no new error.
- Search is cleared only when entering Worktree mode or sessions.current changes, and only to make the locate target visible; ordinary user typing is not overridden.
- Session groups continue to show five rows by default, but the current Session's group is temporarily expanded when the current row is beyond the fifth visible row.
- Positioning is scoped to the Worktree surface, uses scrollIntoView with block nearest, runs after the target row is committed, and does not repeat for an unchanged locate generation.
- Refreshes preserve existing ready content and do not create a scroll loop or clear the current projection.
- Blank Session visibility, Session menus, drag ordering, Worktree ordering, and existing error surfaces remain unchanged.
- Do not modify package.json version, the DSH source checkout, generated lib/, coverage, screenshots, credentials, or unrelated drafts.
- Every implementation task must use small scoped commits and run its focused test before moving to the next task.

---

## File Map

All paths below are relative to:
 /private/tmp/clutch-dsh-wt-worktree-0.1.6-session-reveal/packages/clutch-dsh-worktree

- Create: test/client-current-session-location.test.mjs — focused tests for current-Session location and stable reveal keys.
- Create: test/client-worktree-session-position.test.mjs — focused tests for overlay-scoped scrolling.
- Create: src/client/worktree-session-position.ts — browser-safe DOM helper that finds one Session row under a supplied surface root and performs nearest scrolling.
- Modify: src/client/worktree-surface-selectors.ts — add the current-Session location type, resolver, and stable reveal-key derivation.
- Modify: src/client/worktree-surface-types.ts — add current/selected Session row props and group current-session input.
- Modify: src/client/worktree-surface-rows.tsx — render the current marker and pass it from each Session group row.
- Modify: src/client/WorktreeSurface.tsx — own current-session reveal memory, search clearing, effective expansion, manual suppression, and generation-guarded positioning.
- Modify: src/client/worktree.css — add a non-layout-shifting selected appearance for the current Session row.
- Modify: test/client-surface.test.mjs — add source-level assertions for highlight, temporary reveal, manual suppression, search clearing, and positioning lifecycle.
- Modify: README.md — document current Session highlighting and browser-local temporary reveal.
- Modify: README.zh.md — keep the Chinese public behavior documentation synchronized.
- Modify: src/client/README.md — document the Client-side current Session reveal and scroll boundary.

No entry.ts, Host, Remote, Provider, Manage, contract, sidecar schema, or package manifest changes are planned.

## Existing Interfaces Used by the Plan

The implementation starts from the release baseline already merged into this
feature worktree:

- WorktreeSurface receives sessions through useSessions and workspaces through useWorkspaces.
- WorktreeSurface already subscribes to expandState with useSyncExternalStore.
- WorktreeWorkspaceView contains workspaceId, worktrees, bindings, branches, and readiness.
- SessionBinding contains workspaceId, worktreeId, sessionId, and status, including detached bindings.
- WorktreeSessionRow already exposes data-session-id on the outer row.
- useSidebarOverlayGeometry already provides a RefObject<HTMLDivElement> attached to the Worktree aside.
- Refreshes already preserve ready content when called with preserveCurrent: true.

The plan does not reuse resolveWorktreeSessionContext for row placement because
that context intentionally treats detached and repair states as non-navigable;
the Worktree tree must continue to display detached binding history.

---

### Task 1: Resolve the current Session to a stable visual group

Files:

- Create: test/client-current-session-location.test.mjs
- Modify: src/client/worktree-surface-selectors.ts

Interfaces:

- Consumes: a current Session ID, Workspace membership items, and the latest ready WorktreeWorkspaceView list.
- Produces: CurrentSessionLocation, resolveCurrentSessionLocation, currentSessionRevealKeys, and
  shouldRevealCurrentSessionGroup for WorktreeSurface and focused tests.

- [ ] Step 1: Write failing selector tests.

Create test/client-current-session-location.test.mjs with this focused fixture and
assertion set:

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentSessionRevealKeys,
  resolveCurrentSessionLocation,
} from '../lib/client/worktree-surface-selectors.js';

const workspaces = [
  {
    workspaceId: 'ws-main',
    title: 'Main Workspace',
    sessionIds: ['session-main'],
  },
  {
    workspaceId: 'ws-active',
    title: 'Active Workspace',
    sessionIds: ['session-active'],
  },
  {
    workspaceId: 'ws-detached',
    title: 'Detached Workspace',
    sessionIds: ['session-detached'],
  },
];

const views = [
  {
    workspaceId: 'ws-main',
    worktrees: [],
    branches: [],
    bindings: [],
    readiness: { status: 'ready' },
  },
  {
    workspaceId: 'ws-active',
    worktrees: [
      {
        worktreeId: 'wt-active',
        workspaceId: 'ws-active',
        absolutePath: '/tmp/active',
        branch: 'feature/active',
        source: 'plugin',
        status: 'active',
      },
    ],
    branches: [],
    bindings: [
      {
        workspaceId: 'ws-active',
        worktreeId: 'wt-active',
        sessionId: 'session-active',
        status: 'active',
      },
    ],
    readiness: { status: 'ready' },
  },
  {
    workspaceId: 'ws-detached',
    worktrees: [
      {
        worktreeId: 'wt-detached',
        workspaceId: 'ws-detached',
        absolutePath: '/tmp/detached',
        branch: 'feature/detached',
        source: 'external',
        status: 'removed',
      },
    ],
    branches: [],
    bindings: [
      {
        workspaceId: 'ws-detached',
        worktreeId: 'wt-detached',
        sessionId: 'session-detached',
        status: 'detached',
      },
    ],
    readiness: { status: 'ready' },
  },
];

test('resolves an unbound Session to Main', () => {
  assert.deepEqual(
    resolveCurrentSessionLocation('session-main', workspaces, views),
    {
      sessionId: 'session-main',
      workspaceId: 'ws-main',
      groupKey: 'main:ws-main',
      kind: 'main',
    },
  );
});

test('resolves an active binding to its Worktree group', () => {
  assert.deepEqual(
    resolveCurrentSessionLocation('session-active', workspaces, views),
    {
      sessionId: 'session-active',
      workspaceId: 'ws-active',
      groupKey: 'worktree:wt-active',
      kind: 'worktree',
      worktreeId: 'wt-active',
    },
  );
});

test('resolves a detached binding to the retained Worktree group', () => {
  assert.deepEqual(
    resolveCurrentSessionLocation('session-detached', workspaces, views),
    {
      sessionId: 'session-detached',
      workspaceId: 'ws-detached',
      groupKey: 'worktree:wt-detached',
      kind: 'worktree',
      worktreeId: 'wt-detached',
    },
  );
});

test('returns no location for missing, incomplete, or mismatched facts', () => {
  assert.equal(resolveCurrentSessionLocation(undefined, workspaces, views), undefined);
  assert.equal(resolveCurrentSessionLocation('missing', workspaces, views), undefined);
  assert.equal(resolveCurrentSessionLocation('session-main', workspaces, []), undefined);
  assert.equal(
    resolveCurrentSessionLocation(
      'session-active',
      workspaces,
      views.map((view) =>
        view.workspaceId === 'ws-active'
          ? { ...view, worktrees: [] }
          : view,
      ),
    ),
    undefined,
  );
});

test('derives stable reveal keys from IDs and not labels or array positions', () => {
  const location = resolveCurrentSessionLocation('session-active', workspaces, views);
  assert.deepEqual(currentSessionRevealKeys(location), [
    'workspace:ws-active',
    'worktree:wt-active',
    'session-group:worktree:wt-active',
  ]);
});
~~~

- [ ] Step 2: Run the focused test and verify the missing-export failure.

Run:

~~~bash
pnpm run build && node --test test/client-current-session-location.test.mjs
~~~

Expected: FAIL because the selector module does not yet export the new resolver
or reveal-key helper.

- [ ] Step 3: Add the exact selector contract and implementation.

Append the following API shape to src/client/worktree-surface-selectors.ts,
using the existing WorktreeWorkspaceView and WorkspaceLike imports:

~~~ts
export type CurrentSessionLocation =
  | {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly groupKey: string;
      readonly kind: 'main';
    }
  | {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly groupKey: string;
      readonly kind: 'worktree';
      readonly worktreeId: string;
    };

export function resolveCurrentSessionLocation(
  currentSessionId: string | undefined,
  workspaces: readonly Pick<WorkspaceLike, 'workspaceId' | 'sessionIds'>[],
  views: readonly WorktreeWorkspaceView[],
): CurrentSessionLocation | undefined {
  if (currentSessionId === undefined) return undefined;
  const workspace = workspaces.find((candidate) =>
    candidate.sessionIds.includes(currentSessionId),
  );
  if (workspace === undefined) return undefined;
  const view = views.find((candidate) => candidate.workspaceId === workspace.workspaceId);
  if (view === undefined) return undefined;
  const binding = view.bindings.find((candidate) =>
    candidate.sessionId === currentSessionId,
  );
  if (binding === undefined) {
    return {
      sessionId: currentSessionId,
      workspaceId: workspace.workspaceId,
      groupKey: 'main:' + workspace.workspaceId,
      kind: 'main',
    };
  }
  const worktree = view.worktrees.find((candidate) =>
    candidate.worktreeId === binding.worktreeId &&
    candidate.workspaceId === workspace.workspaceId,
  );
  if (worktree === undefined) return undefined;
  return {
    sessionId: currentSessionId,
    workspaceId: workspace.workspaceId,
    groupKey: 'worktree:' + worktree.worktreeId,
    kind: 'worktree',
    worktreeId: worktree.worktreeId,
  };
}

export function currentSessionRevealKeys(
  location: CurrentSessionLocation | undefined,
): readonly string[] {
  if (location === undefined) return [];
  return [
    'workspace:' + location.workspaceId,
    location.kind === 'main'
      ? 'main:' + location.workspaceId
      : 'worktree:' + location.worktreeId,
    'session-group:' + location.groupKey,
  ];
}
~~~

The resolver must accept both active and detached bindings when the referenced
Worktree record is present. It must not inspect branch labels, health, status,
array positions, or current branch facts.

- [ ] Step 4: Run the selector tests and verify all cases pass.

Run:

~~~bash
pnpm run build && node --test test/client-current-session-location.test.mjs
~~~

Expected: PASS for Main, active Worktree, detached Worktree, unmatched facts,
and stable reveal-key cases.

- [ ] Step 5: Commit the selector unit.

~~~bash
git add src/client/worktree-surface-selectors.ts test/client-current-session-location.test.mjs
git commit -m "feat(worktree): resolve current session location"
~~~

---

### Task 2: Add the current Session row marker without changing row behavior

Files:

- Modify: src/client/worktree-surface-types.ts
- Modify: src/client/worktree-surface-rows.tsx
- Modify: src/client/worktree.css
- Modify: test/client-surface.test.mjs

Interfaces:

- Consumes: CurrentSessionLocation group keys from Task 1 and the existing WorktreeSessionGroup rendering contract.
- Produces: a current boolean on WorktreeSessionRowProps and an optional currentSessionId on WorktreeSessionGroupProps; later surface code passes sessions.current through these props.

- [ ] Step 1: Add failing source-contract assertions.

Add a test beside the existing blank Session row parity test in
test/client-surface.test.mjs:

~~~js
test('marks only the DSH current Session row without changing row controls', async () => {
  const { rows, types } = await readSurfaceSources();
  assert.match(types, /readonly current: boolean/);
  assert.match(types, /readonly currentSessionId\?: string/);
  assert.match(rows, /data-session-current=\{current \? 'true' : undefined\}/);
  assert.match(rows, /aria-current=\{current \? 'true' : undefined\}/);
  assert.match(rows, /current=\{sessionId === currentSessionId\}/);
  assert.match(await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  ), /\.treeSessionRow\[data-session-current='true'\]/);
});
~~~

- [ ] Step 2: Run the focused source test and verify it fails on the missing marker.

Run:

~~~bash
pnpm run build && node --test test/client-surface.test.mjs
~~~

Expected: FAIL only for the new assertions because the current prop and CSS
selector do not exist yet.

- [ ] Step 3: Extend the row interfaces.

In WorktreeSessionRowProps add:

~~~ts
readonly current: boolean;
~~~

In WorktreeSessionGroupProps add:

~~~ts
readonly currentSessionId?: string;
~~~

Keep current separate from blank, actionPending, drag, and menu state. The row
must continue to render a menu for ordinary Sessions and no menu for blank
Sessions.

- [ ] Step 4: Render the marker and pass it through the group.

Update WorktreeSessionRow to destructure current and add the marker attributes
to its existing outer treeitem:

~~~tsx
data-session-current={current ? 'true' : undefined}
aria-current={current ? 'true' : undefined}
~~~

Update WorktreeSessionGroup to accept currentSessionId and pass:

~~~tsx
current={sessionId === currentSessionId}
~~~

to every WorktreeSessionRow. Do not move data-session-id, draggable behavior,
blank visibility, menu portal behavior, or drag markers.

- [ ] Step 5: Add a non-layout-shifting selected style.

Add this rule immediately after the existing treeSessionRow hover/menu rule in
src/client/worktree.css:

~~~css
.treeSessionRow[data-session-current='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
}

.treeSessionRow[data-session-current='true'] .treeSessionContent {
  font-weight: 600;
}
~~~

The current row must keep the existing fixed action rail, label truncation,
hover, menu-open, and drag-marker geometry.

- [ ] Step 6: Run the focused source test and the existing Session-view tests.

Run:

~~~bash
pnpm run build && node --test test/client-surface.test.mjs test/client-session-view.test.mjs
~~~

Expected: PASS, with existing blank Session visibility and menu behavior
unchanged.

- [ ] Step 7: Commit the row marker.

~~~bash
git add src/client/worktree-surface-types.ts src/client/worktree-surface-rows.tsx src/client/worktree.css test/client-surface.test.mjs
git commit -m "feat(worktree): highlight current session row"
~~~

---

### Task 3: Add temporary reveal state and manual-collapse precedence

Files:

- Modify: src/client/WorktreeSurface.tsx
- Modify: test/client-surface.test.mjs

Interfaces:

- Consumes: resolveCurrentSessionLocation and currentSessionRevealKeys from Task 1; current marker props from Task 2; expandState snapshot and actions already injected by the release baseline.
- Produces: effective structural/session-group expansion, search clearing on locate triggers, and in-memory suppression for explicit manual collapse.

- [ ] Step 1: Add failing source assertions for reveal semantics.

Add a focused test in test/client-surface.test.mjs:

~~~js
test('temporarily reveals the current Session path without persisting it', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /const currentSessionId = sessions\.current/);
  assert.match(source, /resolveCurrentSessionLocation/);
  assert.match(source, /currentSessionReveal/);
  assert.match(source, /currentSessionRevealKeys/);
  assert.match(source, /setSearchQuery\(''\)/);
  assert.match(source, /isWorkspaceExpanded\(expandSnapshot,[\s\S]*\|\|/);
  assert.match(source, /isMainExpanded\(expandSnapshot,[\s\S]*\|\|/);
  assert.match(source, /isWorktreeExpanded\([\s\S]*\|\|/);
  assert.match(source, /shouldRevealCurrentSessionGroup\(sessionIds, currentSessionId\)/);
  assert.match(source, /suppressedKeys/);
  assert.match(source, /expandState\.actions\.toggleWorkspace/);
  assert.match(source, /expandState\.actions\.toggleMain/);
  assert.match(source, /expandState\.actions\.toggleWorktree/);
  assert.doesNotMatch(source, /currentSessionReveal.*localStorage/);
});
~~~

- [ ] Step 2: Run the source test and verify it fails.

Run:

~~~bash
pnpm run build && node --test test/client-surface.test.mjs
~~~

Expected: FAIL because the surface has no current-session reveal state or
effective expansion logic.

- [ ] Step 3: Add the reveal state and current-location derivation.

Import useLayoutEffect and the two selector helpers. Add the following local
state shape near the existing ExpandedSessionGroups alias:

~~~ts
interface CurrentSessionRevealState {
  readonly sessionId: string;
  readonly suppressedKeys: Readonly<Record<string, true>>;
}
~~~

After reading sessions and workspaces, bind:

~~~ts
const currentSessionId = sessions.current;
const [currentSessionReveal, setCurrentSessionReveal] =
  useState<CurrentSessionRevealState>();
const searchQueryRef = useRef(searchQuery);
searchQueryRef.current = searchQuery;
const locateGenerationRef = useRef(0);
const positionedLocateGenerationRef = useRef<number>();
~~~

After viewByWorkspace is available, derive the location only from a complete
ready read:

~~~ts
const currentSessionLocation = useMemo(
  () =>
    readState.status === 'ready'
      ? resolveCurrentSessionLocation(currentSessionId, workspaces.items, readState.views)
      : undefined,
  [currentSessionId, readState.status, readState.views, workspaces.items],
);
const currentRevealKeys = useMemo(
  () => new Set(currentSessionRevealKeys(currentSessionLocation)),
  [currentSessionLocation],
);
const isCurrentSessionReveal = (key: string): boolean =>
  currentSessionReveal?.sessionId === currentSessionId &&
  currentRevealKeys.has(key) &&
  currentSessionReveal.suppressedKeys[key] !== true;
~~~

The locate-trigger layout effect must reset the generation refs used by Task 4,
clear a non-empty search only while Worktree mode is active, and reset reveal
suppression on mode entry or current Session change:

~~~ts
useLayoutEffect(() => {
  locateGenerationRef.current += 1;
  positionedLocateGenerationRef.current = undefined;
  if (mode !== 'worktree') {
    setCurrentSessionReveal(undefined);
    return;
  }
  if (searchQueryRef.current.trim().length > 0) setSearchQuery('');
  setCurrentSessionReveal(
    currentSessionId === undefined
      ? undefined
      : { sessionId: currentSessionId, suppressedKeys: {} },
  );
}, [currentSessionId, mode]);
~~~

The effect runs only when mode or sessions.current changes. It must not depend
on readState, query, or expandSnapshot.

- [ ] Step 4: Implement the suppression helper and effective expansion.

Add a callback-local helper that only suppresses a key belonging to the
current location:

~~~ts
const suppressCurrentSessionReveal = (key: string): boolean => {
  if (!isCurrentSessionReveal(key)) return false;
  setCurrentSessionReveal((current) => {
    if (current === undefined || current.sessionId !== currentSessionId) return current;
    return {
      ...current,
      suppressedKeys: { ...current.suppressedKeys, [key]: true },
    };
  });
  return true;
};
~~~

For Workspace, Main, and Worktree rows, compute effective expansion as the
persisted selector OR the unsuppressed current reveal key:

~~~ts
const expanded =
  isWorkspaceExpanded(expandSnapshot, workspace.workspaceId) ||
  isCurrentSessionReveal('workspace:' + workspace.workspaceId);
const mainExpanded =
  isMainExpanded(expandSnapshot, workspace.workspaceId) ||
  isCurrentSessionReveal('main:' + workspace.workspaceId);
const worktreeExpanded =
  isWorktreeExpanded(expandSnapshot, record.worktreeId) ||
  isCurrentSessionReveal('worktree:' + record.worktreeId);
~~~

The Session group effective value must preserve existing transient state and
add the current reveal key only when the current Session is outside the first
five rows:

~~~ts
const sessionGroupExpanded =
  expandedSessionGroups[groupKey] === true ||
  (shouldRevealCurrentSessionGroup(sessionIds, currentSessionId) &&
    isCurrentSessionReveal('session-group:' + groupKey));
~~~

Use these effective values for row props and WorktreeSessionGroup expanded.
Keep the persisted expandState snapshot as the only input to the existing
structural toggle selectors.

- [ ] Step 5: Make manual collapse win over automatic reveal.

Update toggleWorkspace, toggleMain, and toggleWorktree using this exact rule:

1. Read persistedExpanded from the relevant is...Expanded selector.
2. Read autoExpanded from isCurrentSessionReveal for that row key.
3. If the row is visually expanded and autoExpanded is true, suppress its reveal key.
4. If it is visually expanded only because autoExpanded is true, return without calling the persisted toggle action.
5. If persistedExpanded is true, call the persisted toggle action to record the user's collapse.
6. On every actual collapse, clear the same transient Session group keys that the existing implementation clears.
7. If the row is visually collapsed, call the persisted toggle action to perform the normal explicit expand.

For example, the Workspace handler must have this behavior:

~~~ts
const toggleWorkspace = (workspaceId: string): void => {
  const persistedExpanded = isWorkspaceExpanded(expandSnapshot, workspaceId);
  const autoExpanded = isCurrentSessionReveal('workspace:' + workspaceId);
  const visuallyExpanded = persistedExpanded || autoExpanded;
  if (visuallyExpanded && autoExpanded) {
    suppressCurrentSessionReveal('workspace:' + workspaceId);
  }
  if (visuallyExpanded && !persistedExpanded) {
    clearSessionGroups([
      'main:' + workspaceId,
      ...(
        viewByWorkspace.get(workspaceId)?.worktrees.map((record) => record.worktreeId) ?? []
      ).map((worktreeId) => 'worktree:' + worktreeId),
    ]);
    return;
  }
  expandState.actions.toggleWorkspace(workspaceId);
  if (visuallyExpanded) {
    clearSessionGroups([
      'main:' + workspaceId,
      ...(
        viewByWorkspace.get(workspaceId)?.worktrees.map((record) => record.worktreeId) ?? []
      ).map((worktreeId) => 'worktree:' + worktreeId),
    ]);
  }
};
~~~

Apply the same two-path logic to Main and Worktree. Main clears only
main:workspaceId. Worktree clears only worktree:worktreeId. Use these handlers
so an automatically opened collapsed row is never persisted as expanded:

~~~ts
const toggleMain = (workspaceId: string): void => {
  const persistedExpanded = isMainExpanded(expandSnapshot, workspaceId);
  const autoExpanded = isCurrentSessionReveal('main:' + workspaceId);
  const visuallyExpanded = persistedExpanded || autoExpanded;
  if (visuallyExpanded && autoExpanded) {
    suppressCurrentSessionReveal('main:' + workspaceId);
  }
  if (visuallyExpanded && !persistedExpanded) {
    clearSessionGroups(['main:' + workspaceId]);
    return;
  }
  expandState.actions.toggleMain(workspaceId);
  if (visuallyExpanded) clearSessionGroups(['main:' + workspaceId]);
};

const toggleWorktree = (worktreeId: string): void => {
  const persistedExpanded = isWorktreeExpanded(expandSnapshot, worktreeId);
  const autoExpanded = isCurrentSessionReveal('worktree:' + worktreeId);
  const visuallyExpanded = persistedExpanded || autoExpanded;
  if (visuallyExpanded && autoExpanded) {
    suppressCurrentSessionReveal('worktree:' + worktreeId);
  }
  if (visuallyExpanded && !persistedExpanded) {
    clearSessionGroups(['worktree:' + worktreeId]);
    return;
  }
  expandState.actions.toggleWorktree(worktreeId);
  if (visuallyExpanded) clearSessionGroups(['worktree:' + worktreeId]);
};
~~~

Replace the duplicated Session overflow callbacks with one
toggleSessionGroup(groupKey) helper:

~~~ts
const toggleSessionGroup = (groupKey: string): void => {
  const autoExpanded = isCurrentSessionReveal('session-group:' + groupKey);
  const transientExpanded = expandedSessionGroups[groupKey] === true;
  if (autoExpanded) {
    suppressCurrentSessionReveal('session-group:' + groupKey);
    setExpandedSessionGroups((current) => {
      const next = { ...current };
      delete next[groupKey];
      return next;
    });
    return;
  }
  setExpandedSessionGroups((current) => ({
    ...current,
    [groupKey]: !transientExpanded,
  }));
};
~~~

Pass currentSessionId to both Main and Worktree WorktreeSessionGroup calls,
pass sessionGroupExpanded as expanded, and call toggleSessionGroup from both
overflow controls. The Main call must retain its existing group key and add:

~~~tsx
groupKey={mainGroupKey}
currentSessionId={currentSessionId}
  expanded={expandedSessionGroups[mainGroupKey] === true ||
  (shouldRevealCurrentSessionGroup(sessionIds, currentSessionId) &&
    isCurrentSessionReveal('session-group:' + mainGroupKey))}
onToggleExpanded={() => {
  toggleSessionGroup(mainGroupKey);
}}
~~~

The Worktree call uses the same props with worktreeGroupKey. Do not persist
expandedSessionGroups.

- [ ] Step 6: Run focused tests and inspect the diff for persistence leaks.

Run:

~~~bash
pnpm run build && node --test test/client-surface.test.mjs test/client-current-session-location.test.mjs
git diff --check
~~~

Expected: PASS; the diff contains no localStorage usage or new expandState
mutation in the reveal path, and existing structural persistence tests remain
unchanged.

- [ ] Step 7: Commit the temporary reveal behavior.

~~~bash
git add src/client/WorktreeSurface.tsx test/client-surface.test.mjs
git commit -m "feat(worktree): reveal current session path temporarily"
~~~

---

### Task 4: Position the current row once per locate generation

Files:

- Create: src/client/worktree-session-position.ts
- Modify: src/client/WorktreeSurface.tsx
- Create: test/client-worktree-session-position.test.mjs
- Modify: test/client-surface.test.mjs

Interfaces:

- Consumes: a ParentNode root and a Session ID.
- Produces: scrollCurrentSessionIntoView(root, sessionId): boolean, which returns false without side effects when the row is absent and calls scrollIntoView({ block: 'nearest' }) exactly once when found.

- [ ] Step 1: Add failing DOM-helper tests.

Create test/client-worktree-session-position.test.mjs with:

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollCurrentSessionIntoView } from '../lib/client/worktree-session-position.js';

function fakeRow(sessionId, calls) {
  return {
    dataset: { sessionId },
    scrollIntoView(options) {
      calls.push({ sessionId, options });
    },
  };
}

function fakeRoot(rows) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-session-id]');
      return rows;
    },
  };
}

test('scrolls only the matching row inside the supplied Worktree root', () => {
  const calls = [];
  const root = fakeRoot([
    fakeRow('other', calls),
    fakeRow('current', calls),
  ]);

  assert.equal(scrollCurrentSessionIntoView(root, 'current'), true);
  assert.deepEqual(calls, [
    { sessionId: 'current', options: { block: 'nearest' } },
  ]);
});

test('does not scroll when the current row is not rendered', () => {
  const calls = [];
  assert.equal(
    scrollCurrentSessionIntoView(fakeRoot([fakeRow('other', calls)]), 'missing'),
    false,
  );
  assert.deepEqual(calls, []);
});
~~~

- [ ] Step 2: Run the focused test and verify the missing-module failure.

Run:

~~~bash
pnpm run build && node --test test/client-worktree-session-position.test.mjs
~~~

Expected: FAIL because worktree-session-position.ts does not exist.

- [ ] Step 3: Implement the overlay-scoped DOM helper.

Create src/client/worktree-session-position.ts:

~~~ts
export function scrollCurrentSessionIntoView(
  root: ParentNode | null,
  sessionId: string,
): boolean {
  if (root === null) return false;
  const row = Array.from(root.querySelectorAll<HTMLElement>('[data-session-id]'))
    .find((candidate) => candidate.dataset.sessionId === sessionId);
  if (row === undefined) return false;
  row.scrollIntoView({ block: 'nearest' });
  return true;
}
~~~

The helper must not query document, native Sidebar elements, or any outer page
container. It receives the Worktree aside root from WorktreeSurface.

- [ ] Step 4: Run the helper tests and verify they pass.

Run:

~~~bash
pnpm run build && node --test test/client-worktree-session-position.test.mjs
~~~

Expected: PASS for matching and missing rows.

- [ ] Step 5: Add generation-guarded post-commit positioning.

Import scrollCurrentSessionIntoView into WorktreeSurface.tsx. Reuse the
locateGenerationRef and positionedLocateGenerationRef refs created in Task 3.

Place this layout effect after currentSessionLocation and reveal-state
derivation, so its dependencies describe the rendered target:

~~~ts
useLayoutEffect(() => {
  if (
    mode !== 'worktree' ||
    currentSessionId === undefined ||
    currentSessionLocation === undefined
  ) {
    return;
  }
  const generation = locateGenerationRef.current;
  if (positionedLocateGenerationRef.current === generation) return;
  let cancelled = false;
  const frame = requestAnimationFrame(() => {
    if (cancelled || generation !== locateGenerationRef.current) return;
    if (!scrollCurrentSessionIntoView(ref.current, currentSessionId)) return;
    positionedLocateGenerationRef.current = generation;
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}, [
  currentSessionId,
  currentSessionLocation,
  currentSessionReveal,
  expandSnapshot,
  mode,
  query,
  readState.status,
]);
~~~

The locate-trigger effect from Task 3 must be declared before this effect. That
ensures a mode/current-Session change increments the generation before the
position effect schedules its frame. The positioning effect may rerun when
ready data, query, or effective expansion changes so it can wait for a row that
was not committed yet, but the positioned generation guard prevents ordinary
refreshes from scrolling again.

- [ ] Step 6: Add source-level lifecycle assertions.

Add these assertions to test/client-surface.test.mjs:

~~~js
test('positions the current Worktree Session after commit and cancels stale work', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const positionSource = await readFile(
    new URL('../src/client/worktree-session-position.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /locateGenerationRef/);
  assert.match(source, /positionedLocateGenerationRef/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /cancelAnimationFrame/);
  assert.match(source, /scrollCurrentSessionIntoView/);
  assert.match(source, /generation !== locateGenerationRef\.current/);
  assert.match(positionSource, /querySelectorAll<HTMLElement>\('\\[data-session-id\\]'\)/);
  assert.match(positionSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.doesNotMatch(source, /document\.querySelector/);
});
~~~

- [ ] Step 7: Run all focused tests and inspect refresh behavior.

Run:

~~~bash
pnpm run build && node --test test/client-worktree-session-position.test.mjs test/client-surface.test.mjs test/client-session-view.test.mjs
git diff --check
~~~

Expected: PASS; ordinary ready refreshes keep the current projection and do not
create a second scroll for the same locate generation.

- [ ] Step 8: Commit the positioning unit.

~~~bash
git add src/client/worktree-session-position.ts src/client/WorktreeSurface.tsx test/client-worktree-session-position.test.mjs test/client-surface.test.mjs
git commit -m "feat(worktree): position current session row"
~~~

---

### Task 5: Document the browser-local behavior and verify the package

Files:

- Modify: README.md
- Modify: README.zh.md
- Modify: src/client/README.md
- Modify: test/client-surface.test.mjs

Interfaces:

- Consumes: the completed current marker, temporary reveal, search-clearing, and nearest-scroll behavior from Tasks 1–4.
- Produces: synchronized public documentation and a regression check that the documented boundary remains explicit.

- [ ] Step 1: Add failing documentation assertions.

Extend the existing README parity test in test/client-surface.test.mjs with:

~~~js
assert.match(readme, /current Session.*highlight|highlight.*current Session/i);
assert.match(readme, /temporar(y|ily).*reveal|temporary.*expand/i);
assert.match(readme, /does not change.*persisted.*expansion|persisted.*expansion.*unchanged/i);
assert.match(readmeZh, /当前 Session.*高亮|高亮.*当前 Session/);
assert.match(readmeZh, /临时.*展开|临时.*定位/);
assert.match(readmeZh, /不改变.*展开选择|展开选择.*不改变/);
assert.match(clientReadme, /current Session.*browser-local|当前 Session.*浏览器本地/i);
assert.match(clientReadme, /scrollIntoView|nearest visible area|最近可见区域/i);
~~~

- [ ] Step 2: Run the README test and verify the new assertions fail.

Run:

~~~bash
pnpm run build && node --test test/client-surface.test.mjs
~~~

Expected: FAIL only for the new current-Session documentation assertions.

- [ ] Step 3: Add synchronized public capability copy.

Add one English capability bullet near the existing expansion-state bullet:

~~~text
- Highlight the DSH current Session in Worktree view; entering Worktree mode or switching the current Session temporarily reveals its Workspace/Main/Worktree path, expands Session overflow only when the row is outside the first five, clears a hiding search, and scrolls the row into view without changing persisted expansion choices.
~~~

Add the corresponding Chinese bullet in the same capability position:

~~~text
- 在 Worktree view 高亮 DSH 当前 Session；进入 Worktree 模式或切换当前会话时，临时展开其 Workspace/Main/Worktree 路径；只有当前行不在前五行时才展开 Session 五行溢出，随后清空隐藏它的搜索并滚动定位，同时不改变已保存的展开选择。
~~~

Keep the bilingual source-of-truth wording, storage key, Session naming, and
command names synchronized. Do not add a package version to either README.

- [ ] Step 4: Document the Client boundary.

Add a Current Session reveal subsection after Browser-local expansion state in
src/client/README.md:

~~~text
### Current Session reveal and positioning

The Worktree surface reads DSH sessions.current as the only current-Session fact.
The matching Main, active Worktree, or detached Worktree row receives the current
marker. When Worktree mode opens or sessions.current changes, the Client clears
a search that would hide the row, temporarily expands the Workspace/Main/Worktree
path, expands the five-row Session overflow only when the current row is outside
the first five, and scrolls the row into the nearest visible area of the Worktree
overlay.

Reveal and suppression are in-memory presentation state. Automatic reveal never
mutates clutch-dsh-worktree.expand-state, DSH Workspace/Session data, Worktree
bindings, or sidecar records. A user's manual collapse wins for the current
Session, and the suppression resets when the current Session changes or Worktree
mode exits. Ordinary refreshes do not re-scroll an unchanged current Session;
missing or incomplete targets remain a normal unresolved view state rather than
a new domain error.
~~~

Translate the same facts into the existing English-only Client README style; do
not add unrelated public API details.

- [ ] Step 5: Run the documentation and focused regression tests.

Run:

~~~bash
pnpm run build && node --test test/client-surface.test.mjs test/client-current-session-location.test.mjs test/client-worktree-session-position.test.mjs
~~~

Expected: PASS for README parity, selector, DOM positioning, row marker, and
surface lifecycle assertions.

- [ ] Step 6: Commit the documentation.

~~~bash
git add README.md README.zh.md src/client/README.md test/client-surface.test.mjs
git commit -m "docs(worktree): document current session reveal"
~~~

- [ ] Step 7: Run package and workspace verification.

From the repository root, run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check:workspace
pnpm run check:patches
pnpm run check
git diff --check
~~~

Expected: every command exits 0. The package test builds the client before
running the Node test suite; generated lib output must remain ignored and
unstaged.

- [ ] Step 8: Inspect the final feature diff and worktree state.

Run:

~~~bash
git status --short --branch
git diff wt-worktree-0.1.6/release...HEAD -- src/client test README.md README.zh.md
git diff wt-worktree-0.1.6/release...HEAD --name-only | rg '(^|/)(src/(host|manage|provider|contract)|package.json|cordis.patch.yml|lib/|coverage/)'
~~~

Expected: the first command shows only intentional feature files or ignored
build output, the second diff contains the current-session client/test/docs
changes, and the final command prints no forbidden Host/Manage/Provider/
contract/package/generated paths.

---

## Spec Coverage Checklist

- Current row highlight from sessions.current: Task 2.
- Main, active Worktree, and detached Worktree resolution: Task 1.
- Temporary Workspace/Main/Worktree expansion: Task 3.
- Temporary fifth-row Session overflow expansion: Task 3.
- Search clearing only on Worktree entry/current Session change: Task 3 and Task 5.
- Manual collapse suppression without persisted-state mutation: Task 3.
- Nearest overlay-scoped scroll after commit: Task 4.
- Stale generation, unmount cleanup, missing target, and delayed ready data: Task 4.
- Refresh preservation and no repeated scroll on ordinary refresh: Task 4 and Task 5.
- Blank Session, menu, drag, and row geometry compatibility: Task 2 and Task 3.
- Browser-local public boundary and bilingual documentation: Task 5.
- Package, workspace, patch, and final diff verification: Task 5.

## Commit Sequence

The implementation should leave these scoped commits on
wt-worktree-0.1.6/feat-current-session-reveal after the existing spec commit
95abf92:

1. feat(worktree): resolve current session location
2. feat(worktree): highlight current session row
3. feat(worktree): reveal current session path temporarily
4. feat(worktree): position current session row
5. docs(worktree): document current session reveal

Do not rebase, merge, push, publish, or modify the release worktree as part of
executing this plan. The release-branch rebase/merge gate is handled separately
after this feature worktree has been reviewed and authorized.

## Regression follow-up — 2026-08-28

The current-session reveal originally expanded any Session group with more than
five rows. After Session ordering was corrected to put a newly observed Session
at the account head, that rule expanded the whole Worktree unnecessarily after
creation. The implementation now expands Session overflow only when the current
Session is outside the first five rows; structural ancestor reveal and
overlay-scoped positioning remain unchanged.
