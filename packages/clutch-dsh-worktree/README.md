# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` 为 DSH Web UI 增加按 Git Worktree 组织 Session 的视角，同时继续由 DSH 管理原始 Project/Workspace 和 Session 数据。

English marketplace description:

> Adds a Worktree view to DSH Web UI that groups Sessions by Git worktree while keeping DSH as the source of truth.

## 功能

从 DSH Sidebar footer 打开 Worktree mode 后，可以：

- 按 Workspace → Worktree → Session 查看会话；
- 搜索 Workspace，并从已有 local branch 创建新的 Git Worktree 和 branch；
- 在 Main 或指定 Worktree 下创建 Session，并直接打开新 Session；
- 查看 active、detached 和 repair 状态；
- 通过 active Worktree 的选项菜单移除 Worktree，并在确认弹窗中完成操作；
- 继续使用 DSH 原生的 Workspace rename/delete/reorder 和 Session 菜单、排序能力；Worktree 可在所属 Workspace 内拖动排序，顺序持久化在 plugin sidecar，Main 固定在第一位。
- 在已有 Session 的 Conversation 标题行显示只读上下文：`Session title → Agent mode → current branch / Worktree branch`。
- 在新建会话的 Hero 标题后以只读浮层显示 `Workspace (current branch / Worktree branch)`；重新选择 Workspace 后随当前分支上下文更新。

Worktree Session 仍属于原始 DSH Project/Workspace，因此切回原生 Project/Session 视角时仍可由 DSH 展示。插件不复制 Session 内容，也不修改消息、prompt、transcript 或历史记录。

## 兼容性与前置条件

- DSH CLI 和目标 Web profile 使用 `dsh-v0.1.0-rc.8`；
- 已有可启动的 DSH profile，例如 `web` 或 `demo`；
- plugin 安装在实际启动 Web UI 的同一个 profile；
- DSH Client 必须提供原生 `@deepseek-ai/dsh-client-ui-conversation` package 的 `conversation.session.header.actions` seat；
- 要使用 Worktree 功能，目标 Workspace 必须位于 Git repository 中，且至少有一个初始 commit 和本地 branch；如果前置条件不满足，创建弹窗会显示可复制的 Git 命令，但插件不会自动修改 Workspace。

package manifest 已声明可安装的 `dsh.bundle`，并随 package 提供 `cordis.patch.yml`；Web UI 使用另行声明的 `dsh.client` browser entry。

## 安装

### 从本地 checkout 安装

先在 `clutch-dsh` 根目录构建 package：

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build
```

再在本地 `deepseek-harness` 根目录构建 DSH，并把 package 安装到目标 profile：

```bash
cd /path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web --dump-config
pnpm dsh web
```

建议使用绝对路径。`--dump-config` 输出中应能看到 `@cerbur/clutch-dsh-worktree` 的 bundle layer。

如果 profile 之前安装过旧的 unscoped package，先移除旧条目：

```bash
pnpm dsh plugin --profile web remove clutch-dsh-worktree
```

### 从 npm registry 安装

已发布的 package 可以直接通过 DSH CLI 安装：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

如果使用的是 `deepseek-harness` 源码 checkout、系统没有独立的 `dsh` 命令，使用等价的转发形式：

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add @cerbur/clutch-dsh-worktree
pnpm dsh web
```

安装前可以查看官方 npm registry 的当前发布版本：

```bash
npm view @cerbur/clutch-dsh-worktree version --registry=https://registry.npmjs.org/
```

