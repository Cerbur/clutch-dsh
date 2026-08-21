# Worktree UI 多语言支持设计

**日期：** 2026-08-21  
**状态：** 已确认设计

## 目标

为 '@cerbur/clutch-dsh-worktree' 的浏览器 Consumer 接入 DSH 原生多语言机制，使
Worktree mode 的全部插件自有可见文案跟随 DSH 当前语言切换。

语言选择、语言偏好持久化、当前语言快照、切换通知和渲染刷新全部由 DSH 提供。
插件只拥有自己的 'worktree' 文案 namespace 和 'zh'/'en' 词典，不新增插件本地语言
设置，也不复制 DSH 的语言状态。

## 参考实现与现状

参考实现位于：

/Users/yuancheng/Documents/Code/deepseek-harness/packages/client/locale

DSH 原生设计提供：

- 'ctx.locale'：由 DSH Host 的 'settingsScope' 驱动的 LocaleRuntime；
- 'locale.register(namespace, { zh, en })'：注册 feature-owned 词典并在 Fiber 销毁时
  注销；
- 'ctx.slots.installLocale(locale)'：向 Slot renderer 提供 LocaleFace；
- Slot registration 的 'locale: namespace' 声明；
- 组件侧的 'PropsLocale<namespace>' 和响应式 't()'；
- DSH Host 的 'locale.preference' 持久化与 DSH 原生语言切换事件。

当前 Worktree Consumer 的可见文案主要硬编码在
'src/client/WorktreeModeAction.tsx' 和 'src/client/WorktreeSurface.tsx'，尚未声明
locale service、词典或 Slot locale contract。'sidebar-overlay-geometry.ts' 还包含用于
识别 DSH 原生“新建会话”控件的中英文 DOM label，这些 label 是兼容性探测数据，不是
插件可见文案。

## 范围与非目标

### 包含

- Worktree footer action 的 label、title 和 ARIA label；
- Workspace、Main、Worktree、Session 行的菜单、折叠、创建入口和状态 label；
- 搜索框、加载状态、空状态、重试与 Session binding 恢复入口；
- 重命名、删除 Workspace、创建 Worktree 弹窗的标题、说明、字段、按钮和 ARIA label；
- 插件自己生成的 fallback/wrapper error copy；
- 'README.md' 中关于界面语言跟随 DSH 的公开说明；
- 对词典、Slot wiring、error copy 和现有 Client contract 的自动化验证。

### 不包含

- 插件自己的语言检测、语言设置页面、语言存储或 locale context；
- 对 DSH/Host 返回的原始错误 message、Workspace/Session/branch/path/title 内容进行
  翻译；
- 修改 DSH Project/Workspace、Session、消息、transcript、历史内容或 metadata；
- 修改 'sidebar-overlay-geometry.ts' 的原生 DSH label 兼容探测语义；
- 在 DSH 当前 'zh'/'en' 之外自行声明另一套语言集合。

## 方案选择

采用 DSH 原生 LocaleRuntime + Slot locale contract。

手动把 'ctx.locale.bind()' 的函数作为普通 inject prop 传递，会绕过 Slot renderer 的
LocaleFace revision 刷新机制；插件自建 i18n/context 则会重复 DSH 的语言来源和持久化
边界。直接使用 DSH 标准 contract 可以让语言切换只影响显示层，不改变 Worktree/Session
关系和请求流程。

## 运行时架构

### Package metadata

在 'package.json' 中：

- 增加 '@deepseek-ai/dsh-client-locale' 的 rc.8 peer/dev dependency；
- 在 'dsh.client.inject' 中声明 '@deepseek-ai/dsh-client-locale'，确保 DSH 在装载
  Worktree Consumer 前提供 LocaleRuntime。

在 'src/client/entry.ts' 中：

- 通过 type-only import 引入 DSH locale 的 Context merge；
- 将 Client Fiber 的 'inject' 增加 'locale'；
- 用 'ctx.effect(() => ctx.locale.register(WORKTREE_NS, { zh, en }), ...)' 注册词典，
  使登记和注销绑定于插件 Fiber 生命周期。

### Namespace 与词典

新增 'src/client/locales.ts'：

~~~ts
export const WORKTREE_NS = 'worktree' as const

export const zh = {
  'mode.open': '打开 Worktree 模式',
  'mode.exit': '退出 Worktree 模式',
} satisfies Record<string, string>

export type WorktreeLocaleKey = keyof typeof zh

export const en = {
  'mode.open': 'Open Worktree mode',
  'mode.exit': 'Exit Worktree mode',
} satisfies Record<WorktreeLocaleKey, string>
~~~

'src/client/entry.ts' 对
'@deepseek-ai/dsh-client-ui-slots' 做 declaration merge：

~~~ts
interface LocaleNamespaceMap {
  worktree: WorktreeLocaleKey
}
~~~

'zh' 是 key source，'en' 必须覆盖完全相同的 key 集。词典使用 DSH LocaleRuntime 的
flat key 与 '{name}' 参数约定。

### Slot 与组件

两个插件 Slot registration 都声明 'locale: WORKTREE_NS'：

- 'sidebar.footer.action' → 'WorktreeModeAction'；
- 'shell.overlay' → 'WorktreeSurface'。

'WorktreeModeActionProps' 与 'WorktreeSurfaceProps' 分别组合
'PropsLocale<typeof WORKTREE_NS>'。Surface 再将同一个 't' 显式传入内部的
Workspace row、Worktree group row、Session row、session group 和弹窗渲染路径。
这些内部组件不单独注册 Slot，也不创建第二个 locale source。

