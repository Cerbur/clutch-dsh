# @cerbur/clutch-dsh-worktree 开发与贡献指南

本文档为 `@cerbur/clutch-dsh-worktree` 插件的开发者与贡献者提供完整的开发环境搭建、源码构建、本地安装调试、测试验证以及贡献者工作流指引。

关于插件的权威架构设计与实现原理，请参阅 [ARCHITECTURE.md](ARCHITECTURE.md)。
关于 Agent 维护指令与关键约束，请参阅 [../AGENTS.md](../AGENTS.md)。
关于通用与本包的发布流程，请参阅 [RELEASING.md](RELEASING.md) 及根目录 [../../../docs/RELEASING.md](../../../docs/RELEASING.md)。

---

## 1. 环境前置要求

Dashboard 同步基线新增 `syncWorktreeBaseline` Remote；联调时构建插件后重启或重载 Host，再刷新
Client，单独刷新页面无法给旧 Host 增加端点。`node --test test/baseline-sync.test.mjs
test/client-dashboard.test.mjs test/worktree-tools.test.mjs` 验证共享原生 Session 派发与 UI 接收流程。
真实 merge/rebase 流程应在独立临时 Git 仓库和测试 Worktree 中执行，不能使用开发分支作为操作目标。

- **Node.js**: `>=20.0.0`（推荐使用 LTS 版本）
- **pnpm**: 构建本 package 时使用其 `package.json` pin 的 `pnpm@10.32.1`。第 4 节的 pnpm 11+ `allowBuilds` 要求仅适用于上游 DSH profile 的 Git 源码安装。
- **Git**: `>=2.20.0`（需要支持 worktree 核心命令与 branch 发现）

分支按需加载增加 `getWorkspaceGitState` Host/Remote 接缝，返回根 checkout 的当前分支与 Git
就绪错误，不枚举 branch refs。更新此版本联调时需要重新构建并重载或重启 Host；单独刷新浏览器
无法为旧 Host 添加该 RPC。Workspace 导航和创建弹窗打开不读完整分支列表；选择器打开才请求候选，
Fetch 完成后由 Host 读取一次并直接返回列表，窗口焦点与 Git 页刷新不额外读取。

---

## 2. 准备 Upstream DSH 源码 Checkout

本插件的本地开发、调试与全量联调以官方 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness) 的源码 checkout 为准。

> **注意：** Upstream 仓库当前的默认分支为 `master`（而非 `main` 或历史 prerelease 分支）。后续若官方切换默认分支，应跟从最新默认分支。最低兼容版本基线为 `dsh-v0.2.0-rc.1`；当前额外验证的 prerelease graph 为 `dsh-v0.2.0-rc.1`，其 Node 引擎要求为 `^22.19.0 || >=24.0.0`。

