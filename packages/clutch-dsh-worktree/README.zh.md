# @cerbur/clutch-dsh-worktree

`@cerbur/clutch-dsh-worktree` 为 DSH Web UI 增加 Git Worktree 视图，按
Workspace → Worktree → Session 组织会话，同时继续由 DSH 作为 Project/Workspace 身份、
Session 元数据、原生列表和会话历史的唯一事实来源。插件只保存 Worktree/Session 的外部
关系元数据。

## 界面截图

![中文 Worktree 侧边栏和新会话空白 Hero](assets/screenshots/screenshots-zh.png)

中文截图展示了侧边栏中的 Worktree 模式、包含 Main 和 Worktree 行的 Workspace 树，以及
新会话空白 Hero 中的只读上下文。

## 能力

- 从 DSH Sidebar footer 进入 Worktree 模式，按 Workspace → Worktree → Session 浏览会话。
- 搜索 Workspace，并从已有 local branch 创建 Git Worktree 和 branch。
- 在 Main 或 active Worktree 下创建普通 Session 或 Worktree Session，并直接打开新会话。
- 查看 ready、repair、active 和 detached Worktree 状态，包括可重试的操作错误。
- 通过 active Worktree 的选项菜单和确认弹窗移除 Worktree；Main 和 detached 行不显示该菜单。
- 继续使用 DSH 原生的 Workspace rename/delete/reorder 和 Session 菜单。Worktree 可以在所属
  Workspace 内排序；顺序保存在插件 sidecar 中，Main 固定在第一位。
- 在已有 Conversation 的标题行以及新会话空白 Hero 中，以只读方式显示当前 local branch 或
  Worktree branch 上下文。
- 在同一个 Session 的 snapshot 更新以及 Session 切换期间保持 Conversation 和 Hero 上下文
  稳定；替换读取进行时保留上一次有效上下文。
- 过长的 branch 名称在 chip 中折叠，并通过原生 hover card 展示完整值；Sidebar footer action
  对齐原生字体和排版，Sidebar 折叠后不再额外显示 `WT` 按钮。
- Worktree Session 仍出现在原始 DSH Project/Workspace 视角中；插件不复制 Session 内容，
  也不修改消息、prompt、transcript 或历史记录。

### 兼容性与前置条件

- 开发和源码验证应使用官方 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)
  的干净 checkout，并跟随仓库当前默认分支。该仓库当前使用 `master` 而不是 `main`，且仍是
  developer preview，package 和 API contract 可能变化；在向 profile 安装本 plugin 前，先完成
  upstream 的安装和构建步骤。
- 目标 profile（例如 `web` 或 `demo`）必须已经可以正常启动，且 plugin 必须安装到实际
  启动 Web UI 的同一个 profile。
- DSH Client 必须提供原生 `@deepseek-ai/dsh-client-ui-conversation` package 及其
  `conversation.session.header.actions` seat。
- Worktree 操作要求 Git 已安装且可在 PATH 中使用。Workspace 必须位于 Git repository 中，
  且至少有一个初始 commit 和本地 branch。Git 可执行文件缺失时显示安装提示且不显示命令块；
  缺少 repository、初始 commit 或本地 branch 时显示可复制的 setup 命令。插件不会执行 setup
  或安装命令，也不会修改 Workspace 文件。
- package 声明了可安装的 `dsh.bundle` 并提供 `cordis.patch.yml`；浏览器 UI 通过
  `dsh.client` metadata 声明。

## 安装

普通用户安装请使用 npm package。开发或验证本地源码时使用仓库 checkout；从市场条目安装
源码 package 时使用 GitHub source path。

### 从 npm 安装（推荐）

在已经安装 DSH CLI 的环境中执行：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

如果使用 `deepseek-harness` 源码 checkout、系统没有独立的 `dsh` 命令，使用等价的转发
形式：

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add @cerbur/clutch-dsh-worktree
pnpm dsh web
```

可以通过官方 registry 查看当前发布版本：

```bash
npm view @cerbur/clutch-dsh-worktree version --registry=https://registry.npmjs.org/
```

### 准备当前 upstream DSH checkout

进行源码开发或验证时，先准备 upstream checkout。当前 upstream 默认分支是 `master`；如果仓库
未来切换默认分支，应跟随仓库的当前默认分支。

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git fetch origin
git pull --ff-only origin master
pnpm install
pnpm run build
```

