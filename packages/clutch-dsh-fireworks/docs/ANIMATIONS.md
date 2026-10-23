# Animation scripts / 动画脚本

An animation is a standalone UTF-8 `.js` file. Import it on the plugin details
page to validate it and open a confirmation dialog, with optional full-screen preview.
Only Confirm Add writes it and makes it active; Cancel leaves settings and disk unchanged. The built-ins in
[`assets/animations`](../assets/animations/) use exactly the same interface.
Download a built-in or start with
[`example-custom.js`](../assets/animations/example-custom.js). The configuration
page contains a complete AI generation prompt with this contract.

动画是独立 UTF-8 `.js` 文件，选择后先校验，再弹出确认窗口，支持全屏预览。
确认添加后才写入并选中；取消不修改配置或磁盘。
所有内置效果与自定义效果使用同一个接口。设置页提供可复制的完整 AI 生成提示词。

Preview sends any card's template to the same global renderer as a real launch, without a
separate preview canvas, toast, tool call or settings write. Stop it explicitly,
change templates, or leave the settings page to release its resources. A real
task celebration preempts a preview; stale preview callbacks cannot validate
another preview or cancel that task's effect. It does not change the active template.

Selection persists immediately; imports persist on Confirm Add and deletion requires inline
Delete/Cancel confirmation replacing the existing action bar, with no card-height change. Pending deletion turns the card red; the confirmation prompt is left-aligned and Delete/Cancel are right-aligned, so Cancel occupies the original Delete position.
There is no separate Save or Discard step and no mandatory full-preview gate. Imports check
size, header, syntax, render entry and a bounded first frame inside the existing restricted
iframe/Worker (never on Host). Hidden preflight schedules directly rather than waiting for RAF,
and immediately terminates its Worker. Optional preview validates the full timeline; known failures
block adding until a successful retry. Each card shows an icon, name, duration,
and a built-in/custom tag (replaced by Current when selected), with Preview and
Export below a divider. Only custom cards have Delete.
Cards and import dialogs share one details renderer and typography/theme variables in
`animation-settings.css`. Name, tag and duration stack vertically; names are single-line
ellipses with the full text in the native title tooltip. Palette aliases use DSH `label-*`,
not nonexistent `text-*`, and tags follow Agent Preset's outline/solid Tag colors and geometry.
If only the Host revision changed, the update rereads and retries once only when all
saved animation selections and source bytes still match the editor's baseline.
A concurrent content edit is still rejected without overwriting it.

Both requests use the same burst channel, rendering surface and lifecycle
callbacks. The iframe explicitly uses `color-scheme: normal`, matching its
srcDoc document. Otherwise Chromium can composite a transparent default-light
document as an opaque white viewport when DSH supplies a dark embedding scheme.
The effect keeps the underlying page visible in either theme.

预览直接通知全局渲染层全屏播放该卡片模板，不使用预览框，也不触发通知或修改当前选择。
停止、切换模板或离开页面会清理预览；真实任务庆祝优先。
切换立即持久化；导入需确认添加，删除在原操作栏内替换为确认提示和右侧删除/取消按钮，待删除卡片变红、高度不变，取消占据原删除位置。
不再提供单独保存、放弃修改或强制完整预览门禁。导入检查大小、脚本头、语法、render 入口与首帧，
代码只在现有隔离 iframe/Worker 中执行，不在 Host 执行；隐藏预检直接调度首帧并立即终止 Worker，
避免 RAF 节流误报超时。可选预览检查完整时间轴，已知失败必须重试成功才能添加。卡片展示图标、名称、时长和内置/自定义标签，选中后标签改为当前使用。
分隔线下方提供预览、导出，只有自定义卡片展示删除。
若仅 Host 修订号变化，保存会重新读取并只在原有选择和脚本全文均未改变时重试一次；
其他页面的内容修改仍受冲突保护，不会被覆盖。
两种请求共用播放通道、渲染组件和生命周期回调。iframe 配色模式与内部文档保持一致，
避免深色主题下 Chromium 将透明内容合成为白色整窗背景。

## File format

The first line is a literal comment with JSON metadata. `version` is `1`,
`name` is a nonempty string of at most 60 characters, and `durationMs` is an
integer from 500 to 8000. Files are limited to 64 KiB; at most eight custom
templates can be saved. No module wrapper, imports, exports, React, or build
step is needed.

