# Worktree Blank Session Presentation Parity (4A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Worktree Session tree follow native DSH blank-Session presentation semantics without changing Session creation, binding persistence, or DSH-owned data.

**Architecture:** Add a small browser-only `session-view.ts` module for blank detection, visibility, display labels, and Session-title search matching. `WorktreeSurface.tsx` will use those pure functions for both Main and Worktree groups, while the existing DSH `useSessions` snapshot remains the only source of `blank` and `current` facts. The 4B blank-reuse and concurrent-create behavior is deliberately excluded.

**Tech Stack:** TypeScript, React, DSH Client snapshot hooks, Node's built-in test runner, pnpm workspace scripts.

## Global Constraints

- Scope is 4A presentation parity only; do not implement blank reuse, duplicate-action guards, request generations, or new RPCs.
- Treat `summary.blank === true` as blank; a missing `blank` fact is treated as non-blank for compatibility with partial browser fixtures.
- Only the DSH `sessions.current` snapshot selects which blank Session is visible.
- A hidden blank row is a render filter only; never delete a DSH Session, remove a Worktree binding, alter transcript data, or alter browser Workspace membership projection.
- Use the Worktree locale namespace key `session.new`: Simplified Chinese `新会话`, English `New Session`.
- Blank Session title search must not match either the localized `New Session` label or the generated Session ID. Workspace, Worktree branch, and path filtering keep their existing semantics.
- Keep the current `sessions.create({ cwd }) → bindSession → openSession` order, binding-failure recovery, and TODO2 preserving refresh behavior unchanged.
- Blank rows keep the existing Session drag behavior. Only the Rename/Fork/Archive row menu is removed.
- Do not modify DSH source packages, Host/Manage/Provider code, `src/client/entry.ts`, `src/client/worktree-view.ts`, or the user's untracked `docs/superpowers/drafts/` files.
- Do not stage `lib/`, generated Typert artifacts, coverage, or temporary files.

## File Map

- Create `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/session-view.ts` for pure browser Session presentation facts and derivation.
- Create `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-session-view.test.mjs` for direct unit coverage of blank visibility, labels, and search.
- Modify `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx` to consume the pure helpers, filter blank IDs before row limits, and omit the blank row menu.
- Modify `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/locales.ts` to add the native-compatible `session.new` copy in both languages.
- Modify `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs` with source-level wiring assertions for the two group paths and the conditional menu.
- Modify `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-locale.test.mjs` with exact `session.new` copy assertions.
- Modify `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/README.md` and `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/README.md` to document the public blank-row behavior.

---

### Task 1: Define failing unit tests for Session presentation facts

**Files:**
- Create: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-session-view.test.mjs`
- Create in Task 2: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/session-view.ts`

**Interfaces:**
- Consumes: the native DSH facts `sessions.current`, `sessions.byId[id].blank`, and `sessions.byId[id].displayTitle`.
- Produces: tests that define `isBlankSession`, `filterVisibleSessionIds`, `sessionDisplayLabel`, and `sessionMatchesQuery` before their implementation exists.

- [ ] **Step 1: Add the focused failing test file.**

Create `test/client-session-view.test.mjs` with this complete content:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterVisibleSessionIds,
  isBlankSession,
  sessionDisplayLabel,
  sessionMatchesQuery,
} from '../lib/client/session-view.js';

function sessions(overrides = {}) {
  return {
    ids: ['current-blank', 'stale-blank', 'normal', 'untitled'],
    current: 'current-blank',
    byId: {
      'current-blank': { blank: true, displayTitle: 'generated-current-id' },
      'stale-blank': { blank: true, displayTitle: 'generated-stale-id' },
      normal: { blank: false, displayTitle: 'Research notes' },
      untitled: { blank: false },
    },
    ...overrides,
  };
}

test('detects only the native blank flag', () => {
  const state = sessions();

  assert.equal(isBlankSession('current-blank', state), true);
  assert.equal(isBlankSession('normal', state), false);
  assert.equal(isBlankSession('unknown', state), false);
});

