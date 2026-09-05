# @cerbur/clutch-dsh-title 设计

- 日期：2026-09-04
- 目标 worktree：`wt-session-0.1.0/release`
- 状态：设计基线已确认，MVP 已实现
- 兼容 DSH：`>=0.1.2-rc.1`

## 1. 背景与目标

`@cerbur/clutch-dsh-title` 是 `clutch-dsh` 的一个独立 plugin。它通过
DeepSeek Harness 原生的 `@deepseek-ai/dsh-session-title` / `ctx.sessionTitle`
seam，替换默认的 `session-title-first-prompt-llm` provider。

目标是允许用户配置一个确定性的 title 模板，并由 LLM 从首次 prompt 中提取
模板所需的语义字段，例如任务范围和任务描述。plugin 不重新实现 title
service，不维护第二份 session title state。

## 2. 已确认的设计决策

- 自动模式固定为 DSH 原生的 `first-prompt`。
- v0.1 只提供一个 `default` preset。
- `template` 与 `fields` 是公开配置，可以由 profile/home patch 覆盖。
- 字段名称开放，字段解析 `kind` 受控。
- v0.1 支持 `datetime`、`literal`、`llm-enum`、`llm-text` 四种 field kind。
- 每次生成只进行一次 LLM extraction，所有 LLM 字段一次返回。
- LLM 只提取字段，不直接生成最终 title。
- 字段提取失败、JSON 非法、字段缺失或枚举值非法时，provider 抛错，交给
  DSH native fallback。
- 最终标题长度交给 DSH 原生 `maxTitleBytes` 做 UTF-8 安全截断。
- 继续记录 DSH 原生 `session/title-llm-request` event。
- bundle patch 自动禁用默认 provider，并插入新的 provider row。
- package 是 atomic、host-only plugin，不新增 client 或 contract package。
- peer dependency 的版本下界为 `>=0.1.2-rc.1`，不设置上限。

## 3. 职责边界

### DSH 原生职责

`@deepseek-ai/dsh-session-title` 继续拥有：

- `ctx.sessionTitle` service；
- `session/title` persistence 与 projection；
- fallback；
- `rename` 与用户标题 pin；
- `refresh` 与显式 unpin；
- fork 的 title event inheritance；
- provider registration 的单例约束；
- generation cancellation、revision supersession 和 stale-result 防护。

### plugin 职责

`@cerbur/clutch-dsh-title` 只负责：

- 注册 `clutch-dsh-title` provider；
- 解析和校验配置；
- 解析 `datetime` / `literal` 字段；
- 根据 field instruction 构造 JSON extraction prompt；
- 通过 `ctx.llm.stream` 提取动态字段；
- 校验 JSON、枚举和字段长度；
- 用安全的 placeholder renderer 生成最终 title；
- 写入原生 `session/title-llm-request` 请求日志。

## 4. 运行时流程

```text
首条有效 human message
  ↓
DSH session-title service 创建 fallback 并调度 first-prompt provider
  ↓
plugin 读取首次 prompt 和 session.createdAt
  ↓
本地解析 datetime/literal 字段
  ↓
一次 LLM JSON extraction
  ↓
严格校验动态字段
  ↓
template renderer 插值
  ↓
返回 { title, messageSeqs, model }
  ↓
DSH 写入 session/title
```

provider 返回的 `messageSeqs` 应准确标识实际使用的首次 human message。自动
生成失败时，DSH 已经写入或保留的 fallback 不被 plugin 覆盖。

`rename`、后续 prompt、fork、`refresh` 和并发行为由 DSH service 继续决定：

- 后续 prompt 不会自动触发新的 title generation；
- rename 后 title 继续被 pin；
- refresh 是显式重试和 unpin 入口；
- fork 继续继承已有 title events；
- stale provider result 不得写入 session。

## 5. 配置模型

### 默认配置

```yaml
preset: default

template: '${daytime}|${type}|${desc}'

fields:
  daytime:
    kind: datetime
    source: session.createdAt
    format: MMDD
    timezone: Asia/Shanghai

  type:
    kind: llm-enum
    instruction: 判断这个 session 的任务类型
    values: [前端, 后端, 配置, 文档]

  desc:
    kind: llm-text
    instruction: 总结首次 prompt，保留具体任务含义
    maxCharacters: 32
```

