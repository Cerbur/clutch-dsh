# @cerbur/clutch-dsh-title Release Log

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
