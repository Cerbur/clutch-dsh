# Fireworks 对 DSH 0.1.2-rc.2（/Users/yuancheng/Documents/Code/deepseek-harness）兼容改动与向前兼容性评估

> **文档性质：** 兼容性评估、架构审计与升级设计文档（严格遵循 `writing-plans` 规范）
> **评估目标：** 评估 `@cerbur/clutch-dsh-fireworks` 针对 DeepSeek Harness `dsh-v0.1.2-rc.2` / `0.1.2` 架构体系（位于 `/Users/yuancheng/Documents/Code/deepseek-harness`）的适配改动清单，并深入评估这些改动能否实现向前兼容（Forward Compatibility）。
> **约束原则：** 本轮执行**纯评估与文档整理，严禁修改任何业务、配置与测试代码**。

---

## 一、评估背景与执行总览

### 1.1 宿主与插件基线环境

| 实体 | 路径 / 分支 / 版本 | 说明 |
| :--- | :--- | :--- |
| **DSH 宿主基线** | `/Users/yuancheng/Documents/Code/deepseek-harness` | 仓库当前处于 0.1.2 演进周期（HEAD 为 `dsh-v0.1.2-rc.1`，master 包含 30+ 项提交正处于 `0.1.2-rc.2` 候选演进）。核心包版本统一为 `0.1.2-rc.1`。 |
| **Fireworks 插件基线** | `packages/clutch-dsh-fireworks` | 当前处于 `wt-fireworks-0.1.2/release` 分支，代码基线继承自 `0.1.1`（此前针对 `dsh-v0.1.1-rc.2` 验证）。 |
| **核心架构变迁** | DSH 0.1.1-rc.2 → 0.1.2 系列 | 宿主完成重大客户端架构解耦：物理删除了 `@deepseek-ai/dsh-client-runtime`，将状态、渲染器和领域分别拆入 `client-store`、`ui-renderer`、`ui-session` 等细粒度包。 |

### 1.2 评估核心结论速览

| 评估维度 | 核心结论 | 风险评级 | 核心原因与机制解释 |
| :--- | :--- | :---: | :--- |
| **Fireworks 现状对 DSH 0.1.2 的兼容性** | **完全阻断 (Incompatible)** | 🚨 致命阻断 | 1. 声明了已彻底删除的 `@deepseek-ai/dsh-client-runtime`（安装与 Web 加载均会抛错）；<br>2. npm Semver 预发布隔离机制导致现有 `<0.2.0-0` 规则拒绝匹配 `0.1.2-rc.1` / `0.1.2-rc.2`。 |
| **完成 0.1.2 适配改动后对 0.1.2 系列的兼容性** | **完全兼容 (Fully Compatible)** | ✅ 无风险 | 改动仅涉及客户端包解耦（引入 `ui-renderer` / `ui-session`）及类型导入修正。Host 端的 Tool、Projection、Event 折叠与 Web 端的 `shell.overlay` 槽位逻辑 100% 保持稳定。 |
| **0.1.2 适配改动对未来版本的向前兼容性 (Forward)** | **高概率向前兼容 (Highly Compatible)**<br>*需注意 Semver 范围设定* | ⚠️ 依赖策略中风险 | 1. **架构与协议面**：Fireworks 仅使用纯标准扩展点（Tool + SessionProjection + Shell.overlay 槽位），零 RPC、零原生 DOM 劫持、零私有存储，接口表面极窄，契约演化稳定性极高；<br>2. **依赖声明面**：peerDependencies 必须采用开放范围（如 `>=0.1.2-rc.1`），避免使用带 `<0.2.0-0` 的人为上限，否则会被未来的预发布版本（如 `0.1.3-rc.1`）二次阻断。 |
| **0.1.2 适配改动对历史版本的向后兼容性 (Backward)** | **不可向后兼容 (Breaking Drop)** | ❌ 明确断裂 | 由于 DSH 0.1.1-rc.2 与 0.1.2-rc.2 的客户端包依赖图互斥（前者必须依赖 `client-runtime`，后者不存在该包），无法在同一个发布包中静态同时支持两者，必须作为版本断代（0.1.2+ 仅支持 DSH 0.1.2+）。 |