克隆并构建 upstream DSH：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git fetch origin
git checkout master
pnpm install
pnpm run build
```

---

## 3. 本地源码构建与安装

### 3.1 构建插件包

Client 的 Worktree 设置入口依赖原生 `@deepseek-ai/dsh-client-ui-settings`（rc.1 基线）。
`dsh-slot-contract.ts` 收敛其 `settings.section` 的最小 owner 契约，避免 Host 生成加载
设置包的 Remote 类型图；运行时通过 DSH 现有 slot 注册，不新增 Host 设置存储。

在 `clutch-dsh` monorepo 根目录执行：

```bash
cd /path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-worktree build
```

构建产物将输出至 `packages/clutch-dsh-worktree/lib/`。Typert Host 分析通过 `tsconfig.host.json` 将 DSH Client Locale 和 Workspace 的类型导入映射到 `scripts/typert-client-locale-meta.d.ts` 与 `scripts/typert-client-ui-workspace-meta.d.ts`。这些 build-only projection 只描述 Worktree 实际使用的 Context 服务，避免 Host 生成时递归载入 Client UI 的 API-remotes 类型图；普通 Client 类型检查和运行时类型仍使用 DSH 的真实模块，Worktree Client 仍只通过现有 `/api` Connection 通信。

Client 的 Git 文件地址使用直接依赖 `@deepseek-ai/dsh-util-workspace-path` 的官方
`fileAddressFor`。该 browser-safe helper 随 Client bundle 打包，不新增 Host 注入服务。

`@deepseek-ai/dsh-client-store` 发布包会导入 `zustand/vanilla`、`zustand/middleware`、
`zustand/shallow` 和 `immer`，但未将它们声明为运行依赖。本包直接声明 Zustand/Immer
开发依赖并将其打入 Client；不能依靠其他 workspace 包或 upstream checkout 偶然提供这些模块。
`build-client.mjs` 启用 `failOnWarn`，无法解析的私有依赖必须使构建失败，不能静默变成
Desktop module table 不支持的 `require()`。隔离回归复制真实发布版 snapshot store、仅链接
本包声明的构建依赖，再执行生成的 handoff factory 与 store 更新；缺失依赖的 fixture 必须构建失败：

```bash
node --test test/client-build.test.mjs
```

### 3.2 将本地插件添加到 DSH Profile

bundle 会同时装载 Host 服务与同包 `./permission-presets` 配置贡献。后者通过 Cordis
`internal/config` hook 在原生权限 entry 激活前追加 Worktree preset，不替换
`permission.config`、不复制内置表、不修改官方 Auto review 注册。`--dump-config`
展示保留的原始权限配置与注入门禁；追加项在运行时 config 中生效。验证权限集成时，应同时
检查自定义 presets/defaultPreset 保留、Auto review 共存、热重载不重复和卸载撤销。

使用绝对路径将构建出的插件包注册至 DSH 的 web profile 中：

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web --dump-config
```

`--dump-config` 输出应包含本插件的 bundle 补丁层。如 profile 中残留有旧的未加 scope 安装，先将其移除：

```bash
pnpm dsh plugin --profile web remove clutch-dsh-worktree
```

启动 DSH Web 服务以验证插件加载：

```bash
pnpm dsh web
```

Desktop 本地安装使用已安装的 CLI，在结束任务并完全退出 Desktop 后执行：

```bash
dsh plugin --profile desktop add /absolute/path/to/clutch-dsh/packages/clutch-dsh-worktree
```

重新打开 Desktop 加载插件。本地链接会从 checkout 解析 Host 的运行依赖，因此
`pnpm install` 后的包级 `node_modules` 必须保留；只有根目录工具链或只有 `lib/` 不能保证
Host/preset 入口可导入。不要通过手工链接或复制替代 profile 安装与依赖解析。
遇到两个入口同时 `failed to import` 时，先检查链接目标的依赖；遇到
`client-modules: require("zustand/vanilla") missed the module table` 时，重新安装构建依赖并构建
Client，不要向 Desktop 全局 module table 添加私有实现依赖。

可选 Desktop 导入 smoke 使用现有 Electron/DSH 图创建隔离 profile，验证实际
`createRuntimeResolution`、`PluginPackages` 与 Cordis Loader 的 preset/Host/Typert 导入，
不启动 GUI、不修改现有 profile。先构建本包，再在本包目录执行：

```bash
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' --expose-internals test/manual/desktop-plugin-import.mjs '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/package.json'
```

可在安装 anchor 后追加其他构建好的 package 绝对路径，用于比较本地 release 与 feature。
导入 smoke 不代表完整 Desktop GUI 已部署或验证。诊断结果见
[Desktop 本地构建诊断](plans/2026-10-13-desktop-local-build.md)。

针对 `dsh-v0.2.0-rc.1` 的兼容性 smoke test 使用隔离 DSH Home，避免读写默认用户配置。先在 clutch-dsh 根目录构建插件，再从该 tag 的 DSH 源码根目录安装并启动：

```bash
# From the clutch-dsh workspace root
pnpm --filter @cerbur/clutch-dsh-worktree build

# From the dsh-v0.2.0-rc.1 checkout root
export DSH_HOME="$HOME/.dsh-test"
pnpm dsh plugin --profile web add /path/to/clutch-dsh/packages/clutch-dsh-worktree
pnpm dsh web --port 3088 --no-open
```

