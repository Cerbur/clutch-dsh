# Worktree/Main Shared Group Row Design

## Goal

让 Worktree 模式中的 Main 分组和普通 Worktree 分组使用同一个树行组件。
Main 只通过参数提供自己的 label、branch/tree icon、展开状态和新增 Session
回调，不再维护一套独立的 JSX 或视觉样式。

同时从 Worktree UI 移除 remove Worktree 的入口；底层
`WorktreeManager.removeWorktree` contract 和实现暂不删除，避免把本次展示调整
扩大成 API 变更。

## Scope and boundaries

改动仅限 Client Consumer、Client surface tests 和相关说明文档：

- `src/client/WorktreeSurface.tsx`
- `src/client/worktree.css`
- `test/client-surface.test.mjs`
- `README.md`、`src/client/README.md` 及对应的近期 UI 计划记录

不修改 DSH source、Remote/RPC contract、sidecar、Worktree/Session 关系模型、
Session 创建流程或 Worktree Manager 的底层 remove 能力。

## Component design

抽出一个参数化的 `WorktreeGroupRow`，负责所有 Main/Worktree group row 的
共同结构：

1. 整行点击切换展开状态。
2. hover 时显示 disclosure chevron，静止时显示 branch/tree icon。
3. 使用统一的 label、状态点位置和固定 trailing action rail。
4. 可选地渲染新增 Session 按钮。
5. 可选地渲染 group menu；本次 UI 中不再向 Worktree 传入 remove menu。

两种调用的差异如下：

| 行类型 | label | icon | 状态点 | action | menu |
| --- | --- | --- | --- | --- | --- |
| Main | `Main` | `IconBranchOutline16` | 无 | 新增 Main Session | 无 |
| Active Worktree | branch 名称 | `IconBranchOutline16` | ready/repair | 新增 Worktree Session | 无 |
| Detached Worktree | branch 名称 | `IconBranchOutline16` | detached | 无 | 无 |

Main 和 Worktree 都使用 `worktreeRow`、`worktreeIcon`、`worktreeLabel`、
`worktreeDisclosure` 和 `treeActionSlot`。删除 `mainRow`、`mainLabel`、
`mainDisclosure` 等仅服务于 Main 的样式和 `MainSessionGroupRow` 组件。

## Interaction and accessibility

- Main 继续使用独立的 browser-local `expandedMains` 状态；Worktree 继续使用
  `expandedWorktrees`，两者不会合并状态。
- disclosure button 保留 `aria-expanded` 和按 label 生成的 accessible name。
- `+` 按钮继续 `stopPropagation()`，避免新增 Session 时切换 group 展开状态。
- Main 的 branch/tree icon 与普通 Worktree 位于同一 leading icon slot，保持行内
  对齐。
- Worktree 的 remove menu、remove confirmation dialog、对应的 React state 和
  UI handler 不再渲染或可达，因此用户无法从 Worktree surface 删除 Worktree。

## Data flow and error behavior

此变更不改变数据流：

- Main `+` 仍调用 DSH 原生 `createMainSession`。
- Active Worktree `+` 仍调用既有 `createSession`，使用 Worktree cwd，并完成
  binding/recovery 流程。
- Detached Worktree 不显示新增 Session action。
- Worktree 查询、health projection、Session 列表、重试错误和 binding recovery
  保持现状。
- `removeWorktree` 仍可由底层 Manager/API 提供给其他受控 Consumer，但当前
  Client surface 不暴露它。

## Testing strategy

先在 `test/client-surface.test.mjs` 增加会失败的结构回归测试，覆盖：

1. `WorktreeGroupRow` 是唯一的 Main/Worktree group row 组件，Main 和普通
   Worktree 都调用它。
2. Main 使用 `IconBranchOutline16` 和统一的 Worktree row class，不再使用
   `MainSessionGroupRow` 或 Main 专属 CSS class。
3. Worktree surface 不再包含 remove Worktree menu、remove modal 或对应的
   remove UI label。
4. Main 和普通 Worktree 仍保留正确的 `+` 行为和各自展开状态。

然后运行 focused Client tests，确认先 RED 再 GREEN；最后运行 package
typecheck、build、完整 test suite 和 `git diff --check`。

## Documentation updates

README 和 Client README 删除“可从 Worktree UI 删除 Worktree”的操作说明，改为
记录 Worktree surface 当前只提供查看、展开、Session 创建和 Worktree 创建入口。
同时保留 detached Worktree 的展示语义，以及底层删除能力属于 Manager contract
这一实现边界。

## Non-goals

- 不删除 `removeWorktree` contract、Remote endpoint 或 Provider 实现。
- 不改变 Worktree 删除后 detached binding 的生命周期规则。
- 不改变 Main/Worktree 的 Session 分组、排序、cwd 或关系投影。
- 不抽象 Workspace row；本次只合并 Main 与普通 Worktree 的 group row。