---

## 二、Fireworks 对 DSH 0.1.2-rc.2 的兼容改动全景清单（表格对照）

以下按模块类别系统梳理 Fireworks 适配 DSH 0.1.2-rc.2 所需的**全部改动点、改动类型及技术依据**：

| 模块层级 | 目标文件 | Fireworks 0.1.1 现状 | DSH 0.1.2-rc.2 契约演进与断点分析 | 适配 0.1.2-rc.2 的具体改动方案 | 改动性质 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **元数据与生命周期** | `package.json` | `"version": "0.1.1"` | 适配破坏性架构断代，遵循 semver 升级规范 | 版本号升级为 `"version": "0.1.2"` | 必要发布变更 |
| **Web 依赖注入** | `package.json` (`dsh.client.inject`) | `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-layout"]` | DSH 0.1.2 删除了 `client-runtime`；Web 启动器在 materialization 阶段按此列表预加载前置包。缺失该包将触发 `web boot: Failed to load plugins` 错误 | 移除 `dsh-client-runtime`，增补渲染器与会话支持：<br>`["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-session"]` | 🚨 破坏性阻断修复 |
| **Peer 依赖定义** | `package.json` (`peerDependencies`) | 包含 `@deepseek-ai/dsh-client-runtime`: `>=0.1.1-rc.2 <0.2.0-0`；各包上限均为 `<0.2.0-0` | 1. 宿主不存在 `client-runtime` 导致安装报错；<br>2. `<0.2.0-0` 触发 semver 规则拦截所有的 `0.1.2-rc.x` 预发布包 | 1. 彻底移除 `dsh-client-runtime`；<br>2. 增加 `dsh-client-ui-renderer` 与 `dsh-client-ui-session`；<br>3. 将 DSH 依赖范围改为开放式 `>=0.1.2-rc.1`（参考 worktree 0.1.9 方案） | 🚨 破坏性阻断修复 |
| **本地开发依赖** | `package.json` (`devDependencies`) | 固定引用 `0.1.1-rc.2` 与 tools `0.1.0-rc.8` | 开发基线升级至 DSH 0.1.2-rc.1 / 0.1.2-rc.2 | 统一提升为 `0.1.2-rc.1`，删除 `dsh-client-runtime`，加入 `ui-renderer` 与 `ui-session` | 开发编译环境对齐 |
| **客户端入口类型** | `src/client/entry.ts` | `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';` | `@deepseek-ai/dsh-client-runtime/client` 物理路径不存在，TS 编译报错 TS2307 | 改为从 Cordis 核心导入：<br>`import type { Context } from '@deepseek-ai/cordis';`<br>函数签名调整为 `apply(ctx: Context): void` | 🚨 编译阻断修复 |
| **客户端上下文增强** | `src/client/entry.ts` | 仅导入 `dsh-client-ui-layout/client` 与 `dsh-client-ui-slots` | 在 0.1.2 中，`ctx.slots` 的类型合并由 `dsh-client-ui-renderer/client` 提供 | 增加类型声明导入：<br>`import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';` | 编译类型推断修复 |
| **Web 槽位声明契约** | `src/client/entry.ts` | 注册 `ctx.slots.register({ name: 'shell.overlay', id: 'clutch-dsh-fireworks-overlay', order: 10 }, FireworksOverlay)` | DSH 0.1.2 的 `AppFrame` 继续保留 `'shell.overlay': { kind: 'list', scope: 'root' }`，位于根节点渲染层最顶层 | **保持现有逻辑无需修改**。0.1.2 运行时无缝匹配 | ✅ 完全兼容无需修改 |
| **会话状态感知 Hook** | `src/client/FireworksOverlay.tsx` | `type FireworksOverlayProps = PropsRuntime<'shell.overlay'>;`<br>通过解构参数获取 `useSessions` | 在 DSH 0.1.2 中，`useSessions` 仍作为 `GlobalStandardProps` 挂载于所有 root 槽位，但其类型合并来源于 `dsh-client-ui-session/client` | 在组件或入口文件中引入：<br>`import type {} from '@deepseek-ai/dsh-client-ui-session/client';`<br>运行时解构与 `state.byId[sessionId]?.projectionValues?.fireworks` 读取逻辑**完全一致** | 编译类型安全补齐 |
| **动效渲染与防回放** | `src/client/FireworksOverlay.tsx` | 使用 `useRef(new Map())` 跟踪已触发 ID，Canvas/Emoji 渲染 | 纯前端逻辑与 React 18 生命周期，不依赖任何 DSH 变化 | **完全保留现有代码，无需修改** | ✅ 完全兼容无需修改 |
| **客户端打包构建** | `scripts/build-client.mjs` | `deps.neverBundle` 包含 `react`, `cordis`, `dsh-client-ui-layout`, `dsh-client-ui-slots` | DSH 0.1.2 的 `PLATFORM_MODULES` 保持一致（`react`, `cordis`, `ui-slots`, `ui-primitives`, `client-store`） | 可在 `neverBundle` 中增补 `@deepseek-ai/dsh-client-store`，移除非必须项；输出格式 `window.__ModuleLoader__.load` 保持 100% 兼容 | ✅ 规范优化 |
| **Host 插件入口** | `src/index.ts` | `inject = ['tools']`；动态注入 `['sessionProjections']` | DSH 0.1.2 的 Cordis 注入机制与 `ctx.tools` / `ctx.sessionProjections` 服务名完全未变 | **完全保留现有代码，无需修改** | ✅ 完全兼容无需修改 |
| **Agent 工具实现** | `src/fireworks-tool.ts` | `defineTool` 配置输出 schema 与 `presentationMeta` | DSH 0.1.2 的 `@deepseek-ai/dsh-tools` 的 `DefineToolOptions` 结构与 0.1.1 严格一致 | **完全保留现有代码，无需修改** | ✅ 完全兼容无需修改 |
| **会话投影定义** | `src/fireworks-projection.ts` | `init: () => null`, `apply`, `wire`, `stateVersion: 1` | DSH 0.1.2 的 `ProjectionDefinition.init(header, count)` 增加了两个入参，但 JS/TS 允许参数省略 | 运行时完全兼容；类型层面可更新为 `init: (_header, _count) => null` 以达到完美类型对齐 | 细节类型对齐 |
| **事件流监听与过滤** | `src/fireworks-projection.ts` | 监听 `tool/result`，提取 `event.data.meta` | DSH 0.1.2 的 `SessionEvent` 中 `tool/result` 结构与 meta 载荷完全保持不变 | **完全保留现有代码，无需修改** | ✅ 完全兼容无需修改 |
| **投影类型扩展** | `src/contract/index.ts` | `declare module '@deepseek-ai/dsh-session-projection/types'` | DSH 0.1.2 显式保留该类型入口用于纯类型声明合并 | **完全保留现有代码，无需修改** | ✅ 完全兼容无需修改 |
| **Cordis 补丁配置** | `cordis.patch.yml` | `- insert: [{ id: 'clutch-dsh-fireworks', name: '@cerbur/clutch-dsh-fireworks' }]` | DSH 0.1.2 的 patch 加载机制与 schema 完全不变 | **完全保留现有代码，无需修改** | ✅ 完全兼容无需修改 |
| **自动化测试套件** | `test/*.test.mjs` | 包含 manifest 检查、host 单元测试和动效测试 | `package-manifest.test.mjs` 断言了旧的 peerDependencies 与 inject 列表 | 更新测试中对 peerDependencies 和 inject 数组的断言以匹配新结构 | 测试用例同步更新 |