```js
// clutch_fireworks: {"version":1,"name":"Golden stars","durationMs":4000}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Animation entry.
function render(frame, fx) {
  const alpha = Math.min(frame.progress * 5, (1 - frame.progress) * 4);
  for (let i = 0; i < 80; i++) {
    const angle = fx.random() * Math.PI * 2;
    const reach = Math.min(frame.width, frame.height) * 0.4 * fx.easeOut(frame.progress);
    fx.star(
      frame.width / 2 + Math.cos(angle) * reach,
      frame.height / 2 + Math.sin(angle) * reach,
      4 + fx.random() * 7,
      '#ffcf66',
      alpha,
      angle + frame.progress,
    );
  }
}
```

`render(frame, fx)` must be synchronous. The renderer calls it for each frame,
clears and resets drawing state, applies pixel scaling, follows resizing, and
owns the animation's duration and resource cleanup. Compute movement from
absolute `time` or `progress`, rather than counting frames. Each frame's random
sequence restarts from the same seed so initial positions remain stable.

## Drawing interface

Types are exported from `@cerbur/clutch-dsh-fireworks/animation` as
`AnimationFrame`, `AnimationHelpers`, and `AnimationRender`.

| Frame property           | Meaning                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ctx`                    | Standard `OffscreenCanvasRenderingContext2D`: paths, curves, gradients, text, shadows, compositing and other Canvas 2D drawing operations. |
| `width`, `height`        | Full DSH window drawing area in CSS pixels, shared by live playback and preview.                                                           |
| `dpr`                    | Applied pixel ratio, at most 2 and bounded by an 8-million-pixel canvas budget. Do not scale `ctx` again.                                  |
| `time`, `delta`          | Elapsed time and time since the previous frame, in milliseconds.                                                                           |
| `progress`, `durationMs` | Normalized time from 0 to 1, and the template's configured duration.                                                                       |
| `seed`                   | Deterministic integer seed for this celebration.                                                                                           |
| `message`                | Optional celebration text, or an empty string. No Session identity or DSH handles are exposed.                                             |
| `theme`                  | Resolved DSH appearance: `'light'` or `'dark'`, supplied by the parent and updated during playback.                                        |

| Helper              | Arguments                                         |
| ------------------- | ------------------------------------------------- |
| `fx.random()`       | Seeded random number in `[0, 1)`.                 |
| `fx.clamp(value)`   | Clamp to `[0, 1]`.                                |
| `fx.easeOut(value)` | Cubic ease-out, input clamped to `[0, 1]`.        |
| `fx.circle(...)`    | `x, y, radius, color, alpha = 1, glow = 0`        |
| `fx.ring(...)`      | `x, y, radius, color, lineWidth = 2, alpha = 1`   |
| `fx.line(...)`      | `x1, y1, x2, y2, color, lineWidth = 2, alpha = 1` |
| `fx.star(...)`      | `x, y, radius, color, alpha = 1, rotation = 0`    |
| `fx.emoji(...)`     | `text, x, y, size = 32, alpha = 1, rotation = 0`  |

Colors are CSS colors; rotations are radians; sizes are CSS pixels. Helpers
restore their own Canvas state. Keep the background transparent, fade in and
out, and aim for fewer than about 1000 particles per frame. A reduced-motion
preference keeps a static midpoint frame visible for the configured duration. The
full timeline, including its end frame, still runs on a separate offscreen canvas
inside the same isolated Worker. Only successful completion validates a custom
preview; errors after the midpoint still fail validation. When the window size,
DPR or theme changes, the visible canvas redraws the midpoint with the current dimensions
and palette before continuing offscreen validation. This does not restart the playback clock or
complete validation; otherwise the displayed canvas stays static.

CSS dimensions always match the actual window, including ultrawide and portrait
windows. The renderer lowers DPR uniformly to fit the 8-million-pixel backing
canvas budget, rounding backing dimensions down to stay within that limit.

减少动态效果开启时，静态中点帧保留至配置时长结束；完整时间轴（包括终点帧）仍在同一个
隔离 Worker 的独立离屏画布中验证，显示画布不播放动态。自定义预览必须完整成功才算通过，
中点之后的错误仍会使验证失败。窗口尺寸、DPR 或主题改变时，可见画布按当前尺寸与配色重绘中点帧后继续
离屏验证，不重置播放期限，也不提前通过验证；其余时间保持静态。
CSS 宽高始终使用实际窗口尺寸，包括超宽屏和竖屏；统一降低
DPR，并向下取整画布像素尺寸，将总像素数限制在 800 万以内。

## Theme contract / 主题合同

`frame.theme: 'light' | 'dark'` is a rendering input from the parent DSH page.
Use it to select colors and compositing while preserving random consumption,
particle counts, trajectories, physics and timing. Scripts should treat a missing
theme as `'dark'` for compatibility with older renderers. Keep the overlay transparent:
bright particles and additive flashes suit dark pages; the same hues and saturation
with lower lightness and `source-over` compositing suit light pages. Whale Show
scales only HSL lightness to 65% of its dark-palette value, retaining the original color spectrum.
Do not paint a full-screen background or query the OS theme inside the opaque iframe
or Worker.

The existing `@deepseek-ai/dsh-client-ui-layout` dependency's `ThemePresenter`
projects `snapshot.active.colorScheme` onto `html.style.colorScheme`, the preference
source (`light`, `dark` or `system`) onto `html[data-ds-theme-source]`, and the dark
state onto `body[data-ds-dark-theme]`. This DOM projection supplies the resolved
DSH scheme; no new theme dependency or hook is required. Parent-side
`readAnimationTheme()` checks, in order:

1. A single resolved `light` or `dark` from the root's computed `colorScheme`.
2. An explicit root `data-ds-theme-source` of `light` or `dark`.
3. The body's `data-ds-dark-theme` attribute, if present, meaning dark.
4. The luminance of an opaque body background, then an opaque root background.
5. OS `matchMedia('(prefers-color-scheme: dark)')` as the final fallback.

The parent passes the initial value to `animationDocument()` and watches root/body
mutations with `MutationObserver` plus OS scheme changes. Updates use
`{ type: 'clutch_fireworks/theme', token, theme }`; the child accepts only messages
whose `source` is `parent`, whose token matches the playback token and whose theme
is exactly `light` or `dark`. The opaque iframe never resolves the OS theme itself.
Preview and live playback share `AnimationSurface`; bounded import preflight uses
the same initial theme and update protocol. Embedding and srcDoc retain
`color-scheme: normal` for transparency; the theme travels as data.

A theme update keeps the same iframe and Worker, seed, time, captured animation,
toast and deadline. In reduced motion it redraws the visible midpoint and resumes
the offscreen timeline; that redraw is not a final-frame acknowledgement and cannot
complete validation early.

Whale Show retains `classic`, 5000 ms and the original simulation, RNG consumption,
counts, physics and trails. Dark rendering retains the original golden references;
missing `theme` selects dark. Theme switching reconstructs the private trail buffer
with the new palette at the same simulation tick. Cold reconstruction still paints
only the latest 48 ticks within a two-million-pixel private buffer: it may lose faint
trail history and raster detail, so it is not pixel-identical to uninterrupted playback.

`frame.theme` 是父 DSH 页面传入的绘制参数，值为 `'light' | 'dark'`，播放中可更新。
只据此调整配色与混合方式，保留随机数消费顺序、粒子数量、轨迹、物理与时间轴；兼容旧渲染器
时，缺失值按 `'dark'` 处理。深色适合明亮粒子与加色闪光；浅色保留相同色相与饱和度，降低
明度并采用 `source-over` 混合。鲸鱼烟花仅将 HSL 明度缩放至深色配色的 65%，保留原来的完整色谱。覆盖层始终透明，不绘制整幕背景。

现有 `@deepseek-ai/dsh-client-ui-layout` 的 `ThemePresenter` 将
`snapshot.active.colorScheme` 写入 `html.style.colorScheme`，将偏好来源
`light`、`dark` 或 `system` 写入 `html[data-ds-theme-source]`，并用
`body[data-ds-dark-theme]` 表示深色状态；无需新增主题依赖或 hook。
父页面的 `readAnimationTheme()` 依次读取根元素 computed `colorScheme` 中明确的浅/深值、
根元素明确的 `data-ds-theme-source` 浅/深值、body 深色属性、不透明 body 再 root 背景亮度，
最后才使用操作系统 `matchMedia` 兜底。`system` 是偏好来源，不能覆盖 DSH 已解析的主题。

父页面将初值传给 `animationDocument()`，通过 `MutationObserver` 和 OS 主题 change 观察更新。
`clutch_fireworks/theme` 消息携带 token 和主题；子页面必须同时验证 `source === parent`、
播放 token 和 `light`/`dark` 白名单。opaque iframe 与 Worker 不自行查询 OS 主题。
预览和正式播放共用 `AnimationSurface`，导入预检也遵循同一初值与更新协议。
iframe embedding 与 srcDoc 继续保持 `color-scheme: normal` 以维持透明，主题仅作为数据传递。

切主题不重建 iframe 或 Worker，不重置 seed、time、当前动画、toast 或截止时间。
减少动态模式先重绘可见中点帧，再继续离屏时间轴，不能把重绘当成终点确认或提前完成。
鲸鱼保留 `classic`、5000 ms、原版模拟、RNG 消费、数量、物理与拖尾；深色保留原版 golden
参考，缺失主题按深色处理。切主题在同一模拟 tick 以新配色重建私有拖尾画布；冷重建仍受
最近 48 tick、200 万像素限制，可能损失微弱历史拖尾与栅格细节，不保证与连续播放像素一致。

## Performance

The helpers reuse emoji and glowing-circle bitmaps within each playback. Emoji
use stable raster sizes while their position, size, rotation and opacity can
change each frame. Glowing circles reuse a sprite when radius, color and glow
stay the same; animate position and alpha instead of re-blurring each particle.
Large emoji above 128 CSS pixels draw directly to retain their resolution.
Direct `ctx` drawing remains available and does not use these caches.

The shared sprite cache holds at most 128 entries and two million pixels,
refreshes on DPR changes, and is released with the Worker. When full, helpers
draw directly so particles are retained. Built-ins keep their particle counts;
Starburst uses fixed-size glowing dots that fade instead of shrinking and
recomputing the blur every frame. Transparent helper calls skip painting with
normal `source-over` compositing.

Skip particles before their start and after their end. Consume their random
values before skipping so later particles retain stable positions. Compute
shared values such as burst radius and easing once outside the particle loop.
The suggested particle count is a starting point, not a frame-rate guarantee:
text rasterization, shadows, display size and DPR also affect drawing cost.

绘图助手会在单次播放内复用 emoji 与发光圆点的位图。emoji 仍可逐帧移动、缩放、旋转、
淡入淡出；发光圆点保持固定半径、颜色与 glow，通过位置和 alpha 表达运动，避免重复模糊。
超过 128 CSS 像素的大 emoji 直接绘制以保持分辨率。直接调用 `ctx` 不经过这些缓存。

共享缓存最多 128 项、总计 200 万像素，DPR 改变时刷新，随 Worker 释放；缓存满后回到
直接绘制，不丢弃粒子。内置效果保留原有粒子数量；星空烟花的发光圆点改为固定大小并淡出，
不再通过逐帧缩小圆点重复计算模糊。正常 `source-over` 混合下，完全透明的助手调用跳过绘制。

跳过尚未开始或已经结束的粒子前，先消费它的随机数，避免后续粒子位置跳动。将同组粒子共享
的半径、缓动等计算移到循环外。粒子数量建议不是帧率保证，文字栅格化、阴影、窗口尺寸与
DPR 都会影响开销。

## Responsibilities and failure handling

```mermaid
flowchart LR
    tool[happy_fireworks result] --> event[clutch_fireworks/launch]
    event --> playback[Global playback controller]
    settings[Saved animation selection] --> playback
    playback --> animation[Selected script and Canvas renderer]
    playback --> toast[Plugin toast and Session navigation]
