# clutch-dsh-worktree Implementation Plan

> **For agentic workers:** The package-consolidation execution is complete; its
> record is in
> [2026-08-20-clutch-dsh-worktree-package-consolidation.md](2026-08-20-clutch-dsh-worktree-package-consolidation.md).
> This document is the feature roadmap after that migration. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DSH Web UI 增加 Project → Worktree → Session 视角，在不改写 DSH
原始 Workspace、Session 或会话内容的前提下，通过同一个
`clutch-dsh-worktree` plugin package 的 Host Provider、Remote facade 和
Browser Consumer 维护 Worktree/Session 关系。

**Architecture:** DSH 继续作为 Workspace、Session、消息和 transcript 的唯一
数据源；plugin 只保存 Worktree 生命周期和 Session binding sidecar。一个
package 内部以 `src/contract/`、`src/provider/`、`src/manage/` 和未来的
`src/client/` 保持单向依赖。`manage` 负责用例编排，`provider` 只负责
底层 adapter 和持久化。DSH bundle 通过 package.json 的 `dsh.bundle.patch` 激活，
不把能力角色误建模为三个必须独立发布的 package。

**Tech Stack:** pnpm workspace、TypeScript、Cordis/Typert、DSH Host/Client
API、生成的 Remote contribution、本地 Git CLI、Workspace-sharded JSON
sidecar、React/CSS Modules、Node test runner。

## Global Constraints

- 只使用 DSH 的公开 API 和扩展点，不修改 `/Users/yuancheng/Documents/Code/deepseek-harness`。
- `packages/clutch-dsh-worktree/` 是唯一 runnable package；`manager`、`local`、`ui` 是内部角色/目录概念。
- `src/contract/` 不依赖 Git、sidecar、React 或 DSH mutation API。
- `src/provider/` 不依赖 `src/manage/` 或 `src/client/`；它只负责底层 adapter 和持久化。
- `src/manage/` 组合 `contract` 与 `provider`，负责上层 Worktree/Session 用例编排。
- Provider 可以读取 DSH Workspace/Session，但不得写入或复制 Project/Workspace、Session header、消息、prompt、transcript、历史内容或原始 Session 列表。
- sidecar 只保存 Workspace/Worktree/Session relation、Worktree path/branch/status 和 schema version。
- 没有 binding、main binding 或 detached binding 时，运行时 cwd 是 DSH Workspace 根目录；active binding 才使用 Worktree 路径。
- 删除 Worktree 不删除 Session；删除后保留 detached 关系，显式解绑才回到 main。
- 关系写入幂等；同一 Session 绑定第二个 active Worktree 必须返回明确冲突。
- Git 只管理 Worktree 和 Git metadata，不修改工作树业务文件。
- 每个阶段必须有针对性的测试和文档更新；不执行 publish、push 或外部系统修改。

## Package layout

```text
packages/clutch-dsh-worktree/
├── package.json
├── cordis.patch.yml
├── src/
│   ├── index.ts          # Host/package entry
│   ├── contract/
│   │   ├── index.ts       # internal Service Definition
│   │   └── index.contract.ts
│   ├── provider/
│   │   ├── index.ts       # low-level Provider exports
│   │   ├── git.ts
│   │   ├── sidecar.ts
│   │   └── types.ts
│   ├── manage/
│   │   ├── index.ts       # Worktree/Session orchestration
│   │   ├── manager.ts
│   │   └── types.ts
│   └── client/             # browser Consumer, added in the UI phase
└── test/
```

`package.json` owns the external identity:

```json
{
  "name": "clutch-dsh-worktree",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "plugin",
    "serviceDefinition": "clutch-dsh-worktree"
  }
}
```

The empty patch used during the contract/Provider phases is intentional. The
Remote and UI phases replace it with the real DSH composition entries after
their entrypoints exist.

## Completed reconnaissance and implementation

### Phase 0 — DSH and repository reconnaissance

**Status:** complete.

Evidence recorded from DSH source and documentation:

- `dsh plugin` activates a dependency when its package manifest declares
  `dsh.bundle`; it does not require separate role packages.
- DSH explicitly allows one package to own multiple capability roles when the
  roles do not need independent evolution.
- A normal UI package can expose Host `src/index.ts` and browser
  `src/client/index.ts` entrypoints from one package.
- The generated Remote assembly remains a special build-plane exception and is
  not evidence that Worktree contract, Provider and UI need separate packages.

### Phase 1 — contract and package skeleton

**Status:** complete; the contract and Provider now live in the root package.

The stable internal contract contains Worktree/Branch/Session binding records,
the six approved WorktreeManager operations, stable error codes, and typed
error details. It does not contain Session content, Git commands, sidecar IO,
UI state, or a generic execution API.

### Phase 2 — Local Provider, Git, and sidecar

**Status:** complete; behavior is covered with injected `DshReadAdapter`,
`GitWorktreeAdapter`, and `SidecarStore`.

The Provider covers generated Worktree paths, local branch/worktree rules,
Workspace-sharded atomic sidecar writes, idempotent binding, conflict errors,
main/active/detached cwd resolution, and create/delete recovery. It does not
pretend to have a real DSH Host composition until Phase 3.

## Remaining roadmap

### Phase 3 — Host Remote and real DSH composition

- Add the generated `./remote` contribution from the same package's Host entry.
- Verify the target DSH release/profile explicitly mounts the contribution into
  `@deepseek-ai/dsh-api-remotes/client`.
- Use the existing DSH Remote assembly; do not create a second transport or
  patch DSH source.
- Add a real composition fixture or stop with documented evidence if the
  target release cannot mount the contribution.

### Phase 4 — Browser Consumer and peer Worktree mode

- Add `src/client/index.ts` and the browser-safe contract/client facade.
- Register a peer Worktree/Session navigation surface using DSH's supported
  sidebar/footer and shell overlay slots.
- Keep the native Workspace/Session browser intact.
- Store `viewMode` in browser-local state only; never write it to DSH or sidecar.

### Phase 5 — Worktree lifecycle UI

- List local branches and mark branches checked out by the Workspace or an
  active Worktree as unavailable.
- Create Worktrees only through Provider-generated paths and existing local
  branches; reject no-initial-commit, invalid branch, path conflict and
  already-checked-out cases with stable errors.
- Delete Worktrees only after explicit confirmation; show detached bindings and
  preserve Session history when synchronization needs repair.

### Phase 6 — Session creation, binding, and projection

- Create a normal DSH Session first with the selected Worktree cwd.
- Write the external binding second; if binding fails, keep the DSH Session and
  report the retry/degraded state.
- Read DSH's original Session list for Project view and join sidecar relations
  only for Worktree view.
- Open existing Sessions through DSH's normal `ctx.sessions.open` path.

### Phase 7 — End-to-end verification

Cover the following through package tests and a real DSH composition fixture:

- main, active Worktree and detached cwd resolution;
- repeated binding idempotency and active binding conflict;
- Workspace mismatch, relative path, root path, invalid branch and no-commit rejection;
- Worktree create/delete and Session create/bind recovery;
- byte-for-byte preservation of DSH Workspace/Session fixtures;
- Project Session view availability when sidecar is unavailable;
- Worktree-created Sessions appearing in the original DSH Session list;
- browser mode switching, detached/repair/degraded presentation and disposal.

## Handoff gate

The current handoff is the package-consolidation plan. Do not begin Phase 3 until
the root package, real DSH bundle manifest, migrated tests and updated design
records pass the focused checks. After each later phase, report changed files,
commands, results and unresolved DSH composition issues, then stop for approval.