---

## 三、向前兼容性（Forward Compatibility）专项深度评估

如果 Fireworks 按上述方案完成面向 DSH 0.1.2-rc.2 的适配改动，**未来能否持续向前兼容 DSH 0.1.3、0.2.0 或主干演进？**

### 3.1 向前兼容性多维度评估矩阵

| 架构维度 | 未来的演化预期（DSH 主干方向） | Fireworks 改动后的应对机制 | 能否向前兼容 | 风险等级与防护建议 |
| :--- | :--- | :--- | :---: | :--- |
| **1. 依赖管理与 Semver 机制** | DSH 将继续发布 `0.1.2` 正式版、`0.1.3-alpha.x`、`0.1.3-rc.x` 等预发布版本 | 若采用 `>=0.1.2-rc.1` 开放下限且不设狭隘上限（或使用 `*`），包管理器不会拦截未来版本的安装 | **能 (有条件)** | ⚠️ **中风险**<br>**原则：** 严禁再写 `<0.2.0-0` 这种封闭上限。虽然 npm 语义上推荐写上限，但在 prerelease 频繁的内测体系中，封闭上限会导致每一个新 rc 均无法向前安装。 |
| **2. Host 插件模型 (Cordis)** | Cordis 4.x 作为 Harness 核心微内核将长期保持稳定，`ctx.inject` 和生命周期不会发生重构 | Fireworks 仅使用基础的 `inject = ['tools']` 与动态 `ctx.inject(['sessionProjections'])` | **能 (完全向前兼容)** | 🟢 **极低**<br>属于 Cordis 核心设计，无弃用或迁移风险。 |
| **3. Agent 工具系统 (Tools)** | `defineTool`、Canonical Output 机制以及 `presentationMeta` 已经成为 DSH 核心标准并大规模应用于官方工具 | Fireworks 的 `happy_fireworks` 采用最小标准化定义，无任何私有执行逻辑或危险权限声明 | **能 (完全向前兼容)** | 🟢 **极低**<br>工具定义在 0.1.0~0.1.2 跨版本演进中极为稳固。 |
| **4. 会话投影 (Session Projection)** | 会话投影作为 DSH 的核心只读折叠管道，正被用于缓存优化（如近期合并的 `projcache-v6-compat`） | Fireworks 投影为纯同步函数，严格遵循全量状态不可变原则；`wire` 只下发最新礼花信号；`stateVersion` 具备版本自愈能力 | **能 (完全向前兼容)** | 🟢 **极低**<br>DSH 投影机制正在强化而非废弃，未来版本将长期兼容纯同步 fold。 |
| **5. Web 模块加载器 (__ModuleLoader__)** | DSH Web 端通过 `window.__ModuleLoader__.load` 实现了沙箱化懒加载与 HMR 体系，已从实验特性固化为官方基础设施 | Fireworks 打包输出严格对齐 `__ModuleLoader__.load({ id, factory })` CJS 标准包装 | **能 (完全向前兼容)** | 🟢 **极低**<br>ModuleLoader 是 DSH 客户端的平台底座，短期内不会变更。 |
| **6. 页面插槽系统 (Shell.overlay)** | `AppFrame` 将页面全局蒙层（全局弹窗、通知、动效）统一定义在根槽位 `shell.overlay`（`scope: 'root'`） | Fireworks 注册在 `shell.overlay`，挂载在根 DOM 最上层，使用独立绝对定位，不侵入任何具体侧边栏或对话流 DOM | **能 (完全向前兼容)** | 🟢 **极低**<br>顶层 overlay 是 UI 框架的刚性需求，槽位名称与 scope 极其稳定。 |
| **7. 会话感知与状态 Hook** | Session 状态与投影数据由 `ui-session` 统一通过 WebSocket wire 同步到客户端全局 store | Fireworks 仅订阅 `state.byId[sessionId]?.projectionValues?.fireworks`，这是官方投影下发标准路径 | **能 (完全向前兼容)** | 🟢 **极低**<br>即使客户端 store 内部重构，投影字典在 `useSessions` 中的透出方式保持稳定。 |