### 3.3 开发迭代与重载

Main/子目录 checkout 回归（先构建本包）：

```bash
node --test test/main-checkout.test.mjs test/file-address.test.mjs test/client-git-open-file.test.mjs test/client-dashboard.test.mjs test/client-branch-drift.test.mjs
node --test test/sidecar-data-migration.test.mjs
```

第一组通过真实临时 Git 仓库验证嵌套 Workspace、linked checkout 路径别名、branch/精确 Tag/
detached Commit、从捕获 HEAD 创建、文件地址和 Sidebar 回调，以及 Main 的菜单与状态展示。
Git 路径语义回归见 `test/git-dashboard.test.mjs`：公开列表与 Diff 请求从 Workspace 工作目录起算，
Provider 保留 Git 根坐标；测试包含 Main/托管/旧记录、commit/summary/working-tree、rename 和边界拒绝。
Windows drive、extended prefix 与 UNC 在浏览器路径单测中验证；这些测试不等于 Windows
宿主或运行中 DSH 的端到端联调。第二组覆盖 v1–v7 历史 Sidecar 迁移；本次 checkout 投影
不升级 v7 schema，HEAD 观察值不可写入 Sidecar。布局还应在 Chromium 窄屏和宽屏检查长引用、
多位数统计与空 Git 面板，使用隔离组件 fixture 时需与实机联调结果区分。

`/cluworktree` 的可选 Host 接缝需要原生 `commands`、`tools`、`sessionController`、
`sessionQuery`、`agents`、`llm` 与 `systemPrompt` 服务。包的开发依赖提供 DSH `0.2.0-rc.1` 的 commands/tools
真实 registry 用于回归验证；实现通过最小 structural Host port 调用它们，避免将
Host SessionStore 的 Context declaration merge 引入 Client Session 类型图。
Agent 工具启用状态属于当前运行时，重启后需重新执行指令。新增验证命令：

```bash
node --test test/worktree-tools.test.mjs test/worktree-tool-session.test.mjs test/worktree-tool-changes.test.mjs
node --test test/worktree-tool-schema.test.mjs
```

工具实现集中在 `src/tool/`，每个工具一个文件，随主 package 通过 TypeScript 正常构建。
原生命令入口与 `systemPrompt.assemble({ scope: agent })` 集成测试验证调用方六个工具及执行方回报工具进入
模型请求，并验证普通任务委派指导的作用域。Host 模块需重新构建后重载或重启；页面刷新无法替换服务端已载入的模块。

工具 Session port 通过原生 `sessionQuery` 读取冷历史，通过原生 `llm` resolver 验证模型，
使用新 Agent 的请求/提示词 waterfall 配置初始路由；不调用会写部署默认值的 `selectModel`。
原生 `request/header` 记录后卸载初始路由 hook；重启前尚未发出首个请求的 Session 会失去
该运行时覆盖。模型 hook、取消、参数纠错、旧 Session 单项容错、跨 Workspace 拒绝和有界结果推送均有
确定性回归。真实 LLM 账号 smoke test 仍需另行执行，本地测试不会改动运行中的 DSH profile。

参数 schema 使用 DSH 支持的子集。测试通过真实 `assertSupportedJsonSchema`、
`jsonSchemaToTs`、`renderToolsSdk` 验证全部工具参数不会退化为 unknown，必填的回报 status/summary
与可选参数正确呈现；长度限制放在字段描述中，由执行时的 Zod 校验。互斥 target 投影为 oneOf，
重叠 union 或不支持的未来 schema 关键字必须显式失败，不能静默丢失参数信息。

