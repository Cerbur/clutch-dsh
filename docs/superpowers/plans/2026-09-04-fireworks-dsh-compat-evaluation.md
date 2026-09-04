# Fireworks 对 DSH 0.1.1-rc.2 兼容改动与向前兼容性评估

> **文档性质：** 兼容性评估与架构审计报告（按 writing-plans 规范结构整理）
> **评估目标：** `packages/clutch-dsh-fireworks` 针对 `dsh-v0.1.1-rc.2`（`/Users/yuancheng/Documents/Code/deepseek-harness`）的兼容性设计、实现改动及对未来版本的向前兼容能力评估。
> **代码状态：** 仅评估与文档输出，不修改任何业务与配置代码。

---

## 一、评估背景与核心结论摘要

`@cerbur/clutch-dsh-fireworks` 是基于 DeepSeek Harness 插件体系开发的庆祝动效插件（包含 `happy_fireworks` 工具、会话投影与 Web 覆盖层）。

| 评估维度 | 核心结论 | 风险等级 | 说明 |
| :--- | :--- | :---: | :--- |
| **对 DSH 0.1.1-rc.2 的兼容性** | **完全兼容 (Fully Compatible)** | 无风险 | 无论是 Host 端 (`ctx.tools`、`ctx.sessionProjections`) 还是 Client 端 (`shell.overlay`、`useSessions`)，均精确契合 `dsh-v0.1.1-rc.2` 的公开规范。 |
| **对更早版本的向后兼容 (Backward)** | **部分受限 (Constrained)** | 中 | `package.json` 的 peerDependencies 声明显式排除了 `<0.1.1-rc.2` 的预发布宿主（如 `0.1.0-rc.8`），除非使用 `--legacy-peer-deps`。 |
| **对更高版本的向前兼容 (Forward)** | **不可兼容 (Breaking / Incompatible)** | 高 (阻塞) | DSH 在 `0.1.2-rc.1` 及 master 中彻底移除了 `@deepseek-ai/dsh-client-runtime`，重构了客户端架构，且 semver 规则会拦截 0.1.2 的预发布版本。 |

---

## 二、Fireworks 对 DSH 0.1.1-rc.2 的改动与架构依赖清单（表格总览）

以下整理了 Fireworks 插件与 DSH `dsh-v0.1.1-rc.2` 交互涉及的全部改动点、依赖契约与实现机制：

