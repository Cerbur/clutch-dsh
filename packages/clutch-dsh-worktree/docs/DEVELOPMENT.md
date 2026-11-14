# @cerbur/clutch-dsh-worktree 开发与贡献指南

本文档为 `@cerbur/clutch-dsh-worktree` 插件的开发者与贡献者提供完整的开发环境搭建、源码构建、本地安装调试、测试验证以及贡献者工作流指引。

关于插件的权威架构设计与实现原理，请参阅 [ARCHITECTURE.md](ARCHITECTURE.md)。
关于 Agent 维护指令与关键约束，请参阅 [../AGENTS.md](../AGENTS.md)。
关于通用与本包的发布流程，请参阅 [RELEASING.md](RELEASING.md) 及根目录 [../../../docs/RELEASING.md](../../../docs/RELEASING.md)。

---

## 1. 环境前置要求

2026-11-13 兼容验证与开发依赖基线为 `dsh-v0.2.2-rc.2`，最低支持为 `0.2.2-rc.2`。
铃铛使用 CSS anchor；Sidebar 使用可选原生 section-scroller 接缝；原生归档清理终态只触发
匹配记录的只读刷新。完整排查与 UI 回归记录见 [rc.2 compatibility](plans/2026-11-13-dsh-022-rc2-compatibility.md)。

2026-11-06 tool 兼容验证基线为 `dwm home` 定位的 DSH `0.2.2-rc.1`
（`66491b05e3`）。当时最低支持版本与开发依赖统一为 `0.2.2-rc.1`；通过 capability detection 使用新的
step tool admission、独立 native/PTC executor 和 `agent.model` owner。
除默认全量测试外，设置 `DSH_NATIVE_SOURCE` 和 `DSH_SCHEMA_ADAPTER_ANCHOR`
运行真实源码接缝；`test/native-tool-activation.test.mjs` 要求当前逐步准入图，
覆盖 Local/Worktree 首轮 native/PTC、已存在/新建 Agent、偏好读取去重、禁用、取消与卸载。
`native-agent-relay` 的 fixture 同时支持旧 projection owner 和新 state reader，
消息来源、队列修改、重放与不可重复投递断言保持不变。

当前 DSH 的 `nullableToolProviders` 不再改写 wire；provider adapter 拥有转换，
测试 profile 的 Magpie Responses 路由需设置 `compat.supportsStrictMode: true`，
让 pi-ai 明确发送 `strict: false`，避免网关将可选 requestId 强制变为字符串。
这不是启用 strict sampling。旧图继续验证旧 projection，不能把两种
接缝混同为同一套请求可变性保证。浏览器验收使用独立 `DSH_HOME=~/.dsh-test`
服务和临时 Git Workspace；不向业务仓库写入测试任务。

侧栏导航通过正式 `sidebar.workspaces` 插槽挂载，沿用现有 footer 入口。
`node --test test/sidebar-workspace-slot.test.mjs` 使用安装依赖中的真实 DSH SlotRegistry、
React 和 jsdom，验证优先级替换、退出恢复、折叠、声明重建、卸载清理，以及主对话和
共享 Surface owner 的身份保持。原生列表 renderer 的 owner props 由测试提供；它不替代
真实 Desktop 的玻璃材质、滚动和动画联调。`test/sidebar-glass.test.mjs` 检查生产 bundle
不再包含侧栏遮蔽实现。当前 Host/Client 统一要求 DSH `>=0.2.2-rc.2`。

侧栏宽度与滚动契约回归可在本包目录运行：

```bash
DSH_NATIVE_SOURCE=/absolute/path/to/deepseek-harness PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/manual/sidebar-scroll-layout.mjs
```

使用已经安装的 Playwright 与 Chromium；脚本不下载浏览器。它读取本包 CSS、已安装 rc.2
原生 Sidebar/Workspace CSS、源码 checkout 的原生 scrollbar 皮肤和真实 handoff 实现，
检查 200/280/400px 宽度、空/短/长列表、3px/5px 滚动条宽度、行边缘、稳定 gutter、
quietBars 皮肤继承、滚动交接及无 hook 兼容布局。可设置 `SCREENSHOT_DIR` 保存截图。
这是隔离 DOM 布局回归，不替代真实 DSH/桌面视觉验收。默认 slot 测试另覆盖有/无 hook 的
真实注册、折叠、撤销和卸载生命周期。调查与验收记录见
[Sidebar scroll contract](plans/2026-11-13-sidebar-scroll-contract.md)。

