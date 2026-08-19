# clutch-dsh-worktree

`clutch-dsh-worktree` 为 DSH Web UI 增加 Project → Worktree → Session 的
外部关系视角。本目录是 plugin 的规划、设计和协作入口；可运行 package
按 workspace 约定放在同级 `packages/*` 下。

## 当前实现进度

Phase 1 已建立 Service Definition package：

- `clutch-dsh-worktree-manager`：公共类型、生命周期状态、错误码和
  `WorktreeManager` 六方法 contract。
- `clutch-dsh-worktree-local`：后续 Phase 2 实现 Local Provider。
- `clutch-dsh-worktree-ui`：后续 Phase 4 实现 Web UI Consumer。

## 数据边界

DSH 继续是 Workspace 和 Session 的唯一数据源。plugin 不写入或复制
Project/Workspace、Session header、消息、prompt、transcript、历史内容或
原始 Session 列表。

plugin 后续只维护位于 DSH Home 下的 Workspace-sharded sidecar，保存
Worktree 路径、branch、生命周期以及 Workspace/Worktree/Session 的关系。
没有 binding 的 Session 属于 main 视角；删除 Worktree 后保留 detached
关系，不删除 DSH Session。

## 已确认的 V1 约束

- Worktree 使用 Provider 生成的路径。
- branch combobox 只选择已有 local branch。
- 已被 Workspace 或其他 active Worktree checkout 的 branch 禁用。
- 创建使用 `git worktree add <generated-path> <selected-branch>`。
- V1 不创建新 branch，不使用 `--force`，不执行 remote Git 操作。
- Worktree Session 先通过 DSH `session.create({ cwd })` 创建，再通过外部
  Manager contract 绑定。
- UI 使用 `sidebar.footer.action` 和 `shell.overlay`，不替换 DSH 原生
  Workspace/Session browser。
- `viewMode` 只保存在浏览器本地，刷新后可恢复，不写入 DSH 或 sidecar。

## 相关文档

- [approved design spec](docs/superpowers/specs/2026-08-19-clutch-dsh-worktree-design.md)
- [implementation plan](docs/superpowers/plans/2026-08-19-clutch-dsh-worktree-implementation.md)
- [original planning document](docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md)