test('keeps the current blank Session and hides stale blank Sessions', () => {
  const state = sessions();

  assert.deepEqual(
    filterVisibleSessionIds(
      ['normal', 'stale-blank', 'current-blank', 'untitled'],
      state,
    ),
    ['normal', 'current-blank', 'untitled'],
  );

  assert.deepEqual(
    filterVisibleSessionIds(
      ['current-blank', 'normal'],
      sessions({ current: undefined }),
    ),
    ['normal'],
  );
});

test('uses the localized New Session label only for blank Sessions', () => {
  const state = sessions();

  assert.equal(sessionDisplayLabel('current-blank', state, 'New Session'), 'New Session');
  assert.equal(sessionDisplayLabel('normal', state, 'New Session'), 'Research notes');
  assert.equal(sessionDisplayLabel('untitled', state, 'New Session'), 'untitled');
});

test('excludes blank Sessions from title and generated-id search', () => {
  const state = sessions();

  assert.equal(sessionMatchesQuery('current-blank', state, 'new session'), false);
  assert.equal(sessionMatchesQuery('current-blank', state, 'generated-current-id'), false);
  assert.equal(sessionMatchesQuery('normal', state, 'research'), true);
  assert.equal(sessionMatchesQuery('untitled', state, 'untitled'), true);
});
```

- [ ] **Step 2: Run the focused test and verify the failure is the missing module.**

From `/Users/yuancheng/Documents/Code/clutch-dsh`, run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/client-session-view.test.mjs
```

Expected: the build succeeds, then Node fails with an `ERR_MODULE_NOT_FOUND` for `lib/client/session-view.js`. Do not implement the module before confirming the test is exercising the intended missing interface.

- [ ] **Step 3: Commit the failing contract tests.**

```bash
git add packages/clutch-dsh-worktree/test/client-session-view.test.mjs
git commit -m "test(worktree): define blank session presentation facts"
```

Do not stage the untracked draft files or generated `lib/` output.

### Task 2: Implement the pure Session presentation module

**Files:**
- Create: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/session-view.ts`
- Test: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-session-view.test.mjs`

**Interfaces:**
- Consumes: the failing tests from Task 1.
- Produces: exported `SessionListLike`, `isBlankSession`, `filterVisibleSessionIds`, `sessionDisplayLabel`, and `sessionMatchesQuery` for `WorktreeSurface.tsx`; `isVisibleSession` remains an internal helper.

- [ ] **Step 1: Add the module with the exact structural types and functions.**

Create `src/client/session-view.ts` with this content:

```ts
/** Browser-visible DSH Session summary facts used by the Worktree tree. */
export interface SessionSummaryLike {
  /** Native DSH's empty-log bit. Missing is treated as non-blank. */
  readonly blank?: boolean;
  readonly displayTitle?: string;
}

/** The subset of the DSH Session list consumed by this browser Consumer. */
export interface SessionListLike {
  readonly ids: readonly string[];
  readonly current?: string;
  readonly byId: Record<string, SessionSummaryLike>;
}

/** Read the native blank flag without inferring blankness from title or id. */
export function isBlankSession(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId'>,
): boolean {
  return sessions.byId[sessionId]?.blank === true;
}

/** Native tree visibility: ordinary rows plus the currently selected blank row. */
function isVisibleSession(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId' | 'current'>,
): boolean {
  return !isBlankSession(sessionId, sessions) || sessions.current === sessionId;
}

/** Filter a group without mutating its source order. */
export function filterVisibleSessionIds(
  sessionIds: readonly string[],
  sessions: Pick<SessionListLike, 'byId' | 'current'>,
): readonly string[] {
  return sessionIds.filter((sessionId) => isVisibleSession(sessionId, sessions));
}

/** Resolve a row title while keeping the blank label outside the DSH summary. */
export function sessionDisplayLabel(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId'>,
  blankLabel: string,
): string {
  const summary = sessions.byId[sessionId];
  return summary?.blank === true ? blankLabel : summary?.displayTitle ?? sessionId;
}

/** Match only durable Session titles or the final diagnostic id fallback. */
export function sessionMatchesQuery(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId'>,
  normalizedQuery: string,
): boolean {
  const summary = sessions.byId[sessionId];
  if (summary?.blank === true) return false;
  const label = summary?.displayTitle ?? sessionId;
  return label.toLocaleLowerCase().includes(normalizedQuery);
}
```

