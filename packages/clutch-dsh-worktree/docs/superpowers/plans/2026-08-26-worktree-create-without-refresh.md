# TODO 7：导入 Workspace 后无需刷新即可创建 Worktree

## 结论

问题位于 plugin Client 的 Worktree projection 时序，不需要修改 DSH 源码、Host registry 或原生 Workspace API。

原生 Workspace 创建成功后会立即出现在 DSH Workspace 列表，但 plugin 对该 Workspace 的 Worktree/branch/binding 读取是另一条异步链路。用户在这条读取完成前打开创建对话框时，`modalView` 尚不存在，因此界面一直显示“正在加载工作区…”。

## 实施方案

1. 抽取一个只负责替换/追加单个 Workspace view 的合并函数，确保按需读取不会丢失其他已就绪 Workspace。
2. 打开创建 Worktree 对话框时，如果目标 Workspace 尚无 Worktree view，直接调用现有 `loadWorktreeView()` 读取该 Workspace；读取期间保留加载态。
3. 读取成功后将目标 view 合并回现有 Client state，并重新生成当前分支和默认 Worktree 名称。
4. 读取失败时在对话框内显示可重试错误，避免无限加载；关闭对话框或切换目标时忽略过期异步结果。
5. 为全量 refresh 与弹窗目标读取分别维护 generation guard；目标读取结果在弹窗仍打开时优先合并，避免并发 refresh 把目标 projection 覆盖或取消。

## 验证

- 回归测试覆盖单个 Workspace view 合并及创建对话框的按需读取/错误重试接线；
- 运行 package typecheck、build、test，以及与仓库规则匹配的 workspace/patch 检查；
- 变更仅涉及 `src/client/`、测试和本计划文件，不改动 DSH 源码。