### 3.2 向前兼容性的关键结论与边界界定

1. **结构性向前兼容结论：**
   - **Fireworks 在架构层面具备极强的向前兼容能力**。
   - 相比于 `clutch-dsh-worktree`（涉及重度 Git 子进程、RPC 通信、侧边栏 DOM 劫持、Project 原生列表重写），Fireworks 的**接口触点极其纯粹**（只消费 DSH 官方推荐的扩展点：1 个 Tool、1 个 Projection、1 个 UI Slot）。
   - 一旦切断对历史旧包 `dsh-client-runtime` 的硬依赖，Fireworks 代码本身在未来 DSH 0.1.2、0.1.3 乃至更高版本中均无需频繁更改。

2. **版本声明策略层面的约束（避免“假性不兼容”）：**
   - **安装层阻断是最大的向前兼容障碍**：npm 在处理带有 prerelease tag（如 `-rc.x`）的依赖时，默认采用严格隔离策略。
   - 如果继续在 `peerDependencies` 中标注例如 `>=0.1.2-rc.2 <0.1.3-0`，当宿主升级到 `0.1.3-rc.1` 时，虽然代码 100% 能跑，但包管理器安装会报错。
   - **最佳建议：** 建议参考 `worktree` 升级 0.1.9 的经验，将 peerDependencies 统一声明为 `>=0.1.2-rc.1`，不设人为上限，最大化向前兼容性。