### 从仓库 checkout 安装

先从 `clutch-dsh` checkout 构建 package，再把绝对路径安装到 DSH profile：

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web --dump-config
pnpm dsh web
```

`--dump-config` 输出中应包含该 plugin 的 bundle layer。如果 profile 中仍有旧的 unscoped
安装，先移除：

```bash
pnpm dsh plugin --profile web remove clutch-dsh-worktree
```

更新本地 checkout 时，重新构建 package 并重启 DSH：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build
cd /path/to/deepseek-harness
pnpm dsh web
```

修改 `package.json`、`cordis.patch.yml` 或 profile bundle 成员后，需要再次执行 plugin add
命令。

### 从 GitHub 源码安装

`awesome-dsh-plugin` 生成的源码路径为：

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

这是源码 Git 依赖，不是预构建的 npm package。它的 `prepare` 生命周期会生成 `lib/`。当前
DSH profile 使用 pnpm 11 的 `allowBuilds`：首次执行 Git 安装时，pnpm 会故意拒绝构建，并
在错误信息中打印包含包名、Git URL、解析后的 commit 和子目录 path 的完整 key。将完整
key 复制到 profile 的 `pnpm-workspace.yaml`，例如：

```yaml
allowBuilds:
  '@cerbur/clutch-dsh-worktree@git+https://github.com/Cerbur/clutch-dsh#<resolved-commit>&path:/packages/clutch-dsh-worktree': true
```

必须使用 pnpm 错误提示中打印的完整包 key：`<resolved-commit>`、Git URL 和 path 都必须与
错误输出一致。对于直接 Git 依赖，只写包名不够；当前 pnpm 11 的 Git prepare 流程也不使用
`onlyBuiltDependencies` 这一配置。保存授权后重新执行原安装命令；commit 变化后需要为新
commit 增加对应的 key。该 allowlist 属于信任此 Git commit 的 profile 维护者，不要写入
plugin package。

授权后，Git prepare 会在 checkout 的 monorepo 中执行 `pnpm install`，再执行
`pnpm run build`，因此 profile 必须能访问其配置的 registry。授权之后出现 registry DNS、
镜像或 lockfile 错误，属于安装环境问题，不是 `allowBuilds` 拒绝。若要避免源码构建授权，
请使用上面的 npm 安装方式。

### 卸载

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

## 使用说明

### 打开 Worktree 模式

1. 启动 DSH Web UI，在 Sidebar footer 选择 Worktree。Worktree 模式是附加界面，不会添加
   独立的 Workspace/Worktree Tab。
2. 使用 Workspace 树搜索、展开并选择 Main 或 Worktree 视角。每组默认显示五行，更多内容
   使用 Expand more/Collapse。

![使用 Worktree 模式时的侧边栏和新会话空白 Hero](assets/screenshots/screenshots-zh.png)

上图展示了侧边栏入口以及新会话空白 Hero 中显示的视觉上下文。界面语言跟随 DSH 当前的
语言设置。

### 创建 Worktree

1. 选择 Workspace，点击它旁边的 `+`，选择基线 local branch，并填写 Worktree name。默认
   branch 名称为 `dsh/<8-character-random-string>`。
2. 目标 Worktree 路径必须是绝对路径，属于同一个 Project，且不能是 Project 根目录。相对
   路径、其他 Project 的路径或 Project 根目录都会被拒绝。
3. Git 必须已安装且可在 PATH 中使用。Git 可执行文件缺失时显示安装提示且不显示命令块；请
   安装 Git、重启 DSH 后重试。如果缺少 repository、初始 commit 或本地 branch，按照弹窗中
   的可复制 setup 命令修复后重试。插件只展示这些提示，不会执行 setup 或安装命令或编辑
   业务文件。

### 创建 Main 和 Worktree Session

