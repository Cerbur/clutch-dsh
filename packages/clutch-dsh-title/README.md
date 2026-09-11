# @cerbur/clutch-dsh-title

## Feature overview

`@cerbur/clutch-dsh-title` replaces DSH's default `session-title-first-prompt-llm` provider through the native `@deepseek-ai/dsh-session-title` seam and `ctx.sessionTitle`. It extracts semantic fields once from the first eligible prompt, then renders the final title deterministically from a validated template.

![Default deterministic title flow](assets/screenshots/title-default.svg)

The default title shape is `0904|功能|优化 session title 生成规则`: a timezone-aware session creation date, an LLM-selected task type, and a concise first-prompt description.

## Capabilities

- An immutable built-in `default` template and named user templates with open field names.
- Fresh settings include an editable `emoji` template; duplicate any template and preview its title format in each row.
- **Settings → Session Title** supports creating, editing, deleting and activating templates, or disabling customization to use DSH's native first-prompt title generator.
- Live `$DSH_HOME/settings.yaml` storage; invalid templates remain visible and an invalid/missing active template falls back to `default`.
- Closed field kinds: `datetime`, `literal`, `llm-enum`, and `llm-text`.
- One structured JSON LLM request for the distinct `llm-*` fields referenced by the template; templates containing only `datetime`, `literal` or plain text make no model call.
- Long first prompts retain their beginning and end within the input byte budget, with an explicit omission marker.
- A deliberately small template DSL supporting `${identifier}` only; functions, paths, conditions, expressions, and code evaluation are rejected.
- Invalid managed templates use `default`; extraction failure, cancellation, timeout, empty output, tool calls, and non-stop finishes use DSH's native fallback path.
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

The package includes Host and browser entries mounted through `cordis.patch.yml` and DSH's client loader. The settings page requires native settings, settings UI, locale and API remotes. Host-only composition without settings retains the Cordis configuration behavior.

## Usage

### Template manager

Fresh settings offer a custom `emoji` template with `MMDD | 🎨 | description` formatting, the six task-type values 🎨 / 🔍 / 🚀 / 🔧 / ♻️ / 📦, and `desc.maxCharacters: 1024`. `default` remains selected. The preset is inherited until you save template changes to `$DSH_HOME/settings.yaml`; an existing stored templates map or legacy Cordis template is preserved. You can edit or delete `emoji`, and deletion persists.

Choose **Duplicate** on any row, including `default`, to open a new draft containing that row's YAML. Enter a unique name and save; saving does not activate the copy. Invalid templates can be copied for repair, but must pass validation before saving.

Each row shows an **Example** title, updated while editing. It uses the current date in the configured timezone, literal values, the first enum candidate and illustrative text limited by `maxCharacters`. No model request is made; real semantic values and DSH's final byte limit may produce a different title. Invalid YAML shows an unavailable message.

Open **Settings → Session Title**. **New template** copies `default`; choose a unique name, edit YAML, then **Save** and **Activate**. Saving does not activate a new template. `default` is viewable and selectable but cannot be edited or deleted. Deleting the selected template selects `default`. Turning **Use title templates** off preserves your templates and selection, and calls DSH's native first-prompt LLM generator.

![Session Title template manager](assets/screenshots/template-manager.png)

Templates appear in compact rows with their status and actions. Edit or view a
template to expand its editor in place; the panel follows DSH's light/dark theme
and adapts to narrow screens. The generation switch is locked while an editor is
open, so changing it cannot make your own draft stale.

The multiline editor accepts only `template` and optional `fields`; omit `preset`. Save validates YAML syntax, duplicate keys, `${identifier}` references, field kinds, date/timezone formats and enum/text constraints. Names contain 1–64 letters, numbers, spaces, underscores or hyphens, starting with a letter or number. `default`, `constructor`, `prototype` and `__proto__` are reserved. Template text is limited to 65536 characters. Field definitions inherit built-in fields by name; each override replaces a whole definition.

