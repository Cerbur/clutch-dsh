# clutch-dsh-worktree

`clutch-dsh-worktree` 是一个整体 plugin，为 DSH Web UI 增加
Project → Worktree → Session 的外部关系视角。本目录是 plugin 根目录；
其功能模块按自身边界放在本目录下。

## 当前实现进度

`clutch-dsh-worktree` 是一个整体 plugin 和一个 workspace package。当前
package 内部已经包含：

- `src/contract/`：稳定的公共类型与 interface，不依赖运行时实现；
- `src/provider/`：Git、sidecar、DSH read adapter ports 及其底层实现；
- `src/manage/`：Worktree/Session 用例编排、binding 冲突、恢复和 runtime
  cwd 派生；
- `src/client/`：后续 Phase 4 的 Web UI Consumer entrypoint，尚未实现。

`manager`、`local`、`ui` 是内部角色/实现名称，不是独立 package；其中
`manage` 和 `provider` 是源码模块边界。只有当
未来出现可独立替换的 Provider、外部 Consumer 或独立发布需求时，才重新
拆出 package。

DSH 的实际 bundle 身份由根 `package.json` 的
`dsh.bundle.patch: "./cordis.patch.yml"` 声明；当前 patch 文件为空，
因为真实 Host Remote 和 Web UI composition 仍按后续 Phase 接入。

## 数据边界

DSH 继续是 Workspace 和 Session 的唯一数据源。plugin 不写入或复制
Project/Workspace、Session header、消息、prompt、transcript、历史内容或
原始 Session 列表。

plugin 后续只维护位于 DSH Home 下的 Workspace-sharded sidecar，保存
Worktree 路径、branch、生命周期以及 Workspace/Worktree/Session 的关系。
没有 binding 的 Session 属于 main 视角；删除 Worktree 后保留 detached
关系，不删除 DSH Session。Local Provider 的 DSH Home、DSH read adapter、
Git adapter 和 sidecar repository 都通过注入边界组合；当前仓库没有真实
DSH host composition，因此不猜测或修改 DSH 源码。

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
- [package consolidation plan](docs/superpowers/plans/2026-08-20-clutch-dsh-worktree-package-consolidation.md)
- [original planning document](docs/superpowers/plans/2026-08-18-clutch-dsh-worktree.md)
