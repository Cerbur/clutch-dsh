# clutch-dsh-worktree Internal Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在单一 `clutch-dsh-worktree` package 内建立清晰的 `contract`、
`provider`、`manage` 和 `client` 内部模块，避免 Provider 同时承担上层
Worktree/Session 用例编排。

**Architecture:** `contract` 只定义稳定类型和 interface。`provider` 提供
Git、sidecar、DSH read adapter 和 provider-owned errors。`manage` 组合这些
Provider adapter，负责 Worktree/Session 生命周期、幂等、冲突、恢复和 cwd
解析。未来 `client` 只依赖 Manage 的 browser-safe facade/contract，不直接
读取 Provider。

**Tech Stack:** TypeScript、Node ESM、pnpm workspace、Node test runner、Git
worktree、Workspace-sharded JSON sidecar。

## Global Constraints

- 外部发布单元仍然只有 `clutch-dsh-worktree`，不新增 workspace package。
- `src/contract/` 不依赖 `provider`、`manage`、`client`、Git、sidecar 或 React。
- `src/provider/` 不依赖 `manage` 或 `client`；它只实现底层 adapter 和持久化机制。
- `src/manage/` 可以依赖 `contract` 和 `provider`，但不向上暴露 Git/sidecar implementation details。
- `src/client/` 不执行 Git、不读 sidecar、不导入 Provider internals；当前只建立规划入口，不伪造 UI 行为。
- 现有 Worktree/Session 行为必须保持不变：27 个 package tests 的语义全部保留。
- 不改变 DSH 数据边界、sidecar schema、错误码、恢复顺序或真实 DSH bundle manifest。
- 不修改 `/Users/yuancheng/Documents/Code/deepseek-harness`。

## Target layout

```text
packages/clutch-dsh-worktree/src/
├── index.ts                 # public package composition/export
├── contract/
│   ├── index.ts             # WorktreeManager contract and domain vocabulary
│   └── index.contract.ts    # compile-time contract assertions
├── provider/
│   ├── index.ts             # low-level Provider exports
│   ├── git.ts               # local Git adapter
│   ├── sidecar.ts           # sidecar repository and validation
│   └── types.ts             # DSH/Git/sidecar ports and Provider errors
├── manage/
│   ├── index.ts             # Manage exports
│   ├── manager.ts           # Worktree/Session use-case orchestration
│   └── types.ts             # Manage options and high-level service type
└── client/
    └── README.md            # future browser Consumer entrypoint
```

## Task 1: Add the failing module-graph test

**Files:**

- Create: `test/module-boundaries.test.mjs`

**Interfaces:**

- The test names the required internal module paths and asserts the dependency
  direction before the source move.

- [x] **Step 1: Write the failing test.**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');

test('keeps contract, provider, manage, and client as separate internal modules', async () => {
  const [contract, provider, manage, client] = await Promise.all([
    readFile(path.join(sourceRoot, 'contract', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'provider', 'index.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'manage', 'manager.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'client', 'README.md'), 'utf8'),
  ]);

  assert.match(contract, /interface WorktreeManager/);
  assert.match(provider, /LocalGitAdapter/);
  assert.match(manage, /WorktreeManagerImpl/);
  assert.match(manage, /\.\.\/provider/);
  assert.doesNotMatch(provider, /\.\.\/manage/);
  assert.match(client, /browser Consumer/);
});
```

- [x] **Step 2: Run it and confirm RED.**

Run:

```bash
node --test test/module-boundaries.test.mjs
```

The initial run was RED because the four internal module paths did not yet exist;
the post-migration run is GREEN.

## Task 2: Move the Service Definition into `src/contract/`

**Files:**

- Move: `src/contract.ts` → `src/contract/index.ts`
- Move: `src/index.contract.ts` → `src/contract/index.contract.ts`
- Modify: `src/contract/index.contract.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Produces the same `WorktreeManager`, record, error-code and JSON types from
  `src/contract/index.ts`.
- The compile-time assertion imports from `./index.js` inside the contract
  module; it does not import the package barrel.

- [x] **Step 1: Move the two contract files.**
- [x] **Step 2: Update the assertion import to `./index.js`.**
- [x] **Step 3: Export contract values/types from the root barrel.**
- [x] **Step 4: Run `pnpm --filter clutch-dsh-worktree typecheck`.**

Expected: the contract compiles without importing Provider or Manage.

## Task 3: Move low-level adapters into `src/provider/`

**Files:**

