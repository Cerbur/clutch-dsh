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
- 只有直接顶层 tool 成功返回后才播放，失败和取消不会触发。
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

## 详细使用

由 Agent 自主判断什么时刻值得庆祝。手动测试时可以使用以下指令：

```text
完成一个有意义的里程碑后，调用 happy_fireworks：
{"message":"礼花 MVP 已经可以测试了！"}
```

tool result 会出现在会话中，礼花层会覆盖当前选中的 session 播放几秒：

![礼花动画示意](assets/screenshots/fireworks-mvp.svg)

打开会话时如果 projection 中已经有旧信号，第一次观察会被静默记录，因此刷新页面不会
重复播放历史礼花。当前 DSH tool contract 不会为嵌套 Code Mode dispatch 提供
`presentationMeta`，所以 MVP 只对直接顶层调用播放动画。

卸载 profile 中的 plugin：

```bash
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-fireworks
```