修改代码后，重新构建插件包并重启 DSH：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /path/to/deepseek-harness
pnpm dsh web
```

> **提示：** 若修改了 `package.json`、`cordis.patch.yml` 或 profile bundle 成员，需重新执行一次 `pnpm dsh plugin --profile web add ...`。

Host 的可选权限服务通过调用时 Context getter 读取。权限 provider 迟挂载、撤销或替换
不要求重启 Worktree Host；服务恢复后重试仍需经过原有绑定检查与显式确认。普通
fiber restart / Entry.update 测试不等于文件 watcher/module-graph HMR。

权限生命周期定向回归（先构建本包）：

```bash
node --test test/host-permission-lifecycle.test.mjs test/permission-preset-append.test.mjs
```

可选真实 HMR 接缝实验需要现有、兼容的 Cordis/Loader/Timer/HMR node_modules 图与
支持 `--expose-internals` 的 Node（已用 Node 24 验证）：

```bash
node --expose-internals test/manual/permission-preset-hmr.mjs /absolute/path/to/existing/node_modules
```

该实验只读取所指定的已安装模块，写入并清理自己创建的临时 fixture 包及链接；不启动
DSH/GUI，不修改任何现有安装链接或 profile。它使用本包真实子入口 export、贡献实现、
实际 HMR watcher 和 Node module cache，并连接真实 Host 构造函数与确认 controller；
native permission/Auto 和外围 I/O 仍是 fixture。实验同时支持旧版
`@deepseek-ai/cordis-plugin-hmr` 与 Desktop 的 `@deepseek-ai/dsh-hmr`，并检查包名子入口
与绝对 file URL 的模块身份一致。已验证旧图 Cordis 4.0.2 / Loader 1.0.3 / HMR 1.0.17，
以及实际 Desktop Electron Node 24.18.1 / Cordis 4.0.4 / Loader 1.0.5 / DSH HMR 0.2.0-rc.2
的 10 轮贡献与 native fixture 重载、服务替换及卸载；不代表生产完整 profile 或 DOM
验证。无匹配 watcher、没有重建或生产安装指向另一工作区时，本分支 build 不会更新
当前 GUI。历史证据见 [权限生命周期计划](plans/2026-10-07-permission-lifecycle.md)。

热安装问题的三条独立诊断命令（先构建本包）如下。这些是**故意红色**的可选 repro，
不属于默认单元测试：

```bash
node test/manual/permission-preset-market.mjs /absolute/path/to/dshmarket/lib/hot.js
node test/manual/permission-preset-late-install.mjs
node --expose-internals test/manual/permission-preset-native.mjs /absolute/path/to/existing/node_modules
```

最后一条使用真实 native permission provider/schema，但外围 Session/projection/I/O 是
隔离端口；它反证直接 `fiber.update(raw, true)` 在已有 Auto Session 时的重配安全性。
Desktop ASAR 图需以对应 Electron 可执行文件的 `ELECTRON_RUN_AS_NODE=1` 模式运行。
实际命令、结果、修复阻塞及所需原生扩展接缝见
[Desktop 热安装诊断](plans/2026-10-10-permission-presets-hot-install-diagnosis.md)。

### 3.4 卸载本地插件

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web remove @cerbur/clutch-dsh-worktree
```

---

## 4. GitHub 源码安装与 pnpm 构建授权

当通过 `awesome-dsh-plugin` 插件市场条目安装源码时，安装命令如下：

```bash
dsh plugin --profile web add "github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree"
```

这是源码 Git 依赖而非预构建 npm 包，其 `prepare` 生命周期会运行 `pnpm run build` 生成 `lib/`。

当前 DSH profile 采用 pnpm 11 的 `allowBuilds` 机制：首次执行 Git 安装时，pnpm 会主动拦截构建并输出包含**包名、Git URL、已解析 commit 和子目录 path** 的完整 key。

请将该完整 key 写入 profile 的 `pnpm-workspace.yaml` 中：

```yaml
allowBuilds:
  '@cerbur/clutch-dsh-worktree@git+https://github.com/Cerbur/clutch-dsh#<resolved-commit>&path:/packages/clutch-dsh-worktree': true
```

**注意事项：**