Workspace 导航新增 `readWorkspaceNavigation` RPC；构建后重载 Host 并刷新 Client 才能使用
共享事实优化。旧 Host 明确返回新 endpoint 的 HTTP 404 时回退原读取路径，其他错误不回退。
`node --test test/navigation-loading.test.mjs test/navigation-surface.test.mjs` 在构建后验证
真实临时 Git 仓库的调用计数，以及 React 层的延迟、失败、重进、新增项和 mutation 交错。
后者使用 jsdom 与可控 Promise，不是 Windows DSH 浏览器性能实测。

Windows 导航读阶段的可复现 benchmark、原始样本与验证限制见
[2026-11-03 Windows navigation benchmark](benchmarks/2026-11-03-windows-navigation.md)。
同一脚本在 Apple Silicon 上的测量、平台对比与验证结果见
[2026-11-03 macOS navigation benchmark](benchmarks/2026-11-03-macos-navigation.md)。
构建后运行 `node scripts/benchmark-navigation.mjs --samples 30 --warmups 3 --output <new-json-path>`；
该脚本使用真实 Git 与父提交 reader，不包含 DSH 启动恢复、HTTP transport 或浏览器绘制。
脚本的 fixture/provenance Git helper 使用 30 秒命令期限与独立的 5 秒清理期限；
超时后终止 POSIX 进程组或 Windows 进程树，清理期限到达仍未关闭时显式报错并释放管道。
`node --test test/benchmark-git.test.mjs` 验证真实 Git 结果、超时和无法关闭的进程树；
Windows 分支的模拟测试不替代 Windows 宿主验证。历史 benchmark 数据保持原样。

Dashboard 同步基线新增 `syncWorktreeBaseline` Remote；联调时构建插件后重启或重载 Host，再刷新
Client，单独刷新页面无法给旧 Host 增加端点。`node --test test/baseline-sync.test.mjs
test/client-dashboard.test.mjs test/worktree-tools.test.mjs` 验证共享原生 Session 派发与 UI 接收流程。
真实 merge/rebase 流程应在独立临时 Git 仓库和测试 Worktree 中执行，不能使用开发分支作为操作目标。

`node --test test/dashboard-modal-portal.test.mjs` 使用仅供测试的 `jsdom@26.1.0`、真实 React/ReactDOM
portal，以及已安装 DSH primitives 的原始 Modal/键盘/焦点 helper 声明，覆盖 Escape 冒泡、菜单优先级、
弹窗重开与 pending 接收后的 Session 导航。CSS、图标与无关子视图被隔离，不替换原生 Modal 的事件逻辑；
该依赖不进入插件运行包。

- **Node.js**: `>=24.9.0`（与最低支持的 DSH 版本一致）
- **pnpm**: 构建本 package 时使用其 `package.json` pin 的 `pnpm@10.32.1`。第 4 节的 pnpm 11+ `allowBuilds` 要求仅适用于上游 DSH profile 的 Git 源码安装。
- **Git**: `>=2.20.0`（需要支持 worktree 核心命令与 branch 发现）

分支按需加载增加 `getWorkspaceGitState` Host/Remote 接缝，返回根 checkout 的当前分支与 Git
就绪错误，不枚举 branch refs。更新此版本联调时需要重新构建并重载或重启 Host；单独刷新浏览器
无法为旧 Host 添加该 RPC。Workspace 导航和创建弹窗打开不读完整分支列表；选择器打开才请求候选，
Fetch 完成后由 Host 读取一次并直接返回列表，窗口焦点与 Git 页刷新不额外读取。

---

## 2. 准备 Upstream DSH 源码 Checkout

本插件的本地开发、调试与全量联调以官方 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness) 的源码 checkout 为准。

> **注意：** Upstream 仓库当前的默认分支为 `master`（而非 `main` 或历史 prerelease 分支）。后续若官方切换默认分支，应跟从最新默认分支。最低兼容版本为 `dsh-v0.2.2-rc.2`，当前验证基线为 `dsh-v0.2.2-rc.2`，其 Node 引擎要求为 `>=24.9.0`。

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

本包 TypeScript 启用 `preserveSymlinks`，让 DSH UI 声明从本包安装的依赖解析 Controller、Session 和类型扩展，避免 pnpm 共享提升目录中的其他 DSH 版本混入。不要用 `as unknown as` 绕过不同 graph 的 branded id 或 retention 类型冲突；`pnpm run typecheck` 和 `npm pack --dry-run`（保留 prepare）共同验证编译与发布生命周期。Steer matcher 使用 reducer 的结构化事件输入，允许处理基线类型未枚举的可选 inbox 事件，payload 仍由 reducer 校验。

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