- 使用 Main 的 `+`，在 Project 根目录视角中创建普通 DSH Session。
- 使用 Worktree 的 `+`，创建或复用 runtime cwd 指向该 Worktree 的 Session。插件通过 upstream
  runtime 调用 `session.create({ cwd: worktreePath })`，随后保存外部 binding，在当前浏览器内
  应用 `{ workspaceId, sessionId }` membership projection，并打开该 Session。
- 如果存在目标 cwd 完全匹配的未归档 blank Session，连接器会优先复用它。已绑定的 Session
  会直接打开；未绑定的候选会先 binding，再 projection 和打开。否则执行
  `create → bind → project → open`，同一个 Worktree 的并发点击会合并。
- 如果 DSH 创建 Session 后 binding 失败，Session ID 仍会保留，可用于 Retry 或 Open 恢复。
  插件不会删除或修改该 DSH Session。
- provisional blank Session 遵循 DSH 原生显示规则：只在当前选中的视角中显示，使用本地化
  的 `New Session` 文案，不显示生成的 ID，也没有 Rename、Fork 或 Archive 菜单。接受第一条
  prompt 后，它会变为普通 Session 行；隐藏 blank 行不会删除 Session 或 Worktree binding。

### 排序与管理 Worktree

- 在所属 Workspace 内拖动 Worktree。排序持久化在 plugin sidecar 的有序 `worktrees` 数组中；
  Main 是固定的第一行，Worktree 不能跨 Workspace 移动。
- 使用 active Worktree 的选项菜单和确认弹窗移除 Worktree。Main 和 detached Worktree 不显示
  该菜单。
- 移除 Worktree 不会删除其 Session。关系会保留为 detached，直到显式解绑。删除 Workspace
  只会删除 DSH 的 Workspace registration；其目录、Session、Git Worktree 和 plugin
  sidecar 会保留。
- DSH 原生的 Workspace rename/delete/reorder 和 Session 菜单继续可用。Session 拖动排序
  限定在当前视觉 Main 或 Worktree 分组中。
- Main 分组显示当前 local branch：有分支时为 `本地（branch）`，DSH 没有返回当前分支时
  回退为 `本地`。如果导入的 Workspace 是 Git 仓库中的子目录，会先解析 Git 根目录，再
  复用与 Git 根目录相同的 branch/worktree 信息。branch 名称、路径、Workspace 名称、Session
  标题以及原始 DSH/Git 错误信息保持原值。
- 已有 Session 会在标题行显示只读上下文，格式为 `Session title` → `Agent mode` →
  `current branch / Worktree branch`。过长值在紧凑 chip 中折叠，并通过 hover card 显示完整
  内容。原生标题存在且有锚点时，新会话空白 Hero 会在标题后显示 `Workspace (branch)`，并
  提供相同的完整值 hover card。
- Sidebar 折叠后，footer 保留原生的 icon-only action 尺寸和排版；插件不会再绘制独立的
  `WT` rail control。

### 理解状态与恢复提示

- `ready` 表示 Worktree 可用。`repair` 表示 Worktree、Session、binding 或 cwd 缺失/无效。
  `detached` 表示 Git Worktree 已被移除，但关系仍然保留。active binding 指向缺失
  Worktree 时会显示明确的 repair 警告或错误，不会静默切换到其他 Worktree。
- Worktree health 是 Git 的运行时 projection，不写入 sidecar。Git 前置条件失败按
  Workspace 显示提示：Git 可执行文件缺失时显示安装提示且不显示命令块，缺少 repository、
  初始 commit 或本地 branch 时显示可复制的 setup 命令。Connection、Gateway 和未预期的
  Worktree domain 错误会保留为可重试错误，不会伪装为空列表。
- 已经 ready 的视角刷新时会保留当前 projection，直到替换数据可用。同一个 Session 的
  snapshot 更新不会清空上下文，也不会触发重复读取；没有缓存视角时，首次进入和显式 Retry
  可以显示 loading 状态。

## 界面语言

Worktree 模式跟随 DSH 当前界面语言。语言偏好由 DSH 管理；插件不增加独立的语言设置。
Worktree 入口、Workspace → Worktree → Session 树、菜单、弹窗、状态和重试提示均提供中文
和 English 文案。

