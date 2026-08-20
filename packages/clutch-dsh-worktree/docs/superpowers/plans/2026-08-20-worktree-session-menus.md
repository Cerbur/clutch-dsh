# Worktree Session Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Worktree 侧边栏中复用 DSH 原生菜单/对话框组件，支持 Session 的 Rename/Fork/Archive 选项，并把 active Worktree 的 Remove 移入 Worktree 选项菜单。

**Architecture:** `WorktreeSurface` 继续拥有 Worktree projection 和动作状态，只把行内交互改成 DSH primitives。`entry.ts` 提供最小的原生 DSH Session/Workspace action callbacks；Worktree Manager 的 sidecar、binding、remove confirmation 和错误语义保持不变。菜单使用 `@deepseek-ai/dsh-client-ui-primitives` 的 portal 版本，避免自绘第二套菜单。

**Tech Stack:** TypeScript, React 18, `@deepseek-ai/dsh-client-ui-primitives` (`Menu`, `Modal`, `Button`, `Input`, icons), CSS Modules with `--dsw-*` tokens, Node test runner.

## Global Constraints

- 只修改 `/Users/yuancheng/Documents/Code/clutch-dsh`；不得修改 `/Users/yuancheng/Documents/Code/deepseek-harness`。
- DSH 继续是 Project/Workspace、Session、标题、Archive 集合和消息内容的唯一数据源；plugin 不复制或改造 Session 内容。
- `@deepseek-ai/dsh-client-ui-primitives` 是静态 Web UI baseline：只作为开发时 TypeScript 输入，并在 `scripts/build-client.mjs` 中 externalize，不在 plugin bundle 内复制 primitives。
- 所有菜单操作必须有明确的 `aria-label`；Session 内容区和菜单 trigger 必须是相互独立的交互元素。
- Worktree Remove 只对 `record.status === 'active'` 的 Worktree 提供；确认后沿用 `executeWorktreeAction` 和现有确认框。
- 每个行为先写一个会失败的测试，运行确认失败，再写最小实现；每步保持 `pnpm --filter @cerbur/clutch-dsh-worktree test` 可运行。

## File map

- `package.json` — 声明 primitives 的开发依赖。
- `scripts/build-client.mjs` — 将 primitives 加入 DSH baseline external 列表。
- `src/client/entry.ts` — 从 DSH Context 注入 rename/fork/archive callbacks。
- `src/client/worktree-view.ts` — 提供 archived-session 过滤的纯函数，供组件和测试复用。
- `src/client/WorktreeSurface.tsx` — 添加 Session/Worktree row menus、Rename Modal，并替换 Remove 行内按钮。
- `src/client/worktree.css` — 为 menu-open row、session content/actions、rename input 提供 token-only CSS。
- `test/client-surface.test.mjs` — source-level UI contract 和 archived filter 回归测试。
- `test/client-composition.test.mjs` — Client entry injection contract 回归测试。

### Task 1: Add the red tests for native menu contracts

**Files:**

- Modify: `test/client-surface.test.mjs`
- Modify: `test/client-composition.test.mjs`

**Interfaces:**

- Consumes: current `WorktreeSurface.tsx`, `entry.ts`, and `worktree-view.ts` source files.
- Produces: failing assertions that define the public UI behavior without rendering a second test-only framework.

- [x] **Step 1: Add a failing surface contract test.**

Append a test that reads `src/client/WorktreeSurface.tsx` and asserts the source imports the public primitives module, renders a `Menu` for Session actions and Worktree actions, includes the three native Session labels and the Worktree remove menu marker, uses portal/leave behavior, and no longer renders the old inline `Remove` control. The assertions should be:

```js
test('uses native DSH menus for Session and Worktree row actions', async () => {
  const source = await readFile(new URL('../src/client/WorktreeSurface.tsx', import.meta.url), 'utf8')
  assert.match(source, /from ['"]@deepseek-ai\/dsh-client-ui-primitives['"]/
  assert.match(source, /\bMenu\b/)
  assert.match(source, /\bModal\b/)
  assert.match(source, /\bButton\b/)
  assert.match(source, /\bInput\b/)
  for (const label of ['Rename', 'Fork session', 'Archive session']) assert.match(source, new RegExp(label))
  assert.match(source, /Remove Worktree/)
  assert.match(source, /portal/)
  assert.match(source, /closeOnPointerLeave/)
  assert.match(source, /data-session-menu/)
  assert.match(source, /data-worktree-menu/)
  assert.doesNotMatch(source, /className=\{styles\.inlineButton\}[\s\S]*?>\s*Remove\s*</)
})
```

- [x] **Step 2: Add a failing entry injection contract test.**

Read `src/client/entry.ts` and assert the Worktree surface injection includes `renameSession`, `forkSession`, and `archiveSession`, plus the native API calls `sessions.binding`, `sessions.fork`, and `workspaces.archiveSession`.