针对 `dsh-v0.2.2-rc.2` 的兼容性 smoke test 使用隔离 DSH Home，避免读写默认用户配置。先在 clutch-dsh 根目录构建插件，再从该 tag 的 DSH 源码根目录安装并启动：

```bash
# From the clutch-dsh workspace root
pnpm --filter @cerbur/clutch-dsh-worktree build

# From the dsh-v0.2.2-rc.2 checkout root
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
`sessionQuery`、`agents`、`llm` 与 `systemPrompt` 服务。包的开发依赖使用 DSH `0.2.2-rc.2`；
`clutch-test-dsh-*-legacy` 别名仅为旧 registry/SDK 回归保留 `0.2.0-rc.1`，不代表支持旧宿主。
当前 native/PTC admission 由真实源码集成测试覆盖。实现通过最小 structural Host port 调用服务，避免将
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
通过新 Agent 的 `agent.model.select()` 持久化 Session 专属模型选择；不调用会写部署默认值的 `selectModel`。
仅 legacy fixture 使用请求/提示词 waterfall 临时覆盖，并在原生 `request/header` 后卸载 hook。
模型选择、取消、参数纠错、旧 Session 单项容错、跨 Workspace 拒绝和有界结果推送均有
确定性回归。真实 LLM 账号 smoke test 仍需另行执行，本地测试不会改动运行中的 DSH profile。

工具定义必须遵循 [TOOL-SCHEMA-STANDARD.md](TOOL-SCHEMA-STANDARD.md)：作者层使用每层封闭、无 union 的对象，
互斥目标在执行前校验；长度由原始 Zod 强制执行。经人类批准，可选字段 null 归一化为省略，必填/未知字段不放宽。
默认 test/*.test.mjs 自动运行递归 profile、故意无效负样本、真实注册 inventory/SDK 和全部工具输入门禁。
实际 DSH pi-ai 不属于最小 pinned 依赖图；通过 dwm home 定位已有源码，仅在本 Worktree 运行测试：

~~~bash
DSH_SCHEMA_ADAPTER_ANCHOR=/absolute/dsh/packages/llm/llm-pi-ai/package.json \
  pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

指定 anchor 时测试真实 makeStrictJsonSchema/convertResponsesTools 的 required/null/嵌套 additionalProperties、
无变异和生成参数的运行时接收，不自写转换器。无 anchor 时仅该外部接缝明确 skipped；提供错误 anchor 必须失败。
修改 schema 或升级 DSH 基线时需运行该接缝。它不请求账号、不修改 upstream/运行中 profile，不代表 provider E2E。

可选的真实 native Agent loop 接缝（仍使用确定性模型 adapter，不是账号 E2E）：

```bash
DSH_NATIVE_SOURCE=/absolute/dsh node --test test/native-worktree-tool-lifecycle.test.mjs test/tool-wire-schema.test.mjs
```

它通过实际 Agent loop、Session relay、模型 hook 和提示词组装验证首次回报后 queue 补充任务、
provider opt-in 隔离、其他插件不变及不确定回报的 wire 重试字段。未配置源码时仅该外部接缝跳过。
联调 required+nullable wire 时，在临时 patch 中给 `clutch-dsh-worktree-host` 配置
`dshHome: !!js dshHomePath()` 和 `nullableToolProviders: [实际 provider id]`，
以 `DSH_HOME=/测试目录 dsh web --patch /absolute/overlay.yml --port 3088 --no-open` 启动；
launcher 的 `--patch` 必须在 Web app 的 `--port` 前，且 config 覆盖需保留 dshHome。
每次重载后使用新派发任务验证回报；旧进程的 token/目标不会恢复。

Agent 来源投递的原生数据 factory 直接依赖 `@deepseek-ai/dsh-llm`（peer >=0.2.2-rc.2，开发 pin 为 0.2.2-rc.2），
避免借用偶然存在的传递依赖，也不导入原生 Session/subagent 服务的 Context 类型图污染 Client。
锁文件只在本包 importer 添加既有 llm snapshot 引用，不升级其他 graph。

本包默认测试还包含 `native-agent-relay.test.mjs` 的真实原生接缝。通过 `dwm home` 定位已有源码后，在 monorepo 根运行：

~~~bash
DSH_NATIVE_SOURCE=/absolute/path/to/deepseek-harness \
DSH_SCHEMA_ADAPTER_ANCHOR=/absolute/path/to/deepseek-harness/packages/llm/llm-pi-ai/package.json \
  pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

它执行真实 native inbox/fold、文本 provider context、Chat 分类和 relay body renderer；存储/driver 外壳、CSS、
未使用的 image/unknown-block 路径被隔离。无源码图时仅该外部接缝明确 skipped；错误路径必须失败。
必测来源事实：人类仍为 user，Agent 为 agent-message/relay 且 sender 不可伪造；queue/steer、未知历史读取拒绝、
原 requestId 重试、已消费 receipt、取消/销毁、回报 token 与 callback 门禁均不能退化。不要通过改弱测试过关。
该测试不修改 DSH 源码或原始 Session，不是已部署 GUI 或真实 provider E2E。验证来源展示需要重新加载 Host 中的新插件，
然后在原 GUI 刷新；仅 build 当前 feature 不会替换已运行的生产 Host，也不应为验证擅自重启用户任务。

修改代码后，重新构建插件包并重启 DSH：

```bash
cd /path/to/clutch-dsh
pnpm --filter @cerbur/clutch-dsh-worktree build