| 模块类别 | 文件位置 | DSH 0.1.1-rc.2 契约依赖点 | Fireworks 具体实现与改动 | 兼容性现状 (0.1.1-rc.2) |
| :--- | :--- | :--- | :--- | :--- |
| **Bundle 注入** | `cordis.patch.yml` | `cordis.patch.yml` 声明式合并机制 | 声明 `- insert: [{ id: 'clutch-dsh-fireworks', name: '@cerbur/clutch-dsh-fireworks' }]` | **完全兼容**：DSH 启动时能正常加载 Host 插件 |
| **Host 插件入口** | `src/index.ts` | `@deepseek-ai/cordis` 4.0.1 上下文与 `ctx.inject` 机制 | `inject = ['tools']`；动态注入 `['sessionProjections']` 注册投影，同步注册工具 | **完全兼容**：遵循 Cordis 异步服务注入标准 |
| **Agent 工具定义** | `src/fireworks-tool.ts` | `@deepseek-ai/dsh-tools` 的 `defineTool` 规范，支持规范输出 (Canonical Output) | 声明 `name: 'happy_fireworks'`，定义参数 `message?`，输出 `output { schema, render, presentationMeta }`，以及 `presentCall` / `presentResult` / `execute` | **完全兼容**：`0.1.1-rc.2` 原生支持 `presentationMeta` 导出与卡片渲染 |
| **工具调用元数据** | `src/fireworks-tool.ts` | 顶层工具调用的元数据随 `tool/result` 持久化到 `event.data.meta` | `presentationMeta` 返回 `{ kind: 'clutch-dsh-fireworks', id: value.id, message }`，供后续投影提取 | **完全兼容**：DSH 核心保证了直接顶层工具调用的元数据下发 |
| **会话投影定义** | `src/fireworks-projection.ts` | `@deepseek-ai/dsh-session-projection` 的 `ProjectionDefinition` 规范 | `createFireworksProjectionDefinition()`：拥有 `key: 'fireworks'`、`stateSchema`、`init: () => null`、`apply`、`wire` 与 `stateVersion: 1` | **完全兼容**：符合 DSH 会话投影的纯同步折叠函数要求 |
| **事件流监听与折叠** | `src/fireworks-projection.ts` | `@deepseek-ai/dsh-session` 的 `SessionEvent` 结构定义 | `applyFireworksProjection` 过滤 `event.type === 'tool/result'`，校验 `!event.data.error`、提取 `event.data.meta` 并匹配 `event.data.message.source.callId === meta.id` | **完全兼容**：精准利用已有会话事件，零新增后端事件类型 |
| **投影类型扩展** | `src/contract/index.ts` | TypeScript declaration merging: `SessionProjectionMap` 与 `SessionProjectionStateMap` | `declare module '@deepseek-ai/dsh-session-projection/types'` 注入 `fireworks` 字段 | **完全兼容**：前后端均可通过强类型获取投影值 |
| **Web 客户端注入** | `package.json` (dsh.client) | `dsh.client` 浏览器入口打包与依赖注入声明 | `inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-layout']`, `platform: 'web'` | **完全兼容**：`0.1.1-rc.2` 具有上述两客户端包 |
| **Web 槽位注册** | `src/client/entry.ts` | `@deepseek-ai/dsh-client-ui-slots` 的 `shell.overlay` 根槽位 | `ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'clutch-dsh-fireworks-overlay', order: 10 }, FireworksOverlay))` | **完全兼容**：`0.1.1-rc.2` 的 `AppFrame` 在根节点渲染 `shell.overlay` |
| **会话状态感知** | `src/client/FireworksOverlay.tsx` | `useSessions` 反应式 hook 及其 `state.byId[id].projectionValues` | `useSessions((state) => ({ sessionId: state.current, signal: state.byId[sessionId]?.projectionValues?.fireworks }))` | **完全兼容**：投影值通过 WebSocket wire view 同步到客户端全局状态 |
| **动效去重与防回放** | `src/client/FireworksOverlay.tsx` | 会话历史回放与切换时不重复播放旧礼花 | 使用 `seen = useRef(new Map())`，初次挂载静默记录，仅当活跃会话出现新的调用 ID 时触发动画 | **完全兼容**：保障了页面刷新或切换会话时的体验纯净 |
| **客户端构建封装** | `scripts/build-client.mjs` | DSH ModuleLoader (`window.__ModuleLoader__.load`) 机制 | 将 React 组件和 CSS 样式内联编译打包为单文件 `lib/client.js` | **完全兼容**：独立闭包加载，不污染宿主样式 |
| **发布生命周期优化** | `package.json` (0.1.1 改动) | npm 与 git 依赖安装生命周期规约 | 将 build 从 `prepare` 迁移到 `prepublishOnly`，防止源码作为 Git 依赖安装时强行构建 | **完全兼容**：符合 clutch-dsh 发布规范 |
| **Peer 依赖约束** | `package.json` (0.1.1 改动) | npm semver 对 prerelease 的匹配规则 | 将 `*` 改为 `>=0.1.1-rc.2 <0.2.0-0` (及 tools `>=0.1.0-rc.8 <0.2.0-0`) | **完全兼容**：精准适配当前 DSH `0.1.1-rc.2` 环境 |

---

## 三、向前兼容性（Forward Compatibility）专项评估与破坏性分析

当 DSH 宿主升级至更高版本（例如 `0.1.2-rc.1` 或当前的 master 分支）时，Fireworks 插件是否能够向前兼容？

### 1. 向前兼容性评估汇总表

