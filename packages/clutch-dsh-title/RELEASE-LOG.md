# @cerbur/clutch-dsh-title Release Log

## 0.1.3 — 2026-09-12

### 中文

#### 新增

- 新增设置中心 Token 消耗统计看板与重置能力，支持展示累计用量与最近一次生成明细。
- 优化标题生成思考强度（reasoningEffort），自适应所选模型支持的最低思考档位并支持自定义配置，以降低生成延迟与 Token 消耗。

#### 说明

- 后续将进一步优化生成提示词与首条消息（first-prompt）截断逻辑，以更加节约生成标题时的 Token 消耗。

### English

#### Added

- Add token consumption statistics display and reset capability in Settings, showing cumulative metrics and recent generation breakdown.
- Optimize title generation reasoning effort by dynamically selecting the lowest supported tier and supporting custom configuration to reduce latency and token usage.

#### Note

- Upcoming updates will further optimize generation prompts and first-prompt truncation logic to reduce token consumption when generating titles.

## 0.1.2 — 2026-09-08

### 中文

#### 新增

- 新增设置中心模板实时样例展示与预设模板复制能力。

#### 优化

- 优化长首条消息输入截断与边界保护，同时保留消息头部与尾部上下文。
- 优化字段提取逻辑，仅向 LLM 提取当前激活模板实际引用的字段。

### English

#### Added

- Add live template title examples and template duplication in Settings.

#### Improved

- Bound long first prompt inputs with head-and-tail preservation within byte limits.
- Extract only fields referenced by the active template during LLM structured extraction.

## 0.1.1 — 2026-09-06

### 中文

#### 新增

- 新增设置中心会话标题模板管理器与实时配置存储。
- 新增插件市场展示截图元数据。

#### 优化

- 优化模板管理器交互与枚举字段默认配置。

### English

#### Added

- Add Settings session title template manager and live settings storage.
- Add storefront screenshot metadata for plugin marketplace.

#### Improved

- Refine template manager interactions and enum field defaults.

## 0.1.0 — 2026-09-04

### 中文

#### 新增

- 新增基于 DSH 原生 `ctx.sessionTitle` seam 的可配置 session title provider。
- 新增 `default` preset、`${identifier}` template DSL，以及 datetime、literal、llm-enum 和 llm-text 字段。
- 新增单次 structured JSON extraction，并保留 native fallback、persistence、rename、refresh、fork 和 concurrency 语义。

### English

#### Added

- Add a configurable session-title provider on DSH's native `ctx.sessionTitle` seam.
- Add the `default` preset, the `${identifier}` template DSL, and datetime, literal, llm-enum, and llm-text fields.
- Add one structured JSON extraction request while preserving native fallback, persistence, rename, refresh, fork, and concurrency semantics.
