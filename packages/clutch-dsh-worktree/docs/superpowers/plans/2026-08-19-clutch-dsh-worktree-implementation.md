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
package 内部以 `src/contract/`、`src/provider/`、`src/manage/`、`src/host/`
和 `src/client/` 保持单向依赖。`manage` 负责用例编排，`provider` 只负责
底层 adapter 和持久化，`host` 是真实 DSH composition root，`client` 当前只
提供 browser-safe facade。DSH bundle 通过 package.json 的
`dsh.bundle.patch` 激活，不把能力角色误建模为三个必须独立发布的 package。

**Tech Stack:** pnpm workspace、TypeScript、Cordis/Typert、DSH Host/Client
API、生成的 Remote contribution、本地 Git CLI、Workspace-sharded JSON
sidecar、React/CSS Modules、Node test runner。

## Global Constraints

- 只使用 DSH 的公开 API 和扩展点，不修改 `/Users/yuancheng/Documents/Code/deepseek-harness`。
- `packages/clutch-dsh-worktree/` 是唯一 runnable package；`manager`、`local`、`ui` 是内部角色/目录概念。
- `src/contract/` 不依赖 Git、sidecar、React 或 DSH mutation API。
- `src/provider/` 不依赖 `src/manage/` 或 `src/client/`；它只负责底层 adapter 和持久化。
- `src/manage/` 组合 `contract` 与 `provider`，负责上层 Worktree/Session 用例编排。
- `src/host/` 只通过 Manage 和 contract 组合 DSH Host；Remote projection 不得导入 Provider internals。
- `src/client/` 不调用 `$mount()`，只适配目标应用已挂载的 Remote namespace。
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
│   ├── host/
│   │   ├── dsh-read-adapter.ts
│   │   ├── remote.ts
│   │   └── service.ts
│   └── client/             # browser-safe facade; UI added in Phase 4
├── scripts/                # official Typert artifact generation
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

The empty patch used during the contract/Provider phases was intentional.
Phase 3 replaced it with the `clutch-dsh-worktree-host` insert; Web UI rows
remain deferred.

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

### Phase 3 — Host Remote and real DSH composition

**Status:** Host path complete; rc.7 browser assembly mount blocked with evidence.

- [x] Add `WorktreeRemoteService` from the same package's Host entry.
- [x] Generate and publish strict `./typert` and `./remote` artifacts with the
      official `dsh-typert-generator@0.1.0-rc.7` API.
- [x] Expose `listWorktrees`, `listBranches`, `createWorktree`,
      `removeWorktree`, `listBindings`, and `bindSession` as plain browser-safe
      projections.
- [x] Keep `resolveRuntimeCwd` Host-only because the persisted-cwd model has no
      browser execution boundary requiring it.
- [x] Insert the Host service through `cordis.patch.yml` and pass
      `dshHomePath()` from DSH composition.
- [x] Add a minimal real composition fixture using Cordis Loader, DSH
      `TypertLoader`, `TypertRegistry`, and `ApiGateway`; load the package row and
      call `worktreeManager/listWorktrees` through the generated strict Host
      descriptor.
- [x] Add runtime contract, generated descriptor, compile-time namespace, DSH
      read-only adapter, dependency-boundary, and fixed-roster evidence tests.
- [x] Verify rc.7 profile/browser mounting instead of inventing it.
- [ ] Mount `clutch-dsh-worktree/remote` inside
      `@deepseek-ai/dsh-api-remotes/client` for the target application.

The last item is blocked in `dsh-v0.1.0-rc.7`: the Client source imports a
fixed five-contribution roster, its README requires another explicit runtime
import for any additional capability, and profile patches only compose Loader
rows. `dsh.client` cannot add imports to that prebuilt bundle. The package does
not work around this with a second assembly, custom transport, or Client-side
`$mount()`. The next step is an upstream contribution-selection seat or a
target application build whose one canonical `api-remotes` assembly explicitly
imports this package's `./remote`.

## Remaining roadmap

### Phase 4 — Browser Consumer and peer Worktree mode

- **Status: shell complete; canonical Remote assembly remains blocked on rc.7.**
- [x] Add package `dsh.client` metadata and an official `./client` browser
      handoff from `src/client/entry.ts` to `lib/client.js`, loadable through
      `window.__ModuleLoader__.load(...)` and disposable through the slot entry
      lifetimes.
- [x] Reuse the Phase 3 `src/client/index.ts` browser-safe facade only when the
      target application's canonical assembly already exposes the complete
      `worktreeManager` namespace; do not call the Remote contribution mount API.
- [x] Wait for the DSH Remote carrier service while keeping the Worktree
      namespace optional; resolve the namespace at slot injection time so a
      canonical mount is not lost to an early `undefined` snapshot.
- [x] Register only the additive `sidebar.footer.action` and `shell.overlay`
      slots. Do not register `sidebar.workspaces`; the native browser remains
      mounted underneath the overlay.
- [x] Add a root-scoped browser-local `viewMode` preference with default,
      enter/exit, refresh rehydration, and unavailable/degraded fallback to
      `workspace-session`.
- [x] Render a read-only Worktree surface that derives its initial Workspace
      from current Session membership or DSH recency, allows local Workspace
      selection, reads Main rows from the global DSH Session list rather than
      native `Workspace.sessionIds`, and opens existing Sessions through
      `ctx.sessions.open` without changing mode.
- [x] Measure the existing Sidebar column through the supported overlay DOM
      anchor and `ResizeObserver`, following resize/collapse behavior without
      covering Conversation.
- [x] Add Client loading/disposal, slot registration, mode persistence,
      navigation, geometry, browser-boundary, late-namespace, and real Cordis
      Context/SlotRegistry disposal fixtures.
- [ ] Mount `clutch-dsh-worktree/remote` inside the one canonical
      `@deepseek-ai/dsh-api-remotes/client` assembly for a future DSH release or
      target application build.

The last item is blocked in `dsh-v0.1.0-rc.7`: the Client source imports a
fixed five-contribution roster, its README requires another explicit runtime
import for any additional capability, and profile patches only compose Loader
rows. The completed Phase 4 shell therefore distinguishes two states: Client
loading/disposal is real and tested; Worktree Remote calls are unavailable on
rc.7 until an official contribution-selection seat or a target application
build explicitly includes `clutch-dsh-worktree/remote` in the existing
assembly. The detailed research handoff and model prompt are recorded in
`docs/superpowers/specs/2026-08-20-clutch-dsh-worktree-remote-assembly-research-handoff.md`.

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

Phase 4 may be handed off after the repository checks pass. The UI must not
assume Worktree Remote calls are available on rc.7; report the canonical
assembly evidence and the unresolved upstream capability separately from the
tested Client shell. After each later phase, report changed files, commands,
results and unresolved DSH composition issues, then stop for approval.
