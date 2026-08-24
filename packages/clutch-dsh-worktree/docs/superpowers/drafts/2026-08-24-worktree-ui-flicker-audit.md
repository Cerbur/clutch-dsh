# Draft TODO 3：全面排查 Worktree 相关 UI 闪动

**状态：** Draft，调查项；action refresh 与过期结果回写已处理，membership、blank parity 和 geometry 仍待调查

**来源：** 用户提出的第 3 项。

## 目标

把“闪动”从单一新建 Session 问题扩大为可复现、可分类、可验证的 UI 稳定性检查，覆盖 Worktree mode、原生 Sidebar、Conversation Hero、Workspace membership projection 和异步错误状态。保留有意的 Sidebar collapse/hover 动画，不把正常动画误报为 bug。

## 当前风险清单

### 已处理：action refresh 的 destructive refresh

TODO 2 已通过 `refresh({ preserveCurrent: true })` 修复：已有树的 Worktree、Session、Worktree 创建和 binding retry action refresh 不再先清空 `views`。首次进入 Worktree mode 和显式 read retry 仍保留 `loading + 空 views`，这是当前约定。

TODO3 本身又补上了 `WorktreeSurface` 的 latest-wins guard：新 refresh 开始后，旧请求即使晚返回，也不能再提交 `ready/error` 状态。它只防止过期结果污染画面，不取消已经发出的 Connection 请求，也不替代后续的请求去重。

### P1：外部拓扑刷新仍可能触发空 loading

当 Workspace ID 或顺序变化时，`refresh` callback 会变化并触发默认 refresh；这类非 action refresh 仍可能暂时清空旧树。需要单独决定它应该继续视为初始读取，还是也采用保留旧 projection 的 `refreshing` 语义。

另外，旧请求仍会消耗传输并可能完成 context invalidation；latest-wins 目前只保护 `readState` 的可见提交。

### P1：native membership projection 的多次 snapshot

`virtual-workspace-membership.ts` 在 `ensure`、`sync`、native list subscribe 和 `dispose` 时写入 DSH browser-local Workspace list。新 Session 的 create、bind、open、refresh 可能触发多次 Sidebar tree projection；需要确认是否出现行先插入 Main、再移动到 Worktree，或先出现 raw ID、再显示标题。Conversation context store 已经有独立的 generation 防护，但 membership overlay 仍需浏览器实测。

### P1：blank Session 的文本/可见性不稳定

本插件 `sessionLabel()` 只有 `displayTitle ?? sessionId`，没有原生 `blank` 语义；新建 Session 可能先显示生成 ID，再变成 title，且 blank 行不会像 native 一样隐藏菜单。这既是视觉闪动来源，也是 TODO 4 的 parity 问题。

### P2：overlay 几何初始化与原生 Sidebar 变化

`useSidebarOverlayGeometry()` 在找不到 native New Session 或 footer anchor 时把 surface 设为 `height: 0; visibility: hidden`。它通过 `ResizeObserver`、`MutationObserver` 和 `requestAnimationFrame` 重新计算边界；原生 Sidebar 在折叠、展开、Session list 更新时重排，可能造成 Worktree surface 短暂隐藏或高度跳变。需要检查是否为真实问题，不能仅凭代码推断。

### P2：有意动画与状态切换混在一起

- Worktree surface 有 width transition；collapsed 状态通过 `wideContent`/`railContent` 切换；
- Native Sidebar 自己有 collapse slide/crossfade；
- Native ConversationRoot 有 blank/active/settling phase 保护；
- Worktree `HoverCard`、Menu、Modal 还有 portal 生命周期。

这些都可能在录屏中看起来像闪动，调查时要记录 computed style、DOM 是否 remount、元素 bounding box 是否变化，不能简单移除所有 transition。

## 调查矩阵

每个场景记录：触发动作、首个 DOM 变化、是否出现空白/旧内容、元素是否 remount、顶部/底部坐标、请求开始/结束时间、最终状态。

| 场景 | 重点观察 |
| --- | --- |
| Worktree Main `+` 新建 Session | `readState`、blank row、Conversation Hero phase |
| active Worktree `+` 新建 Session | binding projection、row move、cwd 上下文 |
| 创建 Worktree 后自动创建 Session | Modal 关闭、Worktree row 出现、Session open 顺序 |
| binding 失败后 Retry/Open created Session | 错误面板是否替换树、重试是否重复行 |
| 切换 native / Worktree mode | overlay bounds、surface mount、Sidebar width |
| Sidebar collapse/expand 与 Session 创建交错 | native crossfade 与 plugin width transition |
| Worktree/branch/health refresh | stale response、loading、repair/detached 状态 |
| reload、无 Git、空 binding、Workspace 删除 | initial loading、degraded/read-only、旧 projection 残留 |

## 推荐调查手段

1. 用相同 fixture 对比 native New Session 和 Worktree `+`，录制 60fps 视频并保留失败截图。
2. 在 Client 关键状态和 request 生命周期加临时 `performance.mark`；用 MutationObserver 统计 surface、row、ConversationRoot 的 mount/remove。
3. 对关键节点采样 `getBoundingClientRect()`，区分“内容闪一下”和“几何真的跳了一下”。
4. 在确认根因后为纯状态逻辑补 Node tests，为真实跨插件路径补 Playwright/e2e 或 snapshot；不要用 sleep 让测试“稳定”。
5. destructive action refresh 与过期 response 已先处理；下一步优先验证外部拓扑 refresh 和 blank row 两类确定性问题，再处理 geometry 和有意动画。

## 统一验收标准

- 已有内容的 action refresh 不把页面替换为空 loading；
- 旧请求不能覆盖新状态；
- blank Session 在整个空会话阶段使用稳定的原生语义；
- overlay 在 anchor 暂缺时可隐藏，但 anchor 重建后只恢复一次，不连续闪烁；
- native collapse、Menu、Modal 的预期动画保持不变；
- reduced-motion 下不新增动画依赖；
- 每个被修复的闪动都有稳定复现步骤和回归证据。

## 相关代码

- 本插件：`src/client/WorktreeSurface.tsx`、`src/client/worktree-view.ts`、`src/client/virtual-workspace-membership.ts`、`src/client/sidebar-overlay-geometry.ts`、`src/client/worktree.css`
- Native DSH：`packages/client/ui-sidebar/src/client/SidebarRoot.tsx`、`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`、`packages/client/ui-workspace/src/client/tree.ts`、`packages/client/ui-workspace/src/client/rows/Rows.tsx`
