# TODO 6：Worktree view 展开状态持久化设计

**状态：** 已确认设计

**日期：** 2026-08-26

## 目标

Worktree view 在浏览器刷新或组件重挂载后，继续保持用户对 Workspace、Main 和
Worktree 三层结构的展开/折叠选择。Session group 的“展开其余会话”继续是临时状态，
不跨刷新保存。

该能力只属于 browser-local view state，不改变 DSH 的 Workspace、Session、消息、
transcript 或 history，也不写入 plugin sidecar。

## Native DSH 语义与边界

已读取 DSH `packages/client/ui-workspace` 的实现，得到以下参考：

- native Workspace browser 使用 `defineStore`，通过 `dsh.workspace.view.v5` 保存
  `groupExpansion`，Workspace group key 是 Workspace ID。
- native 的五行限制之外的 Session 展开状态由组件内 `useState` 管理；刷新或卸载后
  不恢复。折叠父 Workspace 时，native 会清除该 group 的临时“显示全部”状态。
- native runtime 的 store 持久化基于 browser `localStorage`，存储失败只使偏好降级为
  内存状态，不阻塞 UI。

插件沿用上述“browser-local store + transient session overflow”的边界，但保留当前
Worktree view 的默认语义：Workspace、Main、Worktree 缺少记录时默认展开，Session
group 默认只显示五行。

本设计不要求、也不授权修改 DSH 源码；native 调研只读，运行时只使用 rc.8 已有的
公开 Client runtime 和 slot 能力。

## 范围与非目标

### 纳入范围

- Workspace 展开状态；
- Main 展开状态；
- Worktree 展开状态；
- 刷新、Worktree mode 进入/退出以及 slot/component 重挂载后的恢复；
- ready refresh 后清理已不存在的实体 ID；
- 父级折叠时清理临时 Session group 展开状态。

### 不纳入范围

- Session group 的 `Expand more` 状态持久化；
- 搜索条件、选中项、滚动位置或 Sidebar 宽度持久化；
- 跨浏览器 tab 的实时同步；
- sidecar、DSH Host、Workspace/Session 原始数据或 DSH API 修改；
- 修改 Worktree 的排序或生命周期模型。

## 状态模型

新增独立的 browser-local storage key：

```text
clutch-dsh-worktree.expand-state
```

持久化 JSON 的逻辑结构为：

```ts
interface WorktreeExpandState {
  readonly collapsedWorkspaceIds: Record<string, true>;
  readonly collapsedMainWorkspaceIds: Record<string, true>;
  readonly collapsedWorktreeIds: Record<string, true>;
}
```

只记录折叠例外，不记录展开项：

- ID 不在对应记录中：展开；
- ID 在对应记录中：折叠；
- toggle 展开时删除 ID，toggle 折叠时加入 ID。

实体身份使用稳定 ID，而不是显示名称、branch 名称或数组位置：

- Workspace 与 Main 使用 `workspaceId`；
- Worktree 使用 `worktreeId`。

因此 Workspace 重命名、Worktree branch 变化、Workspace/Worktree 排序都不会改变
展开偏好。

## 组件与数据流

### Store 生命周期

plugin `apply()` 创建一个独立的 expand-state snapshot store，并将其作为 injection
传给 `WorktreeOverlay`。它不占用现有的 slot store seat；现有 view-mode store
继续服务 Sidebar footer action。

`WorktreeSurface` 订阅注入的 snapshot source，而不是在 mount 时创建 store。这样
localStorage 的同步恢复发生在首次渲染之前，避免先按默认值完全展开、随后再恢复而
产生闪烁。组件卸载不会丢失该 store，plugin 生命周期结束后 store 随其 fiber 释放。

### 渲染

`WorktreeSurface` 用 expand-state snapshot 派生：

- `expandedWorkspace = !collapsedWorkspaceIds[workspaceId]`；
- `expandedMain = !collapsedMainWorkspaceIds[workspaceId]`；
- `expandedWorktree = !collapsedWorktreeIds[worktreeId]`。

Session group 仍由当前组件内存状态控制，且不写入该 store。

### Toggle

用户点击 Workspace、Main 或 Worktree 行时，立即更新对应记录；snapshot persistence
自动写入 localStorage。搜索只改变当前可见行，不修改持久化状态。

折叠父级时，结构层状态本身保留，以便重新展开父级后恢复用户对 Main/Worktree 的
选择；同时清除临时 Session group 状态：

- 折叠 Workspace：清除该 Workspace 的 Main group 和所有 Worktree group；
- 折叠 Main：清除对应 Main group；
- 折叠 Worktree：清除对应 Worktree group。

## 失效 ID 清理

清理只在 Worktree read state 为 `ready` 时执行：

- Workspace/Main 记录对照完整的 DSH Workspace 列表；
- Worktree 记录对照当前 ready snapshot 中的 Worktree 列表；
- 仍出现在 snapshot 中的 `detached` Worktree 保留其状态；
- 完全不存在的实体才从记录中删除。

在 `idle`、`loading` 或 `error` 状态下不清理。这样 DSH、Gateway、sidecar 或连接
暂时失败时，不会因为一个不完整或空的读取结果而删除用户偏好，也不会影响已有 ready
projection 的保留行为。

## 存储失败与数据损坏

- localStorage 不可用、配额不足或写入失败时，状态退化为当前页面内存状态；不显示
  plugin domain error，也不阻塞 Worktree view。
- 读取到无法识别的 JSON 或缺少字段时，归一化为空的三组记录；不将异常传播到
  Worktree read error surface。
- 该 store 的任何读写都不触碰 DSH 原始数据和 plugin sidecar。

## 验收与测试

### Store 测试

- 初始状态三层默认展开；
- toggle 折叠/展开正确加入和移除 ID；
- localStorage 恢复使用独立 key；
- 损坏或缺字段数据回退为空状态；
- 多个 Workspace/Worktree 的状态互不影响。

### Surface 测试

- 恢复后的 `aria-expanded`、子树可见性和 branch/group 行状态正确；
- 组件重挂载和页面刷新不会先显示完全展开状态；
- Session group 不跨刷新恢复；
- 折叠 Workspace/Main/Worktree 会清除相应临时 Session group 展开状态；
- Workspace 重命名、Worktree branch 改变、排序和搜索不改变状态归属。

### Refresh 与清理测试

- ready refresh 会删除已消失的 Workspace/Worktree ID；
- loading/error refresh 不会清理现有记录；
- detached Worktree 仍存在于 ready snapshot 时保留记录；
- read failure 不会清空已有 ready projection 或 expand-state。

## 公开文档与实现边界

实现时同步更新 `README.md`、`README.zh.md` 和必要的 `src/client/README.md`，说明
展开状态是 browser-local preference，不属于 DSH 或 sidecar 数据。实现只涉及 plugin
的 Client store、surface wiring、测试和文档；不修改 DSH checkout、Host composition、
Remote contract 或 sidecar schema。
