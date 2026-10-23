# 发布记录

## 0.2.0 — 2026-10-24

### 中文

#### 新增

- 新增插件详情页动画设置，支持独立脚本内置模板（含“鲸跃烟火”默认模板）、自定义 JavaScript 脚本导入、全屏预览验证、下载和 AI 生成提示词。
- 抽出通用 Canvas 动画渲染层，统一提供时间轴、绘图助手、隔离 Worker、超时与资源清理；toast 和会话跳转继续独立管理。
- 新增拟真 Canvas 粒子烟花秀（Realistic Canvas celebration shows），支持色彩混合与透明叠加，提供 Poisson 随机发射调度、模式切换（Emoji / Realistic）及彩蛋几率触发。
- 通过 `clutch_fireworks/launch` 事件在整个 DSH 窗口播放礼花，支持后台 Session 和跨页面排队。
- 新增可点击跳转到来源 Session 的庆祝 toast，刷新不重播，短暂断线按有效期补收。
- 新增插件原创 SVG 图标与高清截屏视觉文档。

#### 优化

- 自定义脚本保存为 `$DSH_HOME/clutch-dsh-fireworks/animations/<sha256>.js` 私有文件；Host 设置只存相对路径、选择和显示元数据，旧全文配置在下次更新时迁移，备份需包含脚本目录。
- 点击动画卡片立即持久化选择，无需单独保存；紧凑自适应卡片统一浅深主题，预览使用圆形进度/停止控件，不改变当前选择。
- 导入先校验脚本头、大小、语法、render 入口和有界首帧，再提供可选全屏预览；确认添加才保存并启用，取消不写入，已知预览失败需重试成功。删除在原操作栏内二次确认，配置更新成功后只清理不再被其他模板或 profile 引用的文件；删除当前项切回 Emoji。
- 文件丢失或损坏时保留名称/时长及仅能删除的损坏卡片；Host 持久化回退到 Emoji，旧路径配置自动补齐元数据，只读或恢复写入失败时提示仅临时回退，旧页面缓存不能重建已删除文件。
- 每个排队事件实际开始前重新读取 Host 设置并检查文件，再捕获模板；跨页面切换、删除或文件损坏会影响下一事件，当前事件继续使用已捕获模板。刷新等待最多 5 秒，过期、超时或卸载会取消等待并隔离迟到响应，避免重播旧脚本。
- 优化庆祝 Toast 视觉材质与交互反馈，精炼 AI 动画生成提示词。
- 使用 DSH 原生 Remote stream 复用共享 WebSocket，撤除插件 SSE、心跳与空闲计时器；运行时注册随插件启停清理，保留静默刷新、游标补收和完整事件队列。
- 按完整事件串行播放动画与 toast，两条链路都结束后才推进下一事件；增加固定 12 秒超时、不重试及迟到回调隔离。
- 保留实际窗口的 CSS 像素宽高，以统一 DPR 控制 800 万像素预算，避免超宽或超高窗口非等比拉伸。
- 通过有界 sprite 缓存复用 emoji 与发光圆点位图，DPR 变化时刷新、超限后直接绘制；跳过不可见粒子并保留随机序列，减少重复栅格化、模糊和逐帧计算。
- 使用已鉴权的原生 Gateway，最低支持 DSH 0.2.1-rc.1，并将 peer 依赖更新至 0.2.1 系列。

#### 修复

- 修复减少动态效果模式下的窗口缩放：保留可见画布，窗口尺寸或 DPR 改变时重绘静态中点帧，并继续独立验证完整时间轴，不重置播放期限。
- 修复减少动态效果的生命周期：静态中点帧保留至配置时长结束，完整时间轴在离屏画布验证，避免中点后出错的自定义脚本被误判通过。
- 修复深色主题下动画 iframe 配色模式不一致导致的白屏遮挡；预览和工具调用共用播放入口、渲染组件与生命周期。
- 修复独立 RPC 通道路由因 Cordis 服务依赖边界注册失败而无法展示烟花的问题；通过真实 Cordis/Connection 回归测试及已安装 DSH 的浏览器验收。
- 修复 configForms 快照结构兼容性，确保表单配置稳定读取。