| 潜在影响领域 | DSH 未来版本 (0.1.2+) 演进现状 | 对 Fireworks 的兼容性影响 | 是否向前兼容 | 破坏级别 |
| :--- | :--- | :--- | :---: | :---: |
| **客户端核心包移除** | 彻底删除 `@deepseek-ai/dsh-client-runtime` (commit `be531688f3`) | Fireworks `package.json` 中声明了对该包的 peerDependencies 及 `dsh.client.inject`，宿主不存在该包导致安装失败与模块加载失败 | **否 (不兼容)** | 🚨 致命阻断 |
| **客户端状态 Hook 迁移** | `useSessions` 改由 `@deepseek-ai/dsh-client-ui-session` 及 `ui-renderer` 交付 | Fireworks 依赖 `PropsRuntime<'shell.overlay'>` 传递的 `useSessions`，由于 runtime 包缺失，类型与运行时接入链路断裂 | **否 (不兼容)** | 🚨 致命阻断 |
| **Semver 预发布规则拦截** | DSH 发布了 `0.1.2-alpha.x` / `0.1.2-rc.x` 等预发布版本 | npm semver 规定：不带 includePrerelease 时，预发布版本只能匹配相同元组的范围。`>=0.1.1-rc.2 <0.2.0-0` 无法匹配 `0.1.2-rc.1` | **否 (不兼容)** | 🚨 依赖安装拦截 |
| **Session 投影 init 签名扩充** | `init(header, count)` 增加了会话头与继承事件数入参 | Fireworks 实现为 `init: () => null`。JS 层面忽略多余参数仍可运行；但重新编译类型检查时需更新签名 | **是 (运行时兼容，构建需同步)** | ⚠️ 轻微 |
| **Tool 元数据与事件模型** | `output.presentationMeta` 与 `tool/result` 事件契约保持稳定 | DSH 0.1.2 仍保持 `exec.callId`、`tool/result` 及 `event.data.meta` 机制不变 | **是 (兼容)** | ✅ 无影响 |
| **Host 插件注入机制** | `cordis.patch.yml` 与 `ctx.tools` 注册机制保持稳定 | Host 端的 Cordis 插件装配模型在 0.1.2 保持一致 | **是 (兼容)** | ✅ 无影响 |
| **页面覆盖层槽位** | `shell.overlay` 依然作为 `AppFrame` 的顶级 list 槽位存在 | 槽位名称与渲染结构未改动，依旧位于根视图最上层 | **是 (兼容)** | ✅ 无影响 |

---

## 四、核心阻断点成因深度剖析

### 1. 致命阻断点一：`@deepseek-ai/dsh-client-runtime` 的消亡
- **DSH 变更详情**：在 DSH 0.1.2 开发周期中（commit `be531688f3`），DSH 对臃肿的 `client/runtime` 进行了领域拆分，将其职能拆入：
  - `@deepseek-ai/dsh-client-ui-renderer`（负责 Slot 与渲染层）
  - `@deepseek-ai/dsh-client-ui-session`（负责 Session 状态与视图）
  - `@deepseek-ai/dsh-client-store`（负责通用 Store 基础设施）
  原 `@deepseek-ai/dsh-client-runtime` 包被物理删除且不再构建或发布。
- **Fireworks 的阻断表现**：
  - **安装阶段**：包管理器在解析 Fireworks 的 `peerDependencies` 时，无法在 DSH 0.1.2 仓库或 npm 上找到满足 `@deepseek-ai/dsh-client-runtime` 的包，抛出依赖未满足错误。
  - **浏览器加载阶段**：DSH `web` profile 在按 `package.json.dsh.client.inject` 注入前置模块时，因找不到该模块而直接中断 Fireworks 客户端插件的初始化。

### 2. 致命阻断点二：Semver Prerelease 的匹配隔离
- **原因机制**：
  Fireworks 0.1.1 声明的范围为：
  `"@deepseek-ai/dsh-client-runtime": ">=0.1.1-rc.2 <0.2.0-0"`
  以及 `dsh-tools`：`">=0.1.0-rc.8 <0.2.0-0"`。
  根据 Semver 规范（Semver 2.0.0 §9 & npm/semver 规则），当比较一个预发布版本（如 `0.1.2-rc.1`）时，只要范围表达式没有明确包含相同 `[major, minor, patch]`（即 `0.1.2-*`）的预发布标记，`semver.satisfies` 默认直接返回 `false`。
- **实际表现**：
  即使某个包未来未被移除（如 `@deepseek-ai/dsh-session` 在 0.1.2-rc.1 依然存在），在安装时 npm/pnpm 也会将 `0.1.2-rc.1` 判定为不满足 `>=0.1.1-rc.2 <0.2.0-0`！

---

## 五、结论与后续适配建议（供后续升级参考）

1. **当前现状结论**：
   - Fireworks 当前实现针对 **DSH 0.1.1-rc.2** 是完备、健壮且严格测试通过的。
   - 但它**无法向前兼容 DSH 0.1.2+**，在 DSH 升级到 0.1.2-rc.1 或更高版本后，Fireworks 必须发布新版本（如 `0.1.2`）进行适配。

2. **未来适配 0.1.2+ 需进行的升级改造路线（保持零侵入原则）：**
   - **客户端依赖更新**：将 `dsh.client.inject` 和 peerDependencies 中的 `@deepseek-ai/dsh-client-runtime` 替换为新版标准客户端包（如 `@deepseek-ai/dsh-client-ui-renderer` 与 `@deepseek-ai/dsh-client-ui-session`）。
   - **客户端类型导入更新**：将 `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'` 改为直接从 `@deepseek-ai/cordis` 导入 `Context`。
   - **Semver 范围放宽**：采用开放式的范围或在每个 release 中对准 DSH 的主干版本号。