- [ ] **Step 2: Build and run the focused tests.**

```bash
cd /Users/yuancheng/Documents/Code/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test packages/clutch-dsh-worktree/test/client-session-view.test.mjs
```

Expected: typecheck, build, and all four focused tests pass. The helper must preserve input array order and must not mutate either `ids` or `byId`.

- [ ] **Step 3: Commit the pure helper.**

```bash
git add packages/clutch-dsh-worktree/src/client/session-view.ts
git commit -m "feat(worktree): add blank session presentation helpers"
```

### Task 3: Wire blank semantics into Main and Worktree rows

**Files:**
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx:58-305,620-835,866-870,1541-1718`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/locales.ts:1-180`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-surface.test.mjs`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-locale.test.mjs`
- Test: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/test/client-session-view.test.mjs`

**Interfaces:**
- Consumes: `SessionListLike` and the four pure functions from `session-view.ts`.
- Produces: a Worktree surface where current blank rows show localized `New Session`, stale blank rows are filtered before row limits, blank rows have no Session menu, and normal rows retain existing behavior.

- [ ] **Step 1: Add failing source and locale assertions.**

Append this test to `test/client-locale.test.mjs`:

```js
test('uses native-compatible blank Session labels', () => {
  assert.equal(zh['session.new'], '新会话');
  assert.equal(en['session.new'], 'New Session');
});
```

Add this test to `test/client-surface.test.mjs`:

```js
test('wires native blank Session visibility and menu parity into both tree groups', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const localeSource = await readFile(
    new URL('../src/client/locales.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /session-view\.js/);
  assert.match(source, /filterVisibleSessionIds/);
  assert.match(source, /isBlankSession/);
  assert.match(source, /sessionMatchesQuery/);
  assert.match(source, /blank=\{isBlankSession\(sessionId, sessions\)\}/);
  assert.match(localeSource, /'session\.new': '新会话'/);
  assert.match(localeSource, /'session\.new': 'New Session'/);

  const rowStart = source.indexOf('function WorktreeSessionRow');
  const rowEnd = source.indexOf('interface WorktreeSessionGroupProps', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);
  assert.match(rowSource, /readonly blank: boolean/);
  assert.match(rowSource, /data-session-blank/);
  assert.match(rowSource, /\{!blank && \(/);
});
```

Run the focused source/locale checks from the package directory after the existing build:

```bash
cd /Users/yuancheng/Documents/Code/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test \
  packages/clutch-dsh-worktree/test/client-locale.test.mjs \
  packages/clutch-dsh-worktree/test/client-surface.test.mjs
```

Expected: the new locale assertion fails because `session.new` is absent, and the surface assertion fails because no blank wiring exists yet. Existing unrelated tests must remain green.

- [ ] **Step 2: Replace the local Session list type and label helper.**

In `WorktreeSurface.tsx`, remove the local `SessionListLike` interface and import the type/functions:

```ts
import {
  filterVisibleSessionIds,
  isBlankSession,
  sessionDisplayLabel,
  sessionMatchesQuery,
  type SessionListLike,
} from './session-view.js';
```

Replace the current `sessionLabel` function with:

```ts
function sessionLabel(
  sessionId: string,
  sessions: SessionListLike,
  t: WorktreeTranslate,
): string {
  return sessionDisplayLabel(sessionId, sessions, t('session.new'));
}
```

Keep the existing `sessions` cast at the `useSessions` boundary, but cast to the imported structural type:

```ts
const sessions = useSessions((state) => state) as SessionListLike;
```

- [ ] **Step 3: Make Workspace search use the blank-excluding Session matcher.**

In `workspaceMatches`, replace both Session label checks with `sessionMatchesQuery`:

```ts
if (workspace.sessionIds.some((sessionId) => sessionMatchesQuery(sessionId, sessions, query))) {
  return true;
}
```

and:

```ts
return view.bindings.some((binding) =>
  sessionMatchesQuery(binding.sessionId, sessions, query),
);
```

This ensures a blank row cannot make a Workspace match because the user typed `New Session` or the generated Session ID. Workspace title, Worktree branch, and absolute path matching remain unchanged.

- [ ] **Step 4: Filter Main and Worktree IDs before search and five-row truncation.**

For Main, replace the direct `mainSessionIds` assignment with:

```ts
const mainSessionIds = filterVisibleSessionIds(
  unboundSessionIds(allWorkspaceSessionIds, [...boundSessionIds]),
  sessions,
);
const visibleMainSessionIds = mainSessionIds.filter(
  (sessionId) =>
    workspaceMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
);
```

For each Worktree, replace the `worktreeSessionIds` assignment with:

```ts
const worktreeSessionIds = filterVisibleSessionIds(
  filterArchivedSessionIds(
    bindingIdsFor(bindings, record.worktreeId).filter((sessionId) =>
      sessions.ids.includes(sessionId),
    ),
    archivedSessionIds,
  ),
  sessions,
);
```

Replace both Worktree search checks with `sessionMatchesQuery`:

```ts
!worktreeSessionIds.some((sessionId) =>
  sessionMatchesQuery(sessionId, sessions, query),
)
```

and:

```ts
const visibleWorktreeSessionIds = worktreeSessionIds.filter(
  (sessionId) =>
    worktreeMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
);
```

The order is intentional: archived and stale blank rows are removed before the `WorktreeSessionGroup` applies `slice(0, 5)`. If a Workspace or branch/path query matches the group, the current blank row may remain in that group; blank rows still never match their own title or id.

- [ ] **Step 5: Pass blank state to the row and omit only its Session menu.**

Add this prop to `WorktreeSessionRowProps`:

```ts
readonly blank: boolean;
```

Destructure it in `WorktreeSessionRow` and add a diagnostic DOM fact to the row:

```tsx
data-session-blank={blank ? 'true' : undefined}
```

Keep the current drag handlers and Session content button. Replace the unconditional `rowActions` block with:

```tsx
{!blank && (
  <span className={styles.rowActions}>
    <Menu
      open={menuOpen}
      onClose={() => {
        setMenuOpen(false);
      }}
      items={sessionMenuItems}
      onSelect={(id) => {
        setMenuOpen(false);
        if (id === 'rename') onRename?.(sessionId, label);
        if (id === 'fork') onFork?.(sessionId);
        if (id === 'archive') onArchive?.(sessionId);
      }}
      portal
      closeOnPointerLeave
      anchor={(
        <button
          type="button"
          className={styles.iconButton}
          data-session-menu
          aria-label={t('session.options', { name: label })}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((current) => !current);
          }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  </span>
)}
```

The visible Session content button already receives `label` as text, so `New Session` is its accessible name; no generated ID is exposed through the row. Do not pass a disabled blank menu or add a blank-specific rename handler.

- [ ] **Step 6: Pass the blank fact from `WorktreeSessionGroup`.**

In the `WorktreeSessionRow` call, add the prop and pass the localized label through `t`:

```tsx
<WorktreeSessionRow
  t={t}
  key={`${groupKey}:${sessionId}`}
  sessionId={sessionId}
  blank={isBlankSession(sessionId, sessions)}
  label={sessionLabel(sessionId, sessions, t)}
  ...
/>
```

Update every remaining `sessionLabel(sessionId, sessions)` call to `sessionLabel(sessionId, sessions, t)`. Search predicates must use `sessionMatchesQuery`, not the localized display label.

- [ ] **Step 7: Add the two locale entries.**

In both dictionaries in `src/client/locales.ts`, add the key next to the existing `session.options` entry:

```ts
'session.new': '新会话',
```

and:

```ts
'session.new': 'New Session',
```

The existing locale key-set test will continue to enforce that both dictionaries stay balanced.

- [ ] **Step 8: Run the focused tests and typecheck.**

```bash
cd /Users/yuancheng/Documents/Code/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
node --test \
  packages/clutch-dsh-worktree/test/client-session-view.test.mjs \
  packages/clutch-dsh-worktree/test/client-locale.test.mjs \
  packages/clutch-dsh-worktree/test/client-surface.test.mjs
```

Expected: all focused tests pass; no test should require a DSH Session deletion, a new Manager endpoint, or a transcript fixture.

- [ ] **Step 9: Commit the Client parity implementation.**

```bash
git add \
  packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx \
  packages/clutch-dsh-worktree/src/client/locales.ts \
  packages/clutch-dsh-worktree/test/client-surface.test.mjs \
  packages/clutch-dsh-worktree/test/client-locale.test.mjs
git commit -m "feat(worktree): match native blank session rows"
```

Do not stage `docs/superpowers/drafts/` or generated build output.

### Task 4: Document the public 4A behavior

**Files:**
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/README.md`
- Modify: `/Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-worktree/src/client/README.md`

**Interfaces:**
- Consumes: the verified Client behavior from Task 3.
- Produces: public documentation that distinguishes a provisional blank Session from a normal Session without documenting the out-of-scope 4B reuse behavior.

- [ ] **Step 1: Add the user-facing behavior to the package README.**

Under `## 当前限制`, after the existing paragraph describing Worktree Session creation, add:

```md
未发送第一条 prompt 的 provisional blank Session 遵循 DSH 原生显示规则：仅在当前选中的视角中显示本地化的“新会话”/“New Session”，不显示生成的 Session ID，也不显示重命名、Fork 或归档菜单。首条 prompt 被接受后，原生 Session summary 转为普通会话，Worktree 行恢复显示真实标题和菜单；隐藏 blank 行不会删除 Session 或 Worktree binding。
```

- [ ] **Step 2: Clarify the Client contract.**

In `src/client/README.md`, extend the existing Worktree surface contract bullet:

```md
- Session menus retain Rename/Fork/Archive for ordinary Sessions. A provisional blank Session is visible only while it is the current DSH Session, uses the localized `New Session` label, and has no Session action menu; the binding remains browser/sidecar-owned even when the row is hidden.
```

Remove or rewrite the older sentence that says all Session menus retain Rename/Fork/Archive without this blank exception. Do not mention reusing an existing blank Session in this 4A documentation; that belongs to TODO4B.

- [ ] **Step 3: Run documentation and full package verification.**

```bash
cd /Users/yuancheng/Documents/Code/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check:workspace
pnpm run check:patches
pnpm run check
git diff --check
git status --short --branch
```

Expected: every available command exits 0; the only tracked changes are the 4A implementation, tests, and documentation; the three existing untracked draft files remain untouched.

- [ ] **Step 4: Commit the documentation.**

```bash
git add \
  packages/clutch-dsh-worktree/README.md \
  packages/clutch-dsh-worktree/src/client/README.md
git commit -m "docs(worktree): describe blank session presentation"
```

## Completion Criteria

4A is complete only when all of the following are true:

- Current blank Main and Worktree Sessions display localized `New Session` and never their generated IDs.
- A blank Session that is no longer current disappears from both Main and Worktree groups without changing any binding or DSH data.
- Blank rows have no Rename, Fork, or Archive menu; ordinary rows retain all existing actions and drag behavior.
- Blank rows do not match Session-title searches by localized label or generated ID; existing Workspace/branch/path search behavior remains intact.
- DSH summary updates alone promote a blank row to an ordinary row after the first accepted prompt.
- Binding failure recovery and TODO2 preserving refresh behavior remain unchanged.
- The package typecheck, build, tests, workspace checks, patch checks, and `git diff --check` pass.

## Explicit Non-Goals

- Reusing an existing blank Session when Worktree `+` is clicked.
- Coalescing concurrent Worktree Session creation requests.
- Changing `createSessionForWorktree`, `entry.ts`, the Worktree Manager contract, or the sidecar schema.
- Reading transcript content or guessing whether a prompt was accepted.
- Changing native DSH packages or adding a new Client transport.
