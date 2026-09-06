# @cerbur/clutch-dsh-title Release Log

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