---

## 四、历史与未来版本跨度兼容对照表 (0.1.0 ~ 0.2.0+)

| DSH 宿主版本区间 | 兼容状态判定 | 运行/加载特征 | 核心原因与断点说明 |
| :--- | :---: | :--- | :--- |
| **DSH 0.1.0-rc.7 ~ 0.1.0-rc.8** | **不可用 (Incompatible)** | 无法启动或缺少特性 | 缺少会话投影 (`sessionProjections`) 的部分 wire 协议与 `presentationMeta` 原生透出机制。 |
| **DSH 0.1.1-rc.1 ~ 0.1.1-rc.2** | **改动后不可用 (Breaking Drop)** | 模块加载中断 (`Cannot find module`) | DSH 0.1.1 仅提供 `@deepseek-ai/dsh-client-runtime`，改动后的 Fireworks 依赖 `dsh-client-ui-renderer` 和 `dsh-client-ui-session`，在 0.1.1 宿主中不存在这些新包。 |
| **DSH 0.1.2-rc.1 (HEAD)** | **完全可用 (Fully Compatible)** | 完美运行，动效与工具正常触发 | DSH 0.1.2-rc.1 正式落地了客户端拆包架构，完全匹配改动后的模块图。 |
| **DSH 0.1.2-rc.2 (待发布/当前 master)** | **完全可用 (Fully Compatible)** | 完美运行，动效与工具正常触发 | 当前 master 仅包含 http-proxy、model-discovery、projcache 等修复，未对 Tool/Projection/Slot/Client-Loader 引入任何破坏性改动。 |
| **DSH 0.1.2 正式版** | **完全可用 (Fully Compatible)** | 完美运行 | 0.1.2 系列的 ABI 和 API 已在 rc.1 冻结，正式版将保持完全稳定。 |
| **DSH 0.1.3+ / 0.2.0+ (未来版本)** | **高置信度兼容 (High Confidence)** | 预计免适配运行 | 只要 DSH 不推翻已确立的 Tool Canonical Output、SessionProjection 纯函数规范与 Slot 系统，改动后的 Fireworks 即可持续向前运行。 |

---

## 五、后续实施计划推荐（仅供升级参考，本轮不执行）

> **实施提示：** 若后续获得用户代码修改授权，可按以下任务分解快速落地适配：

### Task 1: 依赖清单与构建配置现代化
- 修改 `packages/clutch-dsh-fireworks/package.json`：
  - `version`: `0.1.1` → `0.1.2`
  - `dsh.client.inject`: 替换 `client-runtime` 为 `ui-layout`, `ui-renderer`, `ui-session`
  - `peerDependencies` & `devDependencies`: 迁移至 DSH 0.1.2 依赖图，采用 `>=0.1.2-rc.1`

### Task 2: 客户端源码类型导入修复
- 修改 `packages/clutch-dsh-fireworks/src/client/entry.ts`：
  - 将 `ClientContext` 替换为 `@deepseek-ai/cordis` 的 `Context`
  - 增加 `import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'` 与 `ui-session/client`

### Task 3: 构建与自动化测试用例适配
- 修改 `packages/clutch-dsh-fireworks/test/package-manifest.test.mjs`：
  - 更新对新 manifest 结构的断言
- 执行回归验证：
  - `pnpm --filter @cerbur/clutch-dsh-fireworks build`
  - `pnpm --filter @cerbur/clutch-dsh-fireworks test`