- [x] **Step 3: Run the focused tests and verify RED.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: existing tests pass, and the two new tests fail because the current surface has no primitives menus and the entry injects no native Session action callbacks.

### Task 2: Make the primitives available without bundling a duplicate UI kit

**Files:**

- Modify: `package.json`
- Modify: `scripts/build-client.mjs`

**Interfaces:**

- Consumes: DSH rc.8 static baseline module `@deepseek-ai/dsh-client-ui-primitives`.
- Produces: TypeScript resolution for primitives and a browser artifact that requests the existing DSH module instead of bundling a private copy.

- [x] **Step 1: Add the development dependency.**

Add `"@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8"` under `devDependencies`, keeping the existing peer/dependency policy for dynamic DSH packages unchanged.

- [x] **Step 2: Add primitives to the client external list.**

In `scripts/build-client.mjs`, add the exact module specifier to `clientExternals`:

```js
const clientExternals = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
]
```

- [x] **Step 3: Refresh the workspace link and verify the focused build.**

Run from the repository root:

```bash
pnpm install --lockfile-only
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
```

Expected: the lockfile records the dev dependency, typecheck/build exit 0, and `lib/client.js` contains an external request for the primitives module rather than the `Menu` implementation.

### Task 3: Inject native DSH Session actions

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/entry.ts`
- Modify: `test/client-composition.test.mjs`

**Interfaces:**

- Consumes: `ClientContext`, `ctx.sessions.binding`, `ctx.sessions.fork`, `ctx.sessions.open`, and `ctx.workspaces.archiveSession`.
- Produces: `WorktreeSurfaceInjected` callbacks:

```ts
readonly renameSession?: (sessionId: string, title: string) => Promise<void>
readonly forkSession?: (sessionId: string) => void
readonly archiveSession?: (sessionId: string) => Promise<void>
```

- [x] **Step 1: Extend the injected type and test the callback shape.**

Add the three optional callbacks to `WorktreeSurfaceInjected`. Extend the composition test fixture assertions to require that the overlay inject factory exposes all three names.

- [x] **Step 2: Implement rename through the bound native Session.**

Inside the overlay inject factory, add:

```ts
renameSession: async (sessionId, title) => {
  const session = ctx.sessions.binding(sessionId as SessionId)?.session
  if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
  const result = await session.rename(title)
  if (!result.ok) throw new Error(result.error.message)
},
```

This must not write the Worktree sidecar or mutate Workspace membership.

- [x] **Step 3: Implement fork/open and archive through native APIs.**

Use the same semantics as DSH `ui-workspace`:

```ts
forkSession: (sessionId) => {
  void ctx.sessions.fork({ sessionId: sessionId as SessionId, increaseTitle: true })
    .then((childId) => { ctx.sessions.open(childId) })
    .catch(() => {})
},
archiveSession: (sessionId) =>
  ctx.workspaces.archiveSession(sessionId as Parameters<typeof ctx.workspaces.archiveSession>[0]),
```

Keep fork failures non-destructive and let Archive failures return to the surface for display.

- [x] **Step 4: Run the injection tests and verify GREEN for this slice.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- --test-name-pattern='Client|injection|composition'
```

Expected: the new injection assertions pass; menu assertions remain red until Task 4.

### Task 4: Add the DSH-style Session row menu and Rename Modal

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: the three injected callbacks from Task 3 and public primitives.
- Produces: a Session row component with independent content and menu trigger, plus controlled Rename modal state.

- [x] **Step 1: Add the Session row menu state and actions.**

Define a focused `WorktreeSessionRow` component above `WorktreeSurface`. Its menu items must be:

```tsx
[
  { id: 'rename', label: 'Rename', icon: <IconEditOutline16 /> },
  { id: 'fork', label: 'Fork session', icon: <IconBranchOutline16 /> },
  { id: 'archive', label: 'Archive session', icon: <IconArchiveOutline20 size={16} /> },
]
```

Use `Menu` with `portal`, `closeOnPointerLeave`, and `onSelect` that stops only the menu, then calls the parent action callback. The menu trigger must stop propagation so clicking ellipsis never opens the Session. The main Session content remains a button and calls `openWorkspaceSession`.

- [x] **Step 2: Replace each Worktree Session button with the row component.**

Pass workspace/session IDs, current display label, bound/detached status, action pending state, `openWorkspaceSession`, and menu callbacks. Keep the existing query filtering and tree guide output. Do not copy Session contents into a new model.

- [x] **Step 3: Add controlled Rename Modal behavior.**

In `WorktreeSurface`, add target/draft/pending/error state. Selecting Rename sets the target and current display title. Confirm trims the draft, calls `renameSession`, closes on success, and preserves the modal with `role="alert"` error text on failure. Render the modal with public `Modal`, `Input`, and `Button` primitives; Enter confirms when the draft is non-empty, Escape/outside click closes when not pending.

