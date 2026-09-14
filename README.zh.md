[English](README.md) | [简体中文](README.zh.md)

# clutch-dsh

`clutch-dsh` 是一个面向 DeepSeek Harness（DSH）的 pnpm workspace 和 plugin 集合。
你可以只把需要的 plugin 安装到 DSH Web profile 中。

当前仓库包含 Worktree、Fireworks、Discuss 和 Title plugin。每个 package 都有独立的使用
文档，也可以单独构建或安装。

## 安装

### 从 npm 安装

在已安装 DSH CLI 的环境中，选择需要的 plugin 添加到 Web profile，然后启动 DSH Web：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
dsh plugin --profile web add @cerbur/clutch-dsh-title
dsh web
```

不需要安装全部 plugin。每个 package 的 README 都说明了对应的行为、要求和使用方法。

### 从本地 checkout 安装

如果你要从 `clutch-dsh` checkout 构建 package，并将本地版本加载到 DSH 源码 checkout，
可以使用下面的流程：

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web
```

把 package 名称和路径替换为要测试的 plugin。各 package README 会给出准确的本地构建命令
以及该 package 特有的开发说明。

## 插件

| Plugin                                                                       | 预览                                                                                                                             | 功能                                                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@cerbur/clutch-dsh-worktree`](packages/clutch-dsh-worktree/README.zh.md)   | <img src="packages/clutch-dsh-worktree/assets/screenshots/screenshots-dashboard.webp" width="240" alt="Worktree Dashboard 预览"> | 增加按 Workspace、Worktree 和 Session 组织 DSH 会话的 Git Worktree 视图。Dashboard 目前是仅 plugin 的预览版。 |
| [`@cerbur/clutch-dsh-fireworks`](packages/clutch-dsh-fireworks/README.zh.md) | <img src="packages/clutch-dsh-fireworks/assets/screenshots/screenshots-zh.png" width="240" alt="DSH Web UI 中的礼花覆盖层">      | 增加 `happy_fireworks` 工具，在重要里程碑完成时显示短暂的庆祝覆盖层。                                         |
| [`@cerbur/clutch-dsh-discuss`](packages/clutch-dsh-discuss/README.zh.md)     | <img src="packages/clutch-dsh-discuss/assets/screenshots/discuss-mvp.svg" width="240" alt="Discuss brainstorming 流程">          | 增加 `/discuss [topic]`，作为 bundled brainstorming workflow 和 review 后 design doc 的入口。                 |
| [`@cerbur/clutch-dsh-title`](packages/clutch-dsh-title/README.zh.md)         | <img src="packages/clutch-dsh-title/assets/screenshots/session-title-list.png" width="240" alt="DSH Session 标题列表">           | 增加可配置的 Session title template 和新 DSH Session 的设置管理器。                                           |

## 开发

在仓库根目录安装依赖并运行检查：

```bash
pnpm install
pnpm run check
pnpm run build
pnpm run test
```

常用的定向检查包括：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
```

如果只需要构建、类型检查或测试某个 package，可以使用它的 filter。package 特有的源码
安装流程和 DSH 兼容性说明见对应文档。

workspace 根 package 保持 private。根目录检查会验证 package 结构、Cordis bundle patch、
格式、lint、类型和测试；可发布的 plugin 位于 `packages/` 下。

## 文档

- [Plugin authoring guide](docs/PLUGIN_AUTHORING.md) — package 结构、角色和 bundle patch。
- [Release guide](docs/RELEASING.md) — 统一的版本、worktree、打包和发布流程。
- [Worktree README](packages/clutch-dsh-worktree/README.zh.md) — Git Worktree 导航和生命周期。
- [Fireworks README](packages/clutch-dsh-fireworks/README.zh.md) — 里程碑庆祝。
- [Discuss README](packages/clutch-dsh-discuss/README.zh.md) — `/discuss` brainstorming 入口。
- [Title README](packages/clutch-dsh-title/README.zh.md) — Session title template。

## 友情链接

- [LINUX DO](https://linux.do/) — 新的理想型社区。
