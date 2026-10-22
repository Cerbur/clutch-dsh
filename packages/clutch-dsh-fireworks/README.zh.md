[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-fireworks

`@cerbur/clutch-dsh-fireworks` 为 DSH Web UI 增加短暂的庆祝覆盖层。Agent 在重要里程碑完成
后可以调用 `happy_fireworks`，也可以传入简短消息，让整个 DSH 窗口播放 emoji 礼花，即使来源
Session 正在后台运行。点击通知 toast 可以跳转到触发庆祝的 Session。

这是一个附加式 DSH 扩展。它只注册自己的工具和 Web UI overlay，不修改 DSH 源码，也不向
conversation history 添加自定义事件类型。

## 安装

### 从 npm 安装

在已安装 DSH CLI 的环境中：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
dsh web
```

如果使用 DeepSeek Harness 源码 checkout 且没有独立的 `dsh` 命令，可使用等价的
`pnpm dsh` 形式。

### 从本地 checkout 安装

先构建 package 和 DSH 源码 checkout，再用绝对路径添加 package：

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-fireworks build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-fireworks
pnpm dsh web
```

生成的 `lib/` 目录不会提交，因此应使用这个已构建的本地 checkout 流程，而不要从原始
`github:` path 直接安装。修改 `package.json` 或 `cordis.patch.yml` 后，需要重新执行绝对
路径安装命令。

## 功能

| 功能                   | 预览                                                                                                                             | 作用                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **自动庆祝里程碑**     | <img src="assets/screenshots/fireworks-mvp.svg" width="420" alt="Happy fireworks 庆祝预览">                                      | bundled guidance 会引导 Agent 在完成设计或计划、完成并验证功能、解决复杂 Bug，或重构后通过全量验证时调用 `happy_fireworks`。读取文件和单次检查等日常动作不算里程碑。 |
| **Fireworks 覆盖层**   | <img src="assets/screenshots/screenshots-zh.png" width="420" alt="DSH Web UI 中的礼花覆盖层">                                    | 成功调用后，在整个 DSH 窗口显示短暂、可穿透点击的覆盖层，不依赖当前选中的 Session，并显示可点击的庆祝 toast。                                                        |
| **跳转到来源 Session** | <img src="assets/screenshots/global-fireworks-toast.png" width="420" alt="真实 DSH 插件页面中的后台 Session 礼花和可点击 toast"> | 点击 toast，通过 DSH 导航打开来源 Session；关闭 toast 不会中断动画。截图来自已安装插件的真实后台工具调用。                                                           |
| **安全的回放行为**     | —                                                                                                                                | 失败或取消的调用保持安静。打开 Session、刷新页面或切换 Session 都不会重新播放旧礼花。                                                                                |

## 使用

### 庆祝重要里程碑

安装后，Agent 会看到 `happy_fireworks` 工具的使用指引。当任务在收尾轮达到重要里程碑时，Agent
可以使用它，例如完成设计、验证功能、解决复杂 Bug，或完成重构后的全量验证。

这个工具不用于读取文件、检查 Git 状态或执行单次检查等日常中间步骤。

### 手动测试

可以明确要求 Agent 测试覆盖层：

```text
完成一个有意义的里程碑后，调用 happy_fireworks：
{"message":"礼花 MVP 已经可以测试了！"}
```

成功调用会出现在 conversation 中，并播放几秒覆盖层。可选消息会被 trim，并限制为适合 toast 的
短文本。程序化 tool-call dispatch 和直接顶层 tool result 都支持。任务运行时可以切换到其他
Session 或应用页面，全局效果仍会播放。点击 toast 上的 **Open session →** 返回来源 Session，
也可以点击 **×** 关闭通知。

## 要求

| 组件    | 要求                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DSH     | 提供 DSH Connection RPC、Session、Session Projection、Tools、UI Renderer、UI Slots 和 UI Workspace 导航的 Web UI。要求 DSH 0.2.0 或更高版本，显式支持 0.2.0 和 0.2.1 预发布版；`package.json` 中的 peer 范围是唯一来源。 |
| Cordis  | 兼容的 Cordis `4.x`；开发使用 `4.0.4`。                                                                                                                                                                                  |
| Browser | 已加载该 plugin Web client bundle 的 DSH Web UI。                                                                                                                                                                        |

## 行为与限制

- 每次礼花约持续 3 秒，并使用确定性的 emoji 视觉元素。可选的 `message` 会被规范化为
  最多 120 个字符。只有 toast 接收点击，粒子层保持点击穿透。
- 只有实时成功的 fireworks 结果会触发播放。错误、取消、加载历史 Session 和刷新页面都不会
  重播旧庆祝。
- 切换 Session 或应用页面不会清除动画。toast 最多保留 8 秒，除非被关闭或被队列中的
  下一次庆祝替换。
- 不同 Session 的庆祝按队列播放，重复的 Session/tool-call identity 会被忽略。临时事件源
  和播放队列各最多保留 128 项，事件在 30 秒后过期。过期或溢出的待播事件会被丢弃，
  短暂断线可以在这些限制内补收。
- 每个已连接的 owner 页面独立消费事件。效果仅显示在对应 DSH 窗口内，不创建操作系统桌面
  覆盖层。工具成功结果表示请求已记录，不表示浏览器确认完成了播放。
- 插件通过已鉴权的 DSH Connection 共享路由 `/api/clutch_fireworks/events` 传输
  `clutch_fireworks/launch` 事件，不添加 DSH 生成目录项或自定义 Session 事件类型。
  全局事件源仅对 Host owner 开放，受限的非 owner peer 无法读取。
- 如果 Host 提供 DSH 的 `systemPrompt` service，插件会添加里程碑指引。没有该可选 service
  时，工具仍然可用，但不会添加这段指引。
- package 不 patch DSH 源码，也不持久化 conversation 副本。

## 开发

在 workspace 根目录构建、类型检查和测试：

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks typecheck
pnpm --filter @cerbur/clutch-dsh-fireworks build
pnpm --filter @cerbur/clutch-dsh-fireworks test
```

package 发布参数和源码安装约束见 [docs/RELEASING.md](docs/RELEASING.md)。

## 卸载

使用 DSH CLI：

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-fireworks
```

如果使用 DeepSeek Harness checkout，可对同一个 package name 使用
`pnpm dsh plugin --profile web remove`。

## 友情链接

- [LINUX DO](https://linux.do/) — 新的理想型社区。
