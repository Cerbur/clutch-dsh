# Worktree 提示优化

目标分支：wt-worktree-0.1.10/feat-optimize-tips。

- 修正中英文归档及导入提示：归档保留目录、active binding 和 cwd，清理磁盘另行确认。
- active Worktree 原生 HoverCard 按 repair、recovery-needed、branch-drift 与 detached HEAD
  展示状态、路径和可执行处理指引；只展示指导，不自动运行修复命令。
- 使用 DSH ui-primitives 的公开 Toast。原生 Toast 仅接收文本，故逐条展示摘要，
  完整诊断和原有恢复按钮收进一个 details 入口；表单校验与 Git 初始化指引保持就地。
- 通知按来源与内容去重、顺序展示，清除已解决通知，允许解决后的同一错误再次提示；
  不修改 ready projection、刷新范围、生命周期或存储模型。

这是既有 archive 与 surface 计划的提示层增量，不变更归档/清理/移出管理语义。
验证包含通知队列回归、双语文案、现有 Client/生命周期回归、typecheck、lint、build
与 workspace/patch 检查。

## 验证结果

在目标 feature worktree 执行：

- `pnpm run check:workspace`：通过。
- `pnpm run check:patches`：通过；YAML parser 对已有 `!!js` 标签输出 warning。
- `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`：通过。
- `pnpm --filter @cerbur/clutch-dsh-worktree lint`：通过。
- `pnpm --filter @cerbur/clutch-dsh-worktree test`：通过，532/532；
  包括 build 与 remote type fixture。
- `node --test test/client-surface.test.mjs test/client-notifications.test.mjs`：
  84/84 通过。原有两处 JSX 固定结构断言已适配 hover/恢复入口的新结构。
- `git diff --check`：通过。

复用 release worktree 的已安装依赖，链接位于被忽略的 node_modules 目录。
未在运行中的真实 DSH 页面做视觉验收；未提交、递增版本、合并或发布。