- Move: `src/git.ts` → `src/provider/git.ts`
- Move: `src/sidecar.ts` → `src/provider/sidecar.ts`
- Move: `src/types.ts` → `src/provider/types.ts`
- Create: `src/provider/index.ts`
- Modify: imports in the moved Provider files and `src/index.ts`

**Interfaces:**

- `src/provider/types.ts` owns `DshReadAdapter`, `GitWorktreeAdapter`,
  `SidecarStore`, `SidecarSnapshot`, `SIDECAR_SCHEMA_VERSION`, and
  `WorktreeProviderError`.
- `src/provider/index.ts` exports `LocalGitAdapter`,
  `WorkspaceShardedSidecarRepository`, sidecar validation, Provider errors and
  Provider port types.
- Provider imports contract types from `../contract/index.js` and never imports
  Manage.

- [x] **Step 1: Move the adapter files and add the Provider barrel.**
- [x] **Step 2: Update relative imports to `../contract/index.js` where needed.**
- [x] **Step 3: Remove Manage-only option/service types from Provider types.**
- [x] **Step 4: Run `pnpm --filter clutch-dsh-worktree typecheck`.**

Expected: Git and sidecar compile as low-level Provider modules with no Manage
dependency.

## Task 4: Move Worktree lifecycle orchestration into `src/manage/`

**Files:**

- Move: `src/provider.ts` → `src/manage/manager.ts`
- Create: `src/manage/index.ts`
- Create: `src/manage/types.ts`
- Modify: `src/manage/manager.ts`
- Modify: `src/index.ts`
- Rename: `test/provider.test.mjs` → `test/manage.test.mjs`
- Modify: `test/manage.test.mjs`

**Interfaces:**

```ts
export interface WorktreeManagerOptions {
  readonly dsh: DshReadAdapter;
  readonly dshHome: string;
  readonly git?: GitWorktreeAdapter;
  readonly sidecar?: SidecarStore;
  readonly idFactory?: () => string;
}

export interface WorktreeManagerService extends WorktreeManager {
  resolveRuntimeCwd(input: RuntimeCwdInput): Promise<string>;
}

export class WorktreeManagerImpl implements WorktreeManagerService {}

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManagerService;
```

`WorktreeManagerImpl` keeps the existing validation, idempotency, recovery and
cwd behavior. It composes `LocalGitAdapter` and
`WorkspaceShardedSidecarRepository` as defaults, while tests can continue to
inject fake adapters.

- [x] **Step 1: Add the new Manage names to `test/manage.test.mjs` before moving implementation.**
- [x] **Step 2: Run the Manage test and confirm RED because the new exports do not exist.**
- [x] **Step 3: Move and rename the current orchestration implementation.**
- [x] **Step 4: Add `WorktreeManagerOptions` and `WorktreeManagerService`.**
- [x] **Step 5: Export Manage from `src/manage/index.ts` and the root barrel.**
- [x] **Step 6: Run `pnpm --filter clutch-dsh-worktree test`.**

Expected: all existing 27 behavior tests pass, plus the module-boundary test, with the implementation now owned
by Manage rather than Provider (28 tests pass in total).

## Task 5: Establish the Client module and update package exports/docs

**Files:**

- Create: `src/client/README.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-19-clutch-dsh-worktree-design.md`
- Modify: `docs/superpowers/plans/2026-08-19-clutch-dsh-worktree-implementation.md`

- [x] **Step 1: Document `src/client/` as the future browser entrypoint.**
- [x] **Step 2: Keep the package export pointed at the root barrel and contract subpath.**
- [x] **Step 3: Update all diagrams and dependency rules to show `manage` above `provider`.**
- [x] **Step 4: Run the module-graph test and formatting check.**

## Task 6: Final verification

- [x] **Step 1: Run focused checks.**

```bash
node --test test/module-boundaries.test.mjs
pnpm --filter clutch-dsh-worktree typecheck
pnpm --filter clutch-dsh-worktree lint
pnpm --filter clutch-dsh-worktree test
```

- [x] **Step 2: Run repository checks.**

```bash
pnpm run check
pnpm run build
pnpm exec prettier --check .
git diff --check
```

- [x] **Step 3: Review the final tree.**

```bash
rg --files packages/clutch-dsh-worktree/src | sort
rg -n 'from .*manage|from .*provider|from .*contract' packages/clutch-dsh-worktree/src
```

Expected: one package with four internal directories, no nested runtime
packages, no generated output in the source tree, and no DSH source changes.