```

Scripts run in a dedicated Worker inside a `sandbox="allow-scripts"` iframe
with an opaque origin and a restrictive CSP. They cannot access the application
DOM, storage, network, DSH services, navigation, or toast controls. Do not use
`fetch`, `import`, `importScripts`, `require`, DOM APIs, timers, event listeners,
`postMessage`, or change global functions. Use only the frame, helpers, Canvas
and pure math. Custom scripts never execute in the Host or DSH main renderer.

Host delivery uses the native `clutch_fireworks/events` Remote stream on DSH's
shared authenticated `/api/remote.mux` WebSocket. The plugin registers its Host
service and explicit strict descriptor through public runtime APIs; the Client
mounts the same descriptor once per plugin fiber. No automatic `./typert` loader
registration, generated DSH catalog edits, separate SSE socket or plugin heartbeat
is involved. DSH handles connection authentication and recovery. On stream loss,
the controller reopens the logical subscription after one second with its epoch
and cursor; fresh pages and restarted Hosts establish silent baselines. Replay
stays bounded to 128 events/30 seconds and slow readers coalesce from that buffer.

Animation settings still use native unary settings RPC. The toast and animation
share one event slot and their 12-second deadline is independent of delivery.
Unmount cancels the logical stream, removes the UI and withdraws the Host/Client
descriptors; re-enable creates a new epoch. Updating loaded Host JavaScript or
package metadata may still need a DSH reload/restart. The supported SDK baseline
is DSH 0.2.1-rc.1. Development SDK and browser acceptance use 0.2.1-rc.2.
The global feed rejects non-owner callers even if their Remote
access policy otherwise permits the endpoint.

The renderer detects startup errors and frames taking over 750 ms, terminates
the Worker, and releases its Blob URL and iframe. A preview reports errors and
does not enable saving a failed custom selection. During a real celebration,
script errors or unavailable Worker/OffscreenCanvas support trigger the trusted
emoji fallback. The independent toast remains clickable and dismissible.

Animation and toast share one event time slot. Both start together, and the
controller advances the queue only after both finish. Closing or successfully
following a toast completes that branch; its automatic lifetime is eight
seconds. Each event has an absolute 12-second deadline from launch, independent
of renderer acknowledgements. The deadline clears both branches and consumes
the event without retry. Old callbacks cannot complete a newer event. Preview
cannot interrupt an active event's remaining toast.

动画与 toast 共用一个事件时间片，同时启动、全部完成后再出队。toast 在自动消失、
手动关闭或成功跳转后结束；每个事件从启动起最多等待 12 秒，超时清理并继续，
不重试。旧回调不能结束新事件，预览也不能插入真实事件剩余的 toast 时间。

Saved scripts are immutable, content-addressed files under
`$DSH_HOME/clutch-dsh-fireworks/animations/<sha256>.js`. DSH Home defaults to
`~/.dsh`; the injected Host `dshHomePath` respects a configured `DSH_HOME`.
The Host settings namespace `clutch-dsh-fireworks` stores only references in
its volatile `animation` field:

```yaml
animation:
  version: 2
  active: custom-example
  files:
    custom-example: clutch-dsh-fireworks/animations/<sha256>.js
