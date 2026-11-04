# 一次只展开一个 Workspace 与切换提示

日期：2026-11-04
范围：`packages/clutch-dsh-worktree` 客户端侧栏（`shell.overlay`）
状态：已实现

## 背景与目标

Worktree 侧栏此前把每个 Workspace 作为可同时展开的分组。Workspace 数量增长后，打开多个
分组会让侧栏变成很长的树，也不容易看出哪个 Workspace 正在占用主视图。本次约束 Workspace
的展开，让侧栏一次只保留一个焦点：

- 同一时间最多只有一个 Workspace 展开，并由它承载 Local/Main、Worktree 与 Session 树；
- 选择其他 Workspace 会收起前一个，再次选择当前 Workspace 会收起树；
- 运行中的 Session 在收起的 Workspace 行上显示原生转圈；
- 等待审批（及其他 pending interaction）在收起的 Workspace 行上显示黄点；
- 未读完成在收起的 Workspace 行上显示绿点，用于提示切换到该 Workspace。

指示器只使用客户端已经持有的原生 Session 事实，不新增 Host 读取、Sidecar 字段或 DSH 数据写入。

## 语义定义

| 行为 | 语义 |
| --- | --- |
| 展开 Workspace | 从 `collapsedWorkspaceIds` 移除该 ID，并折叠其他所有已知 Workspace |
| 收起 Workspace | 当前 Workspace 再次激活时折叠自身；树体关闭，其他 Workspace 保持收起 |
| 切换 Workspace | 只保留目标 Workspace 展开；前一个 Workspace 的 Main/Worktree 临时分组展开被清除 |
| 当前 Session 导航 | 临时 reveal 立即选中所属 Workspace，随后由 layout effect 收敛为唯一展开的 Workspace |
| 显式选择优先 | 用户打开非当前 Session 的 Workspace 时，抑制当前 Workspace 的临时 reveal，直到 Session 导航变化；`appliedRevealRef` 防止 suppression 提交前的显式点击被 reveal 覆盖 |
| 初始收敛 | 旧记录里多个 Workspace 未折叠时，保留第一个未折叠项并折叠其余项 |
| 活动筛选 / 搜索 | 仅影响哪些 Workspace 可见；已展开的 Workspace 被隐藏时不会自动展开其他 Workspace |

## 指示器规则

收起的 Workspace 行使用现有 28px 操作槽渲染一个聚合 `StateDot`，并保持原生状态映射：

| 聚合状态 | 呈现 | 示例 |
| --- | --- | --- |
| `warning` | 黄色 dot | 等待审批、计划审核、等待回答 |
| `ongoing` | 原生转圈 | 运行中、子代理运行中 |
| `done` | 绿色 dot | 未读完成 |
| idle / 无成员 | 不显示 | — |

聚合优先级仍由 `aggregateSessionStatus` 决定：pending interaction > ongoing > completed。
展开的 Workspace 不显示聚合指示，因为其内部行已经展示各自状态；悬停/菜单打开时操作槽优先显示
Workspace 操作，指示器让位。

Main 与 Worktree 分组保持同一套原生映射：运行中为 spinner，审批为黄点，完成未读为绿色 dot。

## 实现分解

| 文件 | 职责 |
| --- | --- |
| `src/client/view/worktree-expand-state.ts` | `openWorkspaceExclusive` action、`resolveOpenWorkspaceId` 纯选择器 |
| `src/client/surface/state/useSessionExpansion.tsx` | 唯一展开的 Workspace、当前 Session reveal 收敛、抑制显式选择冲突、清除前一个 Workspace 的临时分组 |
| `src/client/surface/components/WorkspaceTree.tsx` | 用 `isWorkspaceOpen` 派生 `expanded`，继续复用 Main/Worktree/Session 过滤与门禁 |
| `src/client/surface/components/rows.tsx` | Workspace 行 `data-workspace-open`，沿用 `StateDot` 原生状态映射（ongoing 转圈、warning 黄点、done 绿点） |
| `src/client/worktree.css` | 展开的 Workspace 复用原生 `interactive-bg-hover` 填充、weight 500 标签；disclosure 的 24×24 命中区、焦点环、按下态与 hover/touch 媒体查询 |
| `src/client/surface/components/AnimatedTree.tsx` | 折叠/展开位移与淡出统一为 `ease-in-out`，保持 100/200ms |
| `src/client/README.md`、`docs/ARCHITECTURE.md`、`docs/SIDEBAR-PRESENTATION.md` | 契约与呈现说明 |
| `README.md`、`README.zh.md` | 双语用户文档同步 |

