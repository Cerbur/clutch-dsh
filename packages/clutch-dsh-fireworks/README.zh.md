# @cerbur/clutch-dsh-fireworks

## 功能介绍

`@cerbur/clutch-dsh-fireworks` 为 DSH Web UI 增加一个轻量的庆祝层。Agent 完成重要成果
并调用 `happy_fireworks` 后，当前会话会短暂播放 emoji 礼花。

![礼花 overlay 预览](assets/screenshots/fireworks-mvp.svg)

这是一个纯 plugin-only 的扩展。它只使用 DSH 已有的 tool-result、session projection 和
`shell.overlay` 扩展点，不修改 DSH 源码。

## 能力

- 注册 `happy_fireworks` Agent tool。
- 没有必填参数，可选传入一段简短的 `message`，显示在庆祝横幅中。
- 当宿主环境提供 `systemPrompt` 服务时，通过 `ctx.inject(['systemPrompt'])` 注册系统行为准则 section（`tool:fireworks`，order 2950），在模型收尾轮提供决策心智；宿主未提供时平滑降级。
- 具象化四大明确触发里程碑，显式鼓励 Agent 主动调用：
  1. 完成架构设计文档、规范或实施计划；
  2. 完成功能特性研发与验证；
  3. 修复并验证复杂 Bug；
  4. 重构或迁移后全量测试套件验证通过。
- 明确日常琐碎操作的负向边界（如单纯读取文件、检查 git 状态、执行单次检查等不触发）。
- 只有直接顶层 tool 或代码执行分发（`tool/code-dispatch`）成功返回后才播放，失败和取消不会触发。
- 使用 40 个 emoji 视觉元素组成可点击穿透的全屏礼花层，其中至少包含 10 个 🎉、5 个 🌟
  和 5 个 ✨；剩余 20 个从扩充后的庆祝 emoji 池中进行 seeded roll。
- 历史回放和切换会话不会重复播放旧礼花。
- 通过 `FireworksRenderer` 暴露带类型的 `emoji` 和 `svg` visual，为后续 SVG renderer 预留接口。
- 不需要修改 DSH 源码；插件只提供自己的 Cordis bundle 配置和 Web client metadata。

## 安装

### 从 npm 安装（推荐）

使用已安装的 DSH CLI：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
dsh web
```

### 从仓库源码安装

先构建 plugin，再将绝对路径安装到 DSH Web profile：

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

DSH Web profile 及其原生 UI 必须已经可以正常启动。修改 package manifest 或
`cordis.patch.yml` 后，需要重新执行源码安装命令。

上述源码安装流程会显式构建本地 checkout。生成的 `lib/` 不提交到仓库，因此应使用上述
本地 checkout 流程，而不要直接从原始的 `github:` package path 安装。

## 详细使用

### 自主里程碑庆祝

借助工具描述中的具象化触发契约以及注入的系统行为准则（System Prompt Section），Agent 会在任务收尾轮自主识别重大里程碑（例如架构设计完成、特性研发与验证通过、复杂 Bug 修复解决、重构后全量测试通过）并主动调用 `happy_fireworks` 与用户共同庆祝，同时避免在日常琐碎步骤中滥用。

### 显式提示词与手动测试

在调试或需要明确控制的场景下，也可以通过提示词显式要求 Agent 触发庆祝：

```text
完成一个有意义的里程碑后，调用 happy_fireworks：
{"message":"礼花 MVP 已经可以测试了！"}
```

tool result 会出现在会话中，礼花层会覆盖当前选中的 session 播放几秒：

![礼花动画示意](assets/screenshots/fireworks-mvp.svg)

在 DSH Web UI 中成功调用后的效果如下：

![DSH Web UI 中成功调用礼花工具](assets/screenshots/screenshots-zh.png)

打开会话时如果 projection 中已经有旧信号，第一次观察会被静默记录，因此刷新页面不会
重复播放历史礼花。插件同时支持直接顶层 tool 调用以及程序代码调用（PTC / `run_code`）事件折叠。

卸载 profile 中的 plugin：

```bash
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-fireworks
```