```

The browser displays hydrated source. Authenticated owner-only native
Remote methods load and update it; no public file URL or new browser permission
is needed. Legacy `{ active, scripts }` settings remain readable and migrate
only on a successful import/selection/deletion, never on startup or preview. Updating validates all
scripts, atomically places private files (mode `0600`, new directories `0700`),
then updates references through Host settings with the page's revision. A
concurrent edit is rejected without changing existing referenced content.
Only plugin-owned hash paths are accepted, with symlink and checksum checks.

Deletion commits the reference update first, then removes the old hash file
only if it is no longer referenced by another template, the live settings, or
Home/profile `cordis.yml` / `cordis.patch.yml` documents (including legacy inline
source). A conflict never deletes old referenced bytes. Cleanup failures are
shown separately from successful configuration updates. An unselected deletion
preserves the active choice; deleting the active template selects Emoji.
Deletion only targets explicitly removed hashes, not unrelated files or old
orphans. Arbitrary manual/profile edits in another process are not an atomic
transaction with this cleanup. Unreadable/malformed profile documents prevent
cleanup and produce a warning instead of risking shared data.
Back up this directory together with settings when moving DSH Home. If a file
is missing or damaged, settings shows its relative path and recovery advice;
restore the original file or re-import the script. An unavailable selected
template falls back to Emoji rather than stale source.

Each queued launch rereads Host settings and file availability before capturing its
template and duration, even when multiple launches arrived in one batch. Preparation
does not share an older settings-panel request; it returns the newly read preferences
directly to playback. Other pages' edits never mutate an active event's captured bytes.
Preparation reserves the event slot and blocks preview while delivery continues. Expiry,
a five-second refresh timeout or plugin stop aborts the read; identity checks discard late
responses. A post-read expiry check also handles suspended tabs. Failed reads use Emoji;
expired/timed-out preparation advances without retry. Animation, toast and their 12-second
deadline start only after preparation completes.

每个排队事件在捕获模板与时长前重新读取 Host 设置和文件可用性，即使事件同批到达也分别
检查。刷新不复用较早的设置页请求，直接把本次读取结果交给播放；其他页面的编辑不会改变
当前事件已捕获的脚本。刷新期间占用事件时间片、禁止插入预览，但继续接收事件。
过期、5 秒刷新超时或卸载会中止读取，迟到结果按身份丢弃；读取后再检查过期时间以兼容
标签页暂停。失败使用 Emoji，过期或超时则推进队列、不重试；动画、toast 及其 12 秒期限
在准备完成后一起启动。

No script or preference is written into Session history. Worker,
renderer, script header format, 64 KiB limit and eight-template limit are unchanged.

## Acceptance

The records below describe earlier checks. This theme-passthrough follow-up has
no new installed-GUI acceptance recorded here. Current verification is automated;
the parent agent separately owns the independent native Chrome visual comparison.

以下记录属于此前验收，本次主题透传修复尚无新增已安装 GUI 验收记录；当前验证限自动化，
父 agent 另行负责独立原生 Chrome 视觉对照。

Earlier validation in installed DSH 0.2.1-rc.2 with `DSH_HOME=~/.dsh-test`, using Codex's
built-in browser: built-in preview, file import, custom preview and save,
refresh persistence, real background `happy_fireworks` playback of the imported
template, toast navigation to the source Session, and termination of a
deliberately looping preview while the settings page remains responsive.

File storage was additionally verified on port 3088: legacy migration,
65,536-byte import/preview/save, exact on-disk bytes and `0600` permissions,
relative-only configuration, refresh and Host restart persistence, real tool
playback and toast navigation, missing-file Emoji fallback and recovery.
See [storage verification](plans/2026-10-23-animation-file-storage.md).

Rendering regression gate: use a dark DSH theme, click preview, and verify the
settings text and sidebar remain visible behind the moving particles. Repeat
in a light theme and with a real background tool call; click its toast to
verify Session navigation. The iframe and srcDoc color schemes must match.
Node unit tests do not reproduce Chromium's iframe compositing behavior, so
this browser check is required when changing the rendering surface or theme
styles.

## Missing files and display metadata

The v2 manifest keeps optional `metadata: {id: {name, durationMs}}` beside the relative
`files` paths. It never stores source code. Existing path-only entries acquire metadata
on a successful owner load while files are readable. Loads and saves share the library's
serial queue; recovery uses revision CAS and retries a conflict once against fresh settings.
A missing/unreadable/corrupt selected script persists `active: emoji` without removing its
reference. Runtime preferences expose `unavailable` metadata separately from executable
`scripts`; a broken id cannot be active, previewed or exported. The settings card keeps its
name, tag and duration and offers only list removal. Other updates preserve broken references;
limits count both healthy and broken custom entries. Read-only/recovery-write failures retain
the in-memory fallback and explain why it could not be persisted. A stale cached script cannot
recreate an unreadable existing id: Host rejects that update, and the UI reloads the list.

A visible settings panel refreshes every two seconds and on focus, suppressing overlapping
local writes/file validation; preview and live launch also refresh availability. Only the
first painted frame starts the progress ring. CSS/SVG advances it for the declared duration
without per-frame React updates. Completion, cancellation, replacement, unmount and a newly
unavailable preview clear the control. The existing footer is fixed at 40 px, including
its confirmation state. The old preview-note and playback-status paragraphs are removed.

v2 清单在相对路径旁保留可选名称/时长元数据，不存脚本全文；旧配置读取时补齐。
读取与保存串行，恢复使用 CAS，冲突后最多重新读取重试一次。当前文件不可用时持久化
`active: emoji`，保留原引用；运行时将损坏项放入独立 `unavailable` 显示清单，禁止选中、
预览和导出，卡片仅能删除配置项。其他更新保留损坏项，数量上限也包含损坏项。
只读或恢复写入失败时仅临时回退并提示。Host 拒绝用旧页面缓存重建不可读的原 id。
可见设置页每两秒及聚焦时刷新，预览和正式播放前也检查；圆形进度从首帧确认开始，
用 CSS/SVG 推进，无需逐帧触发 React。原操作栏固定 40px，确认删除不增加卡片高度。
