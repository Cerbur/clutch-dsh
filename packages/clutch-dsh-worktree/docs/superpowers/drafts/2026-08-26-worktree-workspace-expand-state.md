# Draft TODO 6：Worktree view 记住 workspace/worktree 展开状态，刷新后保持

**状态：** 已完成调研，设计已确认；实现计划见 docs/superpowers/plans/2026-08-26-worktree-workspace-expand-state.md

**来源：** 用户提出的 0.1.6 第 2 项。

## 目标

Worktree view 中用户的展开/折叠状态在刷新后保持：

- workspace、main、worktree、session group 各层的展开/折叠状态可被记忆；
- 现状是每次刷新都是 workspace-worktree 完全展开，专注性差；
- 调研 DSH 原生如何实现展开状态的记录与恢复，按其语义对齐后再实现。

## 已完成调研（本插件现状）

`src/client/WorktreeSurface.tsx` 用组件内存 state 管理全部展开状态：

```ts
const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
const [expandedMains, setExpandedMains] = useState<Record<string, boolean>>({});
const [expandedWorktrees, setExpandedWorktrees] = useState<Record<string, boolean>>({});
const [expandedSessionGroups, setExpandedSessionGroups] = useState<Record<string, boolean>>({});
```

- workspace/main/worktree 的默认语义是 `!== false` 即展开 → 所有层级默认完全展开；
- session group 的默认语义是 `=== true` 才展开（即默认折叠，配合「每组默认显示五行 + Expand more/Collapse」）；
- 这些都是浏览器内存 state：刷新或组件重挂载即丢失 → 每次刷新回到完全展开。
- 按 plugin 数据边界，这是 browser-local view state（Client 职责），只能持久化到浏览器本地存储（localStorage/indexedDB），不能写入 sidecar 或 DSH 原始数据。

## 已完成调研（native 实现方式）

DSH 原生 `packages/client/ui-workspace` 使用 `defineStore`，通过
`dsh.workspace.view.v5` 持久化 `groupExpansion`；Workspace group 使用 Workspace ID
作为 key。插件按这一 browser-local 语义保存 Workspace、Main 和 Worktree 的结构展开
例外，缺少记录时默认展开。

原生每组五行之外的 Session 溢出展开由组件内状态管理，是临时行为，不会在刷新或组件
卸载后恢复；折叠父级时会清除受影响的临时“显示全部”状态。插件保留相同的五行 Session
溢出语义，并将存储失败降级为内存行为，不修改 DSH 或 sidecar 数据。

## 初步实现方向

以下仅为历史调研阶段的初步提案，已被确认设计取代：持久化仅覆盖 Workspace/Main/Worktree 的结构展开状态，Session 溢出展开保持为组件内存中的临时状态。

1. 将 `expandedWorkspaces`/`expandedMains`/`expandedWorktrees`/`expandedSessionGroups` 提取为可持久化的 browser-local store：mount 时恢复、变更时保存；
2. key 带 plugin 前缀与 workspaceId 作用域，避免与原生或其他插件冲突；清理已删除 workspace 的失效条目；
3. 刷新/进入 Worktree mode 的 loading → ready 期间不允许「先全展开再恢复」的闪烁：恢复持久化值后再渲染，或渲染初期直接使用持久化值；
4. session group 默认折叠、workspace/main/worktree 默认展开的语义保持不变（除非 native 语义不同）。

## 需要在实现前确认的边界

- 多 workspace 的展开状态相互独立；
- workspace 删除后失效条目的清理；
- 展开状态与「每组默认显示五行」的 Expand more 状态是否一并持久化；
- 与 native tree 持久化语义的一致性（若 native 有持久化）。

## 验收草案

- 折叠某个 workspace/worktree → 刷新页面 → 仍保持折叠；
- 展开状态与原生 workspace tree 语义一致（若原生已持久化）；不同 workspace 互不影响；
- 刷新/refresh 过程不闪回完全展开状态；
- 相关单元/组件测试与刷新回归测试覆盖。

## 相关代码

- 本插件：`src/client/WorktreeSurface.tsx`、`src/client/worktree-view.ts`、`src/client/worktree-surface-rows.tsx`（展开/折叠渲染）、`src/client/worktree-surface-types.ts`（`expanded` 字段）
- Native DSH（调研对象）：`packages/client/ui-workspace` 的 tree/rows 展开状态处理
- 现有测试：`test/client-surface.test.mjs` 等