cd /path/to/deepseek-harness
pnpm dsh web
```

> **提示：** 若修改了 `package.json`、`cordis.patch.yml` 或 profile bundle 成员，需重新执行一次 `pnpm dsh plugin --profile web add ...`。

插件仅装载 Host，不再提供权限子入口或修改原生 permission 配置。升级本地安装后重新执行上述 plugin add，重启测试服务并刷新 Client，使已安装 bundle 移除旧贡献。历史 Session 的原生策略不迁移。

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

Sidecar、偏好与锁仍位于用户主目录的 DSH Home；新 checkout 放在原 Workspace 范围以沿用默认权限：

- **工作区 Sidecar JSON**：`$dshHome/clutch-dsh-worktree/workspaces/<workspaceId>.json`
- **新建 Worktree 根目录**：`<workspace>/.agents/clutch-worktrees/wt_<hex>/`（子目录 Workspace 也在其自身范围内）；历史 `$dshHome/clutch-dsh-worktree/worktree/wt_<hex>/` 保持原位
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

### 归档与未决清理恢复回归

在 monorepo 根构建后，从 package 根运行。所有 fixture 仓库、Sidecar、锁与日志必须位于
唯一任务目录；只给子命令设置 DSH_HOME/TMPDIR，不覆盖 HOME 或现有 DSH 实例：

```bash
pnpm --filter @cerbur/clutch-dsh-worktree build
cd packages/clutch-dsh-worktree
archiveTestRoot=$(mktemp -d "$HOME/.dsh-test/archive-recovery-XXXXXX")
mkdir -p "$archiveTestRoot/tmp" "$archiveTestRoot/home"
TMPDIR="$archiveTestRoot/tmp" DSH_HOME="$archiveTestRoot/home" \
  node --test test/archive-recovery.test.mjs test/client-branch-drift.test.mjs \
  > "$archiveTestRoot/recovery.log" 2>&1