The source of truth is the `clutch-dsh-title` namespace in `$DSH_HOME/settings.yaml` (normally `~/.dsh/settings.yaml`, or the DSH settings provider's configured file). No browser storage or `clutch.yaml` is used:

```yaml
clutch-dsh-title:
  enabled: true
  active: personal
  templates:
    personal: |
      template: '${daytime}|${desc}'
```

DSH's watcher receives external edits. Invalid templates stay visible with errors and cannot be activated. An invalid/missing selected template uses `default`; repairing and saving it restores the selection. External `default` overrides are ignored. Invalid container settings show diagnostics and use safe defaults. If the entire YAML document is malformed, DSH retains its last readable document during hot reload.

The page validates before sending writes; the storage schema deliberately accepts invalid external entries so they remain repairable. Runtime generation validates again. Writes preserve unrelated entries and carry `expectedRevision`; `settings/conflict` reports a stale save. Observed external updates preserve drafts and require reopening the editor. DSH has a race window before its file watcher receives an external edit: avoid simultaneous manual file edits and page saves. Read-only settings disable writes.

### Existing Cordis configuration

The bundle patch disables the exact DSH entry named `@deepseek-ai/dsh-session-title-first-prompt-llm` and inserts this plugin with `preset: default`. The native title service remains the only title subsystem.

Existing Cordis overrides remain supported. With settings composed, explicit `template`/`fields` overrides become an inherited editable `legacy` template instead of changing `default`. A stored templates map replaces the inherited map. Model routing and request budgets remain Cordis configuration. The default Cordis configuration is:

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
    values:
      - value: 设计
        description: 明确需求、制定实现方案，或设计架构、接口和交互时使用
      - value: 探索
        description: 理解代码、调研技术、分析问题或验证可行性，主要目标是获得结论时使用
      - value: 功能
        description: 新增此前不存在的能力，或扩展现有功能的使用场景时使用
      - value: 修复
        description: 纠正缺陷、排查并解决故障，或恢复预期行为时使用
      - value: 优化
        description: 在保持现有功能含义的基础上，改善性能、体验、结构或可维护性时使用
      - value: 发布
        description: 准备版本、编写发布说明、打包、部署或执行上线流程时使用

  desc:
    kind: llm-text
    instruction: 总结首次 prompt，保留具体任务含义
    maxCharacters: 32
```

Field definitions are merged by field name, while an override replaces one complete field definition. For example, a project can use arbitrary field names and a controlled set of values:

Each `llm-enum.values` entry accepts either a string or an object with non-empty `value` and `description`. Both forms can be mixed. Descriptions tell the model when to select a value; only the value appears in the title. Values must be unique after normalization. Invalid entries block saving and activation; an invalid active template loaded from disk falls back to `default`.

```yaml
preset: default
template: '${daytime}|${kind}|${desc}'
fields:
  kind:
    kind: llm-enum
    instruction: 判断任务是优化、功能还是修复
    values:
      - value: 优化
        description: 改进已有功能的性能、体验或结构时使用
      - value: 功能
        description: 新增此前不存在的能力时使用
      - value: 修复
        description: 纠正错误或恢复预期行为时使用
  desc:
    kind: llm-text
    instruction: 总结首次 prompt
    maxCharacters: 32
```

Only fields referenced by the compiled template are resolved. Repeated references are extracted once, and all referenced LLM fields are sent in one JSON-framed request. For example, `${daytime}|${desc}|${desc}` requests only `desc`, and does not require the inherited `type` output. `${daytime}` or a literal-only template makes no model call and writes no `session/title-llm-request` event. All field definitions, including unused and inherited definitions, still undergo configuration validation.

The model returns fields only; the renderer inserts deterministic values and literal separators. The renderer does not execute template content, and field validation trims, removes control characters, and enforces enum membership or Unicode-character limits before rendering.

### Title reasoning effort

Cordis `reasoningEffort` defaults to `off`. The plugin passes this adapter-owned ID through `GenerateOptions.reasoningEffort` for template field extraction, in addition to the concise JSON prompt. Set it to another non-empty ID supported by the selected provider/model, or explicitly set `reasoningEffort: null` to omit the option and use adapter defaults. This is a plugin-level Cordis option, not template YAML or a setting in the template manager; it remains effective across template changes.

Actual thinking behavior depends on the DSH adapter and model. In particular, pi-ai may implement `off` by omitting its reasoning option, which cannot guarantee that the upstream model stops thinking. Unsupported efforts may fail with `UNSUPPORTED_REASONING_EFFORT` and use native title fallback; the plugin does not retry with another effort. This option applies only while title templates are enabled, and does not alter main conversation requests or the native generator used when templates are disabled. The native `session/title-llm-request` event schema remains unchanged and does not record reasoning effort.

### Long first prompts and input budget

Cordis `maxInputBytes` defaults to `4096`. It limits the complete JSON-framed user input actually sent to the model, including framing instructions, `seq`, JSON escaping and clipping metadata. It excludes the separate system instructions and model transport envelope. Short inputs retain their original framing and text.

When that input exceeds the budget, the plugin trims outer whitespace and retains the beginning and end of the first eligible prompt. After reserving framing and marker overhead, it divides escaped UTF-8 bytes approximately equally between the two ends, reusing spare capacity at the other end. The serialized entry has `truncated: true`, and the omitted middle is replaced by `\n[...middle omitted...]\n`. Cuts preserve Unicode code points (including surrogate pairs), but may split a combined emoji or other grapheme cluster. The final complete input is checked against the byte limit again.

Keeping both ends preserves introductory context and closing requirements; middle details are lost and title accuracy may decrease. No model summary, additional model call or later conversation is used. Each end must retain at least one non-whitespace source code point; a budget too small for this valid marked input fails with a `maxInputBytes` error and uses native fallback.

The `session/title-llm-request` event records the exact clipped payload sent to the model; `messageSeqs` retains the original source sequence. Original session messages are never modified. DSH's native automatic scheduling still waits for its request header, including for deterministic templates; explicit refresh can render such templates without a model route.

If extraction fails, the provider throws and `ctx.sessionTitle` applies DSH's native fallback. Native `rename()` still pins a user title; later automatic work cannot overwrite it, while native `refresh()` remains the explicit re-derivation operation. Titles and `session/title-llm-request` events use DSH persistence and are inherited by native forks. Configuration changes do not rewrite historical title events or trigger a batch rename.

Only one provider may be registered in a context. Keep the default provider disabled when this package is enabled, and do not compose it with another provider that also registers `ctx.sessionTitle`.

For package-specific release parameters, see [`docs/RELEASING.md`](docs/RELEASING.md). For the public release history, see [`RELEASE-LOG.md`](RELEASE-LOG.md).
