# Draft TODO 3：全面排查 Worktree 相关 UI 闪动

**状态：** Draft，调查项；refresh、过期结果回写、membership atomicity、anchor 重绑和 reduced-motion 已处理；blank parity 属于 TODO 4，真实浏览器几何/动画仍待验证

**来源：** 用户提出的第 3 项。

## 目标

把“闪动”从单一新建 Session 问题扩大为可复现、可分类、可验证的 UI 稳定性检查，覆盖 Worktree mode、原生 Sidebar、Conversation Hero、Workspace membership projection 和异步错误状态。保留有意的 Sidebar collapse/hover 动画，不把正常动画误报为 bug。

## 当前风险清单

### 已处理：action refresh 的 destructive refresh

TODO 2 已通过 `refresh({ preserveCurrent: true })` 修复：已有树的 Worktree、Session、Worktree 创建和 binding retry action refresh 不再先清空 `views`。首次进入 Worktree mode 和显式 read retry 仍保留 `loading + 空 views`，这是当前约定。

TODO3 本身又补上了 `WorktreeSurface` 的 latest-wins guard：新 refresh 开始后，旧请求即使晚返回，也不能再提交 `ready/error` 状态。它只防止过期结果污染画面，不取消已经发出的 Connection 请求，也不替代后续的请求去重。

### 已处理：外部拓扑刷新保持 ready projection

当 Workspace ID 或顺序变化使 `refresh` callback 变化时，mode effect 会根据当前 `readState` 选择 refresh 语义：已有 `ready` projection 使用 `preserveCurrent`，首次进入或没有可保留 projection 时仍使用默认 loading。

旧请求仍会消耗传输并可能完成 context invalidation；latest-wins 目前只保护 `readState` 的可见提交。

### 已处理：native membership projection 的多次 snapshot

`virtual-workspace-membership.ts` 现在在 rc.8 Workspace list 的 `set()` 写入边界先应用 browser-local binding projection，再通知 native subscribers。这样即使 native consumer 先于插件订阅，也不会观察到 `raw → projected` 的双快照；native list refresh 仍会通过订阅回放，dispose 会恢复原始 `set()`。回归测试覆盖 raw snapshot 不可见的顺序。

### P1：blank Session 的文本/可见性不稳定

本插件 `sessionLabel()` 只有 `displayTitle ?? sessionId`，没有原生 `blank` 语义；新建 Session 可能先显示生成 ID，再变成 title，且 blank 行不会像 native 一样隐藏菜单。这既是视觉闪动来源，也是 TODO 4 的 parity 问题。

### 已处理一部分：overlay 几何初始化与原生 Sidebar 变化

`useSidebarOverlayGeometry()` 在找不到 native New Session 或 footer anchor 时把 surface 设为 `height: 0; visibility: hidden`。当 MutationObserver 发现原生节点被替换时，下一次计算会同步 `ResizeObserver` 的观察目标，避免继续监听已移除的旧 anchor。真实浏览器中的首屏 mount、折叠/展开和 Session list 重排仍需记录 computed style 与 bounding box，不能仅凭 Node 测试宣称无闪动。

### P2：有意动画与状态切换混在一起

- Worktree surface 有 width transition；collapsed 状态通过 `wideContent`/`railContent` 切换；
- Native Sidebar 自己有 collapse slide/crossfade；
- Native ConversationRoot 有 blank/active/settling phase 保护；
- Worktree `HoverCard`、Menu、Modal 还有 portal 生命周期。

插件 surface 的 width transition 已加入 `prefers-reduced-motion: reduce` 覆盖；native Sidebar 自带的 collapse/crossfade 也有同等覆盖。剩余判断仍需浏览器录制确认 DOM 是否 remount，不能把这些有意动画全部移除。

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
5. destructive action refresh、过期 response、membership atomicity、anchor 重绑和 reduced-motion 已有 Node 回归证据；下一步只需用浏览器验证 blank row（TODO 4）、首屏 anchor 暂缺、折叠/展开和 ConversationRoot 是否 remount。

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