```

`archive-recovery.test.mjs` 使用真实 Manager、LocalGitAdapter 与磁盘 Sidecar，复现
目录残留/Git 无登记的 `WORKTREE_IDENTITY_CHANGED` 和无关新建的
`WORKTREE_RECOVERY_REQUIRED`；验证明确取消、备份 fsync、原子发布失败、重启、幂等、
跨进程、批量部分失败及路径权限/I/O 不确定性。Git 使用显式 cwd、结构化 argv、10 秒超时
和 1 MiB 输出限额；并发采用调度屏障，测试具有 15–20 秒截止时间。fixture 保留在任务
TMPDIR 下供取证，测试不会使用生产路径。全量门禁也须继承同样的隔离环境。

既有现场备份只作只读取证，复现应重新生成路径/仓库指纹；不可把生产路径直接回放到清理
入口。无需启动或替换用户 GUI；Client 回归执行生产恢复动作与范围刷新约束。
新增恢复参数随 Host Remote 构建生成；仅本地构建不表示现有 GUI 已加载此实现。

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

### Local HEAD 监听回归

构建后运行 `node --test test/checkout-head-watcher.test.mjs`。真实文件系统用例覆盖普通与
linked checkout；故障注入覆盖通知丢失、watch 创建失败、异步 error、原子替换 HEAD、
detached HEAD、相同内容去重与 Host 销毁门禁。保持 5 秒断言期限，不靠放宽超时隐藏丢事件。
沙箱内 macOS `fs.watch` 可能报 `EMFILE`；轮询兜底仍应通过，原生通知路径需在正常宿主环境复验。
`node --test test/host-checkout-navigation.test.mjs` 使用真实 Cordis service、Manager 与临时
Git 仓库，在导航快照完成到观察注册之间切换 branch，覆盖首次/已有监听、并发首次读取、
旧结果迟到、新鲜读取不循环通知以及 Host disposal；仅通过屏障固定时序，不伪造导航结果。

### Desktop 升级与关闭回归

Desktop 升级与关闭回归（构建后在本包目录运行）：

```bash
DSH_NATIVE_SOURCE=/absolute/path/to/deepseek-harness node --test test/host-upgrade-shutdown.test.mjs test/mutation-lock-lifecycle.test.mjs test/worktree-tool-changes.test.mjs test/subprocess-git.test.mjs
```

默认回归覆盖真实 Cordis Host、临时磁盘 shard/repository 锁、Git 取消后的 tree-exit 等待、
通知过期/取消/卸载的 waiter 与 listener 清理，以及 Worktree 文件与 Sidecar binding 保留。
配置 `DSH_NATIVE_SOURCE` 后，另执行真实 Desktop update admission（用 mock timer 推进 10 秒
控制窗口）和真实 process-shutdown controller（IPC 子进程保留默认 5 秒强退期限）。未配置
源码时仅这两项明确 skipped；错误路径必须失败。原生 roster 是 fixture，测试不执行
electron-updater、不加载生产 profile 或重启用户 Desktop。证据与上游建议见
[Desktop 升级超时诊断](plans/2026-11-14-desktop-upgrade-timeout.md)。

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

**Tool test-first governance：** 新增/修改 tool 必须通过既定测试。先修 tool；若规则或测试疑似有误，
停止争议调整，提交失败、实现、官方来源的对照证据，由人类判定。不得先删、跳过、改弱断言或更新快照过关，
也不能让父 Agent 代批。可增加覆盖、做不减弱契约的测试组织重构；实质放宽须先获人类批准。
规范、自动/人工审查分工与适配层证据见 [TOOL-SCHEMA-STANDARD.md](TOOL-SCHEMA-STANDARD.md)。

1. **分支与 Worktree 规范**：遵循根目录 `AGENTS.md` 的 worktree 模型。feature worktree 从最新
   `main` 创建，命名为 `wt-worktree/feat-<feature-name>`；功能完成后可并入某个
   `wt-worktree-<version>/release` 发布。所有功能修改必须在独立 feature worktree 中完成。
2. **提交与门禁**：
   - 并入 release 前必须 rebase 到该 release worktree 的最新基线；
   - 必须通过 clean worktree 检查（无任何 staged、unstaged 或 untracked 文件）；
   - 严禁从 feature worktree 执行 `npm publish`；
   - package version 递增和带版本号的 `RELEASE-LOG.md` 条目在 release worktree 中完成。
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

## 原生 Session 目录能力验证

生产依赖与类型验证最低 graph 为 `0.2.2-rc.2`，旧版本只保留为显式 legacy 测试 fixture。新建 Worktree Session 还要求
原生 workingDirectory 服务，以及 Session 创建的 workspaceId 输入。不能仅按 semver 推断
该 capability 已加载；缺失时新创建流程显式失败，不自动更改权限或 header cwd。

新增 test/native-session-flow.test.mjs 覆盖原始归属、子目录 Workspace、目录/绑定失败、
冷投影释放、原生权限保留、清理和请求去重。独立 Cordis fiber 回归覆盖可选目录服务的注入边界。真实上游目录服务验证：

```bash
DSH_NATIVE_SOURCE=/path/to/deepseek-harness node --test test/native-session-flow.test.mjs
```

该测试只创建临时 Git 仓库和内存 Session，调用真实 WorkingDirectory/Projection/SandboxPolicy，
验证原 header 与权限不变、原生目录事件先发布、取消不改目录。未设置 DSH_NATIVE_SOURCE
时仅该真实 graph 用例跳过，主要契约回归仍执行。历史 preset smoke 继续只验证 legacy Session。

Popover Git 事件刷新新增 startGitWatch/watchGitChanges/stopGitWatch RPC，更新后需重新加载
Host 插件并刷新 Client。只刷新 Client 时旧 Host 不支持监听，仍每 60 秒读取兜底。
Host 使用 Node 文件监听；无事件支持的文件系统依赖兜底。事件等待每 5 秒结束以满足
Desktop drain，不代表每 5 秒执行 Git。可运行 node --test test/git-change-watch.test.mjs
和 test/client-worktree-popover.test.mjs 验证事件与关闭生命周期。