## UI 规范对齐

基准：`dsh-workspace-todos/docs/panel-ui-rules.md`（DSH 宿主 UI/UX 规范的落地规则；其历史
`ui-design-check.md` 引用的完整 `dsh-ui-ux-design-standard.md` 不在当前 checkout 中）。
本次只对齐切换、折叠与展开相关的条款：

| 规范条款 | 落地 |
| --- | --- |
| 只用 DSH 语义别名，不新增色板 | 展开的 Workspace 复用 `--dsw-alias-interactive-bg-hover`，不再画 2px 色条；焦点使用 `--dsw-focus-ring-color` |
| 字号 12 / 13 / 14，行高 20，字重 ≤500 | Workspace 标题 14/20/500；disclosure 13/20 |
| 图标按钮 24×24 | disclosure 命中区 24×24，视觉中心仍落在 20px leading cell |
| 动效 100 / 200ms，只动 opacity / transform，`--ds-ease-in-out` | disclosure 使用 `--ds-transition-duration` 旋转；`AnimatedTree` 使用 100/200ms + `--ds-ease-in-out` 曲线 |
| hover 只在支持 hover 的设备启用 | disclosure hover 收进 `@media (hover: hover)`；`@media (hover: none)` 常显 disclosure |
| 按下态 | disclosure `:active` 使用 `--dsw-alias-interactive-bg-active` |
| 键盘焦点 2px 环 | `--dsw-focus-ring-width` + `--dsw-focus-ring-color`，offset 2px |
| 减少动态效果 | disclosure 旋转在 `prefers-reduced-motion: reduce` 下关闭；树动画沿用现有 reduce 分支 |

Workspace / Main / Worktree 行动作栏的既有 hover 分组不在本次范围内，仍按
`docs/SIDEBAR-PRESENTATION.md` 的 known gap 单独处理；本次只对齐 Workspace 展开状态、disclosure
和树动效。

## 保持的不变量

- **数据所有权**：不新增 Sidecar 字段，不写 DSH Session/Workspace，不读取或修改业务目录。
- **最小刷新作用域**：切换 Workspace 只更新浏览器本地 expand state，不触发任何读取。
- **保持 ready 内容**：切换 Workspace 不清空投影，不产生 loading 或白屏；只是折叠/展开已有行。
- **当前 Session 可见性**：导航到当前 Session 时仍会临时展开它的 Workspace/Main/Worktree，
  并抑制手动折叠；收敛不会隐藏当前 Session。
- **持久化**：仍使用 `clutch-dsh-worktree.expand-state`；只把 Workspace 的“唯一展开”写回该键，
  Main/Worktree 的折叠记录保持原语义。

## 验证

```bash
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree test
cd packages/clutch-dsh-worktree && node --test test/readme-parity.test.mjs
```

新增/更新的覆盖：

- `resolveOpenWorkspaceId` 的 reveal 优先、首个未折叠、全部收起、未知 reveal 回退；
- `openWorkspaceExclusive` 只留下目标 Workspace，并持久化；
- 源码契约：Workspace 行使用 `isWorkspaceOpen`、`data-workspace-open`，收起行的 dot 映射；
- 既有 Session reveal、Collapse All、活动筛选与状态聚合测试保持通过。

## 后续观察

- 如果 Workspace 数量继续增长，可在 Workspace 行上增加搜索命中/活动范围计数，但本次不改变过滤语义。
- 当前没有独立的“Workspace 列表”滚动容器；Workspace 行仍与树共用侧栏滚动。若展开的树很长，
  收起 Workspace 后滚动位置由现有 `OverlayScrollbar` 承担。