# Release log

## 0.2.0 — 2026-10-24

### English

#### Added

- Add animation settings on the plugin details page: standalone built-in scripts (including the default "Whale Show"), custom JavaScript imports, full-screen preview verification, downloads, and an AI generation prompt.
- Extract a reusable Canvas animation layer with timing, drawing helpers, isolated Workers, watchdogs and cleanup; keep toast and Session navigation independent.
- Add realistic canvas particle celebration shows featuring theme-aware blending, transparent overlays, and event-driven teardown; introduce Poisson launch scheduling with configurable duration and rate, mode switching (Emoji vs. Realistic), and splash shell rolls.
- Play global fireworks across the whole DSH window through `clutch_fireworks/launch`, including background Sessions and queued celebrations across app pages.
- Add clickable toasts that open the source Session, with silent refresh baselines and bounded reconnect catch-up.
- Add an original SVG plugin icon and refresh visual documentation screenshots.

#### Improved

- Store custom scripts as private `$DSH_HOME/clutch-dsh-fireworks/animations/<sha256>.js` files; Host settings keep only relative paths, selection and display metadata. Migrate legacy inline source on the next update, and include the script directory in backups.
- Persist card selections immediately without a separate Save step; compact responsive cards share light/dark styling, and preview uses a circular progress/stop control without changing the active selection.
- Validate import headers, size, syntax, render entry and a bounded first frame before offering optional full-screen preview. Only Confirm Add saves and activates; Cancel writes nothing, and known preview failures require a successful retry. Confirm deletion in the existing action bar; after settings commit, remove only files no longer referenced by other templates or profiles. Deleting the active template selects Emoji.
- Retain missing/damaged files as delete-only cards with name/duration metadata. The Host persists Emoji fallback, backfills metadata for old path-only settings, and reports temporary fallback when read-only settings or recovery writes prevent persistence. Stale page caches cannot recreate deleted files.
- Refresh Host settings and file availability before each queued event actually starts, then capture its template. Cross-page selection, deletion or file damage affects the next event while the current event retains its captured template. Bound refresh waits to five seconds; expiry, timeout or unload cancels the wait and isolates late responses so stale scripts cannot replay.
- Refine celebration toast material and AI animation prompt.
- Reuse DSH's shared WebSocket through native Remote streams; remove plugin SSE, heartbeats and idle timers. Scope runtime registrations to plugin lifecycle while retaining silent refresh, cursor catch-up and complete-event serialization.
- Serialize animation and toast as complete events; advance after both branches finish, with a fixed 12-second deadline, no retries, and stale-callback isolation.
- Preserve actual window dimensions in CSS pixels and bound the 8-million-pixel budget through a uniform DPR, avoiding aspect-ratio distortion in very wide or tall windows.
- Reuse emoji and glowing-circle bitmaps through a bounded sprite cache, refreshing on DPR changes and drawing directly on overflow; skip invisible particles while preserving random sequences to reduce repeated rasterization, blur and per-frame calculations.
- Use the authenticated native Gateway, requiring DSH 0.2.1-rc.1 and aligning peer dependencies with the 0.2.1 line.

#### Fixed

- Fix reduced-motion resizing: retain visible canvas, redraw its static midpoint when window dimensions or DPR change, and continue independent full-timeline validation without restarting playback.
- Fix reduced-motion lifecycle: retain static midpoint for the configured duration and validate the full timeline offscreen, so custom scripts failing after the midpoint cannot pass validation.
- Fix opaque white animation viewport in dark themes by matching iframe and document color schemes; share playback entry, surface and lifecycle between preview and tool launches.
- Fix missing fireworks caused by Cordis dependency boundaries preventing dedicated RPC route registration; verify with real Cordis/Connection regression coverage and browser checks in installed DSH.
- Fix support for both configForms snapshot shapes to ensure stable configuration reading.

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