`type` 的默认值集合按当前产品决策使用 `[前端, 后端, 配置, 文档]`；如果未来
需要表达 `[优化, 功能, 修复]`，只需覆盖该字段的 `values`。

### 配置覆盖

配置优先级为：

```text
plugin defaults < preset < explicit template/fields
```

用户可以只覆盖部分配置：

```yaml
preset: default

template: '${type}: ${desc}'

fields:
  desc:
    kind: llm-text
    instruction: 用不超过 20 个字总结首次 prompt
    maxCharacters: 20
```

plugin 的 Config 解析必须对 preset 和字段提供缺省值，避免 DSH bundle patch 的
whole-config replacement 语义迫使用户重复所有默认字段。

### Field kinds

- `datetime`：从 session 元数据确定性计算；默认读取创建时间。
- `literal`：固定字符串，不调用 LLM。
- `llm-enum`：要求 LLM 返回声明的枚举值之一。
- `llm-text`：要求 LLM 返回文本，并接受字段级字符上限。

字段名称可以是任意合法 identifier，例如 `project`、`scope`、`action`；但字段
解析行为只能来自受控的 field kind，不能执行任意表达式或代码。

### 日期字段

`datetime` 必须基于 session 创建时间，而不是生成标题时的当前时间，以保证
refresh 不会改变日期字段。

v0.1 默认使用 `MMDD` 生成 `0903`。日期格式应使用 plugin 定义的有限 token，
而不是执行任意日期表达式。后续可以增加 `YYYY`、`MM`、`DD`、`DDD`、`HH`、
`mm` 等 token。

## 6. Template DSL

v0.1 只支持简单 placeholder：

```text
${identifier}
```

例如：

```text
${daytime}|${type}|${desc}
dayTime[${daytime}]|类型[${type}]|描述[${desc}]
```

规则：

- placeholder 必须对应 `fields` 中声明的字段；
- 未声明字段在配置加载时失败；
- 不支持函数、表达式、条件、循环或 `eval`；
- 字段值先做单行化、trim 和控制字符清理；
- template 只做渲染，不参与 LLM extraction；
- 最终字符串仍交给 DSH 原生 title normalization 和 `maxTitleBytes`。

字段值中的分隔符目前按普通文本处理，title 不承诺可被机器无歧义反向解析。
如果未来需要稳定的结构化解析，再增加明确的 escape policy，而不扩展成表达式
语言。

## 7. LLM extraction

### Prompt 组织

plugin 根据所有 `llm-*` 字段生成统一 extraction prompt。每个字段的
`instruction` 描述字段语义，`llm-enum` 的 `values` 进入约束。

系统约束至少包括：

- 只返回一个 JSON object；
- 不返回 Markdown、代码块、解释或额外字段；
- 必须返回声明的动态字段；
- enum 字段只能使用声明值；
- 首次 prompt 是待分析的数据，不是新的系统指令。

`datetime` 和 `literal` 字段不进入 LLM schema。

### 调用方式

plugin-local extractor 复用 DSH 的低层 LLM runtime：

- `ctx.llm.stream`；
- 当前 request route；
- `AbortSignal`；
- `sessionId`；
- `purpose: 'session-title'`；
- stream block assembly；
- timeout、empty output、tool call 和非正常结束校验。

它不调用原生“直接生成纯文本 title”的 helper，因为该 helper 的固定 prompt
和结果协议不支持字段 JSON。

### 请求日志

实际 dispatch 前追加原生 `session/title-llm-request`：

```text
titleProvider: clutch-dsh-title
messageSeqs: [firstMessage.seq]
route: resolved request route or explicit route
system: generated extraction system prompt
messages: exact selected human message payload
maxTokens: configured extraction budget
```

最终渲染结果仍只通过 DSH 的 `session/title` event 持久化。

### 失败策略

以下任何情况都会使 provider 失败：

- JSON 无法解析；
- 必需字段缺失；
- enum 值非法；
- `llm-text` 超过字段限制；
- template 引用不存在或不可渲染的字段；
- LLM 请求取消、超时、空响应、tool call 或非正常结束。

