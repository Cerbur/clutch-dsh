# Draft TODO 4：blank Session 不显示生成 ID，跟原生新建会话保持一致

**状态：** Draft，已完成 native parity 调研

**来源：** 用户提出的第 4 项。

## 目标

通过 Worktree UI 新建 Session 后，在用户尚未发送第一条消息时，把它当作 native DSH 的 provisional blank Session：

- UI 显示本地化的 `New Session`，不显示生成时的 session id；
- blank Session 只在当前选中视角中出现，离开后按 native 规则隐藏；
- blank 阶段不显示 Rename/Fork/Archive 等针对已有内容的操作；
- 第一条 prompt 被接受后，Session 转为普通会话，显示真实 display title 并恢复必要菜单；
- 不删除 DSH 创建的 Session，不修改 transcript，也不破坏 Worktree binding 的 retry/recovery 语义。

## Native DSH 行为

当前本地 `deepseek-harness` 的 native 实现已经定义了完整语义：

- `SessionSummary.blank` 表示 empty log；
- `ui-workspace/tree.ts` 的 `sessionVisible()` 只让普通 Session 或当前选中的 blank Session 出现在树中；
- blank Session 的显示标题统一为 `New Session`，而不是 durable title/id；
- `ui-workspace/src/client/rows/Rows.tsx` 对 blank 行不显示时间，也不渲染 Rename/Fork/Archive 菜单；
- `WorkspaceRuntime.connectWorkspace()` 会复用同一 Workspace/cwd 下现有的未归档 blank Session，而不是每次点击 New Session 都继续生成隐藏会话；
- `SessionRuntime.create()` 返回的 ID 仍然是 host 的真实 Session identity，并在返回前进入 list store。native parity 是“隐藏/复用 provisional blank 行”，不是把 host ID 删除掉。

## 本插件当前差异

### Session summary 类型过窄

`src/client/WorktreeSurface.tsx` 的 `SessionListLike` 只读取：

```ts
byId: Record<string, { displayTitle?: string }>
```

没有 `blank`、`current` 等 native parity 所需字段。

### label 直接回退到 ID

当前 `sessionLabel()` 是：

```ts
return sessions.byId[sessionId]?.displayTitle ?? sessionId;
```

新建 Session 在 display title 尚未形成时，必然把生成的 ID 当作可见文案。

### Worktree Session row 没有 blank 分支

`WorktreeSessionRow` 总是显示 row menu；`WorktreeSessionGroup` 也直接渲染所有 binding 对应的 `sessions.ids`。这与 native “只有 current blank 可见、blank 不带行操作”的规则不同。

### 创建流程本身是正确的持久化顺序

`createSessionForWorktree()` 先调用 `sessions.create({ cwd })`，再 bind，binding 失败时保留创建出的 Session ID 供 Retry/Open。这条顺序符合 package AGENTS 的恢复要求，不应为了隐藏 ID 而删除 Session 或延迟 host 创建。

## 初步实现方向

1. 扩展浏览器侧 structural `SessionListLike`，读取 `current` 和 `byId[sessionId].blank`；必要时读取 `cwd`，但不复制 Session 内容。
2. 将 `sessionLabel()` 改为：blank → `t('session.new')`，非 blank → `displayTitle`；若非 blank 且 title 缺失，再使用 ID 作为最后诊断回退。
3. 在 Main/Worktree session ID 派生阶段复刻 native visibility：blank 只保留 `sessionId === sessions.current`；不要把 blank binding 从 sidecar 删除。
4. 给 `WorktreeSessionRow` 传 `blank`，blank 时不渲染 Session menu，并为 accessible name 使用本地化 `New Session`。
5. 在 blank → non-blank 的首个 accepted prompt 后，让原生 summary 驱动一次稳定更新；不要依赖本地猜测 prompt 是否成功。
6. 评估 Worktree 级 blank reuse：同一 Worktree/cwd 已有未归档 blank Session 时，后续 `+` 应优先打开它；这可能需要在 Client 复用现有 Session，或给 Manager 增加明确的查找/绑定语义，但不能通过读取 transcript 实现。

## 需要留意的关系语义

- blank Session 可以已经拥有 Worktree binding；隐藏 row 不等于解绑；
- detached Worktree 的 blank binding 仍应遵循 native visibility，不得静默移动到 Main；
- binding 失败时继续保留 created ID 供恢复，但 UI 可以显示可复制/可打开的诊断信息，而不是把 ID 当作普通标题；
- Workspace membership projection 仍只在浏览器内工作，不能借 parity 修复之名修改 DSH 原生 Workspace/Session 数据。

## 验收草案

- Worktree `+` 创建并打开 blank Session 后，树中显示 `New Session`，不显示 UUID/生成 ID；
- 关闭/切换到其他 Session 后，非当前 blank 行不出现在 Worktree 树；
- blank 行没有 Rename/Fork/Archive 菜单；
- 首条 prompt 成功后，行显示原生 display title，菜单按普通 Session 恢复；
- 已有 blank Session 时重复点击 `+` 不额外生成第二个 blank；
- binding 失败仍可 Retry 或 Open created Session，且 DSH Session 不被删除；
- 中文/English 文案、搜索、Session reorder 和 native Workspace projection 不回归。

## 相关代码

- 本插件：`src/client/WorktreeSurface.tsx`、`src/client/worktree-view.ts`、`src/client/entry.ts`、`src/client/virtual-workspace-membership.ts`
- Native DSH：`packages/client/runtime/src/client/sessions/service.ts`、`packages/client/runtime/src/client/workspaces/service.ts`、`packages/client/ui-workspace/src/client/tree.ts`、`packages/client/ui-workspace/src/client/rows/Rows.tsx`
- 现有测试：`test/client-session.test.mjs`、`test/client-surface.test.mjs`
