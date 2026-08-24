# Draft TODO 1：新建 Session 顶部显示 branch / Worktree 上下文

**状态：** Draft，待后续跟进

**来源：** 用户提出的第 1 项；附图只作为布局参考，不作为实现指令。

## 目标

通过 Worktree UI 的 `+` 新建 Session 后，在原生空会话页面的 composer 上方、Workspace 选择器和模式选择器同一行中展示当前上下文：

- Main 视角显示 Workspace 当前 local branch，例如 `main`；
- Worktree 视角显示对应 Worktree 的 branch/name，例如 `feature/foo`；
- 切换 Session、Workspace 或 Worktree 后，提示跟随当前 Session 更新；
- 没有 Worktree 关系时不显示错误的旧值，也不改写原生 Workspace/Session 数据。

## 已完成调研

### 当前插件已有 branch 数据，但只用于 Sidebar

- `src/client/WorktreeSurface.tsx` 已从 `view.branches.find(branch.isCurrent)` 计算 Main 行标签。
- Worktree 行使用 `WorktreeRecord.branch` 展示 branch；`absolutePath` 只用于 cwd 和搜索。
- 这解决的是 Worktree 树中的行标签，不会进入原生 Conversation Hero，所以不能直接满足本 TODO。

### 原生空会话顶部有明确的扩展位置

DSH `ConversationRoot` 的 hero 行当前由以下内容组成：

1. 原生 `WorkspaceChip`；
2. `conversation.hero.workspace` 的 Workspace picker；
3. `conversation.hero.agentPreset` 的模式/Agent preset chip。

当前插件只注册 `shell.overlay` 和 Sidebar footer action，没有注册 Conversation Hero 的 Consumer，也没有共享“当前 Session → Worktree binding”的浏览器投影给 Hero 使用。

### 当前数据关系

Worktree Session 的流程是：

```text
sessions.create({ cwd: worktree.absolutePath })
  → manager.bindSession({ workspaceId, worktreeId, sessionId })
  → browser-local Workspace membership projection
  → sessions.open(sessionId)
```

因此 branch/name 可由现有 `listBranches`、`listWorktrees`、`listBindings` 组合得到，不需要把 branch 写进 DSH Session metadata。

## 初步实现方向

推荐为 DSH `ui-conversation` 增加一个加法式、root-scoped 的 Hero seat，例如 `conversation.hero.context` / `conversation.hero.trailing`，位置放在 Agent preset chip 旁边。Worktree 插件作为该 seat 的 Consumer，渲染只读 context chip。

插件侧应建立一个可供 Sidebar 和 Hero 复用的浏览器 context projection：

- 输入：当前 `sessions.current`、Workspace membership、Worktree bindings、Worktree records、当前 branch；
- 输出：`main | worktree | none` 加对应 display label；
- 更新：Session open、binding refresh、Worktree 删除/变 detached、Workspace 列表变化；
- 复用现有 Manager 读取，避免 Hero 和 Worktree Sidebar 各自发一套重复 RPC。

不建议用绝对定位的 `shell.overlay` 覆盖 Conversation 页面：它依赖原生 DOM 结构和坐标，容易与 composer 动画、窗口缩放及响应式布局互相影响，也会把第 2/3 项的闪动问题扩大。

## 需要在实现前确认的边界

- `conversation.hero.agentPreset` 当前是 single seat，不能让本插件直接抢占；应新增 seat，或先把现有 seat 改为明确的可组合形式。
- Hero 目前既可能没有 Session，也可能处于 blank Session；没有 binding 时应返回 `none`，不能根据 cwd 猜 Worktree。
- “Worktree 名”和“Worktree branch”目前在插件数据模型中都落在 `WorktreeRecord.branch`；若产品要展示独立名称，需要先扩充 contract，否则默认展示 branch。
- 文案、截断、hover card、中文/英文切换需沿用 DSH native chip 的语义与 design token。

## 验收草案

- 从 Main `+` 新建并打开 blank Session，Hero 行显示当前 branch；
- 从 active Worktree `+` 新建并打开 blank Session，Hero 行显示该 Worktree branch/name；
- 在 Main、Worktree、不同 Workspace 间切换，context 不残留；
- detached、repair、无 binding、DSH list 尚未 ready 时不展示错误上下文；
- 原生 Workspace picker、Agent preset、composer 位置和交互不改变；
- 单元/组件测试覆盖 projection，Native/fixture 测试覆盖切换和 refresh，视觉回归覆盖长 branch 名。

## 相关代码

- 本插件：`src/client/WorktreeSurface.tsx`、`src/client/entry.ts`、`src/client/worktree-view.ts`、`src/contract/index.ts`
- Native DSH：`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`、`packages/client/ui-conversation/src/client/contract/slots.ts`、`packages/client/ui-workspace/src/client/WorkspacePicker.tsx`
