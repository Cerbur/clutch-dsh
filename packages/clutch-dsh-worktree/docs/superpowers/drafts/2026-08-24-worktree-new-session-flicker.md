# Draft TODO 2：修复新建 Session 时的 UI 闪动

**状态：** Draft，已定位到一个高可信根因，待实现验证

**来源：** 用户提出的第 2 项。

## 现象定义

从 Worktree 行或 Main 行点击 `+` 新建 Session 时，Sidebar/Worktree 树或 Conversation 页面出现短暂空白、loading、重新出现或位置跳动。需要以录屏/浏览器帧确认具体可见阶段，但当前代码已经存在会制造这种闪动的确定路径。

## 调研证据

### 高可信根因：创建完成后的 refresh 先清空旧 projection

`src/client/WorktreeSurface.tsx` 的 `createSession` 流程是：

```text
setActionPending(true)
createSessionCallback(input)
  → sessions.create({ cwd })
  → bindSession(...)
  → ensureSessionWorkspace(...)
  → openSession(sessionId)
await refresh()
```

`refresh()` 在非 `preserveCurrent` 模式下会先执行：

```ts
setReadState({ status: 'loading', views: [] })
```

而 `createSession` 使用的正是默认 refresh。于是新 Session 已经打开后，WorktreeSurface 会先丢失所有 `views`，渲染 loading message，等三组 Manager 读取完成再恢复树。这是一个明确的空 projection → loading → ready 三段式闪动。

现有 `test/client-surface.test.mjs` 还把“默认 refresh 清空 views”写成了回归断言；它保护了旧行为，但正好也是本 TODO 需要调整的行为定义。

### 其他会放大现象的异步阶段

- `sessions.create` 会先让 DSH Session list 出现新 ID，之后 `ensureSessionWorkspace` 再修改 browser-local Workspace membership，最后 `sessions.open` 改变当前 Session；这些 snapshot 可能在不同 render 中到达。
- binding 成功后仍要通过 `/api` 重新读取 Worktree、branch、binding 三个 projection；期间没有 optimistic Worktree view 或保留旧 view。
- `actionPending` 没有传给 Worktree/Main 的 `+` 按钮作为 disabled 语义，连续点击可能并发创建多个 Session，使视觉和数据问题混在一起。
- blank Session 在初始 summary 还没有 display title 时会触发第 4 项的 ID 回退，造成文本二次变化。

## 初步修复方向

把 refresh 状态从“loading 且 views 清空”拆成两类：

- 首次进入 Worktree mode：允许 `loading + 空 views`；
- 已有 ready projection 的动作刷新：保留旧 `views`，使用 `refreshing`/`actionPending` 表示后台更新，成功后原子替换，失败时在旧树上显示 retryable error。

最小候选改法是让新建 Session 使用 `refresh({ preserveCurrent: true })`，但更完整的方向是让所有动作 refresh 都采用保留旧 projection 的语义，只有首次读取和明确重试才进入空 loading。

同时评估：

- 为 create/bind 请求增加一次性 action guard，禁用对应 `+` 或合并重复请求；
- 给 refresh 增加 request generation，旧请求返回时不能覆盖新 projection；
- 保持 `ensureSessionWorkspace` 与 `openSession` 的顺序，不通过删除 DSH Session 来“消除闪动”；
- 让 blank label 在同一 projection 里稳定显示，避免 ID → title 的额外变化。

## 验收草案

- 已加载 Worktree 树时点击 Main/Worktree `+`，原树在创建、binding、refresh 期间保持可见；
- 不出现整棵树替换为 loading 再恢复的中间帧；
- 新 Session 打开后只发生必要的当前行/当前 Conversation 状态更新；
- 重复点击不会创建重复 Session；
- refresh 失败时保留旧树并显示可重试错误，不把失败伪装成空列表；
- 首次进入 Worktree mode 的 loading 行为不被误改；
- 覆盖 Main `+`、Worktree `+`、新建 Worktree 后自动建 Session、binding 失败恢复四条路径。

## 相关代码

- `src/client/WorktreeSurface.tsx`：`refresh`、`createSession`、`submitWorktree`
- `src/client/worktree-view.ts`：`createSessionForWorktree`
- `src/client/entry.ts`：`sessions.create`、`ensureSessionWorkspace`、`sessions.open` 注入
- `test/client-surface.test.mjs`、`test/client-session.test.mjs`