从本地 checkout 更新时，只需重新构建 package 并重启 DSH：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build
cd /path/to/deepseek-harness
pnpm dsh web
```

修改 `package.json`、`cordis.patch.yml` 或 profile bundle 成员后，需要重新执行 `dsh plugin add`。

### 卸载

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

## 使用说明

1. 启动 DSH Web UI，在 Sidebar footer 打开 Worktree mode。
2. 使用 Workspace 的 `+` 选择基线 local branch，填写新的 Worktree name；默认 branch 名为 `dsh/<8位随机串>`。如果 Workspace 没有 Git、没有首次 commit 或没有本地 branch，弹窗会先显示对应的可复制修复命令。
3. 使用 Main 旁边的 `+` 创建普通 DSH Session。
4. 使用 Worktree 旁边的 `+` 创建 cwd 指向该 Worktree 的 Session；插件完成关系绑定后打开它。
5. 观察 Worktree 的 ready、repair 或 detached 状态；active Worktree 的选项菜单提供 Remove Worktree 入口，Main 和 detached Worktree 不显示该选项。

Workspace 删除只删除 DSH 的 Workspace registration；其目录、Session、Git Worktree 和 plugin sidecar 会保留。

## 界面语言

Worktree mode 跟随 DSH 当前界面语言。语言选择和偏好持久化由 DSH 提供；插件不增加
独立的语言设置。当前插件随 DSH 提供中文和 English 文案，切换 DSH 语言后，Worktree
入口、Workspace/Worktree/Session 树、菜单、弹窗、状态和重试提示会同步切换。

Workspace、Session、branch、path 以及 DSH/Host 返回的原始错误信息保持原值，便于
诊断和继续使用 DSH 原生数据。

Worktree mode 的 Main 分组会显示当前 local branch：English 为 `Local (branch)`，中文为
`本地（branch）`；如果 DSH 没有返回当前分支，则显示 `Local` 或 `本地`。branch 名称保持
DSH/Git 原值。

## 当前限制

DSH rc.8 的原生 `session.create` 不能同时接收 `workspaceId` 和独立 `cwd`。Worktree Session 因此先以 `cwd` 创建，再由插件保存关系，并在当前浏览器内投影 Workspace membership；这不会修改 DSH 源码或 Session metadata。需要 DSH 原生持久 attach 时，仍需 DSH 提供同时支持 Workspace 与独立 cwd 的 API。

Worktree `+` 会优先复用当前 active Worktree、相同绝对路径下未归档的 blank Session；已绑定的直接打开，未绑定的先保存 binding 再投影和打开。没有可复用候选时才按 `create → bind → project → open` 创建；同一 Client 内对同一 Worktree 的并发点击会合并为一次流程。binding 失败会保留原 Session ID 供恢复，指向缺失 Session 或错误 cwd 的关系则显示可重试的 repair 状态。

未发送第一条 prompt 的 provisional blank Session 遵循 DSH 原生显示规则：仅在当前选中的视角中显示本地化的“新会话”/“New Session”，不显示生成的 Session ID，也不显示重命名、Fork 或归档菜单。首条 prompt 被接受后，原生 Session summary 转为普通会话，Worktree 行恢复显示真实标题和菜单；隐藏 blank 行不会删除 Session 或 Worktree binding。

Worktree 顺序按每个 Workspace 独立持久化在 plugin sidecar 的 `worktrees` 数组中，使用与 DSH 原生 `insertBefore` 相同的 source/anchor 语义。Main 是固定的本地视角，不参与 Worktree 拖动；排序不会修改 DSH Workspace、Session 或 Git Worktree 数据。

如果 Connection、Gateway 或 Worktree 操作失败，界面会保留可重试的错误，不把失败伪装为空列表。Git 前置条件失败会按 Workspace 独立显示 setup 提示和可复制命令；插件不会自动执行这些命令，也不会写入 README 或 commit。删除 Worktree 不会删除 Session；detached 关系会保留，直到显式解绑。Main 与 Worktree 分组共用一个参数化 split-row；Main 使用相同的 branch/tree icon 和 action rail，但不传入 Worktree remove 菜单。

Conversation 上下文显示在已有 Session 的原生标题行；新建会话的空白 Hero 使用 plugin-only `shell.overlay` 在原生标题后显示 `Workspace (branch)`。浮层只在原生 `[data-phase="hero"]` 和标题锚点存在时显示，重新选择 Workspace 后会重新读取对应的 local branch 或 active Worktree branch。它仅供展示，不会写回 DSH Workspace 或 Session；binding 处于 detached、invalid、repair 或 unavailable 状态时，标签会消失。由于 rc.8 没有 Hero 标题的 additive slot，浮层位置依赖原生 Hero 的 DOM 结构，未来应优先迁移到正式 slot。

## 版本与发布

本地路径和 Git 依赖安装读取当前 checkout，npm 安装读取 registry；两者不是同一个安装来源。`packages/clutch-dsh-worktree/package.json` 的 `version` 是本地和 npm 的唯一版本源。不要在 README 或市场条目中复制当前版本号；发布修复或新功能时，先递增 package version，再通过 `prepare` 从当前源码生成 `lib/`，然后打包并发布新的 npm version。完整的版本同步、发布、registry 验证和本地/Git/registry 安装流程见 [`docs/RELEASING.md`](docs/RELEASING.md)。

## 开发与验证

在 workspace 根目录执行：

```bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

完整 workspace 校验：

```bash
pnpm run check
```

维护者请先阅读 [AGENTS.md](AGENTS.md) 了解数据边界、模块权责、生命周期和验证约束；发布流程见 [`docs/RELEASING.md`](docs/RELEASING.md)；浏览器 Consumer 的实现说明位于 [`src/client/README.md`](src/client/README.md)。

## 插件市场条目建议

向 `awesome-dsh-plugin` 提交时，建议使用 `git` 分类，并保持描述与实际代码一致：

```yaml
category: git
description:
  en: Adds a Worktree view to DSH Web UI that groups Sessions by Git worktree while keeping DSH as the source of truth.
  zh: 为 DSH Web UI 增加按 Git Worktree 组织 Session 的视角，同时继续由 DSH 管理原始 Project 和 Session 数据。
```

市场投稿还需要在外部仓库中确认 `dsh-plugin` topic、仓库年龄和提交数；这些不是 package README 可以代替设置的内容。