- [x] **Step 4: Add token-only row action CSS.**

Add `.treeSessionRow`, `.treeSessionContent`, `.rowActions`, `.menuOpen`, and `.renameInput` rules. The row actions stay hidden until hover or menu-open, use DSH semantic tokens, and preserve focus/reduced motion. Do not add literal palette values.

- [x] **Step 5: Run the surface tests and verify GREEN for Session menus.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: the native primitives/menu source tests pass and no existing Worktree surface tests regress.

### Task 5: Move Worktree Remove into its own options menu

**Files:**

- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `src/client/worktree.css`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: `worktreeRemoval` confirmation state and `executeWorktreeAction` already used by the existing Remove confirmation.
- Produces: active Worktree rows with an ellipsis menu whose `remove` item opens the existing confirmation modal; detached rows expose no remove item.

- [x] **Step 1: Add the Worktree row menu trigger and item.**

Use `Menu` with `portal` and `closeOnPointerLeave`, anchored to `IconEllipsisOutline16`. The only active item is `{ id: 'remove', label: 'Remove Worktree', icon: <IconTrashOutline16 />, danger: true }`. On selection set `worktreeRemoval(record)` and clear `actionError`.

- [x] **Step 2: Remove the inline Remove button.**

Delete the current `styles.inlineButton` Remove element. Keep the active-only `+` Session button and status text. Add `data-worktree-menu` to the menu trigger so the contract test can distinguish it from the Session menu.

- [x] **Step 3: Keep confirmation and mutation semantics unchanged.**

The existing confirmation button still calls `executeWorktreeAction(manager, { type: 'removeWorktree', input: { workspaceId, worktreeId } })`; it must close the confirmation only after the request is accepted, refresh the projection, and leave sidecar state untouched on failure.

- [x] **Step 4: Run the focused surface tests.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Expected: the Worktree menu assertions pass, no inline Remove control remains, and existing remove recovery tests continue to pass.

### Task 6: Filter archived Session projections and finish package verification

**Files:**

- Modify: `src/client/worktree-view.ts`
- Modify: `src/client/WorktreeSurface.tsx`
- Modify: `test/client-surface.test.mjs`

**Interfaces:**

- Consumes: DSH Workspace snapshot's optional `archivedSessionIds` and the existing Session ID projection.
- Produces: pure helper:

```ts
export function filterArchivedSessionIds(
  sessionIds: readonly string[],
  archivedSessionIds: readonly string[],
): readonly string[]
```

- [x] **Step 1: Write and run the failing archived filter test.**

Import the helper from `../lib/client/worktree-view.js` and assert `['main', 'archived', 'bound']` with `['archived']` returns `['main', 'bound']`, preserving input order and leaving unknown archive IDs harmless. Run the single test through the package test command and confirm it fails because the helper is not defined.

- [x] **Step 2: Implement the minimal pure filter.**

Return `sessionIds.filter(sessionId => !archivedSessionIds.includes(sessionId))`; do not mutate either input.

- [x] **Step 3: Apply the helper to Main and Worktree rows.**

Read `workspaces.archivedSessionIds ?? []` from the existing Workspace hook snapshot, filter the Workspace's Main IDs and binding IDs before rendering, and keep the sidecar binding untouched.

- [x] **Step 4: Run all package checks.**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run check:workspace
pnpm run check:patches
git diff --check
```

Expected: all commands exit 0; no DSH source path is modified; generated `lib/` remains ignored/untracked.

### Task 7: Visual QA in Arc and final review

**Files:**

- Verify: `src/client/WorktreeSurface.tsx`, `src/client/worktree.css`, built `lib/client.js` through the running DSH profile.

- [x] **Step 1: Rebuild the plugin and refresh the running DSH Web UI.**

Run the package build, then reload `http://127.0.0.1:3080/` in the already-open Arc window. Do not modify or reinstall the DSH source checkout.

- [x] **Step 2: Verify Session menu behavior.**

Open Worktree mode, hover a bound Session row, click its ellipsis, and verify the portal card matches DSH native spacing/icon treatment and contains Rename/Fork/Archive. Click Rename and verify the DSH-styled Modal opens; cancel, reopen, and verify outside click/Escape behavior.

- [x] **Step 3: Verify Worktree menu behavior.**

Hover an active Worktree row and verify only ellipsis plus Session `+` are visible. Open ellipsis, select Remove Worktree, verify the existing confirmation text, cancel, reopen and confirm removal. Verify detached Worktrees have no remove menu.

- [x] **Step 4: Inspect final scope.**

Run `git status --short`, confirm only the package, spec, plan, and intended tests/source changed, and report the exact verification commands and any live-server limitations.
