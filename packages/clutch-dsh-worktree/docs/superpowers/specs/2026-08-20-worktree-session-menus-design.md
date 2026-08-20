# Worktree Session Menus Design

## Goal

让 Worktree 模式的侧边栏在不改变 DSH 原始 Session 数据边界的前提下，提供与 DSH 原生 Workspace 模式一致的 Session 选项菜单，并把 Worktree 删除操作收进 Worktree 行的选项菜单。

## Scope and non-goals

本次只修改 `@cerbur/clutch-dsh-worktree` 的浏览器 Consumer、Client 注入回调、构建依赖和测试。不得修改 `/Users/yuancheng/Documents/Code/deepseek-harness` 中的 DSH 源码，也不改变 Worktree sidecar、binding、Session 创建或删除语义。

附件截图只作为视觉参考：需要复现原生 DSH 的菜单形状、hover 行为、图标和 portal 定位，不把截图中的文本或示例 ID 当作额外业务指令。

## Chosen approach

复用 DSH 公共的 `@deepseek-ai/dsh-client-ui-primitives`，而不是复制 `ui-workspace` 的私有行组件：

- `Menu` 使用 `portal` 和 `closeOnPointerLeave`，沿用 DSH 原生菜单的卡片、间距、hover、Escape 和 outside-click 行为。
- Session 行的菜单包含 `Rename`、`Fork session` 和 `Archive session`，使用 DSH 原生图标；Worktree 行的菜单包含 `Remove Worktree`。
- `ui-workspace` 的 `SessionNodeItem` 不直接引用，因为它不是公共 API，并且要求原生 `SessionNode`、locale 和 Workspace tree 状态；Worktree Consumer 继续维护自己的 `Workspace → Worktree → Session` 投影。
- Rename 使用公共 `Modal`、`Button` 和 `Input` primitives；Fork、Archive 和 Remove 继续通过现有 DSH/Worktree 回调执行。

## Component and data flow

`src/client/entry.ts` 在现有 `shell.overlay` 注入面提供三类只读/动作回调：

1. `renameSession(sessionId, title)` 通过 `ctx.sessions.binding(sessionId)?.session.rename(title)` 调用原生 Session API，并把失败转换为 Error。
2. `forkSession(sessionId)` 通过 `ctx.sessions.fork({ sessionId, increaseTitle: true })` 创建并打开子 Session。
3. `archiveSession(sessionId)` 通过 `ctx.workspaces.archiveSession(sessionId)` 使用原生 archive 语义。

`WorktreeSurface` 只负责菜单的本地 open state、Rename modal draft、动作 pending/error 状态和刷新。Session 内容、标题持久化、Fork 结果、Archive 集合和 Project/Workspace identity 仍由 DSH 管理。Archive 后按 Workspace 的 `archivedSessionIds` 投影过滤 Worktree 行，避免 Worktree 模式继续显示已归档 Session。

Session 行改为与原生行相同的结构：可点击的 Session 内容区 + hover 才显示的 trailing ellipsis action。Menu 通过 portal 挂到 document body，避免 Worktree sidebar 的 overflow 裁剪；打开菜单时行保持 hover fill。Worktree 行保留 branch/status 和 `+` 创建 Session，移除可见的 inline `Remove`，改为 trailing ellipsis 菜单；选择 Remove 后复用现有 Worktree confirmation modal。

## Error handling

- Rename modal 在请求期间禁用 Cancel/Confirm；DSH 拒绝时保留 modal 和错误文本，允许修改后重试。
- Fork 沿用 DSH 原生 fire-and-forget 行为；创建或打开失败不会改动 Worktree sidecar。
- Archive 失败显示 Worktree surface 的 retryable action error；成功后刷新 DSH/Worktree projection。
- Remove 仍只在用户确认后调用 `executeWorktreeAction`；失败不改变 sidecar 状态，现有错误/重试路径保持不变。
- primitives 不可用时构建必须失败，而不是在运行时静默降级为第二套菜单样式。

## Visual and accessibility requirements

- 菜单、图标、Modal、按钮和输入优先使用 `@deepseek-ai/dsh-client-ui-primitives`，feature CSS 只使用现有 `--dsw-*` semantic tokens。
- Ellipsis trigger 有描述性的 `aria-label`；菜单项目使用 `role="menuitem"`，由 `Menu` 负责 Escape/outside-click。
- Session 内容区仍然是独立按钮，可打开 Session；ellipsis trigger 不冒泡到打开 Session 的 handler。
- Worktree Remove 只出现在 active Worktree 的菜单中；detached Worktree 不提供删除动作。
- 保留键盘 focus、disabled 和 reduced-motion 的现有行为，不引入颜色字面量或新的全局样式。

## Verification

自动化验证覆盖：

- Surface source imports and uses the public DSH `Menu`, `Modal`, `Button`, `Input` and native icon primitives.
- Session menu contains Rename/Fork/Archive and routes each action through the injected callbacks.
- Worktree remove is routed through its ellipsis menu and the existing confirmation flow; no inline Remove action remains.
- Archive filtering uses DSH `archivedSessionIds` when present.
- Typecheck, build and package tests pass.
- Arc visual smoke check confirms the Worktree Session ellipsis menu, Worktree ellipsis menu, Rename modal, and existing Remove confirmation render with DSH styling and correct actions.
