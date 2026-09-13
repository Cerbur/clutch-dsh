# @cerbur/clutch-dsh

这是一个用于开发和维护 DSH（DeepSeek Harness）plugin 的 pnpm workspace。这里的插件可以安装到 DSH Web UI，为会话标题、Worktree 管理和开发流程增加额外能力。

如果你只是想使用插件，可以直接查看下面的列表和各 package 的 README；如果你要参与开发，再阅读文档和维护说明。

## 已发布 plugin

当前可安装的 plugin packages 包括：

| Plugin name                                                               | Screenshot                                                                                                                                      | 功能描述                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@cerbur/clutch-dsh-worktree`](packages/clutch-dsh-worktree/README.md)   | <img src="packages/clutch-dsh-worktree/assets/screenshots/screenshots-dashboard.webp" width="240" alt="clutch-dsh-worktree Dashboard 预览截图"> | 为 DSH Web UI 增加按 Git Worktree 组织 Session 的视角，并提供仅插件的 Dashboard 预览版和在应用中打开入口；原始 Project 和 Session 数据仍由 DSH 管理。 |
| [`@cerbur/clutch-dsh-fireworks`](packages/clutch-dsh-fireworks/README.md) | <img src="packages/clutch-dsh-fireworks/assets/screenshots/screenshots-zh.png" width="240" alt="clutch-dsh-fireworks 截图">                     | 通过 `happy_fireworks` Agent 工具为 DSH Web UI 增加庆祝礼花覆盖层。                                                                                   |
| [`@cerbur/clutch-dsh-discuss`](packages/clutch-dsh-discuss/README.md)     | <img src="packages/clutch-dsh-discuss/assets/screenshots/discuss-mvp.svg" width="240" alt="clutch-dsh-discuss MVP flow">                        | 通过 `/discuss [topic]` 激活 DSH brainstorming skill 并产出 design doc。                                                                              |
| [`@cerbur/clutch-dsh-title`](packages/clutch-dsh-title/README.md)         | <img src="packages/clutch-dsh-title/assets/screenshots/template-manager.png" width="240" alt="clutch-dsh-title 截图">                           | 通过原生 `ctx.sessionTitle` 为 DSH 提供确定性会话标题生成与设置中心模板管理器。                                                                       |

## 快速开始

在已经安装 DSH CLI 的环境中，选择需要的 plugin 安装到 Web profile：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh plugin --profile web add @cerbur/clutch-dsh-fireworks
dsh plugin --profile web add @cerbur/clutch-dsh-discuss
dsh plugin --profile web add @cerbur/clutch-dsh-title
dsh web
```

每个 plugin 的具体功能、限制和配置方式见对应的 README。

## 本地开发

从仓库源码开发或验证 plugin 时：

```bash
pnpm install
pnpm run check
pnpm run build
pnpm run test
```

修改 package 后，也可以分别运行：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
```

本地安装某个 package 时，使用它自己的 README 中提供的绝对路径命令。例如：

```bash
dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title
```

## Workspace 结构（维护者）

- `packages/*` 下的目录可以是完整 plugin package，也可以是包含 nested module packages 的 plugin 根目录。
- 只有需要独立替换、发布或安装的能力角色才拆成独立 package；Service Definition、Provider 和 Consumer 不要求分别拆包。
- 没有 `package.json` 的目录可以作为规划入口存在，不会被 workspace 检查视为可运行 package。
- 可安装的 DSH bundle 使用真实 manifest：`package.json` 的 `dsh.bundle.patch` 指向同 package 内的 `cordis.patch.yml`。
- 根 package 保持 private，不作为可发布 plugin；额外的 `clutchDsh` metadata 只用于 workspace 结构校验和角色记录。

## 文档

- [Plugin authoring guide](docs/PLUGIN_AUTHORING.md)：命名、依赖和 patch 规则。
- [Release guide](docs/RELEASING.md)：通用版本、检查、打包和发布流程。
- 各 package 的 README：
  - [`clutch-dsh-worktree`](packages/clutch-dsh-worktree/README.md)
  - [`clutch-dsh-fireworks`](packages/clutch-dsh-fireworks/README.md)
  - [`clutch-dsh-discuss`](packages/clutch-dsh-discuss/README.md)
  - [`clutch-dsh-title`](packages/clutch-dsh-title/README.md)
- 各 package 的 `docs/RELEASING.md`：包参数和安装来源说明。

## 友情链接

- [LINUX DO](https://linux.do/) — 新的理想型社区