数据流如下：

~~~text
DSH Host locale.preference
        │
        ▼
DSH LocaleRuntime / LocaleFace
        │ register(worktree, { zh, en })
        ▼
Slot registration(locale: worktree)
        │
        ▼
PropsLocale.t ──► WorktreeSurface ──► rows / menus / dialogs
        ▲
        │ LocaleFace revision on language switch
        └────────────── re-render
~~~

切换语言时不需要插件手动订阅或刷新 Worktree 数据；Worktree 请求、Session binding、
browser-local Workspace membership projection 和 DSH 原始列表保持不变。

## 词典与文案规则

词条按功能使用 flat namespace key，覆盖以下类别：

- 'mode.*'：进入、退出和 footer label；
- 'workspace.*'：Workspace 操作、搜索、空状态和行级 ARIA label；
- 'worktree.*'：Main、Worktree、状态和创建 Session；
- 'session.*'：Session 操作、菜单、展开/收起；
- 'dialog.*'：重命名、删除和创建 Worktree 弹窗；
- 'branch.*'：基线分支、无本地分支、current/checked out 标记；
- 'status.*'、'error.*'、'action.*'：加载、重试、恢复和插件拥有的错误提示。

动态内容通过参数或独立节点传入：

- Workspace/Session title、branch、absolute path 和 Session ID 不翻译；
- count、name、endpoint、sessionId 等结构化参数由 't()' 替换；
- Git/DSH 数据中的固定技术标识保留原值。

'sidebar-overlay-geometry.ts' 继续保留所有当前 DSH 原生“新建会话”中英文 label，
因为它必须识别当前页面实际渲染的原生控件；这些字符串不进入 'worktree' 词典。

## 错误处理

当前浏览器层已经区分可重试错误和 Session binding 失败。本次保留这个行为，并把
文案翻译边界固定为：

1. 'worktree-view.ts' 和 Connection adapter 保持纯数据/错误 contract，不依赖 React
   或 LocaleRuntime；
2. 'WorktreeViewError' 传递 'code'、'retryable'、原始 'message' 和可选 'details'；
3. 插件自有的 capability-missing、invalid-result、disposed、binding wrapper 和
   fallback code 在 UI 层通过纯 'formatWorktreeViewError(error, t)' 映射到
   'worktree' 词条；
4. 'WorktreeSessionBindingError' 保留创建出的 Session ID 和底层 reason，显示文案由
   当前语言的模板生成；
5. 未知 code、原生 DSH API 抛出的错误和 Host domain error 的原始 'message' 原样
   展示，确保诊断信息不被翻译或丢失；
6. 'Retry'、'Retry Binding' 和 'Open Created Session' 等恢复入口本身使用词典，但
   不改变既有恢复顺序和“不删除已创建 DSH Session”的规则。

## 文件边界

预计修改或新增：

- 'package.json'：DSH locale peer/dev dependency 与 Client inject metadata；
- 'src/client/entry.ts'：locale inject、namespace declaration、词典注册和 Slot locale
  registration；
- 'src/client/locales.ts'：'worktree' 的 'zh/en' 词典；
- 'src/client/WorktreeModeAction.tsx'：PropsLocale 与 footer 文案；
- 'src/client/WorktreeSurface.tsx'：PropsLocale、内部组件的 't' 传递和所有可见 copy；
- 'src/client/worktree-view.ts'：结构化 view error details，保持纯逻辑；
- 'src/client/worktree-connection.ts'：保留原始错误信息并为 UI formatter 提供必要的
  code/details；
- 'src/client/worktree-error-copy.ts'：插件自有错误 code 到词典 key 的纯映射；
- 'test/client-fixture.mjs'：提供可记录 register/dispose 的 fake locale face；
- 'test/client-locale.test.mjs'：词典 parity 与参数行为；
- 'test/client-error-copy.test.mjs'：错误 copy 映射和原始 message 保留；
- 'test/client-composition.test.mjs'、'test/client-surface.test.mjs' 和必要的边界测试；
- 'README.md'：公开说明 UI 跟随 DSH 当前语言。

不修改 Host、Provider、Manage、sidecar schema、Remote contract、DSH 原始数据适配器
或 Worktree 生命周期行为。

## 验证与验收

实现遵循 TDD，每个行为先写一个可失败测试，再写最小实现。至少验证：

- 'zh' 与 'en' key 集完全一致；
- DSH locale service 的注册、Slot namespace 和 Fiber dispose wiring 正确；
- DSH 语言切换后 footer、surface、row、menu、dialog 文案使用当前语言；
- 词典参数替换不改变动态 Workspace/Session/branch/path 数据；
- 插件自有错误 code 被翻译，未知 DSH/Host 原始错误保持原文；
- Connection、Gateway、Worktree domain 失败仍显示 retryable error；
- Session binding 失败仍保留已创建 Session ID，并继续支持重试或直接打开；
- geometry anchor 的 DSH 中英文识别行为不回退；
- 原有 Project/Session、Worktree sidecar、Client dispose 和 Remote contract 测试全部通过。

执行命令：

~~~bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

验收结果必须满足：插件不提供第二套语言设置；Worktree mode 的插件自有 UI 完整跟随
DSH 语言；原有 Worktree 数据边界、生命周期、恢复流程和 Client API 行为不改变。
