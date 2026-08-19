# clutch-dsh-worktree-local

这是 `clutch-dsh-worktree` 的 Local Provider package，依赖
`clutch-dsh-worktree-manager` 的六方法 Service Definition contract。

## Provider 边界

- `DshReadAdapter` 只读取 Workspace identity/root、Session summary 和全局
  Session 列表，不包含 DSH mutation 方法。
- `LocalGitAdapter` 只通过本地 `git worktree` 和 local branch 命令工作；不创建
  branch、不使用 `--force`、不执行 remote Git、merge 或 rebase。
- `WorkspaceShardedSidecarRepository` 使用
  `<DSH_HOME>/clutch-dsh-worktree/workspaces/<workspaceId>.json`，并以
  `<DSH_HOME>/clutch-dsh-worktree/worktree/<worktreeId>/` 作为 Provider 生成的
  Worktree 目标路径。
- sidecar mutation 在进程内按 Workspace 串行化，并使用同目录 temporary-file
  + rename 的 atomic replacement。这个 mutex 的保证范围是单个 Provider 进程；
  跨进程 host 协调不属于本 Phase。
- Worktree 创建在 sidecar 写入失败时清理刚创建的 Worktree；清理失败返回
  `SIDECAR_SYNC_REQUIRED`。删除只有在 Git 成功后才标记 `removed` 并将 binding
  标记为 `detached`。
- `resolveRuntimeCwd` 在 Provider boundary 派生 main、active 和 detached cwd；
  不写回 DSH Session。

## DSH host 组合

当前仓库没有真实 DSH host API、rc.7 Remote composition 或 fixture。Provider
因此使用注入式 `DshReadAdapter`、`GitWorktreeAdapter` 和 `SidecarStore`，不猜测
或修改 DSH 源码。Remote contribution、Web UI Consumer、Session 创建 UI 和
sidebar/shell overlay 留在后续 Phase。

## 验证

```text
pnpm --filter clutch-dsh-worktree-local typecheck
pnpm --filter clutch-dsh-worktree-local build
pnpm --filter clutch-dsh-worktree-local lint
pnpm --filter clutch-dsh-worktree-local test
```

测试使用临时 Git repository 和 fake DSH read adapter，不会写入 DSH 原始数据、
Workspace 工作树或真实 sidecar。