1. 必须使用 pnpm 错误提示输出的精确字符串。仅配置包名对直接 Git 依赖无效。
2. `onlyBuiltDependencies` 不是当前 pnpm 11 Git prepare 所用的配置项。
3. 当仓库有新提交时，解析后的 commit hash 改变，需要对应添加新 key。
4. 授权成功后，Git prepare 会在下载的 monorepo 内执行 `pnpm install` 和 `pnpm run build`，因此构建机器必须能正常连接所配置的 npm registry。

---

## 5. 本地调试与排错 (Debugging & Diagnostics)

### 5.1 Profile 配置与 Bundle 挂载排查

运行以下命令检查插件是否被 DSH 成功发现并打补丁：

```bash
cd /path/to/deepseek-harness
pnpm dsh web --dump-config | grep -A 10 clutch-dsh-worktree
```

- 确认 `dshHomePath()` 正确解析并注入。
- 确认 Typert Gateway 在 `/api` 上正常注册了 `worktreeManager/*` endpoint。

### 5.2 Sidecar 存储与跨进程锁排查

插件在本地维护的外部状态位于用户主目录的 DSH Home 下：

- **工作区 Sidecar JSON**：`$dshHome/clutch-dsh-worktree/workspaces/<workspaceId>.json`
- **新建 Worktree 根目录**：`$dshHome/clutch-dsh-worktree/worktree/wt_<hex>/`
- **跨进程文件锁**：`$dshHome/clutch-dsh-worktree/locks/`

在开发调试过程中，若遇到并发异常或需要重置本地测试数据：

- 观察对应 workspace 的 JSON 文件的 `schemaVersion` 和 `worktrees` 条目；
- 检查是否存在未释放的锁文件；正常退出或崩溃恢复时锁会自动释放；
- **切勿手动删除正在执行 Git mutation 的临时标记**。

### 5.3 浏览器客户端与 DevTools 调试

- **Client 资源重载**：修改 `src/client/` 代码后必须执行 `pnpm --filter @cerbur/clutch-dsh-worktree build` 重新生成客户端 bundle；在浏览器中硬刷新（Cmd+Shift+R / Ctrl+F5）加载最新 JS。
- **控制台错误定位**：打开浏览器开发者工具 Console：
  - 过滤 `[worktree]` 或 `[clutch-dsh-worktree]` 日志；
  - 检查 DSH `/api` 请求的 payload 与返回的错误码（如 `WORKTREE_ALREADY_MANAGED`、`WORKTREE_NOT_FOUND`、`WORKTREE_STALE_MUTATION_TOKEN` 等）。

### 5.4 Subprocess 与 Git 错误诊断

- 插件通过直接 argv 数组调用 Git，不经过 shell；
- 若出现 `GIT_OPERATION_FAILED`，检查返回的 `exitCode`、`stderr` 与 `gitProcessTreeDidNotExit` 标记；
- 确认当前系统的 Git 满足版本要求（`git --version >= 2.20.0`），且目标仓库非损坏裸库。

---

## 6. 校验与测试命令

在提交任何改动前，必须在 monorepo 根目录下运行并通过以下全部检查：

```bash
cd /path/to/clutch-dsh

# 1. Workspace 结构与一致性检查
pnpm run check:workspace

# 2. Cordis patch 校验
pnpm run check:patches

# 3. ESLint 检查（包含 src 与 test）
pnpm --filter @cerbur/clutch-dsh-worktree lint

# 4. TypeScript 类型检查
pnpm --filter @cerbur/clutch-dsh-worktree typecheck

# 5. 插件包构建
pnpm --filter @cerbur/clutch-dsh-worktree build

# 6. 单元测试与集成测试
pnpm --filter @cerbur/clutch-dsh-worktree test
```

包级 `lint` 使用 `eslint src test`，同时覆盖源码与测试。ESLint error 必须在提交前修复；
运行测试、构建或 typecheck 不能替代该检查。例如，Node 测试使用 `URL` 时须从 `node:url`
显式导入，即使 Node 运行时也提供同名全局变量。

### Session 完成提醒回归

