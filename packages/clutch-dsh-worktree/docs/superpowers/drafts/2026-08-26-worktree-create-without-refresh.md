# Draft TODO 7：修复 Worktree view 中 workspace 新出现 worktree 后不刷新无法新建 worktree

**状态：** Draft，待排查根因（0.1.6）

**来源：** 用户提出的 0.1.6 第 3 项。

## 问题描述

用户在 Worktree view 中，workspace 里「新出现」的 worktree（新建或新加入 workspace 的 worktree）在**不刷新**的情况下无法新建 worktree；刷新后才能正常操作。需要排查根因并修复，保证新 worktree 加入 workspace 后无需手动刷新即可继续新建 worktree。

## 需排查的候选根因

> 以下为排查起点，不是结论；先复现并定位后再确定修复方案。

1. **view model 缓存陈旧**：`src/client/worktree-view.ts` / `WorktreeSurface.tsx` 的 workspace/worktree 视图在进入 Worktree mode 或某次 refresh 时快照；新 worktree 出现后（例如通过创建流程或 membership projection 更新）缓存未包含新条目，导致后续「新建 worktree / 新建 Session」动作缺少该 workspace 的必要数据（root path、branch 列表等）而失败。
2. **host read adapter 与浏览器投影不一致**：`createWorktree` 的 `requireWorkspace()`（`src/manage/manager-support.ts`）走 `context.dsh.getWorkspace(workspaceId)`，数据源是 host 注入的 `workspaceRegistry`（`src/host/dsh-read-adapter.ts`）；而「新 worktree 加入 workspace」的视图更新是浏览器内的虚拟 membership projection（`src/client/virtual-workspace-membership.ts`）。若新建动作针对的是尚未进入 host registry 的 workspace/新条目，会得到 `WORKSPACE_NOT_FOUND` 或同类错误，直到原生列表刷新后才可用。
3. **创建动作依赖的派生数据过期**：dialog 里 branch 列表、默认 worktree 名（`createDefaultWorktreeName` 的去重集合）等基于旧快照计算，新建条目不参与去重 → 冲突或失败。

## 初步修复方向（待根因确认后细化）

- 复现路径固化：进入 Worktree view → workspace 出现新 worktree → 不刷新直接新建 worktree → 记录失败行为与错误信息；
- 让 create/import 动作对「最新数据」生效：动作执行前重新读取（或增量合并）该 workspace 的权威事实，而不是依赖挂载时的快照；或让新 worktree 出现的更新路径同步刷新视图模型；
- 明确浏览器投影与 host registry 的边界：若动作必须依赖 host 侧数据，则在投影更新时同步触达 host（只读），而不是要求用户手动刷新；
- 修复后补回归测试：新 worktree 加入 workspace 后立即新建 worktree 成功，无需手动 refresh；同时保持「刷新不清空 ready 内容」的既有约定。

## 需要在修复前确认的边界

- 与 TODO 5（导入外部 Worktree）的交互：导入流程上线后，导入的新 worktree 也必须能在不刷新的情况下立即参与后续新建操作；
- 新建动作以哪个数据源为权威（host registry vs 浏览器投影），决定修复落在 client 还是 host 侧；
- 不能通过「静默自动全量刷新」绕过：要保留现有 loading/ready 语义与 projection 生命周期。

## 验收草案

- 复现步骤在修复前可稳定复现，修复后不再触发（不刷新即可新建 worktree）；
- 新建后的 worktree 立即出现在列表且可继续新建 Session/worktree；
- 原有刷新、retry、projection 生命周期行为不回归；
- 新增回归测试覆盖「新 worktree 加入后立即新建」路径。

## 相关代码

- 本插件：`src/client/worktree-view.ts`、`src/client/WorktreeSurface.tsx`、`src/client/worktree-view-actions.ts`、`src/client/virtual-workspace-membership.ts`、`src/client/worktree-surface-dialogs.tsx`、`src/manage/manager-worktrees.ts`、`src/manage/manager-support.ts`（`requireWorkspace`）、`src/host/dsh-read-adapter.ts`
- 现有测试：`test/client-surface.test.mjs`、`test/client-session.test.mjs`、`test/` 下 manager fixture