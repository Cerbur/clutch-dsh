# 发布记录

## 未发布

- 修复减少动态效果模式下的窗口缩放：保留可见画布，窗口尺寸或 DPR 改变时重绘静态中点帧，并继续独立验证完整时间轴，不重置播放期限。
- 修复减少动态效果的生命周期：静态中点帧保留至配置时长结束，完整时间轴在离屏画布验证，避免中点后出错的自定义脚本被误判通过。
- 保留实际窗口的 CSS 像素宽高，以统一 DPR 控制 800 万像素预算，避免超宽或超高窗口非等比拉伸。
- 通过有界 sprite 缓存复用 emoji 与发光圆点位图，DPR 变化时刷新、超限后直接绘制；跳过不可见粒子并保留随机序列，减少重复栅格化、模糊和逐帧计算。

- 使用 DSH 原生 Remote stream 复用共享 WebSocket，撤除插件 SSE、心跳与空闲计时器；运行时注册随插件启停清理，保留静默刷新、游标补收和完整事件队列。

- 按完整事件串行播放动画与 toast，两条链路都结束后才推进下一事件；增加固定 12 秒超时、不重试及迟到回调隔离。

- 修复深色主题下动画 iframe 配色模式不一致导致的白屏遮挡；预览和工具调用共用播放入口、渲染组件与生命周期。

- 预览直接通过全局渲染层全屏播放草稿，移除独立预览框；支持停止、切换及离页清理，不触发 toast，真实任务庆祝优先。
- 新增插件详情页动画设置，支持三种独立脚本内置模板、自定义 JavaScript 导入、完整预览验证、下载和 AI 生成提示词。
- 抽出通用 Canvas 动画渲染层，统一提供时间轴、绘图助手、隔离 Worker、超时与资源清理；toast 和会话跳转继续独立管理。
- 通过 DSH Host 设置持久化动画选择和脚本，以修订号保护并发保存；正式播放失败时回退到 emoji。
- 通过 `clutch_fireworks/launch` 事件在整个 DSH 窗口播放礼花，支持后台 Session 和跨页面排队。
- 新增可点击跳转到来源 Session 的庆祝 toast，刷新不重播，短暂断线按有效期补收。
- 使用已鉴权的原生 Gateway，最低支持 DSH 0.2.1-rc.1。
- 修复独立 RPC 通道路由因 Cordis 服务依赖边界注册失败而无法展示烟花的问题；通过真实 Cordis/Connection 回归测试及已安装 DSH 的浏览器验收。

## 0.1.4 — 2026-09-26

### 中文

#### 修复

- 适配 DSH 0.1.7 会话 API 与主视图选定会话变更，并在会话状态异常或缺失时提供安全回退。
- 将 DSH 依赖基线更新为 `>=0.1.7-rc.1`，并对齐 Cordis `^4.0.1` peer 依赖范围。

## 0.1.3 — 2026-09-10

### 中文

#### 修复

- 兼容最新 DSH Session Format V3 中的 `tool/ptc-dispatch` 事件标签，并保持向下兼容旧版本 `tool/code-dispatch`，确保在程序代码执行（PTC / `run_code`）子调用场景下 Web UI 礼花动效稳定触发。

## 0.1.2 — 2026-09-05

### 中文

#### 优化

- 优化 `happy_fireworks` 工具描述及参数说明，并在 DSH 注入系统级提示词引导模型在里程碑阶段自主调用。
- 将最低支持的 DSH 版本提升至 0.1.2-rc.1，并将 peer 依赖与 DSH 0.1.2 客户端架构对齐。
- 适配 DSH 客户端拆包架构，迁移对已移除客户端运行时包的依赖，改为依赖渲染器与会话支持包。

#### 修复

- 修复在程序代码执行（PTC / `run_code`）子调用场景下投影未能折叠 `tool/code-dispatch` 事件导致 Web UI 无烟花动效的问题。

## 0.1.1 — 2026-08-30

### 中文

#### 修复

- 将构建从通用 `prepare` 生命周期移到 npm 发布前，避免源码依赖安装时触发构建。
- 为当前 DSH 预发布版本声明显式 peer 兼容范围，避免安装时被 semver 错误拦截。

## 0.1.0 — 2026-08-30

### 中文