完成提醒测试必须跨越真实原生状态 owner，不能只给旧 summary 填 `completed=true`。
`test/client-native-session-status.test.mjs` 加载已安装的 UiSession Client handoff，使用真实
Cordis Context、snapshot store 与 SlotRegistry root source，触发 `api-session/status` 和
mainView retention 的 list 回放，再执行生产 Surface hook 与行/Dashboard JSX。平台 widget 和
DOM geometry 使用 browser-free adapter；hook scheduler 保留订阅与 memo 依赖，status-only
用例不更换 `byId`，不靠强制重渲染掩盖缺失订阅。

在 monorepo 根构建，再在包目录运行紧反馈回归：

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
cd packages/clutch-dsh-worktree
node --test test/client-native-session-status.test.mjs
```

覆盖非当前完成、打开/再次运行清除、冷启动 idle、pending 优先级、折叠 Worktree/Workspace、
Dashboard、legacy fallback 以及 catalog-only lineage。没有 `dev:web` watcher 时，本地 build
不会自动更新已运行的生产 GUI；测试回放不表示已部署，不应为验证此回归修改生产 profile 或重启生产。

### README 双语结构与格式校验

插件包含自动化测试以保证中英文 README 结构严格对齐：

```bash
cd /path/to/clutch-dsh/packages/clutch-dsh-worktree
node --test test/readme-parity.test.mjs
```

### Monorepo 全局检查

```bash
cd /path/to/clutch-dsh
pnpm run check
```

---

## 7. 贡献者工作流与门禁

1. **分支与 Worktree 规范**：遵循根目录 `AGENTS.md` 的 release/feature worktree 模型。所有功能修改必须在独立 feature worktree 中完成。
2. **提交与门禁**：
   - 合并前必须 rebase 到最新 release worktree 基线；
   - 必须通过 clean worktree 检查（无任何 staged、unstaged 或 untracked 文件）；
   - 严禁从 feature worktree 执行 `npm publish`。
3. **禁止提交的文件**：
   - `lib/` 构建产物（由 `prepare` 自动生成）
   - `coverage/` 测试覆盖率报告
   - 本地临时 sidecar 数据（如 `$dshHome/clutch-dsh-worktree/`）
   - 个人本地凭据与环境文件
4. **文档同步要求**：
   - 公开行为或用户界面变动时，必须同步更新 `README.md` 与 `README.zh.md`；
   - 架构模型、生命周期或数据边界变动时，必须同步更新 `docs/ARCHITECTURE.md` 与 `AGENTS.md`；
   - 发布前必须在 `RELEASE-LOG.md` 中追加中英文双语更新摘要。

---

## 8. 插件市场（awesome-dsh-plugin）元数据规范

向 `awesome-dsh-plugin` 提交插件时，分类使用 `git`，并保持与包定义一致：

```yaml
category: git
description:
  en: Adds a Worktree view to DSH Web UI that groups Sessions by Git worktree while keeping DSH as the source of truth.
  zh: 为 DSH Web UI 增加按 Git Worktree 组织 Session 的视角，同时继续由 DSH 管理原始 Project/Workspace 和 Session 数据。
```

外部准入指标（如 GitHub 仓库 topic `dsh-plugin`、仓库注册时间、commit 数量等）由市场维护规范决定。

工具偏好回归覆盖通用指令注册开关、Local/Main 与 Worktree 自动注入及隔离、交集去重、派生 Session 仅回报默认值、
首轮 prompt/SDK/指导完整性与第二轮稳定性、并发组装、取消、下游 waterfall 单次变换和创建后默认委派指导，
独立配置文件、并发冲突与损坏文件保护。`node --test test/tool-settings.test.mjs test/worktree-tools.test.mjs`
可定向运行；两处 UI 使用同一 browser-safe 配置接口，不读本地文件。配置修改无需重启，Host 更新通用
命令注册，Agent 在执行前按当前绑定读取 Local/Main 或 Worktree 配置；已加载工具保留至 Agent 结束。