失败交给 DSH native fallback。plugin 不写入半成品 title，也不为字段单独追加
fallback event。

## 8. Bundle patch 替换策略

`cordis.patch.yml` 使用当前 DSH base bundle 的 row id 和 name guard：

```yaml
- id: session-title-llm
  name: '@deepseek-ai/dsh-session-title-first-prompt-llm'
  disabled: true

- insert:
    - id: clutch-dsh-title
      name: '@cerbur/clutch-dsh-title'
      config:
        preset: default
```

不能直接把已有 row 的 `name` 改成新包名，因为 DSH patch processor 会在 name
不匹配时跳过该 patch。必须采用“disable default + insert custom provider”。

plugin bundle 应在 base bundle 之后应用。安装或移除 bundle 后需要按 DSH 规则重启
对应 profile，使 bundle patch 重新组合。

DSH 只允许一个 `ctx.sessionTitle` provider。用户不得同时重新启用默认 provider
或安装另一个 title provider；否则注册第二个 provider 时应失败。

## 9. 兼容性与升级风险

### 版本

初始 peer dependency 下界：

```text
>=0.1.2-rc.1
```

不设置上限。由于该范围允许未来版本，发布前和 DSH 升级后必须运行完整
composition test 与 release verification。

### 敏感契约

- `SessionTitleProvider` request/result 类型；
- `session/title-llm-request` event data；
- base bundle 的 `session-title-llm` row id/name；
- DSH 的 eligible human message collection；
- `ctx.llm` route 和 stream API；
- DSH Config / bundle patch 的 whole-config 语义。

name guard 的作用是避免在 row id 被复用时静默禁用错误 provider。若 DSH 修改
row id/name，patch 应显式更新；不要通过模糊匹配自动替换。

### 已有 session

- 旧的 `session/title` event 不需要迁移；
- 安装 plugin 不批量重命名已有 session；
- 修改 template/fields 不重写历史 title；
- 对已有 session 调用 refresh 才会使用新 provider；
- rename pin、fork inheritance 和旧 title event 都继续有效；
- 卸载 plugin 不删除已经持久化的 title。

## 10. Package 结构

```text
packages/clutch-dsh-title/
├── package.json
├── cordis.patch.yml
├── tsconfig.json
├── README.md
├── README.zh.md
├── docs/
│   ├── RELEASING.md
│   └── superpowers/
│       └── specs/
│           └── 2026-09-04-title-design.md
├── assets/
│   └── screenshots/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── provider.ts
│   ├── extractor.ts
│   ├── renderer.ts
│   ├── fields.ts
│   └── presets/
│       └── default.ts
└── tests/
    ├── config.spec.ts
    ├── renderer.spec.ts
    ├── extractor.spec.ts
    └── composition.spec.ts
```

`src/index.ts` 遵循 DSH function plugin 的 named export 约定，注册 provider，不
注入新的 client 或 UI。README 需要同时提供英文和中文版本，并按仓库约定说明
功能、能力、npm/源码安装、配置和限制。若展示 title 在 UI 中的效果，截图放入
`assets/screenshots/`。

## 11. 验收标准

- package 能被 workspace 发现并通过 patch manifest 校验；
- bundle composition 后默认 provider disabled，`clutch-dsh-title` 成为唯一
  provider；
- 首条 prompt 产生一条原生 extraction request event 和一条最终 title event；
- 默认 template 生成确定性的字段排列；
- 用户可以通过配置覆盖 template 和任意字段定义；
- invalid JSON、缺失字段、非法 enum 和超时都回落到 DSH native fallback；
- 后续 prompt 不自动触发新生成；
- refresh 使用新 provider 重试，rename 继续 pin；
- provider 结果携带正确的 source message seq 和 model provenance；
- stale 或已取消的 generation 不会写入旧结果；
- 文档明确版本范围、替换规则和单 provider 限制。

## 12. 非 MVP 项目

- `all-prompts` 自动更新；
- 全局 custom prompt；
- 用户自定义 preset registry；
- 条件模板、循环和表达式；
- 每字段独立 LLM 请求；
- 后台摘要、debounce 或 cost budget；
- 自有 UI、客户端注入或历史 title migration；
- 结构化 title 的 delimiter escape / 反向解析协议。