#### 新增

- 新增 `happy_fireworks` 工具，并在 DSH Web UI 中播放 emoji 礼花。
- 将每次礼花扩展为 40 个视觉元素，并保证 🎉、🌟 和 ✨ 的最低数量，同时提供 seeded variety。

# Release log

## Unreleased

- Fix reduced-motion resizing: retain the visible canvas, redraw its static midpoint when window dimensions or DPR change, and continue independent full-timeline validation without restarting playback.
- Fix reduced-motion lifecycle: retain the static midpoint for the configured duration and validate the full timeline offscreen, so custom scripts failing after the midpoint cannot pass validation.
- Preserve the actual window dimensions in CSS pixels and bound the 8-million-pixel budget through a uniform DPR, avoiding aspect-ratio distortion in very wide or tall windows.
- Reuse emoji and glowing-circle bitmaps through a bounded sprite cache, refreshing on DPR changes and drawing directly on overflow; skip invisible particles while preserving random sequences to reduce repeated rasterization, blur and per-frame calculations.

- Reuse DSH's shared WebSocket through native Remote streams; remove plugin SSE, heartbeats and idle timers. Scope runtime registrations to plugin lifecycle while retaining silent refresh, cursor catch-up and complete-event serialization.

- Serialize animation and toast as complete events; advance after both branches finish, with a fixed 12-second deadline, no retries, and stale-callback isolation.

- Fix the opaque white animation viewport in dark themes by matching the iframe and document color schemes; share playback entry, surface and lifecycle between preview and tool launches.

- Preview drafts full-window through the global renderer, removing the separate preview box; support stop/switch/page cleanup without toasts, and prioritize real celebrations.
- Add animation settings on the plugin details page: three standalone built-in scripts, custom JavaScript imports, full-preview validation, downloads, and an AI generation prompt.
- Extract a reusable Canvas animation layer with timing, drawing helpers, isolated Workers, watchdogs and cleanup; keep toast and Session navigation independent.
- Persist selections and scripts through DSH Host settings with revision-checked saves; fall back to emoji when live effects fail.
- Play global fireworks through `clutch_fireworks/launch`, including background Sessions and queued celebrations across app pages.
- Add clickable toasts that open the source Session, with silent refresh baselines and bounded reconnect catch-up.
- Use the authenticated native Gateway, requiring DSH 0.2.1-rc.1.
- Fix missing fireworks caused by Cordis dependency boundaries preventing dedicated RPC route registration; verify with real Cordis/Connection regression coverage and browser checks in installed DSH.

## 0.1.4 — 2026-09-26

### English

#### Fixed

- Adapt to DSH 0.1.7 session APIs and main-view session selection, with safe fallback when session state is malformed or absent.
- Update DSH peer dependency baseline to `>=0.1.7-rc.1` and align Cordis peer dependency range to `^4.0.1`.

## 0.1.3 — 2026-09-10

### English

#### Fixed

- Support the updated `tool/ptc-dispatch` event tag from DSH Session Format V3 alongside legacy `tool/code-dispatch` under programmatic tool calling (PTC / `run_code`) so celebrations trigger reliably across DSH host versions.

## 0.1.2 — 2026-09-05

### English

#### Changed

- Optimize `happy_fireworks` tool description and parameter schema, and inject system-level prompt guidance for milestone celebrations.
- Raise minimum supported DSH version to 0.1.2-rc.1 and align peer dependencies with DSH 0.1.2 client architecture.
- Adapt to DSH client modular architecture by migrating off retired client runtime package to renderer and session packages.

#### Fixed

- Fix session projection reduction for `tool/code-dispatch` events under programmatic tool execution (PTC / `run_code`) so celebrations trigger reliably.

## 0.1.1 — 2026-08-30

### English

#### Fixed

- Move the build from the general `prepare` lifecycle to the npm publish step so source dependency
  installs do not trigger a build.
- Declare explicit peer ranges for the current DSH prerelease lines so semver does not reject a
  compatible host during installation.

## 0.1.0 — 2026-08-30

### English

#### Added

- Add the `happy_fireworks` tool and an emoji fireworks celebration in the DSH Web UI.
- Expand each burst to 40 visuals with guaranteed 🎉, 🌟, and ✨ minimum counts plus seeded variety.
