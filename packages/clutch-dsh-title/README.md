# @cerbur/clutch-dsh-title

## Feature overview

`@cerbur/clutch-dsh-title` replaces DSH's default `session-title-first-prompt-llm` provider through the native `@deepseek-ai/dsh-session-title` seam and `ctx.sessionTitle`. It extracts semantic fields once from the first eligible prompt, then renders the final title deterministically from a validated template.

![Default deterministic title flow](assets/screenshots/title-default.svg)

The default title shape is `0904|配置|优化 session title 生成规则`: a timezone-aware session creation date, an LLM-selected task type, and a concise first-prompt description.

## Capabilities

- One built-in `default` preset with an overrideable template and open field names.
- Closed field kinds: `datetime`, `literal`, `llm-enum`, and `llm-text`.
- One structured JSON LLM request for all `llm-*` fields; `datetime` and `literal` fields never depend on model output.
- A deliberately small template DSL supporting `${identifier}` only; functions, paths, conditions, expressions, and code evaluation are rejected.
- Invalid extraction, malformed configuration, cancellation, timeout, empty output, tool calls, and non-stop finishes throw into DSH's native fallback path.
- DSH remains the owner of `maxTitleBytes`, persistence, rename pinning, refresh, fork inheritance, cancellation, and stale-result protection.
- Existing sessions are not batch-migrated. A newly loaded configuration takes effect when the native service performs an explicit refresh.
- This plugin registers one native session-title provider. Do not re-enable the default provider or install another title provider in the same context.

## Installation

### npm registry

Install the package and add it to the DSH web profile:

```bash
npm install @cerbur/clutch-dsh-title
dsh plugin --profile web add @cerbur/clutch-dsh-title
```

The package expects DSH runtime peers at `>=0.1.2-rc.1`, including `@deepseek-ai/dsh-session-title`, `@deepseek-ai/dsh-session-title-llm`, `@deepseek-ai/dsh-llm`, and `@deepseek-ai/dsh-session`.

### Source checkout

From a local checkout of `clutch-dsh`, install workspace dependencies and add the plugin directory:

```bash
pnpm install
dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title
```

The package is host-only and is mounted through `cordis.patch.yml`; no browser bundle is required.

## Usage

The bundle patch disables the exact DSH entry named `@deepseek-ai/dsh-session-title-first-prompt-llm` and inserts this plugin with `preset: default`. The native title service remains the only title subsystem.

The default configuration is:

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

Field definitions are merged by field name, while an override replaces one complete field definition. For example, a project can use arbitrary field names and a controlled set of values:

```yaml
preset: default
template: '${daytime}|${kind}|${desc}'
fields:
  kind:
    kind: llm-enum
    instruction: 判断任务是优化、功能还是修复
    values: [优化, 功能, 修复]
  desc:
    kind: llm-text
    instruction: 总结首次 prompt
    maxCharacters: 32
```

All LLM fields are sent in one JSON-framed request. The model returns fields only; the renderer inserts deterministic values and literal separators. The renderer does not execute template content, and field validation trims, removes control characters, and enforces enum membership or Unicode-character limits before rendering.

If extraction fails, the provider throws and `ctx.sessionTitle` applies DSH's native fallback. Native `rename()` still pins a user title; later automatic work cannot overwrite it, while native `refresh()` remains the explicit re-derivation operation. Titles and `session/title-llm-request` events use DSH persistence and are inherited by native forks. Configuration changes do not rewrite historical title events or trigger a batch rename.

Only one provider may be registered in a context. Keep the default provider disabled when this package is enabled, and do not compose it with another provider that also registers `ctx.sessionTitle`.

For package-specific release parameters, see [`docs/RELEASING.md`](docs/RELEASING.md). For the public release history, see [`RELEASE-LOG.md`](RELEASE-LOG.md).
