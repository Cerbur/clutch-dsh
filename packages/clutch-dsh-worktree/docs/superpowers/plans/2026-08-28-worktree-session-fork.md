# Worktree Session Fork Implementation Plan

> **For agentic workers:** Implement this plan in the current package checkout. Follow the repository's plugin-only data boundary and run the listed verification after each slice.

**Goal:** 让所有 DSH 原生 fork 入口在 parent 属于 Worktree 时自动建立 child binding；child 继续由原生 DSH 管理，并通过 browser-local membership projection 出现在 Worktree view。

**Architecture:** 在 `src/client/entry.ts` composition root 包装共享的 `ctx.sessions.fork`，把原生创建与现有 Worktree `bindSession`、membership projection、open 顺序串起来。用独立的纯协调器承载 binding/recovery 逻辑；启动时从原生 Session summaries 恢复 fork child。绝不写 `Workspace.sessionIds` 或其他 DSH 原生数据。

**Tech Stack:** TypeScript, React, existing DSH Client Connection, `createSnapshotStore`, Node test runner, Vitest-compatible package build.

## Global constraints

- 只修改 `@cerbur/clutch-dsh-worktree` package；不修改 `/Users/yuancheng/Documents/Code/deepseek-harness`。
- 复用现有 `/api` Connection、`WorktreeManager.bindSession`、`ensureSessionWorkspace` 和 `open`；不创建第二套 RPC 或 sidecar。
- native fork 已成功时，任何 plugin sidecar 失败都不得删除或拒绝已创建 child；必须保留可诊断、可重试状态。
- 不把 Worktree child 写入 native `Workspace.sessionIds`；native list 的临时可见性只通过已有 browser-local projection。
- 新增行为先写失败测试并运行确认 RED，再写最小实现。

## File map

- `src/client/worktree-session-fork.ts` — 纯 fork/bind/recovery 协调器与启动恢复逻辑。
- `src/client/entry.ts` — 包装/恢复 `ctx.sessions.fork`，注入 projection、refresh revision 和 recovery store。
- `src/client/worktree-surface-types.ts` — surface fork refresh/recovery contract。
- `src/client/WorktreeSurface.tsx` — binding 成功后的保留刷新和可重试 fork recovery 展示。
- `test/worktree-session-fork.test.mjs` — 协调器 red/green 单测。
- `test/client-composition.test.mjs` — fork wrapper 与生命周期 contract。
- `test/client-surface.test.mjs` — Worktree view refresh/recovery contract。
- `README.md`, `README.zh.md` — 公开说明 plugin-only fork 与 native Workspace 持久化边界。

## Task 1: Add red tests for the fork coordinator

- [x] 添加 native fork 参数透传、Worktree parent binding、普通 Main fork、bind failure recovery、retry 和 dispose 测试。
- [x] 添加启动恢复测试：只恢复带 `parentId` 且 parent 有 active binding 的 child。
- [x] 先运行 package test 确认新测试 RED，再运行完整 `pnpm --filter @cerbur/clutch-dsh-worktree test` 验证 GREEN。

## Task 2: Implement the pure coordinator

- [x] 定义最小的 native fork、binding lookup、bind、projection/open 与 recovery callback interfaces。
- [x] 实现成功 binding、幂等重复 binding、非 Worktree no-op，以及 sidecar failure 不影响 child 返回的语义。
- [x] 实现可取消的 retry 和 dispose guard。
- [x] 实现按 Session summary `parentId` 配对的启动恢复，不自动接管普通 Session。
- [x] 运行 coordinator focused tests 和 package typecheck。

## Task 3: Wire the shared DSH fork entry point

- [x] 在 `entry.ts` 保存原始 `ctx.sessions.fork`，安装包装器并在 plugin dispose 时恢复。
- [x] 用现有 manager/listBindings 查询 binding；复用 `ensureSessionWorkspace` 做浏览器本地 membership projection。
- [x] 用 snapshot/revision 通知 Worktree surface 保留当前 ready 内容并重新读取 bindings。
- [x] 确保 native Worktree tab fork 与 conversation fork 都只经过同一 wrapper，不新增上游 patch。
- [x] 扩展 composition fixture，使没有 fork 能力的旧 fixture 仍能安全加载，具备 fork 的 fixture 验证包装行为。

## Task 4: Add recovery and surface refresh behavior

- [x] Worktree fork 成功 binding 后刷新 Worktree view；刷新期间 preserve current projection。
- [x] recovery 显示 retryable error，并允许重新查询 parent binding、再次 bind；不把 child 从 DSH session list 移除。
- [x] plugin dispose 和异步 race 测试确认不发生迟到 projection/open。

## Task 5: Update public documentation

- [x] 在 `README.md` 与 `README.zh.md` 同步说明三类 fork 入口、Worktree child 的 sidecar/browser projection、native `Workspace.sessionIds` 不变及失败恢复边界。
- [x] 检查文档没有复制当前 package version。

## Task 6: Verify and hand off

- [x] 运行 `pnpm run check:workspace`、`pnpm run check:patches`。
- [x] 运行 `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`、`build`、`test`。
- [x] 复核 `git diff`、`git status --short --untracked-files=all`，确认只包含本 package 的预期修改；不执行 commit/push。