Workspace 名称、Session 标题、branch 名称、路径以及 DSH/Host 返回的原始错误信息保持不变，
便于诊断和继续使用 DSH 原生数据。Main 分组在 English 中本地化为 `Local (branch)`，中文
为 `本地（branch）`；没有返回当前 branch 时分别回退为 `Local`/`本地`。

## 数据边界与当前限制

DSH 管理原始 Project/Workspace 身份和根目录、Session 身份和元数据、原生 Project/Session
列表、消息、prompt、transcript 和历史记录。插件不会复制或重写这些内容。插件的外部索引
位于 DSH host 的 plugin data directory 或独立 sidecar 存储中，只能包含以下关系事实：

- `projectId`、`worktreeId` 和 `sessionId`；
- 绝对 Worktree 路径、branch 和生命周期状态；
- binding 状态和 schema version。

索引不会写入 Project 工作树或 DSH 原始数据目录，也不会保存 `projectRoot` 副本或任何
Session 内容。如果 sidecar 不可用或损坏，原生 Project/Session 视角仍然可读，插件进入
degraded/read-only 状态；不能用空索引覆盖 DSH 原生列表。

一个 Session 最多绑定一个 active Worktree，一个 Worktree 可以绑定多个 Session。Session
重复绑定同一个 Worktree 是幂等的，绑定两个 active Worktree 会产生 conflict。没有 binding、
使用 Main binding 或处于 detached binding 的 Session 使用 Project 根目录作为 cwd；active
Worktree binding 使用对应的 Worktree 路径。cwd 在每次执行时派生，不会写回 DSH Session 元数据。

创建 Worktree 时先创建 Git Worktree，再记录外部关系。sidecar 写入失败时会尽可能清理刚
创建的 Git Worktree。删除 Worktree 失败时不会改变 sidecar 状态，因此关系仍可重试。创建
Session 时先调用 DSH 原生 API，再写入 binding；binding 失败不会删除或修改已创建的 Session。

Worktree Session 流程将独立的 Worktree cwd 交给 upstream DSH runtime，并将
`{ workspaceId, sessionId }` 保持为浏览器本地 membership projection，而不是持久化的 DSH
attach。它不会修改 DSH 源码、Session metadata 或原生 Workspace 存储。native list 刷新后会
重放 projection；binding 消失或 Client dispose 时会移除 projection。

空白 Hero 上下文只用于展示。由于当前 upstream DSH source checkout 没有 additive Hero
headline slot，它的位置依赖原生 `[data-phase="hero"]` 和标题锚点；锚点不可用时浮层会消失，
未来有正式 DSH slot 时应迁移到该 slot。

## 开发与验证

从 workspace 根目录执行：

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

验证双语 README contract 和格式：

```bash
cd /path/to/clutch-dsh/packages/clutch-dsh-worktree
node --test test/readme-parity.test.mjs
pnpm exec prettier --check README.md README.zh.md test/readme-parity.test.mjs
```

完整 workspace 检查为：

```bash
cd /path/to/clutch-dsh
pnpm run check
```

不要提交生成的 `lib/`、coverage、sidecar 数据或本地凭据。数据边界和生命周期规则见
[AGENTS.md](AGENTS.md)，版本与安装来源见 [docs/RELEASING.md](docs/RELEASING.md)，浏览器
Consumer 边界见 [src/client/README.md](src/client/README.md)。

## 插件市场描述

向 `awesome-dsh-plugin` 投稿时使用 `git` 分类，并保持描述与 package 一致：

```yaml
category: git
description:
  en: Adds a Worktree view to DSH Web UI that groups Sessions by Git worktree while keeping DSH as the source of truth.
  zh: 为 DSH Web UI 增加按 Git Worktree 组织 Session 的视角，同时继续由 DSH 管理原始 Project/Workspace 和 Session 数据。
```

市场投稿还需要在外部确认 `dsh-plugin` topic、仓库年龄和提交数等信息；这些外部属性无法
由 package README 设置。
